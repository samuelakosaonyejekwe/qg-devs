"""Durable job queue, worker and scheduler (Suite 15 orchestration).

* Jobs live in SQLite (WAL mode): status queued → running → succeeded | failed | cancelled.
* Workers claim jobs atomically, write heartbeats, report progress and checkpoints; a job whose heartbeat
  is stale (worker crashed, machine restarted) is re-queued up to `max_attempts` times.
* Results are written as JSON files under results/; computations never depend on a browser tab.
* The scheduler enqueues periodic data ingestion, nightly verification and discovery cycles, so the
  deployed service keeps acquiring data while any individual researcher's computer is off.
"""
from __future__ import annotations

import json
import os
import socket
import sqlite3
import threading
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

HOME = Path(os.environ.get("QGDEVS_HOME", Path(__file__).resolve().parent.parent / "var"))


def paths() -> dict[str, Path]:
    p = {"home": HOME, "jobs": HOME / "jobs.db", "catalogue": HOME / "catalogue.db", "ledger": HOME / "ledger.jsonl",
         "vault": HOME / "vault", "results": HOME / "results", "store": HOME / "store", "checkpoints": HOME / "checkpoints"}
    for k in ("vault", "results", "store", "checkpoints"):
        p[k].mkdir(parents=True, exist_ok=True)
    return p


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class JobStore:
    def __init__(self, path: Path | None = None):
        self.path = Path(path or paths()["jobs"])
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._c() as c:
            c.execute("pragma journal_mode=wal")
            c.execute("""create table if not exists jobs (
                id text primary key, type text, params text, status text, progress real, message text,
                result_path text, error text, created text, started text, finished text, heartbeat real,
                worker text, attempts integer, max_attempts integer, priority integer, cancel_requested integer)""")
            c.execute("create index if not exists jobs_status on jobs(status, priority, created)")
            c.execute("create table if not exists schedule (name text primary key, last_run real)")

    def _c(self):
        c = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        c.row_factory = sqlite3.Row
        return c

    def submit(self, type_: str, params: dict, priority: int = 5, max_attempts: int = 3) -> str:
        jid = uuid.uuid4().hex[:12]
        with self._c() as c:
            c.execute("insert into jobs values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (jid, type_, json.dumps(params), "queued", 0.0, "", None, None, utcnow(), None, None, None,
                       None, 0, max_attempts, priority, 0))
        return jid

    def get(self, jid: str) -> dict | None:
        with self._c() as c:
            r = c.execute("select * from jobs where id=?", (jid,)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["params"] = json.loads(d["params"])
        return d

    def list(self, limit: int = 50, status: str | None = None) -> list[dict]:
        q = "select id,type,status,progress,message,created,started,finished,attempts,error from jobs"
        args: tuple = ()
        if status:
            q += " where status=?"
            args = (status,)
        q += " order by created desc limit ?"
        with self._c() as c:
            return [dict(r) for r in c.execute(q, args + (limit,))]

    def claim(self, worker: str, types: list[str] | None = None) -> dict | None:
        with self._c() as c:
            c.execute("begin immediate")
            q = "select id from jobs where status='queued'"
            args: tuple = ()
            if types:
                q += f" and type in ({','.join('?' * len(types))})"
                args = tuple(types)
            r = c.execute(q + " order by priority, created limit 1", args).fetchone()
            if not r:
                c.execute("commit")
                return None
            c.execute("update jobs set status='running', started=?, heartbeat=?, worker=?, attempts=attempts+1 where id=?",
                      (utcnow(), time.time(), worker, r["id"]))
            c.execute("commit")
        return self.get(r["id"])

    def heartbeat(self, jid: str, progress: float | None = None, message: str | None = None) -> bool:
        with self._c() as c:
            c.execute("update jobs set heartbeat=?, progress=coalesce(?, progress), message=coalesce(?, message) where id=?",
                      (time.time(), progress, message, jid))
            r = c.execute("select cancel_requested from jobs where id=?", (jid,)).fetchone()
        return bool(r and r["cancel_requested"])

    def finish(self, jid: str, status: str, result_path: str | None = None, error: str | None = None):
        with self._c() as c:
            c.execute("update jobs set status=?, finished=?, result_path=?, error=?, progress=? where id=?",
                      (status, utcnow(), result_path, error, 1.0 if status == "succeeded" else None, jid))

    def cancel(self, jid: str):
        with self._c() as c:
            c.execute("update jobs set cancel_requested=1 where id=?", (jid,))
            c.execute("update jobs set status='cancelled', finished=? where id=? and status='queued'", (utcnow(), jid))

    def recover_stale(self, stale_s: float = 120.0) -> int:
        """Re-queue running jobs whose worker stopped heartbeating (or fail them after max_attempts)."""
        cutoff = time.time() - stale_s
        with self._c() as c:
            n = c.execute("update jobs set status='queued', message='recovered after worker loss' "
                          "where status='running' and heartbeat < ? and attempts < max_attempts", (cutoff,)).rowcount
            c.execute("update jobs set status='failed', error='worker lost; attempts exhausted', finished=? "
                      "where status='running' and heartbeat < ? and attempts >= max_attempts", (utcnow(), cutoff))
        return n

    def stats(self) -> dict:
        with self._c() as c:
            rows = c.execute("select status, count(*) n from jobs group by status").fetchall()
        return {r["status"]: r["n"] for r in rows}

    def schedule_due(self, name: str, every_s: float) -> bool:
        with self._c() as c:
            c.execute("begin immediate")  # atomic check-and-set: safe with several worker processes
            r = c.execute("select last_run from schedule where name=?", (name,)).fetchone()
            if r and time.time() - r["last_run"] < every_s:
                c.execute("commit")
                return False
            c.execute("insert or replace into schedule values (?,?)", (name, time.time()))
            c.execute("commit")
        return True

    def schedule_state(self) -> dict:
        with self._c() as c:
            return {r["name"]: datetime.fromtimestamp(r["last_run"], timezone.utc).isoformat()
                    for r in c.execute("select * from schedule")}


class Context:
    """Passed to job handlers: progress reporting, cancellation and checkpoints."""

    def __init__(self, store: JobStore, jid: str):
        self.store, self.jid = store, jid
        self.ckpt = paths()["checkpoints"] / f"{jid}.json"

    def progress(self, frac: float, msg: str = "") -> None:
        if self.store.heartbeat(self.jid, frac, msg):
            raise InterruptedError("cancelled by user")

    def load_checkpoint(self) -> dict | None:
        return json.loads(self.ckpt.read_text()) if self.ckpt.exists() else None

    def save_checkpoint(self, state: dict) -> None:
        tmp = self.ckpt.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, default=str))
        tmp.replace(self.ckpt)


HANDLERS: dict[str, Callable[[dict, Context], dict]] = {}


def handler(name):
    def deco(fn):
        HANDLERS[name] = fn
        return fn
    return deco


def _design_env(p):
    from .bmv import BMVDesign
    from .design import Environment
    return BMVDesign.from_dict(p.get("design", {})), Environment(**p.get("environment", {}))


@handler("discrimination_matrix")
def _h_disc(p, ctx):
    from .design import scenario_for
    from .discrimination import discrimination_matrix, MeasurementChain
    d, env = _design_env(p)
    sc, _ = scenario_for(d, env)
    ctx.progress(0.1, "computing robust divergences")
    return discrimination_matrix(sc, p.get("hypotheses"), MeasurementChain(readout_error_A=env.readout_error,
                                                                           readout_error_B=env.readout_error))


@handler("design_optimise")
def _h_opt(p, ctx):
    from .design import optimise, Environment, DesignBounds
    env = Environment(**p.get("environment", {}))
    b = p.get("bounds", {})
    bounds = DesignBounds(**{k: tuple(v) if isinstance(v, list) else v for k, v in b.items()})
    ctx.progress(0.05, "differential evolution running")
    return optimise(env, bounds, seed=p.get("seed", 0), maxiter=p.get("maxiter", 30), popsize=p.get("popsize", 10),
                    top_k=p.get("top_k", 3), robust_check=p.get("robust_check", True))


@handler("vv_run")
def _h_vv(p, ctx):
    from . import vv
    ids = p.get("ids") or [b.id for b in vv.REGISTRY if p.get("include_slow") or not b.slow]
    done = (ctx.load_checkpoint() or {}).get("results", [])
    finished = {r["id"] for r in done}
    for i, bid in enumerate(ids):
        if bid in finished:
            continue
        ctx.progress(i / len(ids), f"benchmark {bid}")
        done += vv.run([bid])["results"]
        ctx.save_checkpoint({"results": done})
    n_fail = sum(not r["passed"] for r in done)
    return {"summary": {"total": len(done), "passed": len(done) - n_fail, "failed": n_fail}, "results": done}


def _records(p) -> bool:
    """Only researcher/admin/scheduler jobs write to the permanent evidence ledger."""
    return p.get("_role", "system") in ("researcher", "admin", "operator", "system")


@handler("discovery_cycle")
def _h_disc_cycle(p, ctx):
    from .discovery import run_discovery_cycle
    from .evidence import Ledger
    import tempfile
    if _records(p):
        return {"hypotheses": run_discovery_cycle(Ledger(paths()["ledger"]), seed=p.get("seed", 0)), "recorded": True}
    with tempfile.TemporaryDirectory() as td:
        return {"hypotheses": run_discovery_cycle(Ledger(Path(td) / "l.jsonl"), seed=p.get("seed", 0)),
                "recorded": False, "note": "anonymous run: results not written to the evidence ledger"}


@handler("calibration_tradeoff")
def _h_cal(p, ctx):
    from .discovery import calibration_tradeoff_study, HypothesisLedger
    from .evidence import Ledger
    r = calibration_tradeoff_study(n=p.get("n", 6), seed=p.get("seed", 0))
    if not _records(p):
        return {**r, "recorded": False, "note": "anonymous run: results not written to the evidence ledger"}
    HypothesisLedger(Ledger(paths()["ledger"])).record(
        title="Decoherence-calibration requirement for quantum vs classical-channel discrimination",
        statement=r["candidate_relationship"], method="bisection with the robust discrimination engine", study=r,
        classification="UNTESTED_PREDICTION", checks={"max_rel_diff_formula_vs_numeric": r["max_rel_diff"]},
        status="NUMERICALLY_VERIFIED" if (r["max_rel_diff"] or 1) < 0.01 else "UNVERIFIED")
    return r


@handler("inference")
def _h_inf(p, ctx):
    import numpy as np
    from .bmv import BMVDesign
    from .inference import CouplingModel, adaptive_metropolis, bayes_factor_coupling, fisher_information
    from .quantum import PAULI_SETTINGS
    m = CouplingModel(BMVDesign.from_dict(p["design"]), PAULI_SETTINGS, p.get("readout_error", 0.01))
    counts = p["counts"]
    ctx.progress(0.1, "MCMC")
    post = adaptive_metropolis(m, counts, n_steps=p.get("n_steps", 6000), seed=p.get("seed", 0))
    ctx.progress(0.7, "evidence")
    bf = bayes_factor_coupling(m, counts)
    shots = int(np.sum(counts[PAULI_SETTINGS[0]]))
    theta = [post["summary"][n]["mean"] for n in m.names]
    return {"posterior": post, "bayes_factor": bf, "fisher": fisher_information(m, theta, shots)}


@handler("fetch_source")
def _h_fetch(p, ctx):
    from .data import fetch_source, Catalogue
    pp = paths()
    return fetch_source(p["connector"], pp["store"], Catalogue(pp["catalogue"]), **p.get("kwargs", {}))


@handler("dossier")
def _h_dossier(p, ctx):
    from .lab import generate_dossier
    d, env = _design_env(p)
    return generate_dossier(d, env)


@handler("backup")
def _h_backup(p, ctx):
    from .backup import snapshot, verify, upload
    a = snapshot()
    return {"archive": str(a), **verify(a), **upload(a)}


SCHEDULE = [  # (name, period seconds, job type, params) — cadences match each source's publication rhythm
    ("ingest-arxiv", 86400, "fetch_source", {"connector": "arxiv"}),
    ("ingest-crossref", 86400, "fetch_source", {"connector": "crossref"}),
    ("ingest-zenodo", 86400, "fetch_source", {"connector": "zenodo"}),
    ("ingest-gwosc", 7 * 86400, "fetch_source", {"connector": "gwosc"}),
    ("ingest-codata", 30 * 86400, "fetch_source", {"connector": "nist-codata"}),
    ("nightly-vv", 86400, "vv_run", {}),
    ("weekly-discovery", 7 * 86400, "discovery_cycle", {}),
    ("daily-backup", 86400, "backup", {}),
]


def run_job(store: JobStore, job: dict) -> None:
    ctx = Context(store, job["id"])
    try:
        fn = HANDLERS[job["type"]]
        result = fn(job["params"], ctx)
        out = paths()["results"] / f"{job['id']}.json"
        out.write_text(json.dumps(result, default=str))
        store.finish(job["id"], "succeeded", str(out))
        if ctx.ckpt.exists():
            ctx.ckpt.unlink()
    except InterruptedError:
        store.finish(job["id"], "cancelled")
    except Exception:
        store.finish(job["id"], "failed", error=traceback.format_exc(limit=5))


FAST_TYPES = ["fetch_source", "dossier", "backup", "inference"]


def worker_loop(stop: threading.Event | None = None, poll_s: float = 2.0, scheduler: bool = True,
                types: list[str] | None = None) -> None:
    """types=None: claim any job; otherwise only the listed types (e.g. a fast lane that never waits behind
    multi-minute studies)."""
    store = JobStore()
    name = f"{socket.gethostname()}-{os.getpid()}"
    last_recover = 0.0
    while not (stop and stop.is_set()):
        if time.time() - last_recover > 30:
            store.recover_stale()
            last_recover = time.time()
            if scheduler:
                for sname, every, jtype, params in SCHEDULE:
                    if store.schedule_due(sname, every):
                        store.submit(jtype, params, priority=8)
        job = store.claim(name, types)
        if job is None:
            time.sleep(poll_s)
            continue
        hb_stop = threading.Event()

        def beat():
            while not hb_stop.wait(15):
                store.heartbeat(job["id"])
        t = threading.Thread(target=beat, daemon=True)
        t.start()
        try:
            run_job(store, job)
        finally:
            hb_stop.set()


if __name__ == "__main__":
    lane = os.environ.get("QGDEVS_WORKER_LANE", "all")
    worker_loop(scheduler=os.environ.get("QGDEVS_SCHEDULER", "1") == "1",
                types=FAST_TYPES if lane == "fast" else None)
