"""Suite 18 — Discovery evidence and independent replication.

* `Ledger`: append-only, hash-chained JSONL record (each entry commits to the previous entry's hash),
  so any retrospective edit of a preregistration, dataset record or result is detectable.
* Preregistration: freezes model versions, design, predicted distributions, decision rules,
  code hash, seeds and analysis plan BEFORE outcome data are unblinded.
* `BlindVault`: withheld datasets are committed by hash on ingestion and cannot be read for analysis
  until an unblinding entry is recorded after a matching preregistration; datasets carry a role
  (calibration / selection / blind_test / replication) and blind-test data are refused for
  calibration or model selection.
* Seven acceptance gates G1–G7 (spec Part II §C) evaluated from recorded evidence; gates requiring
  human or physical evidence cannot be passed by software alone.
* Evidence-classification ladder (spec §22) and reproduction packages.
"""
from __future__ import annotations

import fcntl
import hashlib
import io
import json
import os
from contextlib import contextmanager
import platform
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from . import __version__

GENESIS = "0" * 64
DATA_LABELS = ("REAL", "SYNTHETIC", "REFERENCE", "LITERATURE", "TRAINING")
ROLES = ("calibration", "selection", "blind_test", "replication", "exploratory")

EVIDENCE_LADDER = [
    "Hypothesis generated",
    "Mathematically formulated",
    "Numerically explored",
    "Numerically verified within stated conditions",
    "Computationally independently reproduced",
    "Experimentally testable",
    "Experimental evidence obtained",
    "Independently experimentally replicated",
    "Strongly supported within stated assumptions",
]


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str).encode()


def code_hash(root: Path | None = None) -> str:
    """Hash of every .py source file in the qgdevs package (sorted), identifying the exact code version."""
    root = root or Path(__file__).parent
    h = hashlib.sha256()
    for p in sorted(root.rglob("*.py")):
        h.update(p.relative_to(root).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Ledger:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.touch(exist_ok=True)

    @contextmanager
    def _locked(self, exclusive: bool):
        """Advisory lock on a sidecar file. Several API and worker processes append to the same ledger:
        without it two writers read the same head and both commit to it, permanently breaking the chain."""
        with open(self.path.with_name(self.path.name + ".lock"), "a") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
            try:
                yield
            finally:
                fcntl.flock(lk, fcntl.LOCK_UN)

    def _read(self) -> list[dict]:
        with self.path.open() as f:
            return [json.loads(line) for line in f if line.strip()]

    def entries(self) -> list[dict]:
        with self._locked(False):
            return self._read()

    def head(self) -> str:
        e = self.entries()
        return e[-1]["entry_hash"] if e else GENESIS

    def append(self, kind: str, payload: dict, actor: str = "system") -> dict:
        # hash the JSON-normalised payload, i.e. exactly what is stored and later re-hashed by verify()
        payload = json.loads(json.dumps(payload, default=str))
        with self._locked(True):
            es = self._read()
            prev = es[-1]["entry_hash"] if es else GENESIS
            body = {"index": len(es), "timestamp_utc": now(), "kind": kind, "actor": actor,
                    "payload_sha256": sha256_bytes(canonical(payload)), "payload": payload, "prev_hash": prev}
            body["entry_hash"] = sha256_bytes(canonical({k: v for k, v in body.items() if k != "payload"}))
            with self.path.open("a") as f:
                f.write(json.dumps(body, default=str) + "\n")
                f.flush()
                os.fsync(f.fileno())
        return body

    def snapshot_bytes(self) -> bytes:
        """Consistent copy of the ledger file (no partially appended entry), e.g. for backups."""
        with self._locked(False):
            return self.path.read_bytes()

    def verify(self) -> dict:
        prev = GENESIS
        es = self.entries()
        for i, e in enumerate(es):
            if e.get("index") != i:
                return {"valid": False, "broken_at": i, "reason": "index mismatch"}
            if e["prev_hash"] != prev:
                return {"valid": False, "broken_at": i, "reason": "prev_hash mismatch"}
            if sha256_bytes(canonical(e["payload"])) != e["payload_sha256"]:
                return {"valid": False, "broken_at": i, "reason": "payload altered"}
            h = sha256_bytes(canonical({k: v for k, v in e.items() if k not in ("payload", "entry_hash")}))
            if h != e["entry_hash"]:
                return {"valid": False, "broken_at": i, "reason": "entry hash mismatch"}
            prev = e["entry_hash"]
        return {"valid": True, "length": len(es), "head": prev}

    def find(self, kind: str, **match) -> list[dict]:
        return [e for e in self.entries() if e["kind"] == kind
                and all(e["payload"].get(k) == v for k, v in match.items())]


def preregister(ledger: Ledger, *, title: str, hypotheses: list[str], design: dict, predictions: dict,
                decision_rules: dict, analysis_plan: str, seeds: list[int], sample_size: dict,
                nuisance_ranges: dict, actor: str = "researcher") -> dict:
    payload = {"prereg_id": sha256_bytes(canonical([title, design, predictions, now()]))[:16], "title": title,
               "hypotheses": hypotheses, "design": design, "predictions": predictions,
               "decision_rules": decision_rules, "analysis_plan": analysis_plan, "seeds": seeds,
               "sample_size": sample_size, "nuisance_ranges": nuisance_ranges,
               "software_version": __version__, "code_sha256": code_hash(),
               "python": platform.python_version()}
    return ledger.append("preregistration", payload, actor)


@dataclass
class DatasetRecord:
    dataset_id: str
    label: str
    role: str
    sha256: str
    source: str
    description: str


class BlindVault:
    """Withheld-data store. Data bytes live in `root`; access requires a recorded unblinding."""

    def __init__(self, root: str | Path, ledger: Ledger):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.ledger = ledger

    def ingest(self, data: bytes, *, label: str, role: str, source: str, description: str,
               prereg_id: str | None = None) -> DatasetRecord:
        if label not in DATA_LABELS:
            raise ValueError(f"label must be one of {DATA_LABELS}")
        if role not in ROLES:
            raise ValueError(f"role must be one of {ROLES}")
        if prereg_id is not None and not self.ledger.find("preregistration", prereg_id=prereg_id):
            raise ValueError(f"no preregistration with id {prereg_id!r}")
        h = sha256_bytes(data)
        for prev in self.ledger.find("dataset_ingest", dataset_id=h[:16]):
            pp = prev["payload"]
            if (pp["label"], pp["role"]) != (label, role):
                # the same bytes under a second role would let sealed blind-test data be read through the
                # unsealed record (or make an already-read dataset look sealed)
                raise ValueError(f"these bytes are already ingested as dataset {pp['dataset_id']} with label "
                                 f"{pp['label']} and role {pp['role']}; re-ingestion under a different label/role "
                                 "is refused")
        f = self.root / h
        if not f.exists():  # content-addressed: identical bytes are already stored (and read-only)
            f.write_bytes(data)
            os.chmod(f, 0o440)
        rec = DatasetRecord(h[:16], label, role, h, source, description)
        self.ledger.append("dataset_ingest", {**rec.__dict__, "prereg_id": prereg_id, "bytes": len(data)})
        return rec

    def unblind(self, dataset_id: str, prereg_id: str, actor: str = "researcher") -> dict:
        prereg = self.ledger.find("preregistration", prereg_id=prereg_id)
        if not prereg:
            raise PermissionError("no preregistration with this id: unblinding refused")
        ing = self.ledger.find("dataset_ingest", dataset_id=dataset_id)
        if not ing:
            raise KeyError("unknown dataset")
        bound = {e["payload"].get("prereg_id") for e in ing} - {None}
        if bound and prereg_id not in bound:
            raise PermissionError(f"dataset was ingested under preregistration(s) {sorted(bound)}; "
                                  "unblinding under a different preregistration is refused")
        if ing[0]["payload"]["role"] == "blind_test" and prereg[0]["index"] > ing[0]["index"]:
            # a blind-test dataset ingested before the preregistration is still valid only if it stayed sealed
            if self.ledger.find("data_access", dataset_id=dataset_id):
                raise PermissionError("blind-test data were accessed before preregistration")
        return self.ledger.append("unblinding", {"dataset_id": dataset_id, "prereg_id": prereg_id}, actor)

    def read(self, dataset_id: str, purpose: str) -> bytes:
        ing = self.ledger.find("dataset_ingest", dataset_id=dataset_id)
        if not ing:
            raise KeyError("unknown dataset")
        p = ing[0]["payload"]
        if any(e["payload"]["role"] == "blind_test" for e in ing):  # most restrictive record governs
            if purpose in ("calibration", "selection", "training"):
                raise PermissionError("blind-test data may not be used for calibration, model selection or training")
            if not self.ledger.find("unblinding", dataset_id=dataset_id):
                raise PermissionError("blind-test data are sealed until a preregistered unblinding is recorded")
        data = (self.root / p["sha256"]).read_bytes()
        if sha256_bytes(data) != p["sha256"]:
            raise RuntimeError("stored data do not match their committed hash (tampering or corruption)")
        self.ledger.append("data_access", {"dataset_id": dataset_id, "purpose": purpose})
        return data


# ----------------------------------------------------------------------------- acceptance gates
GATES = [
    ("G1", "Theory", "Complete Hamiltonian/action, dynamics, assumptions; consistent known limits; independently reviewed derivation"),
    ("G2", "Novel prediction", "DOI-linked literature comparison; not a known restatement; reproduced by a second implementation"),
    ("G3", "Solver assurance", "State, conservation and convergence tests; tolerances justified in advance; applicable Lean proofs"),
    ("G4", "Feasibility", "Bill of materials, constraints, sensitivity and cost; experimental team confirms plausibility"),
    ("G5", "Preregistration", "Immutable code/config/data hashes, predicted distribution, blind analysis plan before unblinding"),
    ("G6", "Experimental result", "Instrument-native raw data, calibration, controls, telemetry; meets prespecified criteria"),
    ("G7", "Replication", "Independent lab data and code reproduce the conclusion under stated assumptions"),
]


def evaluate_gates(*, model_meta: dict | None, vv_report: dict | None, lean_status: dict | None,
                   ledger: Ledger | None, dossier: dict | None, literature_review: dict | None = None,
                   second_implementation_match: bool | None = None) -> list[dict]:
    """Evaluate the seven gates from recorded evidence. Status ∈ PASSED, PARTIAL, NOT_PASSED, REQUIRES_HUMAN."""
    entries = ledger.entries() if ledger else []
    signoffs = {e["payload"].get("gate"): e for e in entries if e["kind"] == "human_signoff"}
    out = []

    def rec(g, status, evidence, missing):
        out.append({"gate": g[0], "name": g[1], "criterion": g[2], "status": status,
                    "evidence": evidence, "missing": missing})

    g = GATES[0]
    if model_meta and all(k in model_meta for k in ("dynamics", "assumptions", "admissible_domain", "known_limits")):
        rec(g, "PASSED" if "G1" in signoffs else "REQUIRES_HUMAN", ["model registry G1 record complete"],
            [] if "G1" in signoffs else ["independent review of the derivation (human sign-off)"])
    else:
        rec(g, "NOT_PASSED", [], ["complete model specification"])

    g = GATES[1]
    miss = []
    if not literature_review or not literature_review.get("dois"):
        miss.append("DOI-linked literature comparison")
    elif literature_review.get("verdict") == "known":
        miss.append("prediction is a known result (literature review)")
    if not second_implementation_match:
        miss.append("reproduction by an independent implementation")
    rec(g, "PASSED" if not miss else ("PARTIAL" if len(miss) == 1 else "NOT_PASSED"),
        [x for x in ["second implementation agrees" if second_implementation_match else None,
                     "literature review recorded" if literature_review else None] if x], miss)

    g = GATES[2]
    summ = (vv_report or {}).get("summary") or {}
    # a run must have executed benchmarks (an empty or unknown-id run is vacuous) and cover the full registry
    vv_ok = bool(summ.get("total", 0) > 0 and summ.get("failed", 1) == 0 and vv_report.get("scope", "full") == "full")
    proved = [t for t in (lean_status or {}).get("theorems", []) if t.get("status") == "proved"]
    rec(g, "PASSED" if vv_ok and proved else ("PARTIAL" if vv_ok or proved else "NOT_PASSED"),
        [f"V&V: {vv_report['summary']}" if vv_report else None, f"{len(proved)} Lean theorems machine-checked"],
        ([] if vv_ok else ["all verification benchmarks passing"]) + ([] if proved else ["machine-checked proofs"]))

    g = GATES[3]
    if dossier:
        trl = dossier["engineering"]["technological_readiness"]["overall_trl"]
        status = "REQUIRES_HUMAN" if trl >= 4 else "NOT_PASSED"
        rec(g, "PASSED" if status == "REQUIRES_HUMAN" and "G4" in signoffs else status,
            [f"dossier generated; overall TRL {trl}"],
            (["experimental team confirmation"] if "G4" not in signoffs else []) +
            (["requirements exceed demonstrated capability"] if trl < 4 else []))
    else:
        rec(g, "NOT_PASSED", [], ["experimental dossier"])

    g = GATES[4]
    preregs = [e for e in entries if e["kind"] == "preregistration"]
    chain_ok = bool(ledger and ledger.verify()["valid"])
    rec(g, "PASSED" if preregs and chain_ok else "NOT_PASSED",
        [f"{len(preregs)} preregistration(s) in a valid ledger"] if preregs and chain_ok else [],
        ([] if preregs else ["preregistration record"]) + ([] if chain_ok or not preregs else
                                                           ["ledger hash chain fails verification"]))

    g = GATES[5]
    real = [e for e in entries if e["kind"] == "dataset_ingest" and e["payload"].get("label") == "REAL"]
    rec(g, "NOT_PASSED" if not real else "REQUIRES_HUMAN", [f"{len(real)} REAL dataset(s) ingested"] if real else [],
        ["authentic instrument-native physical measurements"] if not real else
        ["assessment of results against preregistered criteria and alternative models"])

    g = GATES[6]
    repl = [e for e in entries if e["kind"] == "dataset_ingest" and e["payload"].get("role") == "replication"
            and e["payload"].get("label") == "REAL"]
    rec(g, "NOT_PASSED" if not repl else "REQUIRES_HUMAN", [], ["independent laboratory replication"])
    for o in out:
        o["evidence"] = [x for x in o["evidence"] if x]
    return out


def classify_evidence(gates: list[dict], formulated: bool = True, explored: bool = True,
                      independently_reproduced: bool = False) -> dict:
    """Highest rung of the evidence ladder justified by the recorded evidence.

    Rungs are strictly cumulative: a rung is granted only if every lower rung is.
    """
    st = {g["gate"]: g["status"] for g in gates}
    requirements = [
        True,                                   # 0 hypothesis generated
        formulated,                             # 1 mathematically formulated
        explored,                               # 2 numerically explored
        st.get("G3") == "PASSED",               # 3 numerically verified
        independently_reproduced,               # 4 computationally independently reproduced
        st.get("G4") == "PASSED",               # 5 experimentally testable (feasibility confirmed)
        st.get("G6") == "PASSED",               # 6 experimental evidence obtained
        st.get("G7") == "PASSED",               # 7 independently experimentally replicated
        all(v == "PASSED" for v in st.values()),  # 8 strongly supported
    ]
    level = 0
    for k, ok in enumerate(requirements):
        if not ok:
            break
        level = k
    return {"level": level, "classification": EVIDENCE_LADDER[level],
            "physical_claim_permitted": level >= 6,
            "statement": "No physical claim about the nature of gravity is supported by this evidence."
            if level < 6 else "Physical evidence obtained; see gate details for the assumptions under which it holds."}


def reproduction_package(*, config: dict, results: dict, ledger: Ledger | None, notes: str = "") -> bytes:
    """Zip archive with configuration, results, code hash, environment and instructions."""
    buf = io.BytesIO()
    manifest = {"created_utc": now(), "software_version": __version__, "code_sha256": code_hash(),
                "python": platform.python_version(), "platform": platform.platform()}
    try:
        import numpy, scipy
        manifest["numpy"] = numpy.__version__
        manifest["scipy"] = scipy.__version__
    except Exception:
        pass
    files = {"config.json": canonical(config), "results.json": json.dumps(results, indent=2, default=str).encode(),
             "manifest.json": json.dumps(manifest, indent=2).encode(),
             "README.txt": (
                 "QG-DEVS reproduction package\n\n1. Install the QG-DEVS version in manifest.json "
                 "(pip install -e . from the matching source revision; verify code_sha256 with qgdevs.evidence.code_hash()).\n"
                 "2. Re-run: python -m qgdevs.cli reproduce config.json > rerun.json\n"
                 "3. Compare rerun.json with results.json; all deterministic outputs must match to the stated tolerances.\n\n"
                 + notes).encode()}
    if ledger:
        files["ledger.jsonl"] = ledger.snapshot_bytes()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
        z.writestr("SHA256SUMS", "\n".join(f"{sha256_bytes(d)}  {n}" for n, d in files.items()))
    return buf.getvalue()
