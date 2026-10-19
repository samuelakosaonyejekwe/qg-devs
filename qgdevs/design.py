"""Suite 13 — Experimental design and optimisation.

Two-stage (multi-fidelity) design search:
 1. A fast surrogate objective — shots needed for a prespecified one-sided significance of the
    entanglement witness under the quantum-coherent model, with all decoherence and readout effects
    included — is minimised by differential evolution over (mass, centre separation, branch separation,
    interaction time) subject to explicit physical constraints.
 2. The best candidates are re-ranked with the full nuisance-robust model-discrimination engine
    (Suite 12), whose per-shot divergence is the expected information gain for model selection.

Constraints are reported individually so infeasible regions are explained, never silently dropped.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict, field

import numpy as np
from scipy.optimize import differential_evolution

from . import bmv, em, decoherence as dec, materials
from .models import Scenario


MIN_SHOTS_GAUSSIAN = 50  # below this the normal approximation to the witness estimator is not trusted


@dataclass
class Environment:
    pressure: float = 1e-15          # Pa
    T_gas: float = 0.15              # K
    T_env: float = 0.15              # K (black-body environment)
    T_int: float = 0.15              # K (internal temperature of the masses)
    material: str = "diamond"
    residual_charge_e: float = 0.0   # elementary charges on each mass
    include_casimir: bool = True
    readout_error: float = 0.01
    bias_field_T: float = 0.0        # uniform magnetic field during the interaction (along z)


@dataclass
class DesignBounds:
    mass: tuple[float, float] = (1e-16, 1e-13)       # kg
    separation: tuple[float, float] = (50e-6, 1e-3)  # m
    dx: tuple[float, float] = (1e-6, 250e-6)         # m (upper bound = technological limit assumed)
    time: tuple[float, float] = (0.1, 5.0)           # s
    min_surface_gap: float = 10e-6                   # m, closest approach between any two branch surfaces
    max_casimir_fraction: float = 0.1                # |Δφ_CP| / |Δφ_grav| allowed
    geometry: str = "linear"


def scenario_for(design: bmv.BMVDesign, env: Environment) -> tuple[Scenario, dict]:
    mat = materials.get(env.material)
    cm = mat.clausius_mossotti()
    budA = dec.budget(design.mass_A, design.radius_A, design.dx_A, pressure=env.pressure, T_gas=env.T_gas,
                      T_env=env.T_env, T_int=env.T_int, cm=cm, t=design.time)
    budB = dec.budget(design.mass_B, design.radius_B, design.dx_B, pressure=env.pressure, T_gas=env.T_gas,
                      T_env=env.T_env, T_int=env.T_int, cm=cm, t=design.time)
    from .constants import e as e_charge
    include = ("casimir", "coulomb", "induced") if env.include_casimir else ("coulomb", "induced")
    ch = em.branch_energies(design, cm.real, cm.real, env.residual_charge_e * e_charge,
                            env.residual_charge_e * e_charge, include=include)
    # always-present NV spin–spin dipolar coupling; diamagnetic coupling when a bias field is applied
    for k, v in em.spin_dipolar_branch_energies(design).items():
        ch[k]["spin_dipolar"] = v
    if env.bias_field_T:
        for k, v in em.diamagnetic_branch_energies(design, mat.magnetic_susceptibility, (0, 0, env.bias_field_T)).items():
            ch[k]["diamagnetic"] = v
    sc = Scenario(design, budA["total_rate"], budB["total_rate"], em.total_by_branch(ch))
    return sc, {"decoherence_A": budA, "decoherence_B": budB, "nongrav_channels": ch}


def constraint_report(design: bmv.BMVDesign, env: Environment, bounds: DesignBounds) -> dict:
    issues = bmv.check_geometry(design)
    d = bmv.branch_distances(design)
    gap = min(d.values()) - design.radius_A - design.radius_B
    sc, extra = scenario_for(design, env)
    dphi_g = bmv.entangling_phase(bmv.phases_from_energies(sc.grav_energies(), design.time))
    dphi_ng = bmv.entangling_phase(bmv.phases_from_energies(sc.nongrav_energies, design.time))
    frac = abs(dphi_ng) / max(abs(dphi_g), 1e-300)
    checks = {
        "geometry_admissible": {"ok": not issues, "detail": issues},
        "surface_gap": {"ok": gap >= bounds.min_surface_gap, "value_m": gap, "required_m": bounds.min_surface_gap},
        "nongravitational_phase_fraction": {"ok": frac <= bounds.max_casimir_fraction, "value": frac,
                                            "allowed": bounds.max_casimir_fraction},
    }
    return {"feasible": all(c["ok"] for c in checks.values()), "checks": checks,
            "delta_phi_grav": dphi_g, "delta_phi_nongrav": dphi_ng, "scenario": sc, **extra}


def witness_shots(design: bmv.BMVDesign, env: Environment, z_target: float = 5.0) -> dict:
    """Shots per setting for a z_target-sigma one-sided witness violation under QG-COH (surrogate objective)."""
    from .models import HYPOTHESES
    from .quantum import pauli_expectations
    sc, _ = scenario_for(design, env)
    rho = HYPOTHESES["QG-COH"].state(sc)
    from .discrimination import protocol_frame
    F = protocol_frame(sc)
    rc = F @ rho @ F.conj().T
    e = pauli_expectations(rc)
    f = (1 - 2 * env.readout_error) ** 2
    best = None
    for sign in (+1, -1):
        # readout-corrected estimator: unbiased for W_true, variance inflated by 1/f² per correlator
        Em = {k: f * e[k] for k in ("XX", "YZ", "ZY")}
        W_true = 1 - e["XX"] - sign * (e["YZ"] + e["ZY"])
        var1 = sum(1 - Em[k] ** 2 for k in Em) / f**2
        if W_true < 0:
            n_gauss = z_target**2 * var1 / W_true**2
            n = max(n_gauss, MIN_SHOTS_GAUSSIAN)
            if best is None or n < best["shots_per_setting"]:
                best = {"shots_per_setting": float(n), "witness": W_true, "sign": sign,
                        "gaussian_estimate": float(n_gauss), "floor_applied": n_gauss < MIN_SHOTS_GAUSSIAN}
    return best or {"shots_per_setting": float("inf"), "witness": float(
        min(1 - e["XX"] - e["YZ"] - e["ZY"], 1 - e["XX"] + e["YZ"] + e["ZY"])), "sign": 0}


def _design_from(x, bounds: DesignBounds, base: bmv.BMVDesign) -> bmv.BMVDesign:
    lm, d, dx, t = x
    m = 10**lm
    return bmv.BMVDesign(mass_A=m, mass_B=m, density=base.density, separation=d, dx_A=dx, dx_B=dx,
                         geometry=bounds.geometry, angle_deg=base.angle_deg, time=t)


def optimise(env: Environment = Environment(), bounds: DesignBounds = DesignBounds(), seed: int = 0,
             maxiter: int = 40, popsize: int = 12, cycle_overhead_s: float = 1.0, top_k: int = 3,
             robust_check: bool = True) -> dict:
    """Minimise total experiment wall time = 3 settings × shots × (t + overhead) under constraints."""
    base = bmv.BMVDesign(density=materials.get(env.material).density)
    lo = [np.log10(bounds.mass[0]), bounds.separation[0], bounds.dx[0], bounds.time[0]]
    hi = [np.log10(bounds.mass[1]), bounds.separation[1], bounds.dx[1], bounds.time[1]]
    evaluated = []

    def objective(x):
        des = _design_from(x, bounds, base)
        rep = constraint_report(des, env, bounds)
        if not rep["feasible"]:
            pen = 0.0
            ch = rep["checks"]
            if not ch["geometry_admissible"]["ok"]:
                pen += 50
            if not ch["surface_gap"]["ok"]:
                pen += 20 + 20 * (bounds.min_surface_gap - ch["surface_gap"]["value_m"]) / bounds.min_surface_gap
            if not ch["nongravitational_phase_fraction"]["ok"]:
                pen += 20 + np.log10(ch["nongravitational_phase_fraction"]["value"] / bounds.max_casimir_fraction)
            return 100 + pen
        ws = witness_shots(des, env)
        n = ws["shots_per_setting"]
        val = np.log10(3 * n * (des.time + cycle_overhead_s)) if np.isfinite(n) else 60.0
        evaluated.append((val, list(map(float, x))))
        return val

    res = differential_evolution(objective, list(zip(lo, hi)), seed=seed, maxiter=maxiter, popsize=popsize,
                                 tol=1e-6, polish=False)
    evaluated.sort(key=lambda r: r[0])
    seen, cands = [], []
    for val, x in evaluated:
        if all(np.linalg.norm((np.array(x) - np.array(s)) / (np.array(hi) - np.array(lo))) > 0.05 for s in seen):
            seen.append(x)
            cands.append((val, x))
        if len(cands) >= top_k:
            break
    ranked = []
    for val, x in cands:
        des = _design_from(x, bounds, base)
        rep = constraint_report(des, env, bounds)
        ws = witness_shots(des, env)
        entry = {"design": des.as_dict(), "log10_total_time_s": val, "total_time_s": 10**val,
                 "witness_shots_per_setting": ws["shots_per_setting"], "predicted_witness": ws["witness"],
                 "delta_phi_grav": rep["delta_phi_grav"], "delta_phi_nongrav": rep["delta_phi_nongrav"],
                 "decoherence_rate_A": rep["decoherence_A"]["total_rate"],
                 "dominant_decoherence": rep["decoherence_A"]["dominant"], "constraints": {
                     k: {kk: vv for kk, vv in v.items()} for k, v in rep["checks"].items()}}
        if robust_check:
            from .discrimination import discrimination_matrix, MeasurementChain
            M = discrimination_matrix(rep["scenario"], ["QG-COH", "CC-KTM", "SC-MF", "NULL-NG"],
                                      MeasurementChain(readout_error_A=env.readout_error,
                                                       readout_error_B=env.readout_error))
            entry["robust_discrimination"] = [p for p in M["pairs"] if p["true"] == "QG-COH"]
        ranked.append(entry)
    return {"optimiser": "scipy differential_evolution", "seed": seed, "converged": bool(res.success),
            "n_evaluations": int(res.nfev), "environment": asdict(env), "bounds": asdict(bounds),
            "candidates": ranked,
            "objective": "log10( 3 settings × shots for 5σ witness violation × (t + overhead) )"}


def sweep_1d(design: bmv.BMVDesign, env: Environment, param: str, values) -> dict:
    """Prediction of every implemented hypothesis along one design parameter."""
    from .discrimination import predictions_table
    rows = []
    for v in values:
        d = bmv.BMVDesign.from_dict({**design.as_dict(), param: float(v)})
        if param == "mass_A":
            d.mass_B = float(v)
        if param == "dx_A":
            d.dx_B = float(v)
        if bmv.check_geometry(d):
            rows.append({"value": float(v), "admissible": False})
            continue
        sc, _ = scenario_for(d, env)
        rows.append({"value": float(v), "admissible": True,
                     "delta_phi": bmv.entangling_phase(bmv.phases_from_energies(sc.grav_energies(), d.time)),
                     "gamma_env": sc.gamma_env_A,
                     "models": {r["id"]: {"negativity": r["negativity"], "witness": r["witness_cpk"],
                                          "coherence": r["coherence_A"]} for r in predictions_table(sc)}})
    return {"parameter": param, "rows": rows}


def sweep_2d(design: bmv.BMVDesign, env: Environment, px: str, xs, py: str, ys, hypothesis: str = "QG-COH") -> dict:
    """Heat-map data: negativity and witness of one hypothesis over a 2-D design slice."""
    from .models import HYPOTHESES
    from .quantum import negativity
    from .discrimination import protocol_frame
    neg = np.full((len(ys), len(xs)), np.nan)
    wit = np.full((len(ys), len(xs)), np.nan)
    for i, y in enumerate(ys):
        for j, x in enumerate(xs):
            dd = {**design.as_dict(), px: float(x), py: float(y)}
            for a, b in (("mass_A", "mass_B"), ("dx_A", "dx_B")):
                if a in (px, py):
                    dd[b] = dd[a]
            d = bmv.BMVDesign.from_dict(dd)
            if bmv.check_geometry(d):
                continue
            sc, _ = scenario_for(d, env)
            rho = HYPOTHESES[hypothesis].state(sc)
            F = protocol_frame(sc)
            neg[i, j] = negativity(rho)
            wit[i, j] = bmv.cpk_witness_best_sign(F @ rho @ F.conj().T)
    return {"x": {"name": px, "values": list(map(float, xs))}, "y": {"name": py, "values": list(map(float, ys))},
            "negativity": np.where(np.isnan(neg), None, neg).tolist(),
            "witness": np.where(np.isnan(wit), None, wit).tolist(), "hypothesis": hypothesis}
