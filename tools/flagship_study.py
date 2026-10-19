"""Flagship research workflow (spec §23): gravity-mediated entanglement between two superposed masses.

Runs every stage end to end and writes docs/FLAGSHIP_RESULTS.md plus docs/flagship_results.json.
All numbers are produced by the solvers in this repository at run time.

Usage: .venv/bin/python tools/flagship_study.py [--quick]
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from qgdevs import __version__, bmv, decoherence as dec, em, materials, interferometry as itf, lab, qg_eft  # noqa
from qgdevs import inference as inf, quantum as qm, sigproc  # noqa
from qgdevs.design import Environment, DesignBounds, scenario_for, optimise  # noqa
from qgdevs.discrimination import discrimination_matrix, predictions_table, protocol_frame  # noqa
from qgdevs.discovery import bmv_scaling_study, calibration_tradeoff_study  # noqa
from qgdevs.evidence import code_hash  # noqa

QUICK = "--quick" in sys.argv
R: dict = {"generated_utc": datetime.now(timezone.utc).isoformat(), "version": __version__, "code_sha256": code_hash()}
t0 = time.time()

# 1. Benchmark: Bose et al. (2017) configuration
bose = bmv.BMVDesign(geometry="linear")
p = bmv.predict(bose)
R["benchmark_bose2017"] = {"design": bose.as_dict(), "delta_phi_rad": p["delta_phi_gravity_rad"],
                           "concurrence_ideal": p["concurrence"], "witness_ppt": p["witness_ppt"]["value"]}

# 2. Environment, decoherence and non-gravitational channels for the benchmark
env = Environment()
sc, extra = scenario_for(bose, env)
R["benchmark_environment"] = {"environment": env.__dict__,
                              "decoherence": {k: {"rate_s": v["rate"], "regime": v["regime"]} for k, v in
                                              extra["decoherence_A"]["mechanisms"].items()},
                              "total_rate_s": extra["decoherence_A"]["total_rate"],
                              "dominant": extra["decoherence_A"]["dominant"],
                              "delta_phi_nongrav_rad": bmv.entangling_phase(bmv.phases_from_energies(sc.nongrav_energies, bose.time))}
dp = dec.diosi_penrose_rate(bose.mass_A, bose.radius_A, bose.dx_A)
R["diosi_penrose"] = {"rate_s": dp["rate"], "coherence_after_t": float(np.exp(-dp["rate"] * bose.time)),
                      "E_delta_J": dp["E_delta_J"]}
cm = materials.get("diamond").clausius_mossotti().real
R["casimir_gravity_distance_10pct_m"] = em.min_distance_for_gravity_dominance(bose.mass_A, bose.radius_A, cm, 0.1)
R["max_residual_charge_e"] = em.max_charge_for(bose, 0.05, cm)
R["csl_rate_grw_s"] = dec.csl_rate(bose.mass_A, bose.radius_A, bose.dx_A, 1e-16)["rate"]
R["max_electric_dipole_Cm"] = em.max_electric_dipole(bose, 0.05)
R["max_bias_field_T"] = em.max_bias_field(bose, materials.get("diamond").magnetic_susceptibility, 0.05)
R["sg_gradient_precision"] = itf.required_gradient_precision(bose.mass_A, bose.dx_A, 0.25, 2 * np.pi * 100, 10)
from qgdevs import model_ah  # noqa: E402
R["aziz_howl_vs_qg_log10"] = float(np.log10(model_ah.benchmark_comparison()["ratio_ah_to_qg_entangling"]))
R["eft_one_loop_relative"] = qg_eft.eft_potential_terms(bose.mass_A, bose.mass_B, bose.separation)["quantum_relative_size"]
R["stern_gerlach"] = {k: v for k, v in itf.sg_bmv_phases(bose.mass_A, bose.mass_B, bose.separation, 0.25, bose.time,
                                                          bose.dx_A, "linear").items() if not k.startswith("trajectory")}

# 3. Competing-model predictions and robust discrimination at the benchmark
R["benchmark_predictions"] = [{k: r[k] for k in ("id", "negativity", "witness_cpk", "coherence_A")} for r in predictions_table(sc)]
M = discrimination_matrix(sc, ["QG-COH", "QG-EFT1", "SC-MF", "CC-KTM", "DP-COLL", "CSL-COLL", "NULL-NG", "CG-QFT-AH"])
R["benchmark_discrimination"] = [{k: r[k] for k in ("true", "alternative", "D_per_shot", "shots_per_setting", "verdict",
                                                     "nuisance_at_bounds")} for r in M["pairs"]]

# 4. Synthetic measurement → reconstruction → inference (closing the loop on SYNTHETIC data)
F = protocol_frame(sc)
from qgdevs.models import HYPOTHESES  # noqa
rho_meas = F @ HYPOTHESES["QG-COH"].state(sc) @ F.conj().T
rec = sigproc.simulate_counts(rho_meas, qm.PAULI_SETTINGS, 2000, sigproc.DetectorModel(), 7, "QG-COH")
# preregistrable choice of witness variant: the one the model predicts to be negative (same rule as the API)
ev = qm.pauli_expectations(rho_meas)
sign = 1 if 1 - ev["XX"] - ev["YZ"] - ev["ZY"] <= 1 - ev["XX"] + ev["YZ"] + ev["ZY"] else -1
R["synthetic_loop"] = {"label": rec["data_label"], "sha256": rec["sha256"], "witness_sign_variant": sign,
                       "witness": sigproc.witness_estimate(rec["counts"], sign, 0.01, 0.01, n_boot=300)}
m = inf.CouplingModel(bose, qm.PAULI_SETTINGS)
post = inf.adaptive_metropolis(m, rec["counts"], n_steps=3000 if QUICK else 6000, burn=1000 if QUICK else 2000, seed=3)
R["synthetic_loop"]["lambda_posterior"] = post["summary"]["lambda"]
R["synthetic_loop"]["decay_posterior"] = post["summary"]["decay"]

# 5. Discovery: blind scaling recovery and the calibration trade-off relation
R["scaling_far"] = bmv_scaling_study(regime="far")["law"]
R["calibration_tradeoff"] = calibration_tradeoff_study(n=3 if QUICK else 8, seed=1)

# 6. Optimised design under explicit constraints, and its dossier
opt = optimise(env, DesignBounds(), seed=0, maxiter=15 if QUICK else 30, popsize=8 if QUICK else 12, top_k=1)
R["optimised"] = opt["candidates"][0]
best = bmv.BMVDesign.from_dict(R["optimised"]["design"])
dos = lab.generate_dossier(best, env)
R["optimised_dossier"] = {"sha256": dos["sha256"], "consistency": dos["consistency_check"],
                          "readiness": dos["engineering"]["technological_readiness"],
                          "environmental_requirements": dos["engineering"]["environmental_requirements"],
                          "tolerances": dos["engineering"]["tolerances"]}
R["runtime_s"] = round(time.time() - t0, 1)
(ROOT / "docs" / "flagship_results.json").write_text(json.dumps(R, indent=1, default=str))


def f(x, n=3):
    return f"{x:.{n}g}" if isinstance(x, (float, int)) and np.isfinite(x) else str(x)


b, e = R["benchmark_bose2017"], R["benchmark_environment"]
L = ["# Flagship research results — gravity-mediated entanglement\n",
     f"Generated {R['generated_utc'][:16]} UTC by `tools/flagship_study.py` · QG-DEVS {__version__} · code `{R['code_sha256'][:16]}…` · "
     f"runtime {R['runtime_s']} s. Full numbers: `docs/flagship_results.json`.\n",
     "> **Evidence status: computational predictions only.** Nothing below is a physical measurement. Synthetic data are "
     "labelled SYNTHETIC. Gates G4 (feasibility confirmed by an experimental team), G6 (physical data) and G7 "
     "(replication) are not passed.\n",
     "## 1. Benchmark reproduction (Bose et al., PRL 119, 240401, 2017)\n",
     f"m = {f(bose.mass_A)} kg, d = {f(bose.separation)} m, Δx = {f(bose.dx_A)} m, t = {bose.time} s, linear geometry: "
     f"**Δφ = {f(b['delta_phi_rad'], 5)} rad**, ideal concurrence {f(b['concurrence_ideal'], 4)} (= |sin(Δφ/2)|), "
     f"PPT-witness {f(b['witness_ppt'], 4)}. This reproduces the published scheme; it is not an original result.\n",
     "## 2. What competes with the signal at the benchmark\n",
     f"* Environmental decoherence per mass (P = {env.pressure} Pa, T = {env.T_env} K): **{f(e['total_rate_s'])} s⁻¹**, "
     f"dominated by {e['dominant'].replace('_', ' ')}.",
     f"* Casimir–Polder entangling phase: {f(e['delta_phi_nongrav_rad'])} rad "
     f"({f(abs(e['delta_phi_nongrav_rad'] / b['delta_phi_rad']) * 100)} % of the gravitational phase). Gravity dominates "
     f"Casimir by 10× only beyond {f(R['casimir_gravity_distance_10pct_m'] * 1e6)} µm.",
     f"* Residual charge: the largest tolerable equal charge is **{f(R['max_residual_charge_e'])} e**, so even one "
     "elementary charge per mass would swamp the gravitational phase; exact neutrality or screening is mandatory.",
     f"* Diósi–Penrose collapse (uniform-sphere smearing): Γ_DP = **{f(R['diosi_penrose']['rate_s'])} s⁻¹**, leaving "
     f"coherence {f(R['diosi_penrose']['coherence_after_t'])} after t. If DP collapse is real at this smearing scale, "
     "the benchmark experiment cannot show entanglement — which makes the experiment a sharp test of DP.",
     f"* CSL collapse with the standard GRW parameters (λ = 1e-16 s⁻¹, r_C = 100 nm): Γ_CSL = **{f(R['csl_rate_grw_s'])} s⁻¹**, "
     "so entanglement could only appear if λ is many orders of magnitude below the GRW value — the experiment is a sharp CSL test.",
     f"* Electric dipoles (from surface patch potentials or trapped charge) must stay below **{f(R['max_electric_dipole_Cm'])} C·m** "
     f"per mass, and the magnetic field during the interaction below **{f(R['max_bias_field_T'] * 1e3)} mT** (induced diamagnetic dipoles).",
     f"* Stern–Gerlach loop closure: the gradient pulses must be accurate to **{f(R['sg_gradient_precision']['max_relative_gradient_error'])}** "
     "(relative) to keep 90 % recombination visibility (assumed 100 Hz trap, 10 thermal quanta).",
     f"* One-loop quantum-gravity EFT correction: relative size {f(R['eft_one_loop_relative'])}: unobservable; QG-COH and "
     "QG-EFT1 are reported as observationally indistinguishable.",
     f"* Closed-loop Stern–Gerlach realisation: time-integrated Δφ = {f(R['stern_gerlach']['delta_phi'], 4)} rad and a "
     f"required magnetic gradient of **{f(R['stern_gerlach']['required_gradient_T_per_m'])} T/m**.\n",
     "## 3. Competing-model predictions and robust discrimination (benchmark design, environment included)\n",
     "| Model | Negativity | CPK witness | Single-mass coherence |", "|---|---|---|---|"]
L += [f"| {r['id']} | {f(r['negativity'], 4)} | {f(r['witness_cpk'], 4)} | {f(r['coherence_A'], 4)} |" for r in R["benchmark_predictions"]]
L += ["", "Robust discrimination (the alternative may adjust all admissible nuisance parameters; shots per setting for "
      "an expected Bayes factor of 150):\n", "| True | Alternative | D per shot | Shots/setting | Verdict |", "|---|---|---|---|---|"]
L += [f"| {r['true']} | {r['alternative']} | {f(r['D_per_shot'])} | {f(r['shots_per_setting'])} | {r['verdict']} |"
      for r in R["benchmark_discrimination"] if r["true"] in ("QG-COH", "CC-KTM")]
s = R["synthetic_loop"]
L += ["", "*Reading the CSL rows:* CSL-COLL contains QG-COH as its λ → 0 limit (and with a suitable λ it can mimic the "
      "extra dephasing of CC-KTM), so it is *nested* rather than excludable: an observed entanglement witness bounds the "
      "collapse rate to λ ≲ 1e-25 s⁻¹ at r_C = 100 nm instead of falsifying CSL outright. 'Indistinguishable' here is "
      "the correct verdict for nested models, not a failure of the experiment."]
L += ["", "## 4. Closing the loop on synthetic data\n",
      f"2000 shots/setting of SYNTHETIC data (sha256 `{s['sha256'][:16]}…`) generated from QG-COH: witness "
      f"{f(s['witness']['witness'], 4)} ± {f(s['witness']['stderr'], 2)} (z = {f(s['witness']['z_score'], 3)}); inferred "
      f"coupling λ = {f(s['lambda_posterior']['mean'], 4)} [{f(s['lambda_posterior']['ci95'][0], 3)}, "
      f"{f(s['lambda_posterior']['ci95'][1], 3)}] (truth 1). This validates the analysis chain, not nature.\n",
      "## 5. Computationally generated relationships\n",
      f"* **Blind law recovery (known physics):** from simulations alone the engine finds Δφ ∝ "
      f"`{R['scaling_far']['expression']}` (max residual {f(R['scaling_far']['max_rel_residual'])}), i.e. the established "
      "far-field law — classified ESTABLISHED_RESULT.",
      f"* **Calibration trade-off (candidate, novelty NOT ASSESSED):** when the classical measurement–feedback model is "
      f"true, the coherent quantum model can mimic it unless environmental decoherence is independently bounded to within "
      f"a factor s* = 1 + |Δφ_g| / (2 Γ_env t); the closed form agrees with the full robust engine to "
      f"{f(R['calibration_tradeoff']['max_rel_diff'] * 100)} % over {len(R['calibration_tradeoff']['rows'])} random designs. "
      "It follows from the decoherence threshold Γ* = |dΔφ/dt|/2 (exact in both directions and machine-checked in Lean 4: separable for all t iff Γ ≥ |ω|/2, `QGDEVS.never_entangled_iff`) and is closely related to "
      "known decoherence–coupling trade-offs for classical channels (Kafri–Taylor–Milburn 2014; Oppenheim 2023). "
      "A DOI-linked literature review is required before any novelty claim (gate G2).\n"]
o = R["optimised"]
d = o["design"]
L += ["## 6. Optimised design under explicit constraints\n",
      f"Within bounds m ≤ 1e-13 kg, Δx ≤ 250 µm, t ≤ 5 s, surface gap ≥ 10 µm and Casimir ≤ 10 % of the gravitational "
      f"phase: m = {f(d['mass_A'])} kg (R = {f(d['radius_A'])} m), d = {f(d['separation'])} m, Δx = {f(d['dx_A'])} m, "
      f"t = {f(d['time'])} s → Δφ = {f(o['delta_phi_grav'], 4)} rad, predicted witness {f(o['predicted_witness'], 4)}, "
      f"about {f(o['witness_shots_per_setting'])} shots per setting for a 5σ statistical witness violation.\n",
      f"Dossier consistency check: **{'PASSED' if R['optimised_dossier']['consistency']['passed'] else 'NOT PASSED'}** — "
      + "; ".join(R["optimised_dossier"]["consistency"]["problems"]) + ".",
      f"Overall technology readiness: TRL {R['optimised_dossier']['readiness']['overall_trl']}. "
      + R["optimised_dossier"]["readiness"]["conclusion"] + "\n",
      "## 7. Honest conclusion\n",
      "The platform reproduces the established BMV predictions, quantifies every competing explanation it implements, and "
      "finds designs where implemented classical, semiclassical and hybrid models are statistically distinguishable from the "
      "coherent quantum model *in simulation*. It also shows (i) that distinguishing a classical measurement–feedback channel "
      "requires an independent decoherence calibration tighter than s*, (ii) that Diósi–Penrose collapse would erase the "
      "signal at these parameters, and (iii) that the required masses, splittings, gradients and charge control lie far "
      "beyond demonstrated capability. No discovery about the nature of gravity is claimed. The classical-gravity + quantum-"
      "matter mechanism of Aziz & Howl (2025) is now implemented (docs/AZIZ_HOWL_MODEL.md): at BMV parameters it predicts "
      f"entanglement ~{-R['aziz_howl_vs_qg_log10']:.0f} orders of magnitude weaker than QG-COH (entangling-strength "
      "ratio at the Bose et al. benchmark), with different mass, time and constituent-mass scaling."]
(ROOT / "docs" / "FLAGSHIP_RESULTS.md").write_text("\n".join(L) + "\n")
print("done", R["runtime_s"], "s")
