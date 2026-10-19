"""Suite 17 — Scientific data, visualisation support and research management.

* Format I/O: JSON, CSV, HDF5, Parquet, NumPy (.npy/.npz), Matrix Market — every written file carries
  provenance attributes (label, source, software version, SHA-256 of the payload).
* Validation on import: density-matrix admissibility, units/dimensions of named quantities,
  SYNTHETIC vs REAL labelling (unlabelled data are rejected for evidence use).
* Catalogue: SQLite registry of datasets with provenance, role and licence.
* Source connectors for public repositories. Each connector states what its data can and cannot
  evidence (e.g. gravitational-wave strain is genuine gravitational data but is NOT evidence of
  gravity-mediated entanglement). Connectors respect rate limits and record fetch timestamps; sources
  that publish periodically are never presented as real-time.
"""
from __future__ import annotations

import hashlib
import io
import json
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import __version__
from .quantum import check_density_matrix

LABELS = ("REAL", "SYNTHETIC", "REFERENCE", "LITERATURE", "TRAINING")


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------------------------------------------------------------------- formats
def write_hdf5(path: str | Path, arrays: dict[str, np.ndarray], attrs: dict) -> str:
    import h5py
    with h5py.File(path, "w") as f:
        for k, v in arrays.items():
            f.create_dataset(k, data=v, compression="gzip")
        for k, v in {**attrs, "qgdevs_version": __version__, "written_utc": utcnow()}.items():
            f.attrs[k] = json.dumps(v) if isinstance(v, (dict, list)) else v
    return sha256(Path(path).read_bytes())


def read_hdf5(path: str | Path) -> tuple[dict, dict]:
    import h5py
    with h5py.File(path, "r") as f:
        arrays = {k: f[k][()] for k in f.keys()}
        attrs = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in f.attrs.items()}
    return arrays, attrs


def write_parquet(path: str | Path, table: dict[str, list], meta: dict) -> str:
    import pyarrow as pa
    import pyarrow.parquet as pq
    t = pa.table(table)
    t = t.replace_schema_metadata({**{k: json.dumps(v) for k, v in meta.items()},
                                   "qgdevs_version": __version__})
    pq.write_table(t, path)
    return sha256(Path(path).read_bytes())


def read_parquet(path: str | Path) -> tuple[dict, dict]:
    import pyarrow.parquet as pq
    t = pq.read_table(path)
    meta = {k.decode(): v.decode() for k, v in (t.schema.metadata or {}).items()}
    return t.to_pydict(), meta


def read_matrix_market(text: str) -> np.ndarray:
    from scipy.io import mmread
    return np.asarray(mmread(io.StringIO(text)).todense() if hasattr(mmread(io.StringIO(text)), "todense")
                      else mmread(io.StringIO(text)))


def parse_upload(name: str, data: bytes) -> dict:
    """Parse an uploaded file into arrays/tables plus detected metadata (no execution of content)."""
    ext = Path(name).suffix.lower()
    if ext == ".json":
        return {"kind": "json", "content": json.loads(data.decode())}
    if ext == ".csv":
        import csv
        rows = list(csv.reader(io.StringIO(data.decode())))
        header, body = rows[0], rows[1:]
        cols = {h: [] for h in header}
        for r in body:
            for h, v in zip(header, r):
                try:
                    cols[h].append(float(v))
                except ValueError:
                    cols[h].append(v)
        return {"kind": "table", "content": cols}
    if ext == ".npy":
        return {"kind": "array", "content": np.load(io.BytesIO(data), allow_pickle=False)}
    if ext == ".npz":
        z = np.load(io.BytesIO(data), allow_pickle=False)
        return {"kind": "arrays", "content": {k: z[k] for k in z.files}}
    if ext in (".h5", ".hdf5"):
        import h5py
        with h5py.File(io.BytesIO(data), "r") as f:
            arrays = {k: f[k][()] for k in f.keys() if isinstance(f[k], h5py.Dataset)}
            attrs = dict(f.attrs)
        return {"kind": "arrays", "content": arrays, "attrs": attrs}
    if ext == ".parquet":
        import pyarrow.parquet as pq
        return {"kind": "table", "content": pq.read_table(io.BytesIO(data)).to_pydict()}
    if ext == ".mtx":
        return {"kind": "array", "content": read_matrix_market(data.decode())}
    raise ValueError(f"unsupported format '{ext}'")


def validate_density_matrix(arr) -> dict:
    a = np.asarray(arr)
    if a.ndim != 2 or a.shape[0] != a.shape[1]:
        return {"passed": False, "reason": "not a square matrix"}
    return check_density_matrix(a.astype(complex), tol=1e-8).as_dict()


# ----------------------------------------------------------------------------- catalogue
class Catalogue:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.execute("""create table if not exists datasets (
                id text primary key, name text, label text, role text, source text, licence text,
                sha256 text, created_utc text, fetched_utc text, description text, schema_json text,
                evidence_scope text, size_bytes integer)""")

    def _conn(self):
        return sqlite3.connect(self.path)

    def add(self, *, name: str, label: str, source: str, sha: str, description: str = "", role: str = "exploratory",
            licence: str = "unspecified", schema: dict | None = None, evidence_scope: str = "",
            fetched_utc: str | None = None, size: int = 0) -> str:
        if label not in LABELS:
            raise ValueError(f"label must be one of {LABELS}")
        did = sha[:16]
        with self._conn() as c:
            c.execute("insert or replace into datasets values (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (did, name, label, role, source, licence, sha, utcnow(), fetched_utc, description,
                       json.dumps(schema or {}), evidence_scope, size))
        return did

    def list(self, label: str | None = None) -> list[dict]:
        with self._conn() as c:
            c.row_factory = sqlite3.Row
            q = "select * from datasets" + (" where label = ?" if label else "") + " order by created_utc desc"
            return [dict(r) for r in c.execute(q, (label,) if label else ())]

    def get(self, did: str) -> dict | None:
        with self._conn() as c:
            c.row_factory = sqlite3.Row
            r = c.execute("select * from datasets where id = ?", (did,)).fetchone()
            return dict(r) if r else None


# ----------------------------------------------------------------------------- connectors
@dataclass
class Connector:
    id: str
    name: str
    url: str
    label: str
    licence: str
    cadence: str
    evidence_scope: str
    min_interval_s: float = 3.0

    def fetch(self, client, **kw) -> dict:
        raise NotImplementedError


class CodataConnector(Connector):
    def fetch(self, client, **kw):
        r = client.get(self.url, timeout=30)
        r.raise_for_status()
        rows = []
        for line in r.text.splitlines():
            if len(line) > 60 and not line.startswith(("Quantity", "-", " ")):
                parts = [p for p in line[60:].split("  ") if p.strip()]
                rows.append({"quantity": line[:60].strip(), "fields": [p.strip() for p in parts]})
        return {"records": rows, "raw_sha256": sha256(r.content)}


class ArxivConnector(Connector):
    def fetch(self, client, query: str = 'all:"gravity mediated entanglement"', max_results: int = 25, **kw):
        import xml.etree.ElementTree as ET
        r = client.get(self.url, params={"search_query": query, "start": 0, "max_results": max_results,
                                         "sortBy": "submittedDate", "sortOrder": "descending"}, timeout=90)
        r.raise_for_status()
        ns = {"a": "http://www.w3.org/2005/Atom"}
        root = ET.fromstring(r.text)
        recs = []
        for e in root.findall("a:entry", ns):
            recs.append({"id": e.findtext("a:id", default="", namespaces=ns),
                         "title": " ".join(e.findtext("a:title", default="", namespaces=ns).split()),
                         "published": e.findtext("a:published", default="", namespaces=ns),
                         "authors": [a.findtext("a:name", default="", namespaces=ns) for a in e.findall("a:author", ns)],
                         "summary": " ".join(e.findtext("a:summary", default="", namespaces=ns).split())[:600]})
        return {"records": recs, "query": query, "raw_sha256": sha256(r.content)}


class CrossrefConnector(Connector):
    def fetch(self, client, query: str = "gravitationally induced entanglement", rows: int = 20, **kw):
        r = client.get(self.url, params={"query": query, "rows": rows, "sort": "published", "order": "desc"},
                       headers={"User-Agent": "QG-DEVS research platform (https://github.com/samuelakosaonyejekwe/qg-devs)"},
                       timeout=30)
        r.raise_for_status()
        items = r.json()["message"]["items"]
        return {"records": [{"doi": i.get("DOI"), "title": (i.get("title") or [""])[0],
                             "container": (i.get("container-title") or [""])[0],
                             "published": i.get("published", {}).get("date-parts", [[None]])[0]} for i in items],
                "query": query, "raw_sha256": sha256(r.content)}


class ZenodoConnector(Connector):
    def fetch(self, client, query: str = "quantum gravity entanglement", size: int = 20, **kw):
        r = client.get(self.url, params={"q": query, "size": size, "sort": "mostrecent"}, timeout=30)
        r.raise_for_status()
        hits = r.json().get("hits", {}).get("hits", [])
        return {"records": [{"doi": h.get("doi"), "title": h.get("metadata", {}).get("title"),
                             "type": h.get("metadata", {}).get("resource_type", {}).get("type"),
                             "license": (h.get("metadata", {}).get("license") or {}).get("id"),
                             "published": h.get("metadata", {}).get("publication_date")} for h in hits],
                "query": query, "raw_sha256": sha256(r.content)}


class GwoscConnector(Connector):
    def fetch(self, client, **kw):
        r = client.get(self.url, timeout=60)
        r.raise_for_status()
        ev = r.json().get("events", {})
        recs = [{"name": k, "gps": v.get("GPS"), "catalog": v.get("catalog.shortName"),
                 "mass_1_source": v.get("mass_1_source"), "mass_2_source": v.get("mass_2_source"),
                 "luminosity_distance": v.get("luminosity_distance")} for k, v in ev.items()]
        return {"records": recs, "raw_sha256": sha256(r.content)}


class CernOpenDataConnector(Connector):
    def fetch(self, client, query: str = "gravity", size: int = 10, **kw):
        r = client.get(self.url, params={"q": query, "size": size}, timeout=30)
        r.raise_for_status()
        hits = r.json().get("hits", {}).get("hits", [])
        return {"records": [{"recid": h.get("metadata", {}).get("recid"), "title": h.get("metadata", {}).get("title"),
                             "experiment": h.get("metadata", {}).get("experiment")} for h in hits],
                "query": query, "raw_sha256": sha256(r.content)}


CONNECTORS: dict[str, Connector] = {c.id: c for c in [
    CodataConnector("nist-codata", "NIST CODATA fundamental constants", "https://physics.nist.gov/cuu/Constants/Table/allascii.txt",
                    "REFERENCE", "public domain (US Government work)", "updated every four years (CODATA adjustment)",
                    "reference constants for calculations; not experimental evidence for any hypothesis", 60.0),
    ArxivConnector("arxiv", "arXiv preprints (metadata)", "https://export.arxiv.org/api/query", "LITERATURE",
                   "metadata CC0; papers under author-chosen licences", "daily announcements",
                   "literature for prior-art and novelty assessment; preprints are not peer reviewed", 3.0),
    CrossrefConnector("crossref", "Crossref DOI metadata", "https://api.crossref.org/works", "LITERATURE",
                      "metadata CC0", "continuous deposit by publishers",
                      "bibliographic records for citation and novelty review", 1.0),
    ZenodoConnector("zenodo", "Zenodo research records", "https://zenodo.org/api/records", "LITERATURE",
                    "per-record licence", "continuous", "datasets and software records; each must be assessed individually", 2.0),
    GwoscConnector("gwosc", "GWOSC gravitational-wave event catalogue (LIGO/Virgo/KAGRA)",
                   "https://gwosc.org/eventapi/json/allevents/", "REFERENCE", "CC BY 4.0", "per catalogue release",
                   "genuine classical gravitational-wave observations; NOT evidence of gravity-mediated entanglement "
                   "or of quantised gravity", 10.0),
    CernOpenDataConnector("cern-opendata", "CERN Open Data portal", "https://opendata.cern.ch/api/records/", "REFERENCE",
                          "CC0 / per-record", "per release", "particle-physics data; not direct evidence about quantum "
                          "gravitational interactions between masses", 5.0),
]}


def fetch_source(connector_id: str, store: Path, catalogue: Catalogue, client=None, **kw) -> dict:
    """Fetch from a connector, store the normalised JSON with provenance, and register it in the catalogue."""
    import ssl
    import httpx
    c = CONNECTORS[connector_id]
    own = client is None
    # system trust store: some scientific hosts chain to roots absent from certifi's bundle
    client = client or httpx.Client(follow_redirects=True, verify=ssl.create_default_context())
    try:
        t0 = time.time()
        for attempt in range(4):
            try:
                res = c.fetch(client, **kw)
                break
            except (httpx.HTTPStatusError, httpx.TimeoutException) as e:
                status = getattr(getattr(e, "response", None), "status_code", None)
                if (isinstance(e, httpx.HTTPStatusError) and status not in (429, 503)) or attempt == 3:
                    raise
                hdr = e.response.headers.get("retry-after", 0) if status else 0
                wait = float(hdr or 0) or c.min_interval_s * 4 ** attempt
                time.sleep(min(wait, 120))
    finally:
        if own:
            client.close()
    rec = {"connector": c.id, "source": c.url, "fetched_utc": utcnow(), "label": c.label, "licence": c.licence,
           "cadence": c.cadence, "evidence_scope": c.evidence_scope, "n_records": len(res.get("records", [])),
           "elapsed_s": round(time.time() - t0, 3), **res}
    payload = json.dumps(rec, indent=1, default=str).encode()
    h = sha256(payload)
    store.mkdir(parents=True, exist_ok=True)
    (store / f"{c.id}-{h[:12]}.json").write_bytes(payload)
    did = catalogue.add(name=f"{c.name} @ {rec['fetched_utc'][:19]}", label=c.label, source=c.url, sha=h,
                        description=f"{rec['n_records']} records", licence=c.licence, evidence_scope=c.evidence_scope,
                        fetched_utc=rec["fetched_utc"], size=len(payload), role="exploratory")
    return {"dataset_id": did, "sha256": h, "n_records": rec["n_records"], "fetched_utc": rec["fetched_utc"]}
