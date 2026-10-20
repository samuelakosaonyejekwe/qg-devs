"""QG-DEVS HTTP API.

Read endpoints are open; state-changing endpoints (preregistration, dataset ingestion, sign-offs, instrument
commands, job submission) require `Authorization: Bearer <token>` when QGDEVS_API_TOKENS is set
(comma-separated `token:role` pairs, role ∈ researcher|operator|admin). Requests are size- and range-validated;
interactive endpoints are bounded so that heavy work goes through the durable job queue.
"""
from __future__ import annotations

import hmac
import json
import math
import os
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, bmv, constants, decoherence as dec, materials, models, quantum as qm
from .jobs import HANDLERS, JobStore, QueueLimit, paths, sanitize_public_params

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
_rate: dict[str, deque] = defaultdict(deque)  # per process: with N uvicorn workers the effective limit is N×
MAX_UPLOAD_BYTES = 64 * 1024 * 1024


@app.middleware("http")
async def limits(request: Request, call_next):
    ip = request.client.host if request.client else "?"
    now = time.time()
    if len(_rate) > 10_000:  # forget idle clients so the table cannot grow without bound
        for k in [k for k, v in _rate.items() if not v or now - v[-1] > 60]:
            del _rate[k]
    q = _rate[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if request.url.path.startswith("/api/") and request.method != "GET":
        q.append(now)
        if len(q) > int(os.environ.get("QGDEVS_RATE_PER_MIN", "120")):
            return JSONResponse({"detail": "rate limit exceeded"}, status_code=429)
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        return JSONResponse({"detail": "invalid Content-Length header"}, status_code=400)
    if declared > MAX_UPLOAD_BYTES:
        return JSONResponse({"detail": "payload too large"}, status_code=413)
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "same-origin"
    return resp


def _token_table() -> dict[str, tuple[str, str]]:
    """QGDEVS_API_TOKENS = "token:role:Name of person, ..." (comma-separated; name optional, role defaults to
    researcher). Returns {token: (role, name)}."""
    out = {}
    for t in os.environ.get("QGDEVS_API_TOKENS", "").split(","):
        t = t.strip()
        if not t:
            continue
        parts = t.split(":", 2)
        tok = parts[0]
        rl = parts[1] if len(parts) > 1 and parts[1] else "researcher"
        name = parts[2].strip() if len(parts) > 2 and parts[2].strip() else f"unnamed {rl}"
        out[tok] = (rl, name)
    return out


def _tokens() -> dict[str, str]:
    return {k: v[0] for k, v in _token_table().items()}


def principal(authorization: str | None = Header(default=None)) -> dict:
    """Authenticated identity behind a request: role, the name bound to the token, and a token fingerprint
    (first 12 hex of SHA-256; the token itself is never stored)."""
    import hashlib as _h
    table = _token_table()
    if not table:
        r = "public" if _require_tokens() else "researcher"
        return {"role": r, "name": "development user" if r == "researcher" else "anonymous", "token_id": None,
                "verified": False}
    given = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
    if not given:
        return {"role": "public", "name": "anonymous", "token_id": None, "verified": False}
    match = None
    for tok, (rl, name) in table.items():
        if hmac.compare_digest(given.encode(), tok.encode()):
            match = (rl, name)
    if match is None:
        raise HTTPException(403, "invalid access token (check Settings → API bearer token)")
    return {"role": match[0], "name": match[1], "token_id": _h.sha256(given.encode()).hexdigest()[:12], "verified": True}


def need_identity(*roles):
    def dep(p: dict = Depends(principal)):
        if p["role"] not in roles and p["role"] != "admin":
            raise HTTPException(401 if p["role"] == "public" else 403,
                                RESEARCHER_ONLY if p["role"] == "public" else f"requires role {roles}")
        return p
    return dep


RESEARCHER_ONLY = ("Researcher access required: this action writes to the permanent evidence record. "
                   "Enter your access token in Settings → API bearer token.")


def _require_tokens() -> bool:
    """Deployed images set QGDEVS_REQUIRE_TOKENS=1: a server started without QGDEVS_API_TOKENS must then treat
    every visitor as public instead of silently granting anonymous write access to the evidence record."""
    return os.environ.get("QGDEVS_REQUIRE_TOKENS", "0") == "1"


def role(authorization: str | None = Header(default=None)) -> str:
    """'public' for anonymous visitors when tokens are configured; 'researcher' in local development mode."""
    toks = _tokens()
    if not toks:
        return "public" if _require_tokens() else "researcher"  # development mode: no tokens configured
    if not authorization:
        return "public"
    given = authorization[7:] if authorization.startswith("Bearer ") else ""
    match = None
    for tok, rl in toks.items():  # constant-time comparison against every configured token
        if hmac.compare_digest(given.encode(), tok.encode()):
            match = rl
    if match is None:
        raise HTTPException(403, "invalid access token (check Settings → API bearer token)")
    return match


def need(*roles):
    def dep(r: str = Depends(role)):
        if r not in roles and r != "admin":
            raise HTTPException(401 if r == "public" else 403, RESEARCHER_ONLY if r == "public" else f"requires role {roles}")
        return r
    return dep


# Computation-only jobs anyone may run (bounded per visitor); everything that writes evidence needs a token.
PUBLIC_JOB_TYPES = {"discrimination_matrix", "design_optimise", "vv_run", "inference", "dossier",
                    "discovery_cycle", "calibration_tradeoff", "fetch_source"}
PUBLIC_MAX_ACTIVE_PER_CLIENT = 3
PUBLIC_MAX_QUEUE = 40


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
    bias_field_T: float = Field(0.0, ge=-20, le=20)


class ScenarioIn(BaseModel):
    design: DesignIn = DesignIn()
    environment: EnvIn = EnvIn()


def _env(e: EnvIn):
    from .design import Environment
    if e.material not in materials.MATERIALS:
        raise HTTPException(422, f"unknown material {e.material}")
    return Environment(**e.model_dump())


def _hypothesis(hid: str) -> str:
    if hid not in models.HYPOTHESES or not models.HYPOTHESES[hid].implemented:
        raise HTTPException(422, f"unknown or unimplemented hypothesis {hid!r}; available: "
                                 f"{sorted(h.id for h in models.implemented())}")
    return hid


def _finite_array(x, name: str, ndim: int | None = None) -> np.ndarray:
    try:
        a = np.array(x, dtype=float)
    except (TypeError, ValueError):
        raise HTTPException(422, f"{name}: ragged or non-numeric array")
    if ndim is not None and a.ndim != ndim:
        raise HTTPException(422, f"{name}: expected a {ndim}-D array, got shape {list(a.shape)}")
    if not np.all(np.isfinite(a)):
        raise HTTPException(422, f"{name}: values must be finite")
    return a


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


@app.get("/api/equations")
def equations():
    """Every displayed equation as KaTeX-compatible LaTeX: per suite, per hypothesis and for the dossier."""
    from .equations import SUITE_TEX, MODEL_TEX, PROTOCOL_TEX
    return J({"suites": SUITE_TEX, "models": MODEL_TEX, "protocol": PROTOCOL_TEX, "renderer": "KaTeX (display mode)"})


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


def _cmat(re, im, name: str) -> np.ndarray:
    a = _finite_array(re, name + "_re", 2)
    if im is not None:
        b = _finite_array(im, name + "_im", 2)
        if b.shape != a.shape:
            raise HTTPException(422, f"{name}_im must have the shape of {name}_re")
        return a + 1j * b
    return a.astype(complex)


@app.post("/api/quantum/lindblad")
def lindblad(inp: LindbladIn):
    H = _cmat(inp.H_re, inp.H_im, "H")
    d = H.shape[0]
    if not 1 <= d <= 32 or H.shape != (d, d):
        raise HTTPException(422, "H must be square with dimension ≤ 32 (submit larger problems as jobs)")
    if not np.allclose(H, H.conj().T):
        raise HTTPException(422, "H must be Hermitian")
    if len(inp.L_re) > 16:
        raise HTTPException(422, "at most 16 Lindblad operators interactively")
    if inp.L_im is not None and len(inp.L_im) != len(inp.L_re):
        raise HTTPException(422, "L_im must list one matrix per L_re entry")
    Ls = [_cmat(r, inp.L_im[k] if inp.L_im is not None else None, f"L[{k}]") for k, r in enumerate(inp.L_re)]
    if any(L.shape != (d, d) for L in Ls):
        raise HTTPException(422, "every Lindblad operator must have the dimension of H")
    rho0 = _cmat(inp.rho0_re, inp.rho0_im, "rho0")
    if rho0.shape != (d, d):
        raise HTTPException(422, "rho0 must have the dimension of H")
    # the Krylov propagator cost grows with ‖L‖ t; bound it so one request cannot pin a worker for hours
    norm = np.abs(H).sum(axis=1).max() + sum(np.abs(L.conj().T @ L).sum(axis=1).max() for L in Ls)
    if norm * inp.t_final > 1e4:
        raise HTTPException(422, "‖H‖·t_final (plus dissipator norms) must be ≤ 1e4 interactively; submit as a job")
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
    from .design import full_prediction
    return J(full_prediction(sc.design.to(), _env(sc.environment), n_times))


SweepParam = Literal["separation", "dx_A", "mass_A", "time"]
# admissible ranges of the swept values (same bounds as DesignIn)
_SWEEP_RANGE = {"separation": (1e-9, 10.0), "dx_A": (0.0, 10.0), "mass_A": (1e-27, 1e3), "time": (1e-12, 1e4)}


def _sweep_values(name: str, values) -> list[float]:
    lo, hi = _SWEEP_RANGE[name]
    v = _finite_array(values, name, 1)
    if v.size and (v.min() < lo or v.max() > hi):
        raise HTTPException(422, f"{name} values must lie in [{lo:g}, {hi:g}]")
    return v.tolist()


class SweepIn(ScenarioIn):
    px: SweepParam = "separation"
    xs: list[float]
    py: SweepParam = "dx_A"
    ys: list[float]
    hypothesis: str = "QG-COH"


@app.post("/api/bmv/sweep2d")
def bmv_sweep(s: SweepIn):
    from .design import sweep_2d
    if len(s.xs) * len(s.ys) > 2500:
        raise HTTPException(422, "grid larger than 50×50: submit as a job")
    if s.px == s.py:
        raise HTTPException(422, "px and py must differ")
    return J(sweep_2d(s.design.to(), _env(s.environment), s.px, _sweep_values(s.px, s.xs), s.py,
                      _sweep_values(s.py, s.ys), _hypothesis(s.hypothesis)))


@app.post("/api/bmv/sweep1d")
def bmv_sweep1d(sc: ScenarioIn, param: SweepParam = "separation", start: float = 2e-4, stop: float = 1e-3,
                n: int = Query(30, ge=2, le=120)):
    from .design import sweep_1d
    return J(sweep_1d(sc.design.to(), _env(sc.environment), param, _sweep_values(param, np.linspace(start, stop, n))))


@app.post("/api/decoherence/budget")
def decoherence_budget(sc: ScenarioIn, include_dp: bool = False, include_csl: bool = False,
                       csl_log10_lambda: float = Query(-16.0, ge=-30, le=-6)):
    """Environmental decoherence budget; collapse models (hypotheses) only when explicitly requested."""
    d, e = sc.design.to(), sc.environment
    _env(e)  # validates the material
    cm = materials.get(e.material).clausius_mossotti()
    return J(dec.budget(d.mass_A, d.radius_A, d.dx_A, pressure=e.pressure, T_gas=e.T_gas, T_env=e.T_env,
                        T_int=e.T_int, cm=cm, t=d.time, include_dp=include_dp, include_csl=include_csl,
                        csl_lambda=10.0 ** csl_log10_lambda))


@app.post("/api/gravity/orbit")
def gravity_orbit(M: float = Query(1.98847e30, gt=0, le=1e42), a: float = Query(5.7909e10, gt=0, le=1e20),
                  e: float = Query(0.2056, ge=0, lt=0.95)):
    from .gravity import (perihelion_precession_numeric, perihelion_precession_analytic, light_deflection_numeric,
                          light_deflection_analytic, schwarzschild_radius)
    if a * (1 - e) < 1e3 * schwarzschild_radius(M):
        # the event-based solvers assume a bound, weakly relativistic orbit and an escaping light ray
        raise HTTPException(422, "periapsis a(1−e) must exceed 1000 Schwarzschild radii (weak-field regime)")
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
    n = len(b.masses)
    if not 1 <= n <= 64:
        raise HTTPException(422, "1 to 64 bodies interactively")
    m = _finite_array(b.masses, "masses", 1)
    pos, vel = _finite_array(b.positions, "positions", 2), _finite_array(b.velocities, "velocities", 2)
    if pos.shape != vel.shape or pos.shape[0] != n or not 1 <= pos.shape[1] <= 3:
        raise HTTPException(422, "positions and velocities must both be (n_bodies, dim) with dim ≤ 3")
    if np.any(m <= 0) or not math.isfinite(b.dt):
        raise HTTPException(422, "masses must be positive and dt finite")
    if b.steps // b.save_every > 2000:
        raise HTTPException(422, "at most 2000 saved frames (increase save_every)")
    if b.steps * n * n > 2e7:
        raise HTTPException(422, "steps × bodies² must be ≤ 2e7 interactively; submit larger runs as jobs")
    ts, P, V = nbody_verlet(pos, vel, m, b.dt, b.steps, b.save_every)
    return J({"t": ts, "positions": P, "energy": [nbody_energy(p, v, m) for p, v in zip(P, V)]})


@app.post("/api/interferometry/sg")
def interferometry_sg(sc: ScenarioIn, tau: float = Query(0.25, gt=0, le=100)):
    from .interferometry import sg_bmv_phases
    d = sc.design.to()
    return J(sg_bmv_phases(d.mass_A, d.mass_B, d.separation, tau, d.time, d.dx_A, d.geometry, angle_deg=d.angle_deg))


@app.post("/api/interferometry/wavepacket2d")
def wavepacket2d(mass: float = Query(1e-25, ge=1e-30, le=1e-15), sigma: float = Query(5e-7, ge=1e-8, le=1e-5),
                 split_k: float = Query(2e6, ge=0, le=1e8), gravity: float = Query(9.81, ge=-1e3, le=1e3),
                 t_final: float = Query(2e-3, gt=0, le=1.0), frames: int = Query(40, ge=1, le=120),
                 n: int = Query(128, ge=16, le=256)):
    """2-D split-step evolution of a coherently split wave packet (two momentum branches) under gravity."""
    from .interferometry import split_step_2d
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
    if omega * t_final > 2 * math.pi * 1000:
        # the covariance ODE is integrated at rtol 1e-10: cost grows with the number of oscillation periods
        raise HTTPException(422, "omega × t_final must be ≤ 2π × 1000 (1000 trap periods) interactively")
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
    if fmt == "json" and bmv.check_geometry(d):
        raise HTTPException(422, {"admissibility_issues": bmv.check_geometry(d)})
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
    seed: int = Field(0, ge=0, le=2**63 - 1)
    settings: list[Literal[tuple(qm.PAULI_SETTINGS)]] = Field(default_factory=lambda: list(qm.PAULI_SETTINGS),
                                                             min_length=1, max_length=9)


@app.post("/api/signal/simulate")
def signal_simulate(s: SimIn):
    from .design import scenario_for
    from .discrimination import protocol_frame
    from .sigproc import simulate_counts, DetectorModel, witness_estimate
    _hypothesis(s.model)
    if len(set(s.settings)) != len(s.settings):
        raise HTTPException(422, "measurement settings must be distinct")
    scen, _ = scenario_for(s.design.to(), _env(s.environment))
    rho = models.HYPOTHESES[s.model].state(scen)
    F = protocol_frame(scen)
    rec = simulate_counts(F @ rho @ F.conj().T, s.settings, s.shots,
                          DetectorModel(s.environment.readout_error, s.environment.readout_error), s.seed, s.model,
                          {"design": s.design.model_dump(), "environment": s.environment.model_dump()})
    if all(k in rec["counts"] for k in ("XX", "YZ", "ZY")):
        # the witness variant is part of the preregistered protocol: fixed from the QG-COH prediction for the
        # design, never from the (in reality unknown) model that generated the data
        sign = 1
        e = qm.pauli_expectations(F @ models.HYPOTHESES["QG-COH"].state(scen) @ F.conj().T)
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
    for k, v in c.counts.items():
        if len(v) != 4 or min(v) < 0 or not 0 < sum(v) <= 10**9:
            raise HTTPException(422, f"{k}: four non-negative counts (++, +-, -+, --) with a positive total ≤ 1e9")
    return J(tomography_with_uncertainty(c.counts, n_boot=100))


@app.post("/api/signal/injection")
def signal_injection(noise: float = Query(1.0, gt=0, le=1e6), threshold: float = Query(5.0, ge=0, le=100),
                     trials: int = Query(100, ge=1, le=300)):
    from .sigproc import injection_recovery
    tpl = np.sin(np.linspace(0, 8 * np.pi, 200)) * np.hanning(200)
    return J(injection_recovery(tpl, np.linspace(0, 1.2, 9), 4000, noise, threshold, trials))


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
def submit_job(j: JobIn, request: Request, r: str = Depends(role)):
    if j.type not in HANDLERS:
        raise HTTPException(422, f"unknown job type; available: {sorted(HANDLERS)}")
    if len(json.dumps(j.params)) > 2_000_000:
        raise HTTPException(413, "params too large")
    client = request.client.host if request.client else "?"
    st = JobStore()
    params = {k: v for k, v in j.params.items() if not k.startswith("_")}
    if r != "public":
        params.update({"_role": r, "_client": client})
        return J({"id": st.submit(j.type, params), "role": r})
    if j.type not in PUBLIC_JOB_TYPES:
        raise HTTPException(401, RESEARCHER_ONLY)
    try:
        params = sanitize_public_params(j.type, params)
    except ValueError as e:
        raise HTTPException(422, str(e))
    once_per = None
    if j.type == "fetch_source":
        from .data import CONNECTORS
        if params.get("connector") not in CONNECTORS:
            raise HTTPException(422, f"unknown connector; available: {sorted(CONNECTORS)}")
        # anonymous fetches of one source: at most one per hour (shared across visitors and processes)
        once_per = (f"public-fetch-{params['connector']}", 3600.0)
    params.update({"_role": r, "_client": client})
    try:
        jid = st.submit_limited(j.type, params, client, PUBLIC_MAX_ACTIVE_PER_CLIENT, PUBLIC_MAX_QUEUE,
                                once_per=once_per)
    except QueueLimit as e:
        if e.kind == "interval":
            raise HTTPException(429, "this source was fetched recently; try again later or view the catalogue")
        if e.kind == "client":
            raise HTTPException(429, f"you already have {e.count} jobs running; wait for one to finish "
                                     f"(limit {PUBLIC_MAX_ACTIVE_PER_CLIENT} per visitor)")
        raise HTTPException(503, "the job queue is busy; please try again in a few minutes")
    return J({"id": jid, "role": r})


def _public_error(err: str | None) -> str | None:
    """Last line of a stored traceback: anonymous visitors do not see server file paths or source lines."""
    if not err:
        return err
    lines = [x for x in err.strip().splitlines() if x.strip()]
    return lines[-1] if lines else err


@app.get("/api/jobs")
def list_jobs(limit: int = Query(50, ge=1, le=500), r: str = Depends(role)):
    jobs = JobStore().list(limit)
    if r == "public":
        for x in jobs:
            x["error"] = _public_error(x["error"])
    return J({"jobs": jobs, "types": sorted(HANDLERS)})


@app.get("/api/jobs/{jid}")
def job(jid: str, r: str = Depends(role)):
    j = JobStore().get(jid)
    if not j:
        raise HTTPException(404)
    if j["status"] == "succeeded" and j["result_path"]:
        j["result"] = json.loads(Path(j["result_path"]).read_text())
    j["params"] = {k: v for k, v in j["params"].items() if not k.startswith("_")}
    j.pop("result_path", None)
    j.pop("worker", None)
    if r == "public":
        j["error"] = _public_error(j["error"])
    return J(j)


@app.post("/api/jobs/{jid}/cancel")
def cancel(jid: str, request: Request, r: str = Depends(role)):
    st = JobStore()
    j = st.get(jid)
    if not j:
        raise HTTPException(404)
    client = request.client.host if request.client else "?"
    if r == "public" and (j["params"].get("_client") != client or j["params"].get("_role") != "public"):
        # a visitor behind the same proxy/NAT as a researcher must not cancel researcher or scheduler jobs
        raise HTTPException(403, "only the visitor who submitted a job (or a researcher) can cancel it")
    st.cancel(jid)
    return J({"ok": True})


# ----------------------------------------------------------------------------- Suites 14, 16
@app.get("/api/vv/registry")
def vv_registry():
    from . import vv
    return J([{k: getattr(b, k) for k in ("id", "suite", "title", "kind", "tolerance", "justification", "reference",
                                          "compare", "slow")} for b in vv.REGISTRY])


@app.get("/api/vv/latest")
def vv_latest():
    """Latest *complete* verification run: a run restricted to chosen benchmark ids (any visitor may submit one)
    is not a verification of the platform and is never reported here or used by the gate evaluator."""
    st = JobStore()
    for j in st.list(500, status="succeeded"):
        if j["type"] != "vv_run":
            continue
        full = st.get(j["id"]) or {}
        if full.get("params", {}).get("ids"):
            continue
        rep = json.loads((paths()["results"] / f"{j['id']}.json").read_text())
        rep.setdefault("scope", "full")
        return J(rep | {"job": j})
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
                      n: int = Query(128, ge=16, le=512), seed: int = Query(0, ge=0, le=2**32 - 1)):
    from .discovery import bmv_scaling_study
    return J(bmv_scaling_study(n=n, seed=seed, regime=regime, geometry=geometry))


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


async def _read_upload(file: UploadFile, limit: int = MAX_UPLOAD_BYTES) -> bytes:
    """Read an upload in chunks, refusing more than `limit` bytes (chunked requests carry no Content-Length,
    so the middleware check alone does not bound them)."""
    buf = bytearray()
    while chunk := await file.read(1 << 20):
        buf += chunk
        if len(buf) > limit:
            raise HTTPException(413, "payload too large")
    return bytes(buf)


@app.post("/api/data/validate")
async def data_validate(file: UploadFile = File(...)):
    from .data import parse_upload, validate_density_matrix
    raw = await _read_upload(file)
    try:
        parsed = parse_upload(file.filename or "upload", raw)
    except Exception as e:
        raise HTTPException(422, f"could not parse: {type(e).__name__}: {str(e)[:200]}")
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
def evidence_ledger(kind: str | None = None, limit: int = Query(200, ge=1, le=5000)):
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
def preregister(p: PreregIn, who: dict = Depends(need_identity("researcher"))):
    from .evidence import preregister as prereg
    from .design import scenario_for
    from .discrimination import predictions_table
    for h in p.hypotheses:
        _hypothesis(h)  # a preregistration may only name implemented, registered hypotheses
    scen, _ = scenario_for(p.scenario.design.to(), _env(p.scenario.environment))
    preds = {x["id"]: x for x in predictions_table(scen) if x["id"] in p.hypotheses}
    nuis = {h: [n.__dict__ for n in models.HYPOTHESES[h].nuisance] for h in p.hypotheses if h in models.HYPOTHESES}
    e = prereg(_ledger(), title=p.title, hypotheses=p.hypotheses, design=p.scenario.model_dump(), predictions=preds,
               decision_rules=p.decision_rules, analysis_plan=p.analysis_plan, seeds=p.seeds,
               sample_size=p.sample_size, nuisance_ranges=nuis, actor=who["name"],
               identity={"name": who["name"], "token_id": who["token_id"], "verified": who["verified"]})
    return J(e)


@app.post("/api/evidence/datasets")
async def ingest_dataset(file: UploadFile = File(...), label: str = Form(...), role: str = Form(...),
                         source: str = Form(...), description: str = Form(""), prereg_id: str | None = Form(None),
                         who: dict = Depends(need_identity("researcher", "operator"))):
    from .evidence import BlindVault
    raw = await _read_upload(file)
    try:
        rec = BlindVault(paths()["vault"], _ledger()).ingest(
            raw, label=label, role=role, source=source, description=description, prereg_id=prereg_id,
            actor=who["name"], identity={"name": who["name"], "token_id": who["token_id"], "verified": who["verified"]})
    except ValueError as e:
        raise HTTPException(422, str(e))
    return J(rec.__dict__)


class UnblindIn(BaseModel):
    dataset_id: str
    prereg_id: str
    actor: str | None = None  # ignored: the actor is the authenticated identity


@app.post("/api/evidence/unblind")
def unblind(u: UnblindIn, who: dict = Depends(need_identity("researcher"))):
    from .evidence import BlindVault
    try:
        return J(BlindVault(paths()["vault"], _ledger()).unblind(u.dataset_id, u.prereg_id, who["name"]))
    except KeyError:
        raise HTTPException(404, "unknown dataset")
    except PermissionError as e:
        raise HTTPException(403, str(e))


class SignoffIn(BaseModel):
    gate: Literal["G1", "G2", "G3", "G4", "G5", "G6", "G7"]
    affiliation: str = Field(min_length=2, max_length=300)
    statement: str = Field(min_length=10, max_length=5000)
    dataset_id: str | None = None   # G6/G7: the REAL dataset this assessment concerns
    reviewer: str | None = None     # ignored: the reviewer is the identity bound to the access token


@app.get("/api/evidence/anchors")
def evidence_anchors():
    """External anchors of the ledger head (object store + OpenTimestamps) and verification against them.
    Third parties should archive these records: any later truncation of the ledger then becomes detectable."""
    from .anchor import local_anchors, remote_anchors, verify
    led = _ledger()
    local = local_anchors(led)
    try:
        remote, remote_err = remote_anchors(), None
    except Exception as e:  # object store unavailable: report, do not fail
        remote, remote_err = [], type(e).__name__
    seen = {a["anchor_sha256"]: a for a in local + remote}
    return J({"anchors": sorted(seen.values(), key=lambda a: a["ledger_index"])[-200:],
              "verification": verify(led, list(seen.values())),
              "remote_available": remote_err is None, "remote_error": remote_err,
              "how_to_verify": "Archive these anchors. Later POST them to /api/evidence/verify-anchors; each anchored "
                               "(ledger_index, entry_hash) must still exist. OpenTimestamps proofs (.ots) can be "
                               "upgraded and verified with the standard 'ots' client."})


class AnchorsIn(BaseModel):
    anchors: list[dict] = Field(max_length=10000)


@app.post("/api/evidence/verify-anchors")
def verify_external_anchors(a: AnchorsIn):
    """Verify the ledger against anchors archived by a third party (detects truncation and rewrites)."""
    from .anchor import verify
    return J(verify(_ledger(), a.anchors))


@app.post("/api/evidence/signoff")
def signoff(s: SignoffIn, who: dict = Depends(need_identity("researcher"))):
    """The reviewer is the identity bound to the access token, never a free-text field."""
    payload = {k: v for k, v in s.model_dump().items() if k != "reviewer"}
    payload.update({"reviewer": who["name"], "token_id": who["token_id"], "identity_verified": who["verified"]})
    if s.reviewer and s.reviewer != who["name"]:
        payload["claimed_reviewer_ignored"] = s.reviewer
    return J(_ledger().append("human_signoff", payload, who["name"]))


@app.post("/api/evidence/gates")
def gates(sc: ScenarioIn, hypothesis: str = "QG-COH"):
    from .evidence import evaluate_gates, classify_evidence
    from .lab import generate_dossier
    vv_rep = json.loads(vv_latest().body)
    lean = json.loads(lean_status().body)
    agreement = _second_implementation_agreement(sc.design.to())
    native_ok = agreement["agrees"]
    g = evaluate_gates(model_meta=models.HYPOTHESES[_hypothesis(hypothesis)].meta, vv_report=vv_rep if vv_rep.get("summary") else None,
                       lean_status=lean, ledger=_ledger(), dossier=generate_dossier(sc.design.to(), _env(sc.environment)),
                       literature_review=None, second_implementation_match=native_ok)
    return J({"gates": g, "classification": classify_evidence(g, independently_reproduced=native_ok),
              "second_implementation": agreement})


def _second_implementation_agreement(d: bmv.BMVDesign) -> dict:
    """Compare the C++ kernel with the Python reference *for this design*. A loadable library is not evidence
    of agreement; only matching outputs are (tolerances as in tests/test_native.py)."""
    try:
        from . import native
        if not native.available():
            return {"agrees": False, "reason": native.unavailable_reason()}
        if bmv.check_geometry(d):
            return {"agrees": False, "reason": "design not admissible"}
        nat = native.bmv_point(d)
        E = bmv.gravitational_branch_energies(d)
        ph = bmv.phases_from_energies(E, d.time)
        rho = bmv.joint_state(ph, d.gamma_A * d.time, d.gamma_B * d.time)
        U = bmv.local_phase_correction(ph)
        diffs = {"delta_phi_rel": abs(nat["delta_phi"] / bmv.entangling_phase(ph) - 1) if bmv.entangling_phase(ph) else
                 abs(nat["delta_phi"]),
                 "negativity_abs": abs(nat["negativity"] - qm.negativity(rho)),
                 "concurrence_abs": abs(nat["concurrence"] - qm.concurrence(rho)),
                 "witness_abs": abs(nat["witness_cpk_local_corrected"] - bmv.cpk_witness_best_sign(U @ rho @ U.conj().T)),
                 "rho_max_abs": float(np.max(np.abs(nat["rho"] - rho)))}
        ok = (diffs["delta_phi_rel"] <= 1e-9 and diffs["rho_max_abs"] <= 1e-9
              and max(diffs["negativity_abs"], diffs["concurrence_abs"], diffs["witness_abs"]) <= 1e-8)
        return {"agrees": bool(ok), "differences": diffs, "implementation": "C++ kernel (cpp/) vs Python (qgdevs.bmv)"}
    except Exception as e:  # noqa: BLE001 — any failure means agreement was not demonstrated
        return {"agrees": False, "reason": type(e).__name__}


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
def thought_interpret(t: ThoughtIn, r: str = Depends(role)):
    from .thought import interpret
    if t.language_model != "off" and r == "public":
        # language-model calls spend the operator's credentials: researchers only
        cfg = interpret(t.prompt, "off")
        cfg.domain_notes.append("language model assistance requires a researcher token; deterministic interpreter used")
        return J(cfg.as_dict())
    return J(interpret(t.prompt, t.language_model, t.model).as_dict())


class ThoughtExecIn(BaseModel):
    config: dict
    approved: bool


@app.post("/api/thought/execute")
def thought_execute(t: ThoughtExecIn):
    from .thought import ThoughtConfig, Quantity, execute, finalise
    if not t.approved:
        raise HTTPException(403, "the researcher must approve the configuration before execution")
    from .thought import FAMILIES, validate_quantities
    c = t.config
    family = c.get("family")
    if family is not None and family not in FAMILIES:
        raise HTTPException(422, f"unknown family {family!r}; supported: {sorted(FAMILIES)}")
    if c.get("material", "diamond") not in materials.MATERIALS:
        raise HTTPException(422, f"unknown material {c.get('material')!r}")
    if c.get("geometry", "parallel") not in ("parallel", "linear", "angled"):
        raise HTTPException(422, "geometry must be parallel, linear or angled")
    cfg = ThoughtConfig(prompt=str(c.get("prompt", ""))[:4000], family=family,
                        category=c.get("category", "THEORETICAL"), material=c.get("material", "diamond"),
                        geometry=c.get("geometry", "parallel"), speculative=bool(c.get("speculative")),
                        interpreter=c.get("interpreter", "deterministic"))
    from .units import to_si
    for k, q in (c.get("quantities") or {}).items():
        try:
            unit = str(q["unit"])
            # rad/s has no SI scale factor: the value itself is SI (a client-supplied si_value is never trusted)
            si = float(q["value"]) if unit == "rad/s" else to_si(float(q["value"]), unit.replace("µ", "u"))[0]
        except Exception:
            raise HTTPException(422, f"invalid quantity {k}")
        cfg.quantities[k] = Quantity(k, float(q["value"]), unit, si, q.get("source", "USER_STATED"))
    problems = validate_quantities(cfg)
    if problems:
        raise HTTPException(422, {"invalid_quantities": problems})
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
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "unknown API endpoint")
        f = DIST / path
        if path and f.is_file() and DIST in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
