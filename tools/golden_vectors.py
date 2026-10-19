"""Generate golden reference vectors for the TypeScript offline engine (web/src/engine/golden.json).

Every value is computed by the Python reference implementation (qgdevs) exactly as the HTTP API does
for POST /api/bmv/predict, so the browser engine can be checked against it to round-off precision.

Run:  /home/akosa/grqg/.venv/bin/python tools/golden_vectors.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from qgdevs import bmv, decoherence as dec, em, materials, qg_eft  # noqa: E402
from qgdevs.design import Environment, scenario_for  # noqa: E402
from qgdevs.discrimination import predictions_table  # noqa: E402

OUT = ROOT / "web" / "src" / "engine" / "golden.json"


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
    if isinstance(x, complex):
        return {"re": x.real, "im": x.imag}
    if isinstance(x, float) and not math.isfinite(x):
        return None if math.isnan(x) else ("Infinity" if x > 0 else "-Infinity")
    return x


def cases():
    rng = np.random.default_rng(20261019)
    mats = list(materials.MATERIALS)
    geoms = ["parallel", "linear", "angled"]
    out = []
    # reference BMV design
    out.append(({}, {}))
    out.append(({}, {"pressure": 0.0}))  # pure state (no decoherence)
    out.append(({"mass_A": 1e-14, "mass_B": 1e-14, "separation": 200e-6, "dx_A": 150e-6, "dx_B": 150e-6,
                 "geometry": "linear", "time": 1.0}, {"pressure": 0.0, "T_env": 0.0, "T_int": 0.0}))
    out.append(({}, {"material": "silica", "T_int": 4.0, "T_env": 4.0}))
    out.append(({"geometry": "angled", "angle_deg": 30.0}, {"residual_charge_e": 1.0}))
    out.append(({"geometry": "angled", "angle_deg": 135.0, "dx_B": 120e-6}, {"residual_charge_e": 10.0,
                                                                              "include_casimir": False}))
    # magnetic backgrounds: diamagnetic coupling under a bias field (diamond, gold) and paramagnetic osmium
    out.append(({}, {"bias_field_T": 1.0}))
    out.append(({"geometry": "linear", "separation": 600e-6, "dx_A": 200e-6, "dx_B": 200e-6},
                {"material": "gold", "bias_field_T": -2.5}))
    out.append(({"geometry": "angled", "angle_deg": 60.0, "time": 1.2}, {"material": "osmium", "bias_field_T": 0.3,
                                                                           "include_casimir": False}))
    while len(out) < 40:
        lm = rng.uniform(-16, -12)
        m_a = 10**lm
        m_b = m_a if rng.random() < 0.7 else 10 ** (lm + rng.uniform(-0.5, 0.5))
        mat = mats[len(out) % len(mats)]
        dens = materials.get(mat).density
        r = max((3 * m_a / (4 * np.pi * dens)) ** (1 / 3), (3 * m_b / (4 * np.pi * dens)) ** (1 / 3))
        dx_a = float(rng.uniform(max(3 * r, 1e-6), 300e-6))
        dx_b = dx_a if rng.random() < 0.6 else float(rng.uniform(max(3 * r, 1e-6), 300e-6))
        sep = float(rng.uniform(max(dx_a, dx_b) * 0.6 + 10 * r + 20e-6, 1.5e-3))
        geom = geoms[len(out) % 3]
        d = {"mass_A": m_a, "mass_B": m_b, "density": dens, "separation": sep, "dx_A": dx_a, "dx_B": dx_b,
             "geometry": geom, "angle_deg": float(rng.uniform(0, 180)), "time": float(rng.uniform(0.05, 6.0))}
        e = {"material": mat, "pressure": float(10 ** rng.uniform(-17, -10)),
             "T_gas": float(rng.uniform(0.01, 20)), "T_env": float(rng.uniform(0, 30)),
             "T_int": float(rng.uniform(0, 30)) if rng.random() < 0.6 else 0.0,
             "residual_charge_e": float([0, 0, 0, 0, 0, 1, 0, 10][len(out) % 8]),
             "include_casimir": bool(rng.random() < 0.75), "readout_error": float(rng.uniform(0, 0.1)),
             "bias_field_T": float(rng.uniform(-3, 3)) if len(out) % 4 == 1 else 0.0}
        des = bmv.BMVDesign.from_dict({**bmv.BMVDesign().__dict__, **d})
        if bmv.check_geometry(des):
            continue
        out.append((d, e))
    return out


INADMISSIBLE = [
    ({"separation": 250e-6, "dx_A": 250e-6, "dx_B": 250e-6, "geometry": "linear"}, {}),  # branches coincide
    ({"mass_A": 1e-9, "mass_B": 1e-9, "dx_A": 50e-6, "dx_B": 50e-6}, {}),  # dx < diameter
    ({"separation": 3e-6, "dx_A": 1e-5, "dx_B": 1e-5, "mass_A": 1e-13, "mass_B": 1e-13}, {}),
]


def compute(dd: dict, ee: dict) -> dict:
    design = bmv.BMVDesign.from_dict({**bmv.BMVDesign().__dict__, **dd})
    env = Environment(**{**Environment().__dict__, **ee})
    inputs = {"design": {k: v for k, v in design.__dict__.items()}, "environment": dict(env.__dict__)}
    issues = bmv.check_geometry(design)
    if issues:
        return {"inputs": inputs, "admissible": False, "issues": issues}
    scen, extra = scenario_for(design, env)
    design.gamma_A, design.gamma_B = scen.gamma_env_A, scen.gamma_env_B
    times = np.linspace(0, design.time, 12)
    pred = bmv.predict(design, extra_energies=scen.nongrav_energies, times=times)
    pred["models"] = predictions_table(scen)
    pred["decoherence"] = extra["decoherence_A"]
    pred["nongrav_channels"] = extra["nongrav_channels"]
    pred["branch_positions"] = bmv.branch_positions(design)
    mat = materials.get(env.material)
    cm = mat.clausius_mossotti()
    dp_budget = dec.budget(design.mass_A, design.radius_A, design.dx_A, pressure=env.pressure, T_gas=env.T_gas,
                           T_env=env.T_env, T_int=env.T_int, cm=cm, t=design.time, include_dp=True,
                           include_csl=True)
    # model curves: predictions_table with the scenario recomputed at design.time = t
    curve_times = [design.time * f for f in (0.2, 0.55, 1.0)]
    curves = []
    for t in curve_times:
        dt = bmv.BMVDesign.from_dict({**bmv.BMVDesign().__dict__, **dd, "time": float(t)})
        sct, _ = scenario_for(dt, env)
        curves.append({"t": float(t), "models": predictions_table(sct)})
    return {
        "inputs": inputs, "admissible": True, "predict": pred, "dp_budget": dp_budget,
        "min_distance_gravity_dominance": em.min_distance_for_gravity_dominance(
            design.mass_A, design.radius_A, cm.real, 0.1),
        "eft": {k: v for k, v in qg_eft.eft_potential_terms(design.mass_A, design.mass_B, design.separation).items()
                if isinstance(v, float)},
        "curves": curves,
    }


def main():
    out = {"generator": "tools/golden_vectors.py", "reference": "qgdevs (Python)",
           "cases": [compute(d, e) for d, e in cases()] + [compute(d, e) for d, e in INADMISSIBLE]}
    OUT.write_text(json.dumps(clean(out)))
    n_ok = sum(c["admissible"] for c in out["cases"])
    print(f"wrote {OUT} with {len(out['cases'])} cases ({n_ok} admissible)")


if __name__ == "__main__":
    main()
