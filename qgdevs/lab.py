"""Suite 9 — Virtual laboratory and experimental apparatus: dossier generator.

For a BMV-family design this module produces two linked deliverables from the same physics models:

A. Scientific Laboratory Protocol — objective, hypotheses, equations, observables, preregistrable
   decision rules, procedure, calibration, uncertainty budget and falsification criteria.
B. Engineering Apparatus Specification — component breakdown, bill of materials, geometry and
   tolerances, environmental requirements, subsystem specifications, safety, commissioning, and
   CAD-compatible geometry exports (STL, SVG, scene JSON).

Every number carries a provenance status:
  CALCULATED_REQUIREMENT  derived here from the physics models for this design
  LITERATURE_REFERENCE    taken from the cited publication
  ESTIMATED               order-of-magnitude engineering estimate (must be confirmed)
  UNVERIFIED_ASSUMPTION   input assumption that no calculation or source supports yet
  SUPPLIER_CONFIRMED      never produced automatically: only a human entry with a quotation may set it
A design output is never a statement that the apparatus exists or performs as specified.
"""
from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone

import numpy as np

from . import bmv, decoherence as dec, em, materials, interferometry as itf, __version__
from .constants import e as e_charge, G, hbar
from .design import Environment, DesignBounds, constraint_report, scenario_for, witness_shots

CALC, LIT, EST, ASSUME, SUPPLIER = ("CALCULATED_REQUIREMENT", "LITERATURE_REFERENCE", "ESTIMATED",
                                     "UNVERIFIED_ASSUMPTION", "SUPPLIER_CONFIRMED")

# Demonstrated capabilities used to judge technological readiness. Values are the headline figures of
# the cited works; they are not specifications of any particular commercial instrument.
STATE_OF_THE_ART = {
    "matter_wave_mass_kg": {"value": 25000 * 1.66053906892e-27, "status": LIT,
                            "source": "Fein et al., Nat. Phys. 15, 1242 (2019): interference of molecules >25,000 Da"},
    "atom_wavepacket_separation_m": {"value": 0.54, "status": LIT,
                                     "source": "Kovachy et al., Nature 528, 530 (2015): 54 cm separation of Rb-87 wave packets"},
    "levitated_ground_state": {"value": "silica nanoparticle (~143 nm diameter) cooled to motional ground state",
                               "status": LIT, "source": "Delić et al., Science 367, 892 (2020)"},
    "full_loop_stern_gerlach": {"value": "closed-loop SG interferometry with atoms", "status": LIT,
                                "source": "Margalit et al., Sci. Adv. 7, eabg2879 (2021)"},
    "smallest_gravitational_source_mass_kg": {"value": 90e-6, "status": LIT,
                                              "source": "Westphal et al., Nature 591, 225 (2021): 90 mg gold source mass"},
}


def _sha(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


def _tolerances(design: bmv.BMVDesign, phase_budget: float = 0.05) -> dict:
    """Tolerances such that each error source alone shifts Δφ by ≤ phase_budget rad (finite differences)."""
    base = bmv.entangling_phase(bmv.phases_from_energies(bmv.gravitational_branch_energies(design), design.time))
    out = {}
    for name, key, h in [("centre separation", "separation", 1e-9), ("branch separation (each)", "dx_A", 1e-9),
                         ("mass (each)", "mass_A", design.mass_A * 1e-6), ("interaction time", "time", 1e-6)]:
        d2 = bmv.BMVDesign.from_dict({**design.as_dict(), key: getattr(design, key) + h})
        if key == "dx_A":
            d2.dx_B = d2.dx_A
        if key == "mass_A":
            d2.mass_B = d2.mass_A
        dphi = bmv.entangling_phase(bmv.phases_from_energies(bmv.gravitational_branch_energies(d2), d2.time))
        deriv = (dphi - base) / h
        tol = phase_budget / abs(deriv) if deriv else math.inf
        unit = {"separation": "m", "dx_A": "m", "mass_A": "kg", "time": "s"}[key]
        out[name] = {"sensitivity_rad_per_unit": deriv, "tolerance": tol, "unit": unit,
                     "relative_tolerance": tol / getattr(design, key), "status": CALC,
                     "basis": f"|∂Δφ/∂x| δx ≤ {phase_budget} rad"}
    return out


def _environment_requirements(design: bmv.BMVDesign, env: Environment, coherence_budget: float = 0.1) -> dict:
    """Environmental limits such that each channel alone uses ≤ coherence_budget of Γt."""
    mat = materials.get(env.material)
    cm = mat.clausius_mossotti()
    rate = coherence_budget / design.time
    p_max = dec.max_pressure_for(design.radius_A, env.T_gas, rate)
    req = {
        "max_pressure": {"value": p_max, "unit": "Pa", "status": CALC,
                         "basis": f"collisional Γ t ≤ {coherence_budget} at T_gas = {env.T_gas} K"},
        "max_internal_temperature": {"value": dec.max_temperature_for(design.radius_A, design.dx_A, cm, rate, "emission")
                                     if cm.imag > 0 else None, "unit": "K", "status": CALC if cm.imag > 0 else ASSUME,
                                     "basis": "black-body emission Γ t ≤ budget" if cm.imag > 0 else
                                     "Im ε = 0 assumed for this material: emission limit not computable; measure Im ε"},
        "max_environment_temperature": {"value": dec.max_temperature_for(design.radius_A, design.dx_A, cm, rate, "scattering"),
                                        "unit": "K", "status": CALC, "basis": "black-body scattering Γ t ≤ budget"},
    }
    qmax = em.max_charge_for(design, 0.05, cm.real)
    req["max_residual_charge"] = {"value": qmax, "unit": "e", "status": CALC,
                                  "basis": "|Δφ_Coulomb + induced dipole| ≤ 0.05 rad with equal charges on both masses"
                                  + ("; even a single elementary charge exceeds the budget, so both masses must be exactly "
                                     "neutral or electrostatically screened" if qmax == 0 else "")}
    req["max_electric_dipole"] = {"value": em.max_electric_dipole(design, 0.05), "unit": "C m", "status": CALC,
                                  "basis": "worst-orientation dipole–dipole |Δφ| ≤ 0.05 rad (patch potentials or trapped "
                                           "charge create such dipoles; ~10 mV patches typically exceed this)"}
    req["max_bias_field_during_interaction"] = {"value": em.max_bias_field(design, materials.get(env.material).magnetic_susceptibility, 0.05),
                                                "unit": "T", "status": CALC,
                                                "basis": "induced diamagnetic dipole–dipole |Δφ| ≤ 0.05 rad (worst field axis)"}
    req["min_distance_casimir_10pct"] = {"value": em.min_distance_for_gravity_dominance(design.mass_A, design.radius_A, cm.real, 0.1),
                                         "unit": "m", "status": CALC, "basis": "|U_CP| ≤ 0.1 |U_grav| at equal distance"}
    return req


def _readiness(design: bmv.BMVDesign, sg: dict) -> dict:
    sota = STATE_OF_THE_ART
    mass_gap = design.mass_A / sota["matter_wave_mass_kg"]["value"]
    items = [
        {"capability": "spatial superposition of the test mass", "required": f"{design.mass_A:.2e} kg over Δx = {design.dx_A:.2e} m",
         "demonstrated": f"{sota['matter_wave_mass_kg']['value']:.2e} kg ({sota['matter_wave_mass_kg']['source']})",
         "gap_factor_mass": mass_gap, "trl": 1 if mass_gap > 1e3 else 3},
        {"capability": "magnetic field gradient for Stern–Gerlach splitting", "required": f"{sg['required_gradient_T_per_m']:.2e} T/m",
         "demonstrated": "not established for this mass and splitting; requires dedicated engineering study", "trl": 2},
        {"capability": "spin coherence during free evolution", "required": f"{design.time + 4 * 0.25:.2f} s total sequence",
         "demonstrated": "NV-centre electron-spin T2 is typically far below 1 s at accessible temperatures (sample dependent); "
                         "must be measured for the chosen diamond", "trl": 2},
        {"capability": "gravitational interaction between micro-scale masses",
         "required": f"{design.mass_A:.2e} kg sources",
         "demonstrated": f"{sota['smallest_gravitational_source_mass_kg']['value']:.0e} kg ({sota['smallest_gravitational_source_mass_kg']['source']})",
         "trl": 2},
    ]
    return {"items": items, "overall_trl": min(i["trl"] for i in items),
            "conclusion": "Conceptual design only. The required parameters exceed demonstrated capabilities by orders of "
                          "magnitude; no apparatus meeting this specification is known to exist."}


def generate_dossier(design: bmv.BMVDesign, env: Environment = Environment(), bounds: DesignBounds | None = None,
                     discrimination: dict | None = None, sg_tau: float = 0.25) -> dict:
    bounds = bounds or DesignBounds(geometry=design.geometry)
    mat = materials.get(env.material)
    rep = constraint_report(design, env, bounds)
    pred = bmv.predict(design, extra_energies=None)
    ws = witness_shots(design, env)
    sg = itf.sg_bmv_phases(design.mass_A, design.mass_B, design.separation, sg_tau, design.time, design.dx_A,
                           "parallel" if design.geometry == "parallel" else "linear")
    tol = _tolerances(design)
    envreq = _environment_requirements(design, env)
    readiness = _readiness(design, sg)
    bud = rep["decoherence_A"]
    dphi = rep["delta_phi_grav"]
    now = datetime.now(timezone.utc).isoformat()

    protocol = {
        "title": "Gravity-mediated entanglement between two spatially superposed masses — laboratory protocol",
        "classification": "DESIGN OUTPUT — not an executed experiment",
        "1_objective": {
            "question": "Does the gravitational interaction between two masses, each in a spatial superposition, "
                        "generate entanglement between their branch degrees of freedom?",
            "observable": "entanglement witness <W> = 1 - <XX> ∓ (<YZ> + <ZY>) and full two-qubit tomography",
            "hypotheses_tested": ["QG-COH", "SC-MF", "CC-KTM", "DP-COLL", "NULL-NG", "CG-QFT-AH"],
            "note_CG-QFT-AH": "Aziz–Howl prediction is many orders of magnitude below QG-COH at BMV parameters and its "
                              "closed form may be outside the paper's validity domain; see docs/AZIZ_HOWL_MODEL.md"},
        "2_background": {
            "established": ["Newtonian gravity between macroscopic masses (Westphal et al. 2021)",
                            "matter-wave interference of large molecules (Fein et al. 2019)"],
            "open_question": "whether gravity can act as a quantum (non-LOCC) mediator; "
                             "interpretation of a positive witness remains model-dependent (Aziz & Howl 2025; MOVW 2025 preprint)"},
        "3_equations": {
            "branch_energy": "U_ij = -G m_A m_B / r_ij (exact for non-overlapping uniform spheres)",
            "branch_phase": "φ_ij = -U_ij t / ħ",
            "entangling_phase": "Δφ = φ_LL + φ_RR - φ_LR - φ_RL",
            "state": "ρ_{ij,kl} = ¼ e^{i(φ_ij-φ_kl)} e^{-Γ_A t[i≠k]} e^{-Γ_B t[j≠l]}",
            "classical_channel_threshold": "Γ ≥ |dΔφ/dt| / 2 forbids gravitational entanglement (this platform, numerically derived)"},
        "4_predictions": {
            "delta_phi_rad": {"value": dphi, "status": CALC},
            "delta_phi_time_dependent_SG_rad": {"value": sg["delta_phi"], "status": CALC,
                                                "basis": f"closed-loop SG with τ = {sg_tau} s acceleration stages"},
            "concurrence_ideal": {"value": pred["concurrence"], "status": CALC},
            "environmental_decoherence_rate_per_mass_s": {"value": bud["total_rate"], "dominant": bud["dominant"], "status": CALC},
            "predicted_witness_QG_COH": {"value": ws["witness"], "status": CALC},
            "shots_per_setting_5sigma": {"value": ws["shots_per_setting"], "status": CALC,
                                         "note": "statistical only; excludes systematic errors"},
            "competing_predictions": discrimination,
        },
        "5_initial_conditions": {
            "spin_state": "|+>_A |+>_B prepared by microwave π/2 pulses before splitting",
            "motional_state": "cooled centre-of-mass motion; required occupancy to be derived for the chosen trap (not computed here)",
            "status": ASSUME},
        "6_procedure": [
            "Pump down and cool the chamber; verify pressure and temperature against the environmental requirements table.",
            "Discharge both masses (UV or ion neutraliser) and verify residual charge below the computed limit via electric-field modulation.",
            "Load and trap each mass; cool centre-of-mass motion; record trap frequencies.",
            "Initialise NV spins with optical pumping; apply π/2 pulses to create |+>.",
            "Release masses and run the four-stage magnetic-gradient sequence to create the spatial superposition (separation Δx).",
            f"Hold for the interaction time t = {design.time} s at centre separation d = {design.separation:.3e} m.",
            "Reverse the gradient sequence to recombine the paths; verify recombination via single-mass Ramsey visibility.",
            "Apply the preregistered local Z corrections, then rotate to the measurement bases XX, YZ, ZY (and all 9 Pauli settings for tomography).",
            "Read out spins optically; record raw photon counts, timestamps and all environmental telemetry.",
            "Interleave null controls: (i) single-mass runs, (ii) masses swapped/displaced to large d, (iii) gradient off, (iv) charged-mass runs.",
            "Repeat to the preregistered sample size; unblind only after the analysis plan and code hashes are frozen.",
        ],
        "7_calibration": [
            "Spin readout fidelity per mass (bright/dark reference measurements) → readout error ε",
            "Single-mass coherence vs time and Δx → independent environmental Γ (constrains the nuisance range)",
            "Mass of each particle (e.g. trap-frequency + known force, or electrical calibration)",
            "Branch separation via position detection during the hold phase",
            "Local phase β, γ via single-mass Ramsey fringes"],
        "8_uncertainty_budget": {"tolerances_for_0.05_rad": tol,
                                 "decoherence_mechanisms": {k: {"rate_s": v["rate"], "gamma_t": v["gamma_t"], "regime": v["regime"]}
                                                            for k, v in bud["mechanisms"].items()}},
        "9_decision_rules": {
            "entanglement_claim": "one-sided z ≥ 5 on the preregistered witness, readout-corrected, with all null controls consistent with zero",
            "excludes": "a passing witness excludes SC-MF, CC-KTM (κ ≥ 1) and NULL-NG *within their stated assumptions*; "
                        "it does not exclude unregistered classical models; CG-QFT-AH predicts far weaker entanglement with a "
                        "different mass/time/constituent-mass scaling, testable by varying t and isotopic composition",
            "disfavours_QG_COH": "witness consistent with ≥ 0 at 95% while independent decoherence calibration predicts W < 0 "
                                 "at ≥ 5σ under QG-COH",
            "inconclusive": "any other outcome, or failed calibration/null controls; must be reported as inconclusive"},
        "10_falsification": [
            "QG-COH is falsified for this regime if decoherence is independently bounded and no entanglement appears.",
            "DP-COLL is falsified if single-mass coherence survives beyond Γ_DP^-1 at the stated mass and Δx.",
            "A gravitational origin of a positive witness is disfavoured if the signal persists with Δx-independent or "
            "R⁶/d⁷ (Casimir-like) scaling instead of the gravitational scaling."],
        "11_replication": "complete configuration, hashes, software version and analysis code in the replication package",
    }

    radius = design.radius_A
    bom = [
        {"item": "Test masses (×2)", "spec": f"{mat.name}, radius {radius:.3e} m, mass {design.mass_A:.3e} kg",
         "status": CALC, "selection_rationale": mat.notes, "quantity": 2},
        {"item": "Embedded spin qubit", "spec": "single NV⁻ centre per particle, electron spin S = 1 (two levels used)",
         "status": ASSUME, "quantity": 2},
        {"item": "UHV / XHV cryogenic vacuum chamber", "spec": f"pressure ≤ {envreq['max_pressure']['value']:.2e} Pa",
         "status": CALC, "quantity": 1},
        {"item": "Cryostat / cold environment", "spec": f"environment ≤ {env.T_env} K (design input); "
                                                        f"black-body scattering limit {envreq['max_environment_temperature']['value']:.3g} K",
         "status": CALC, "quantity": 1},
        {"item": "Magnetic gradient source (×2)", "spec": f"|∂B| ≈ {sg['required_gradient_T_per_m']:.2e} T/m switched in τ = {sg_tau} s stages",
         "status": CALC, "quantity": 2},
        {"item": "Microwave spin-control system", "spec": "π/2 and basis-rotation pulses, phase-stable to ≪ 0.05 rad", "status": EST, "quantity": 2},
        {"item": "Optical readout (532 nm excitation, fluorescence detection)", "spec": f"readout error ≤ {env.readout_error}",
         "status": ASSUME, "quantity": 2},
        {"item": "Charge-neutralisation system", "spec": f"residual charge ≤ {envreq['max_residual_charge']['value']:.3g} e",
         "status": CALC, "quantity": 1},
        {"item": "Faraday / Casimir screen (optional)", "spec": "conducting membrane between the interferometers (parallel geometry)",
         "status": ASSUME, "quantity": 1},
        {"item": "Vibration isolation", "spec": f"relative displacement noise ≤ {tol['centre separation']['tolerance']:.2e} m over t",
         "status": CALC, "quantity": 1},
        {"item": "Environmental telemetry", "spec": "pressure, temperature, magnetic field, vibration, residual-gas analyser logged per run",
         "status": EST, "quantity": 1},
        {"item": "Timing and data acquisition", "spec": "shared clock; time-tagged photon counts; ≥ 1 µs resolution", "status": EST, "quantity": 1},
    ]
    for b in bom:
        b["cost"] = "quotation required"

    engineering = {
        "title": "Engineering apparatus specification (conceptual)",
        "classification": "CONCEPTUAL DESIGN — not a constructed or validated apparatus",
        "architecture": ["vacuum & cryogenic enclosure", "two mass traps with release mechanism",
                         "two Stern–Gerlach gradient assemblies", "spin control (microwave)", "optical readout",
                         "charge control", "vibration isolation", "telemetry & DAQ", "safety interlocks"],
        "coordinate_system": "origin at A's trap centre; +x towards B; split axis "
                             + ("+y (parallel geometry)" if design.geometry == "parallel" else "+x (linear geometry)"),
        "geometry": {"branch_positions_m": {k: v.tolist() for k, v in bmv.branch_positions(design).items()},
                     "radius_m": radius, "closest_surface_gap_m": rep["checks"]["surface_gap"]["value_m"]},
        "tolerances": tol,
        "environmental_requirements": envreq,
        "bill_of_materials": bom,
        "engineering_analyses": {
            "magnetic": {"required_gradient_T_per_m": sg["required_gradient_T_per_m"], "status": CALC},
            "stern_gerlach_closure": {**itf.required_gradient_precision(design.mass_A, design.dx_A, sg_tau,
                                                                        2 * math.pi * 100.0, 10.0),
                                      "assumed_trap_frequency_Hz": 100.0, "assumed_thermal_occupation": 10.0,
                                      "assumption_status": ASSUME},
            "electrostatic": {"max_residual_charge_e": envreq["max_residual_charge"]["value"], "status": CALC},
            "thermal": {"note": "steady-state heat-load analysis of the cryostat not performed", "status": ASSUME},
            "structural": {"note": "not performed; requires CAD-level design", "status": ASSUME}},
        "safety": [
            "Cryogens: oxygen-deficiency monitoring, venting, PPE (insulated gloves, face shield).",
            "Strong magnetic gradients: exclusion zone for ferromagnetic tools and implanted medical devices.",
            "Laser (green, possibly class 3B/4): interlocked enclosure, wavelength-appropriate eyewear, trained personnel.",
            "Vacuum: implosion protection for viewports; pressure-relief on cryogenic volumes.",
            "Hardware commands from software require operator authorisation, validated limits and an emergency stop."],
        "commissioning": ["leak test and bake-out", "cryogenic cool-down test", "gradient field mapping",
                          "spin readout calibration", "single-mass coherence characterisation", "null-control runs"],
        "technological_readiness": readiness,
        "exports": ["scene.json (3-D scene for the interactive viewer)", "apparatus.stl (masses & chamber, CAD interchange)",
                    "layout.svg (2-D engineering drawing)", "STEP export: not implemented"],
    }

    dossier = {"generated_utc": now, "software_version": __version__, "design": design.as_dict(),
               "environment": env.__dict__, "constraints": {k: v for k, v in rep["checks"].items()},
               "protocol": protocol, "engineering": engineering,
               "consistency_check": consistency_check(protocol, engineering, rep),
               "status_legend": [CALC, LIT, EST, ASSUME, SUPPLIER]}
    dossier["sha256"] = _sha({k: dossier[k] for k in ("design", "environment", "protocol", "engineering")})
    return dossier


def consistency_check(protocol: dict, engineering: dict, rep: dict) -> dict:
    """Automated check that the engineering design satisfies the protocol's physical constraints."""
    problems = []
    if not rep["feasible"]:
        problems += [f"design constraint failed: {k}" for k, v in rep["checks"].items() if not v["ok"]]
    if engineering["technological_readiness"]["overall_trl"] < 4:
        problems.append("technological readiness below 4: requirements exceed demonstrated capability")
    w = protocol["4_predictions"]["predicted_witness_QG_COH"]["value"]
    if w >= 0:
        problems.append("QG-COH predicts no witness violation for this design: the experiment cannot certify entanglement")
    return {"passed": not problems, "problems": problems}


# ----------------------------------------------------------------------------- geometry exports
def scene_json(design: bmv.BMVDesign, chamber_radius: float | None = None) -> dict:
    pos = bmv.branch_positions(design)
    cr = chamber_radius or 2 * (design.separation + design.dx_A)
    return {"units": "m", "kind": "computed geometry",
            "objects": [{"id": k, "type": "sphere", "center": v.tolist(),
                         "radius": design.radius_A if k.startswith("A") else design.radius_B,
                         "role": "branch"} for k, v in pos.items()]
            + [{"id": "chamber", "type": "cylinder", "center": [design.separation / 2, 0, 0], "radius": cr,
                "height": cr, "role": "vacuum chamber (schematic, not to engineering scale)"}]}


def _sphere_triangles(c, r, n=12):
    tris = []
    for i in range(n):
        t1, t2 = math.pi * i / n, math.pi * (i + 1) / n
        for j in range(2 * n):
            p1, p2 = 2 * math.pi * j / (2 * n), 2 * math.pi * (j + 1) / (2 * n)

            def pt(t, p):
                return (c[0] + r * math.sin(t) * math.cos(p), c[1] + r * math.sin(t) * math.sin(p), c[2] + r * math.cos(t))
            a, b, cc, d = pt(t1, p1), pt(t2, p1), pt(t2, p2), pt(t1, p2)
            tris += [(a, b, cc), (a, cc, d)]
    return tris


def stl_ascii(design: bmv.BMVDesign, scale_to_mm: bool = True) -> str:
    s = 1e3 if scale_to_mm else 1.0
    lines = ["solid qgdevs_bmv"]
    for k, v in bmv.branch_positions(design).items():
        r = design.radius_A if k.startswith("A") else design.radius_B
        for tri in _sphere_triangles(v * s, r * s):
            a, b, c = (np.array(p) for p in tri)
            n = np.cross(b - a, c - a)
            nn = np.linalg.norm(n)
            n = n / nn if nn > 0 else n
            lines.append(f" facet normal {n[0]:.6e} {n[1]:.6e} {n[2]:.6e}\n  outer loop")
            for p in (a, b, c):
                lines.append(f"   vertex {p[0]:.9e} {p[1]:.9e} {p[2]:.9e}")
            lines.append("  endloop\n endfacet")
    lines.append("endsolid qgdevs_bmv")
    return "\n".join(lines)


def layout_svg(design: bmv.BMVDesign, width: int = 800) -> str:
    """2-D top view (x–y) with dimension annotations; spheres drawn to scale relative to separations."""
    pos = bmv.branch_positions(design)
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    span = max(max(xs) - min(xs), max(ys) - min(ys), design.separation) * 1.4
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    sc = width / span
    h = width * 0.6

    def X(x):
        return width / 2 + (x - cx) * sc

    def Y(y):
        return h / 2 - (y - cy) * sc

    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {h:.0f}" font-family="sans-serif" font-size="12">',
             '<rect width="100%" height="100%" fill="white"/>']
    for k, p in pos.items():
        r = max((design.radius_A if k.startswith("A") else design.radius_B) * sc, 3)
        col = "#2563eb" if k.startswith("A") else "#db2777"
        parts.append(f'<circle cx="{X(p[0]):.1f}" cy="{Y(p[1]):.1f}" r="{r:.1f}" fill="{col}" fill-opacity="0.8"/>')
        parts.append(f'<text x="{X(p[0]) + 8:.1f}" y="{Y(p[1]) - 8:.1f}">{k.replace("_", " ")}</text>')
    y0 = h - 30
    parts.append(f'<line x1="{X(0):.1f}" y1="{y0}" x2="{X(design.separation):.1f}" y2="{y0}" stroke="black" marker-start="url(#a)" marker-end="url(#a)"/>')
    parts.append(f'<text x="{(X(0) + X(design.separation)) / 2:.1f}" y="{y0 - 6}" text-anchor="middle">d = {design.separation * 1e6:.1f} µm</text>')
    parts.append(f'<text x="10" y="18">Top view (x–y), {design.geometry} geometry, Δx = {design.dx_A * 1e6:.1f} µm, '
                 f'R = {design.radius_A * 1e6:.2f} µm (sphere radii enlarged to ≥3 px for visibility)</text>')
    parts.append('<defs><marker id="a" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">'
                 '<path d="M0,0 L6,3 L0,6 z"/></marker></defs></svg>')
    return "\n".join(parts)
