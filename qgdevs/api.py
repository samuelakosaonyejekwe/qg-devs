"""QG-DEVS HTTP API.

Read endpoints are open; state-changing endpoints (preregistration, dataset ingestion, sign-offs, instrument
commands, job submission) require `Authorization: Bearer <token>` when QGDEVS_API_TOKENS is set
(comma-separated `token:role` pairs, role ∈ researcher|operator|admin). Requests are size- and range-validated;
interactive endpoints are bounded so that heavy work goes through the durable job queue.
"""
from __future__ import annotations

import io
import json
import os
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Literal

import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, bmv, constants, decoherence as dec, em, materials, models, quantum as qm
from .jobs import HANDLERS, JobStore, paths

ROOT = Path(__file__).resolve().parent.parent
app = FastAPI(title="QG-DEVS API", version=__version__, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("QGDEVS_CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])
STARTED = time.time()


def J(obj) -> Response:
    return Response(_dumps(obj), media_type="application/json")


def _dumps(obj) -> str:
    def clean(x):
        if isinstance(x, dict):
            return {str(k): clean(v) for k, v in x.items()}
        if isinstance(x, (list, tuple)):
            return [clean(v) for v in x]
        if isinstance(x, np.ndarray):
            return clean(x.tolist())
        if isinstance(x, (np.floating,)):
            x = float(x)
        if isinstance(x, (np.integer,)):
            return int(x)
        if isinstance(x, np.bool_):
            return bool(x)
        if isinstance(x, float) and not np.isfinite(x):
            return None if np.isnan(x) else ("Infinity" if x > 0 else "-Infinity")
        if isinstance(x, complex):
            return {"re": x.real, "im": x.imag}
        return x
    return json.dumps(clean(obj), default=str)


# ----------------------------------------------------------------------------- security
_rate: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def limits(request: Request, call_next):
    ip = request.client.host if request.client else "?"
    q = _rate[ip]
    now = time.time()
    while q and now - q[0] > 60:
        q.popleft()
    if request.url.path.startswith("/api/") and request.method != "GET":
        q.append(now)
        if len(q) > int(os.environ.get("QGDEVS_RATE_PER_MIN", "120")):
            return JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
    if int(request.headers.get("content-length") or 0) > 64 * 1024 * 1024:
        return JSONResponse({"detail": "payload too large"}, status_code=413)
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "same-origin"
    return resp


def _tokens() -> dict[str, str]:
    raw = os.environ.get("QGDEVS_API_TOKENS", "")
    return dict(t.split(":", 1) if ":" in t else (t, "researcher") for t in raw.split(",") if t)


def role(authorization: str | None = Header(default=None)) -> str:
    toks = _tokens()
    if not toks:
        return "researcher"  # development mode: no tokens configured
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "bearer token required for this operation")
    r = toks.get(authorization[7:])
    if not r:
        raise HTTPException(403, "invalid token")
    return r


def need(*roles):
    def dep(r: str = Depends(role)):
        if r not in roles and r != "admin":
            raise HTTPException(403, f"requires role {roles}")
        return r
    return dep


# ----------------------------------------------------------------------------- schemas
class DesignIn(BaseModel):
    mass_A: float = Field(1e-14, gt=1e-27, lt=1e3)
    mass_B: float = Field(1e-14, gt=1e-27, lt=1e3)
    density: float = Field(3510.0, gt=100, lt=3e4)
    separation: float = Field(450e-6, gt=1e-9, lt=10)
    dx_A: float = Field(250e-6, ge=0, lt=10)
    dx_B: float = Field(250e-6, ge=0, lt=10)
    geometry: Literal["parallel", "linear", "angled"] = "parallel"
    angle_deg: float = Field(90.0, ge=0, le=180)
    time: float = Field(2.5, gt=0, le=1e4)
    gamma_A: float = Field(0.0, ge=0, le=1e9)
    gamma_B: float = Field(0.0, ge=0, le=1e9)

    def to(self) -> bmv.BMVDesign:
        return bmv.BMVDesign(**self.model_dump())


class EnvIn(BaseModel):
    pressure: float = Field(1e-15, ge=0, le=2e5)
    T_gas: float = Field(0.15, gt=0, le=2000)
    T_env: float = Field(0.15, ge=0, le=2000)
    T_int: float = Field(0.15, ge=0, le=2000)
    material: str = "diamond"
    residual_charge_e: float = Field(0.0, ge=0, le=1e9)
    include_casimir: bool = True
    readout_error: float = Field(0.01, ge=0, lt=0.5)


class ScenarioIn(BaseModel):
    design: DesignIn = DesignIn()
    environment: EnvIn = EnvIn()


def _env(e: EnvIn):
    from .design import Environment
    if e.material not in materials.MATERIALS:
        raise HTTPException(422, f"unknown material {e.material}")
    return Environment(**e.model_dump())


# ----------------------------------------------------------------------------- general
@app.get("/api/health")
def health():
    st = JobStore()
    return J({"status": "ok", "version": __version__, "uptime_s": round(time.time() - STARTED, 1),
              "jobs": st.stats(), "schedule_last_run": st.schedule_state(), "native_kernel": _native(),
              "llm": __import__("qgdevs.thought", fromlist=["lm_status"]).lm_status()})


def _native():
    try:
        from . import native
        return {"available": native.available()}
    except Exception as e:
        return {"available": False, "reason": str(e)}


@app.get("/api/release")
def release():
    """Current version and release notes (newest first) for the in-app "What's new" dialog."""
    notes = json.loads((Path(__file__).parent / "release_notes.json").read_text())
    return J({"version": __version__, **notes})


@app.get("/api/suites")
def suites():
    from .suites import SUITES
    return J(SUITES)


@app.get("/api/constants")
def get_constants():
    return J(constants.table())


@app.get("/api/materials")
def get_materials():
    return J({k: m.as_dict() for k, m in materials.MATERIALS.items()})


@app.get("/api/models")
def get_models():
    return J([h.describe() for h in models.HYPOTHESES.values()])


# ----------------------------------------------------------------------------- Suites 1–8 interactive
class LindbladIn(BaseModel):
    H_re: list[list[float]]
    H_im: list[list[float]] | None = None
    L_re: list[list[list[float]]] = []
    L_im: list[list[list[float]]] | None = None
    rho0_re: list[list[float]]
    rho0_im: list[list[float]] | None = None
    t_final: float = Field(gt=0, le=1e6)
    n_times: int = Field(50, ge=2, le=500)


@app.post("/api/quantum/lindblad")
def lindblad(inp: LindbladIn):
    H = np.array(inp.H_re) + 1j * np.array(inp.H_im or np.zeros_like(inp.H_re))
    if H.shape[0] > 32 or H.shape[0] != H.shape[1]:
        raise HTTPException(422, "H must be square with dimension ≤ 32 (submit larger problems as jobs)")
    if not np.allclose(H, H.conj().T):
        raise HTTPException(422, "H must be Hermitian")
    Ls = [np.array(r) + 1j * np.array((inp.L_im or [np.zeros_like(r)] * len(inp.L_re))[k]) for k, r in enumerate(inp.L_re)]
    rho0 = np.array(inp.rho0_re) + 1j * np.array(inp.rho0_im or np.zeros_like(inp.rho0_re))
    chk = qm.check_density_matrix(rho0, 1e-8)
    if not chk.passed:
        raise HTTPException(422, f"initial state is not a density matrix: {chk.as_dict()}")
    ts = np.linspace(0, inp.t_final, inp.n_times)
    rs = qm.evolve_lindblad(rho0, H, Ls, ts)
    return J({"t": ts, "populations": [np.real(np.diag(r)) for r in rs], "purity": [qm.purity(r) for r in rs],
              "checks": [qm.check_density_matrix(r).as_dict() for r in rs[:: max(1, len(rs) // 10)]],
              "final_re": rs[-1].real, "final_im": rs[-1].imag})


@app.post("/api/bmv/predict")
def bmv_predict(sc: ScenarioIn, n_times: int = 120):
    from .design import scenario_for
    from .discrimination import predictions_table
    d = sc.design.to()
    issues = bmv.check_geometry(d)
    env = _env(sc.environment)
    if issues:
        return J({"admissibility_issues": issues})
    scen, extra = scenario_for(d, env)
    d.gamma_A, d.gamma_B = scen.gamma_env_A, scen.gamma_env_B
    times = np.linspace(0, d.time, min(max(n_times, 10), 400))
    pred = bmv.predict(d, extra_energies=scen.nongrav_energies, times=times)
    pred["models"] = predictions_table(scen)
    pred["decoherence"] = extra["decoherence_A"]
    pred["nongrav_channels"] = extra["nongrav_channels"]
    pred["branch_positions"] = {k: v for k, v in bmv.branch_positions(d).items()}
    pred["evidence_status"] = "COMPUTATIONAL PREDICTION (model-dependent; not physical evidence)"
    return J(pred)


class SweepIn(ScenarioIn):
    px: str = "separation"
    xs: list[float]
    py: str = "dx_A"
    ys: list[float]
    hypothesis: str = "QG-COH"


@app.post("/api/bmv/sweep2d")
def bmv_sweep(s: SweepIn):
    from .design import sweep_2d
    if len(s.xs) * len(s.ys) > 2500:
        raise HTTPException(422, "grid larger than 50×50: submit as a job")
    allowed = {"separation", "dx_A", "mass_A", "time"}
    if s.px not in allowed or s.py not in allowed:
        raise HTTPException(422, f"sweep parameters must be in {allowed}")
    return J(sweep_2d(s.design.to(), _env(s.environment), s.px, s.xs, s.py, s.ys, s.hypothesis))


@app.post("/api/bmv/sweep1d")
def bmv_sweep1d(sc: ScenarioIn, param: str = "separation", start: float = 2e-4, stop: float = 1e-3, n: int = 30):
    from .design import sweep_1d
    if n > 120:
        raise HTTPException(422, "n ≤ 120")
    return J(sweep_1d(sc.design.to(), _env(sc.environment), param, np.linspace(start, stop, n)))


@app.post("/api/decoherence/budget")
def decoherence_budget(sc: ScenarioIn, include_dp: bool = True):
    d, e = sc.design.to(), sc.environment
    cm = materials.get(e.material).clausius_mossotti()
    return J(dec.budget(d.mass_A, d.radius_A, d.dx_A, pressure=e.pressure, T_gas=e.T_gas, T_env=e.T_env,
                        T_int=e.T_int, cm=cm, t=d.time, include_dp=include_dp))


@app.post("/api/gravity/orbit")
def gravity_orbit(M: float = 1.98847e30, a: float = 5.7909e10, e: float = 0.2056):
    from .gravity import perihelion_precession_numeric, perihelion_precession_analytic, light_deflection_numeric, light_deflection_analytic
    if not (0 <= e < 0.95):
        raise HTTPException(422, "0 ≤ e < 0.95")
    return J({"precession_numeric_rad": perihelion_precession_numeric(M, a, e),
              "precession_analytic_rad": perihelion_precession_analytic(M, a, e),
              "deflection_numeric_rad": light_deflection_numeric(M, a * (1 - e)),
              "deflection_analytic_rad": light_deflection_analytic(M, a * (1 - e))})


class NBodyIn(BaseModel):
    masses: list[float]
    positions: list[list[float]]
    velocities: list[list[float]]
    dt: float = Field(gt=0)
    steps: int = Field(ge=1, le=200000)
    save_every: int = Field(10, ge=1)


@app.post("/api/gravity/nbody")
def gravity_nbody(b: NBodyIn):
    from .gravity import nbody_verlet, nbody_energy
    if len(b.masses) > 64:
        raise HTTPException(422, "≤ 64 bodies interactively")
    ts, P, V = nbody_verlet(np.array(b.positions), np.array(b.velocities), b.masses, b.dt, b.steps, b.save_every)
    m = np.array(b.masses)
    return J({"t": ts, "positions": P, "energy": [nbody_energy(p, v, m) for p, v in zip(P, V)]})


@app.post("/api/interferometry/sg")
def interferometry_sg(sc: ScenarioIn, tau: float = Query(0.25, gt=0, le=100)):
    from .interferometry import sg_bmv_phases
    d = sc.design.to()
    return J(sg_bmv_phases(d.mass_A, d.mass_B, d.separation, tau, d.time, d.dx_A,
                           "parallel" if d.geometry == "parallel" else "linear"))


@app.post("/api/interferometry/wavepacket2d")
def wavepacket2d(mass: float = 1e-25, sigma: float = 5e-7, split_k: float = 2e6, gravity: float = 9.81,
                 t_final: float = 2e-3, frames: int = 40, n: int = 128):
    """2-D split-step evolution of a coherently split wave packet (two momentum branches) under gravity."""
    from .interferometry import split_step_2d
    if n > 256 or frames > 120:
        raise HTTPException(422, "n ≤ 256 and frames ≤ 120")
    L = 4e-5
    x = np.linspace(-L, L, n)
    X, Y = np.meshgrid(x, x)
    psi = np.exp(-(X**2 + Y**2) / (4 * sigma**2)) * (np.exp(1j * split_k * X) + np.exp(-1j * split_k * X))
    psi /= np.sqrt(np.sum(np.abs(psi) ** 2))
    steps = 400
    ts, dens, _ = split_step_2d(psi, x, x, mass * gravity * Y, mass, t_final / steps, steps,
                                save_every=max(1, steps // frames))
    dens = dens / dens.max(axis=(1, 2), keepdims=True)
    return J({"x": x, "t": ts, "frames": np.round(dens, 4), "units": {"x": "m", "t": "s"},
              "kind": "computed (split-step Fourier)"})


@app.post("/api/optomech/evolve")
def optomech(m: float = Query(1e-14, gt=0, le=1e3), d: float = Query(1e-4, gt=0, le=10),
             omega: float = Query(6.283, gt=0, le=1e12), T: float = Query(0.0, ge=0, le=2000),
             gamma: float = Query(1e-4, ge=0, le=1e9), n_init: float = Query(0.0, ge=0, le=1e9),
             t_final: float = Query(100.0, gt=0, le=1e6), squeeze_r: float = Query(0.0, ge=0, le=5),
             coupling_scale: float = Query(1.0, ge=0, le=1e6)):
    from .optomech import evolve_coupled_oscillators
    return J(evolve_coupled_oscillators(m, m, d, omega, T, gamma, n_init, t_final, 200, coupling_scale, squeeze_r))


# ----------------------------------------------------------------------------- Suites 9–13
@app.post("/api/lab/dossier")
def lab_dossier(sc: ScenarioIn):
    from .lab import generate_dossier
    d = sc.design.to()
    if bmv.check_geometry(d):
        raise HTTPException(422, {"admissibility_issues": bmv.check_geometry(d)})
    return J(generate_dossier(d, _env(sc.environment)))


@app.post("/api/lab/export/{fmt}")
def lab_export(fmt: Literal["stl", "svg", "scene", "json"], sc: ScenarioIn):
    from .lab import stl_ascii, layout_svg, scene_json, generate_dossier
    d = sc.design.to()
    if fmt == "stl":
        return Response(stl_ascii(d), media_type="model/stl",
                        headers={"Content-Disposition": "attachment; filename=qgdevs-apparatus.stl"})
    if fmt == "svg":
        return Response(layout_svg(d), media_type="image/svg+xml")
    if fmt == "scene":
        return J(scene_json(d))
    return Response(_dumps(generate_dossier(d, _env(sc.environment))), media_type="application/json",
                    headers={"Content-Disposition": "attachment; filename=qgdevs-dossier.json"})


class SimIn(ScenarioIn):
    model: str = "QG-COH"
    shots: int = Field(2000, ge=10, le=10_000_000)
    seed: int = 0
    settings: list[str] = qm.PAULI_SETTINGS


@app.post("/api/signal/simulate")
def signal_simulate(s: SimIn):
    from .design import scenario_for
    from .discrimination import protocol_frame
    from .sigproc import simulate_counts, DetectorModel, witness_estimate
    if s.model not in models.HYPOTHESES or not models.HYPOTHESES[s.model].implemented:
        raise HTTPException(422, "unknown or unimplemented model")
    scen, _ = scenario_for(s.design.to(), _env(s.environment))
    rho = models.HYPOTHESES[s.model].state(scen)
    F = protocol_frame(scen)
    rec = simulate_counts(F @ rho @ F.conj().T, s.settings, s.shots,
                          DetectorModel(s.environment.readout_error, s.environment.readout_error), s.seed, s.model,
                          {"design": s.design.model_dump(), "environment": s.environment.model_dump()})
    if all(k in rec["counts"] for k in ("XX", "YZ", "ZY")):
        sign = 1
        e = qm.pauli_expectations(F @ rho @ F.conj().T)
        if 1 - e["XX"] + e["YZ"] + e["ZY"] < 1 - e["XX"] - e["YZ"] - e["ZY"]:
            sign = -1
        rec["witness_estimate"] = witness_estimate(rec["counts"], sign, s.environment.readout_error,
                                                   s.environment.readout_error, n_boot=500)
    return J(rec)


class CountsIn(BaseModel):
    counts: dict[str, list[int]]


@app.post("/api/signal/tomography")
def signal_tomography(c: CountsIn):
    from .sigproc import tomography_with_uncertainty
    if set(c.counts) != set(qm.PAULI_SETTINGS):
        raise HTTPException(422, "tomography requires all 9 Pauli settings")
    return J(tomography_with_uncertainty(c.counts, n_boot=100))


@app.post("/api/signal/injection")
def signal_injection(noise: float = 1.0, threshold: float = 5.0, trials: int = 100):
    from .sigproc import injection_recovery
    tpl = np.sin(np.linspace(0, 8 * np.pi, 200)) * np.hanning(200)
    return J(injection_recovery(tpl, np.linspace(0, 1.2, 9), 4000, noise, threshold, min(trials, 300)))


@app.post("/api/falsification/predictions")
def falsification_predictions(sc: ScenarioIn):
    from .design import scenario_for
    from .discrimination import predictions_table
    scen, _ = scenario_for(sc.design.to(), _env(sc.environment))
    return J({"predictions": predictions_table(scen),
              "registered_not_implemented": [h.describe() for h in models.HYPOTHESES.values() if not h.implemented]})


# ----------------------------------------------------------------------------- jobs
class JobIn(BaseModel):
    type: str
    params: dict = {}


@app.post("/api/jobs")
def submit_job(j: JobIn, r: str = Depends(need("researcher", "operator"))):
    if j.type not in HANDLERS:
        raise HTTPException(422, f"unknown job type; available: {sorted(HANDLERS)}")
    if len(json.dumps(j.params)) > 2_000_000:
        raise HTTPException(413, "params too large")
    return J({"id": JobStore().submit(j.type, j.params)})


@app.get("/api/jobs")
def list_jobs(limit: int = 50):
    return J({"jobs": JobStore().list(min(limit, 500)), "types": sorted(HANDLERS)})


@app.get("/api/jobs/{jid}")
def job(jid: str):
    j = JobStore().get(jid)
    if not j:
        raise HTTPException(404)
    if j["status"] == "succeeded" and j["result_path"]:
        j["result"] = json.loads(Path(j["result_path"]).read_text())
    return J(j)


@app.post("/api/jobs/{jid}/cancel")
def cancel(jid: str, r: str = Depends(need("researcher", "operator"))):
    JobStore().cancel(jid)
    return J({"ok": True})


# ----------------------------------------------------------------------------- Suites 14, 16
@app.get("/api/vv/registry")
def vv_registry():
    from . import vv
    return J([{k: getattr(b, k) for k in ("id", "suite", "title", "kind", "tolerance", "justification", "reference",
                                          "compare", "slow")} for b in vv.REGISTRY])


@app.get("/api/vv/latest")
def vv_latest():
    for j in JobStore().list(200):
        if j["type"] == "vv_run" and j["status"] == "succeeded":
            return J(json.loads((paths()["results"] / f"{j['id']}.json").read_text()) | {"job": j})
    return J({"summary": None, "note": "no completed verification run yet; submit a vv_run job"})


@app.get("/api/lean/status")
def lean_status():
    p = ROOT / "lean" / "proof_status.json"
    if not p.exists():
        return J({"theorems": [], "note": "Lean project not built in this deployment"})
    return J(json.loads(p.read_text()))


@app.get("/api/discovery/hypotheses")
def hypotheses():
    from .evidence import Ledger
    return J([e | {"payload": e["payload"]} for e in Ledger(paths()["ledger"]).entries() if e["kind"] == "hypothesis"])


@app.post("/api/discovery/scaling")
def discovery_scaling(regime: Literal["far", "near"] = "far", geometry: Literal["parallel", "linear"] = "parallel",
                      n: int = 128, seed: int = 0):
    from .discovery import bmv_scaling_study
    return J(bmv_scaling_study(n=min(n, 512), seed=seed, regime=regime, geometry=geometry))


# ----------------------------------------------------------------------------- Suites 17, 18
@app.get("/api/data/connectors")
def connectors():
    from .data import CONNECTORS
    return J([{k: getattr(c, k) for k in ("id", "name", "url", "label", "licence", "cadence", "evidence_scope")}
              for c in CONNECTORS.values()])


@app.get("/api/data/catalogue")
def catalogue(label: str | None = None):
    from .data import Catalogue
    return J(Catalogue(paths()["catalogue"]).list(label))


@app.get("/api/data/records/{did}")
def data_record(did: str):
    from .data import Catalogue
    rec = Catalogue(paths()["catalogue"]).get(did)
    if not rec:
        raise HTTPException(404)
    for f in paths()["store"].glob(f"*-{rec['sha256'][:12]}.json"):
        return Response(f.read_bytes(), media_type="application/json")
    return J(rec)


@app.post("/api/data/validate")
async def data_validate(file: UploadFile = File(...)):
    from .data import parse_upload, validate_density_matrix
    raw = await file.read()
    try:
        parsed = parse_upload(file.filename or "upload", raw)
    except Exception as e:
        raise HTTPException(422, f"could not parse: {e}")
    out = {"filename": file.filename, "bytes": len(raw), "kind": parsed["kind"], "sha256": __import__("hashlib").sha256(raw).hexdigest()}
    c = parsed["content"]
    if parsed["kind"] == "json":
        try:
            arr = np.asarray(c.get("re", c) if isinstance(c, dict) else c, dtype=float)
            if isinstance(c, dict) and "im" in c:
                arr = arr + 1j * np.asarray(c["im"], dtype=float)
            if arr.ndim in (1, 2):
                parsed = {"kind": "array", "content": arr}
                c = arr
        except (TypeError, ValueError):
            pass
    if parsed["kind"] == "array":
        out["shape"] = list(np.shape(c))
        if np.ndim(c) == 2 and np.shape(c)[0] == np.shape(c)[1]:
            out["density_matrix_check"] = validate_density_matrix(c)
    elif parsed["kind"] == "table":
        out["columns"] = {k: len(v) for k, v in c.items()}
    elif parsed["kind"] == "arrays":
        out["arrays"] = {k: list(np.shape(v)) for k, v in c.items()}
    return J(out)


def _ledger():
    from .evidence import Ledger
    return Ledger(paths()["ledger"])


@app.get("/api/evidence/ledger")
def evidence_ledger(kind: str | None = None, limit: int = 200):
    es = _ledger().entries()
    if kind:
        es = [e for e in es if e["kind"] == kind]
    return J({"entries": es[-limit:], "verification": _ledger().verify()})


class PreregIn(BaseModel):
    title: str
    hypotheses: list[str]
    scenario: ScenarioIn
    decision_rules: dict
    analysis_plan: str
    seeds: list[int]
    sample_size: dict
    actor: str = "researcher"


@app.post("/api/evidence/preregister")
def preregister(p: PreregIn, r: str = Depends(need("researcher"))):
    from .evidence import preregister as prereg
    from .design import scenario_for
    from .discrimination import predictions_table
    scen, _ = scenario_for(p.scenario.design.to(), _env(p.scenario.environment))
    preds = {x["id"]: x for x in predictions_table(scen) if x["id"] in p.hypotheses}
    nuis = {h: [n.__dict__ for n in models.HYPOTHESES[h].nuisance] for h in p.hypotheses if h in models.HYPOTHESES}
    e = prereg(_ledger(), title=p.title, hypotheses=p.hypotheses, design=p.scenario.model_dump(), predictions=preds,
               decision_rules=p.decision_rules, analysis_plan=p.analysis_plan, seeds=p.seeds,
               sample_size=p.sample_size, nuisance_ranges=nuis, actor=p.actor)
    return J(e)


@app.post("/api/evidence/datasets")
async def ingest_dataset(file: UploadFile = File(...), label: str = Form(...), role: str = Form(...),
                         source: str = Form(...), description: str = Form(""), prereg_id: str | None = Form(None),
                         r: str = Depends(need("researcher", "operator"))):
    from .evidence import BlindVault
    raw = await file.read()
    try:
        rec = BlindVault(paths()["vault"], _ledger()).ingest(raw, label=label, role=role, source=source,
                                                             description=description, prereg_id=prereg_id)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return J(rec.__dict__)


class UnblindIn(BaseModel):
    dataset_id: str
    prereg_id: str
    actor: str = "researcher"


@app.post("/api/evidence/unblind")
def unblind(u: UnblindIn, r: str = Depends(need("researcher"))):
    from .evidence import BlindVault
    try:
        return J(BlindVault(paths()["vault"], _ledger()).unblind(u.dataset_id, u.prereg_id, u.actor))
    except KeyError:
        raise HTTPException(404, "unknown dataset")
    except PermissionError as e:
        raise HTTPException(403, str(e))


class SignoffIn(BaseModel):
    gate: Literal["G1", "G2", "G3", "G4", "G5", "G6", "G7"]
    reviewer: str
    affiliation: str
    statement: str


@app.post("/api/evidence/signoff")
def signoff(s: SignoffIn, r: str = Depends(need("researcher"))):
    return J(_ledger().append("human_signoff", s.model_dump(), s.reviewer))


@app.post("/api/evidence/gates")
def gates(sc: ScenarioIn, hypothesis: str = "QG-COH"):
    from .evidence import evaluate_gates, classify_evidence
    from .lab import generate_dossier
    vv_rep = json.loads(vv_latest().body)
    lean = json.loads(lean_status().body)
    native_ok = False
    try:
        from . import native
        native_ok = native.available()
    except Exception:
        pass
    g = evaluate_gates(model_meta=models.HYPOTHESES[hypothesis].meta, vv_report=vv_rep if vv_rep.get("summary") else None,
                       lean_status=lean, ledger=_ledger(), dossier=generate_dossier(sc.design.to(), _env(sc.environment)),
                       literature_review=None, second_implementation_match=native_ok)
    return J({"gates": g, "classification": classify_evidence(g, independently_reproduced=native_ok)})


@app.post("/api/evidence/package")
def package(sc: ScenarioIn):
    from .evidence import reproduction_package
    res = json.loads(bmv_predict(sc).body)
    z = reproduction_package(config=sc.model_dump(), results=res, ledger=_ledger())
    return Response(z, media_type="application/zip",
                    headers={"Content-Disposition": "attachment; filename=qgdevs-reproduction.zip"})


# ----------------------------------------------------------------------------- thought experiments
class ThoughtIn(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)
    language_model: Literal["off", "anthropic", "ollama"] = "off"
    model: str | None = None


@app.post("/api/thought/interpret")
def thought_interpret(t: ThoughtIn):
    from .thought import interpret
    return J(interpret(t.prompt, t.language_model, t.model).as_dict())


class ThoughtExecIn(BaseModel):
    config: dict
    approved: bool


@app.post("/api/thought/execute")
def thought_execute(t: ThoughtExecIn):
    from .thought import ThoughtConfig, Quantity, execute, finalise
    if not t.approved:
        raise HTTPException(403, "the researcher must approve the configuration before execution")
    c = t.config
    cfg = ThoughtConfig(prompt=c.get("prompt", ""), family=c.get("family"), category=c.get("category", "THEORETICAL"),
                        material=c.get("material", "diamond"), geometry=c.get("geometry", "parallel"),
                        speculative=bool(c.get("speculative")), interpreter=c.get("interpreter", "deterministic"))
    from .units import to_si
    for k, q in (c.get("quantities") or {}).items():
        try:
            si = q["si_value"] if q.get("unit") == "rad/s" else to_si(float(q["value"]), q["unit"].replace("µ", "u"))[0]
        except Exception:
            raise HTTPException(422, f"invalid quantity {k}")
        cfg.quantities[k] = Quantity(k, float(q["value"]), q["unit"], si, q.get("source", "USER_STATED"))
    cfg = finalise(cfg)
    cfg.approved = True
    return J(execute(cfg))


@app.get("/api/thought/lm-status")
def thought_lm():
    from .thought import lm_status
    return J(lm_status())


# ----------------------------------------------------------------------------- instruments
@app.get("/api/instruments")
def instruments():
    return J({"connected_physical_devices": [],
              "simulated": [{"device_id": "sim-spin-readout-01", "label": "SYNTHETIC"}],
              "note": "No physical instrument is connected to this deployment. Environment B requires an authorised "
                      "laboratory adapter; simulated devices produce SYNTHETIC data only."})


# ----------------------------------------------------------------------------- web app
DIST = ROOT / "web" / "dist"
if not DIST.exists():
    from fastapi.responses import HTMLResponse

    @app.get("/", include_in_schema=False)
    def interim_home():
        from .suites import SUITES
        rows = "".join(f"<tr><td>{x['n']}</td><td>{x['name']}</td><td>{x['maturity']}</td></tr>" for x in SUITES)
        return HTMLResponse(f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>QG-DEVS</title>
<style>body{{font-family:system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 16px;line-height:1.5}}
table{{border-collapse:collapse;width:100%}}td{{border-bottom:1px solid #ddd;padding:4px 8px}}
a{{color:#2563eb}}.note{{background:#fff7e6;border:1px solid #f0c36d;padding:8px 12px;border-radius:6px}}</style></head>
<body><h1>QG-DEVS — Quantum Gravity Discovery and Experimental Verification System</h1>
<p class="note">The interactive web application is being finalised. All scientific engines are live through the API below.
Results are computational predictions, not physical evidence.</p>
<ul><li><a href="/api/docs">Interactive API (run any suite: predictions, dossiers, discrimination, thought experiments…)</a></li>
<li><a href="/api/health">System health</a> · <a href="/api/models">Competing hypotheses</a> · <a href="/api/vv/latest">Latest verification run</a>
· <a href="/api/lean/status">Lean proofs</a> · <a href="/api/data/catalogue">Data catalogue</a></li>
<li><a href="https://github.com/samuelakosaonyejekwe/qg-devs">Source, results and documentation</a></li></ul>
<h2>The 18 suites</h2><table>{rows}</table></body></html>""")


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = DIST / path
        if path and f.is_file() and DIST in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
