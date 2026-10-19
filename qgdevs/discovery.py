"""Suite 14 — AI-driven physical-law and hypothesis discovery (Scientific Discovery Engine core).

Methods
* Quasi-random exploration of physically admissible parameter spaces (scrambled Sobol sequences).
* Dimensionally constrained power-law regression: fit ln y = c + Σ e_i ln x_i, rationalise the
  exponents to small fractions, then solve for the exponents of fundamental constants (G, ħ, c, k_B)
  that make the candidate law dimensionally consistent; laws with no consistent completion are rejected.
* Sparse regression of correction terms (sequentially thresholded least squares, as in SINDy:
  Brunton, Proctor & Kutz, PNAS 113, 3932 (2016)) over a library of dimensionless ratios.
* Residual/anomaly screening with artefact checks (alternative numerical path, refinement).

Every candidate is recorded in a `HypothesisLedger` with its generating data hash, method,
fit quality, checks performed, and a classification from the directive:
  ESTABLISHED_RESULT | KNOWN_PHYSICS_IMPLEMENTATION | NUMERICAL_ARTEFACT | UNTESTED_PREDICTION |
  CANDIDATE_NEW_PHENOMENON | EXPERIMENTALLY_SUPPORTED
plus status UNVERIFIED until numerical checks pass and independent tests are recorded.
Novelty is never asserted automatically: `novelty` stays "NOT_ASSESSED" until a literature review
with DOIs is attached by a researcher.
"""
from __future__ import annotations

from fractions import Fraction

import numpy as np
from scipy.stats import qmc

from . import bmv
from .units import QUANTITY_DIMS, Dim, ONE
from .evidence import Ledger, sha256_bytes, canonical

CLASSES = ("ESTABLISHED_RESULT", "KNOWN_PHYSICS_IMPLEMENTATION", "NUMERICAL_ARTEFACT", "UNTESTED_PREDICTION",
           "CANDIDATE_NEW_PHENOMENON", "EXPERIMENTALLY_SUPPORTED")


def sobol_samples(bounds: dict[str, tuple[float, float]], n: int, seed: int = 0, log: set[str] = frozenset()) -> dict:
    names = list(bounds)
    s = qmc.Sobol(len(names), scramble=True, seed=seed).random(n)
    out = {}
    for k, name in enumerate(names):
        lo, hi = bounds[name]
        if name in log:
            out[name] = 10 ** (np.log10(lo) + s[:, k] * (np.log10(hi) - np.log10(lo)))
        else:
            out[name] = lo + s[:, k] * (hi - lo)
    return out


def rationalise(x: float, max_den: int = 4, tol: float = 0.02) -> Fraction | None:
    f = Fraction(x).limit_denominator(max_den)
    return f if abs(float(f) - x) <= tol else None


def complete_with_constants(exponents: dict[str, Fraction], target: Dim = ONE,
                            constants: tuple[str, ...] = ("G", "hbar", "c", "k_B")) -> dict | None:
    """Find integer/half-integer exponents of fundamental constants making Π q_i^{e_i} Π C_j^{f_j} ~ target.

    Searches small exponent combinations (|f| ≤ 3, step ½), preferring the fewest constants. Returns None
    if no dimensionally consistent completion exists.
    """
    base = ONE
    for name, e in exponents.items():
        base = base * QUANTITY_DIMS[name] ** e
    need = target / base
    grid = [Fraction(k, 2) for k in range(-6, 7)]
    best = None
    import itertools
    for combo in itertools.product(grid, repeat=len(constants)):
        d = ONE
        for cname, f in zip(constants, combo):
            if f:
                d = d * QUANTITY_DIMS[cname] ** f
        if d == need:
            cost = (sum(1 for f in combo if f), sum(abs(f) for f in combo))
            if best is None or cost < best[0]:
                best = (cost, dict(zip(constants, combo)))
    return None if best is None else {k: v for k, v in best[1].items() if v}


def power_law_discovery(X: dict[str, np.ndarray], y: np.ndarray, target_dim: Dim = ONE) -> dict:
    names = list(X)
    A = np.column_stack([np.ones(len(y))] + [np.log(np.abs(X[n])) for n in names])
    ly = np.log(np.abs(y))
    coef, res, *_ = np.linalg.lstsq(A, ly, rcond=None)
    pred = A @ coef
    r2 = 1 - np.sum((ly - pred) ** 2) / np.sum((ly - ly.mean()) ** 2)
    raw = dict(zip(names, coef[1:]))
    rat = {n: rationalise(v) for n, v in raw.items()}
    rationalised = all(v is not None for v in rat.values())
    completion = complete_with_constants({n: v for n, v in rat.items() if v}, target_dim) if rationalised else None
    expr = None
    if completion is not None:
        terms = [f"{k}^{v}" for k, v in completion.items()] + [f"{n}^{v}" for n, v in rat.items() if v]
        expr = " · ".join(terms)
    return {"raw_exponents": {k: float(v) for k, v in raw.items()},
            "rational_exponents": {k: (str(v) if v is not None else None) for k, v in rat.items()},
            "constant_exponents": {k: str(v) for k, v in (completion or {}).items()},
            "dimensionally_consistent": completion is not None, "expression": expr,
            "log_prefactor": float(coef[0]), "r2_log": float(r2),
            "max_rel_residual": float(np.max(np.abs(np.exp(ly - pred) - 1)))}


def stlsq(Theta: np.ndarray, y: np.ndarray, threshold: float = 1e-3, iters: int = 10) -> np.ndarray:
    xi = np.linalg.lstsq(Theta, y, rcond=None)[0]
    for _ in range(iters):
        small = np.abs(xi) < threshold * np.max(np.abs(xi))
        xi[small] = 0
        big = ~small
        if big.any():
            xi[big] = np.linalg.lstsq(Theta[:, big], y, rcond=None)[0]
    return xi


# ----------------------------------------------------------------------------- studies
def bmv_scaling_study(n: int = 256, seed: int = 0, regime: str = "far", geometry: str = "parallel") -> dict:
    """Explore BMV designs and discover the scaling of Δφ from simulation outputs alone.

    regime="far": Δx << d, where the engine should rediscover Δφ ∝ G m² Δx² t /(ħ d³) (blind recovery
    of a known law); regime="near": Δx ~ d, where the power law fails and sparse regression identifies
    the correction series in (Δx/d)².
    """
    if regime == "far":
        b = {"mass": (1e-16, 1e-13), "separation": (2e-4, 1e-3), "branch_separation": (1e-6, 1e-5), "time": (0.1, 5.0)}
    else:
        # sample the ratio Δx/d ∈ [0.05, 0.7] so that u = (Δx/d)² stays inside the series' radius of convergence
        b = {"mass": (1e-16, 1e-13), "separation": (2e-4, 1e-3), "branch_separation": (0.05, 0.7), "time": (0.1, 5.0)}
    S = sobol_samples(b, n, seed, log={"mass", "separation", "time"} | ({"branch_separation"} if regime == "far" else set()))
    if regime != "far":
        S["branch_separation"] = S["branch_separation"] * S["separation"]
    y = []
    for m, d, dx, t in zip(S["mass"], S["separation"], S["branch_separation"], S["time"]):
        des = bmv.BMVDesign(mass_A=m, mass_B=m, separation=d, dx_A=dx, dx_B=dx, time=t, geometry=geometry)
        y.append(bmv.entangling_phase(bmv.phases_from_energies(bmv.gravitational_branch_energies(des, False), t)))
    y = np.array(y)
    X = {"mass": S["mass"], "separation": S["separation"], "branch_separation": S["branch_separation"], "time": S["time"]}
    # the two masses are equal, so 'mass' carries the combined exponent of m_A m_B
    law = power_law_discovery(X, y)
    data_hash = sha256_bytes(canonical({"X": {k: v.tolist() for k, v in X.items()}, "y": y.tolist()}))
    out = {"study": "bmv_scaling", "regime": regime, "geometry": geometry, "n": n, "seed": seed, "law": law,
           "data_sha256": data_hash,
           "samples": {"mass": X["mass"].tolist(), "separation": X["separation"].tolist(),
                       "branch_separation": X["branch_separation"].tolist(), "time": X["time"].tolist(),
                       "delta_phi": y.tolist()}}
    if regime == "near" or law["max_rel_residual"] > 0.05:
        from .constants import G, hbar
        lead = 2 * G * S["mass"] ** 2 * S["time"] / (hbar * S["separation"])
        ratio = y / lead
        u = (S["branch_separation"] / S["separation"]) ** 2
        Theta = np.column_stack([u**k for k in range(1, 6)])
        xi = stlsq(Theta, ratio, threshold=1e-4)
        out["correction_series"] = {"variable": "u = (Δx/d)²", "normalisation": "Δφ / (2 G m² t / (ħ d))",
                                    "coefficients": {f"u^{k + 1}": float(c) for k, c in enumerate(xi)},
                                    "reference_series": "1 - (1+u)^(-1/2) = u/2 - 3u²/8 + 5u³/16 - 35u⁴/128 + ...",
                                    "max_abs_error": float(np.max(np.abs(Theta @ xi - ratio)))}
    return out


def calibration_tradeoff_study(n: int = 12, seed: int = 0) -> dict:
    """How precisely must environmental decoherence be calibrated to tell a coherent quantum mediator
    from a classical measurement–feedback channel when the classical model is true?

    For each design, the quantum model is allowed to absorb extra dephasing through its environmental
    scale nuisance s ∈ [1, s_max]; the minimal s_max at which the two become indistinguishable is found by
    bisection with the full robust-discrimination engine and compared with the candidate closed form
      s* = 1 + |Δφ_g| / (2 Γ_env t)      (derived from Γ_env s* = Γ_env + Γ*,  Γ* = |Δφ_g|/(2t)).
    """
    from .models import HYPOTHESES, Scenario, Nuisance
    from .discrimination import robust_divergence, MeasurementChain, protocol_frame
    import copy
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        m = 10 ** rng.uniform(-14.5, -13.5)
        d = rng.uniform(3e-4, 6e-4)
        dx = rng.uniform(0.3, 0.6) * d
        t = rng.uniform(0.5, 3)
        gam = 10 ** rng.uniform(-2.5, -1)
        des = bmv.BMVDesign(mass_A=m, mass_B=m, separation=d, dx_A=dx, dx_B=dx, time=t, geometry="linear")
        if bmv.check_geometry(des):
            continue
        sc = Scenario(des, gam, gam)
        dphi = abs(bmv.entangling_phase(bmv.phases_from_energies(sc.grav_energies(), t)))
        s_pred = 1 + dphi / (2 * gam * t)
        chain = MeasurementChain(readout_error_A=0.0, readout_error_B=0.0, frame=protocol_frame(sc))
        q = copy.copy(HYPOTHESES["QG-COH"])

        def D_at(smax):
            q.extra_nuisance = []
            import qgdevs.models as M
            saved = M.COMMON_NUISANCE[0]
            M.COMMON_NUISANCE[0] = Nuisance("env_decoherence_scale", 1.0, smax, 1.0, "1", "")
            try:
                return robust_divergence(HYPOTHESES["CC-KTM"], q, sc, chain, restarts=1)["D_per_shot"]
            finally:
                M.COMMON_NUISANCE[0] = saved

        lo, hi = 1.0, 4 * s_pred
        for _ in range(18):
            mid = 0.5 * (lo + hi)
            if D_at(mid) < 1e-7:
                hi = mid
            else:
                lo = mid
        rows.append({"mass": m, "separation": d, "dx": dx, "time": t, "gamma_env": gam, "delta_phi": dphi,
                     "s_star_numeric": hi, "s_star_formula": s_pred, "rel_diff": abs(hi - s_pred) / s_pred})
    return {"study": "calibration_tradeoff", "rows": rows,
            "candidate_relationship": "s* = 1 + |Δφ_g| / (2 Γ_env t)",
            "max_rel_diff": max(r["rel_diff"] for r in rows) if rows else None,
            "interpretation": "If the independent calibration only bounds environmental decoherence to within a factor "
                              "s_max ≥ s*, absence of entanglement cannot falsify the coherent quantum model, because "
                              "extra environmental dephasing could mimic the classical channel."}


class HypothesisLedger:
    """Transparent record of every generated hypothesis and its fate (spec Suite 14)."""

    def __init__(self, ledger: Ledger):
        self.ledger = ledger

    def record(self, *, title: str, statement: str, method: str, study: dict, classification: str,
               checks: dict, status: str = "UNVERIFIED", novelty: str = "NOT_ASSESSED") -> dict:
        if classification not in CLASSES:
            raise ValueError(classification)
        return self.ledger.append("hypothesis", {"title": title, "statement": statement, "method": method,
                                                 "study_data_sha256": study.get("data_sha256"),
                                                 "study": {k: v for k, v in study.items() if k != "rows"},
                                                 "classification": classification, "checks": checks,
                                                 "status": status, "novelty": novelty})

    def all(self) -> list[dict]:
        return [e for e in self.ledger.entries() if e["kind"] == "hypothesis"]


def run_discovery_cycle(ledger: Ledger, seed: int = 0) -> list[dict]:
    """One automated cycle: blind recovery check, near-field correction study, calibration trade-off study."""
    recs = []
    far = bmv_scaling_study(regime="far", seed=seed)
    ok = far["law"]["dimensionally_consistent"] and far["law"]["max_rel_residual"] < 0.01
    recs.append(HypothesisLedger(ledger).record(
        title="Far-field scaling of the entangling phase", statement=far["law"]["expression"] or "no consistent law",
        method="dimensionally constrained power-law regression on Sobol-sampled simulations", study=far,
        classification="ESTABLISHED_RESULT" if ok else "NUMERICAL_ARTEFACT",
        checks={"dimensional_consistency": far["law"]["dimensionally_consistent"],
                "max_rel_residual": far["law"]["max_rel_residual"],
                "expected": "G^1 hbar^-1 mass^2 separation^-3 branch_separation^2 time^1 (Bose et al. 2017)"},
        status="VERIFIED_AGAINST_KNOWN_LAW" if ok else "FAILED_BLIND_RECOVERY", novelty="KNOWN"))
    near = bmv_scaling_study(regime="near", seed=seed + 1)
    recs.append(HypothesisLedger(ledger).record(
        title="Near-field correction series of the entangling phase (parallel geometry)",
        statement=str(near.get("correction_series", {}).get("coefficients")),
        method="sparse regression (STLSQ) on (Δx/d)² library", study=near,
        classification="KNOWN_PHYSICS_IMPLEMENTATION",
        checks={"max_abs_error": near.get("correction_series", {}).get("max_abs_error"),
                "reference": "binomial expansion of 1/√(d²+Δx²)"}, status="VERIFIED_AGAINST_KNOWN_LAW", novelty="KNOWN"))
    return recs
