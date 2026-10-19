# Flagship research results — gravity-mediated entanglement

Generated 2026-10-19T12:40 UTC by `tools/flagship_study.py` · QG-DEVS 0.1.0 · code `0e35432ec83abbab…` · runtime 956.7 s. Full numbers: `docs/flagship_results.json`.

> **Evidence status: computational predictions only.** Nothing below is a physical measurement. Synthetic data are labelled SYNTHETIC. Gates G4 (feasibility confirmed by an experimental team), G6 (physical data) and G7 (replication) are not passed.

## 1. Benchmark reproduction (Bose et al., PRL 119, 240401, 2017)

m = 1e-14 kg, d = 0.00045 m, Δx = 0.00025 m, t = 2.5 s, linear geometry: **Δφ = -0.31393 rad**, ideal concurrence 0.1563 (= |sin(Δφ/2)|), PPT-witness -0.07816. This reproduces the published scheme; it is not an original result.

## 2. What competes with the signal at the benchmark

* Environmental decoherence per mass (P = 1e-15 Pa, T = 0.15 K): **0.0125 s⁻¹**, dominated by gas collisions.
* Casimir–Polder entangling phase: -0.0183 rad (5.84 % of the gravitational phase). Gravity dominates Casimir by 10× only beyond 157 µm.
* Residual charge: the largest tolerable equal charge is **0 e**, so even one elementary charge per mass would swamp the gravitational phase; exact neutrality or screening is mandatory.
* Diósi–Penrose collapse (uniform-sphere smearing): Γ_DP = **86.1 s⁻¹**, leaving coherence 3.25e-94 after t. If DP collapse is real at this smearing scale, the benchmark experiment cannot show entanglement — which makes the experiment a sharp test of DP.
* One-loop quantum-gravity EFT correction: relative size 1.68e-63: unobservable; QG-COH and QG-EFT1 are reported as observationally indistinguishable.
* Closed-loop Stern–Gerlach realisation: time-integrated Δφ = -0.3577 rad and a required magnetic gradient of **2.15e+06 T/m**.

## 3. Competing-model predictions and robust discrimination (benchmark design, environment included)

| Model | Negativity | CPK witness | Single-mass coherence |
|---|---|---|---|
| QG-COH | 0.06501 | -0.2599 | 0.9559 |
| QG-EFT1 | 0.06501 | -0.2599 | 0.9559 |
| SC-MF | 0 | 0.04285 | 0.9692 |
| CC-KTM | 0 | 0.03972 | 0.817 |
| DP-COLL | 0 | 1 | 3.103e-94 |
| NULL-NG | 0 | 0.1119 | 0.9692 |

Robust discrimination (the alternative may adjust all admissible nuisance parameters; shots per setting for an expected Bayes factor of 150):

| True | Alternative | D per shot | Shots/setting | Verdict |
|---|---|---|---|---|
| QG-COH | QG-EFT1 | 0 | inf | indistinguishable |
| QG-COH | SC-MF | 0.00339 | 164 | distinguishable |
| QG-COH | CC-KTM | 0.0195 | 28.6 | distinguishable |
| QG-COH | DP-COLL | 0.372 | 1.5 | distinguishable |
| QG-COH | NULL-NG | 0.0134 | 41.5 | distinguishable |
| CC-KTM | QG-COH | 0.0166 | 33.5 | distinguishable |
| CC-KTM | QG-EFT1 | 0.0166 | 33.5 | distinguishable |
| CC-KTM | SC-MF | 0.0242 | 23 | distinguishable |
| CC-KTM | DP-COLL | 0.248 | 2.25 | distinguishable |
| CC-KTM | NULL-NG | 0.0273 | 20.4 | distinguishable |

## 4. Closing the loop on synthetic data

2000 shots/setting of SYNTHETIC data (sha256 `3bb898d7acb8aa92…`) generated from QG-COH: witness -0.2526 ± 0.034 (z = 7.47); inferred coupling λ = 1.046 [0.881, 1.21] (truth 1). This validates the analysis chain, not nature.

## 5. Computationally generated relationships

* **Blind law recovery (known physics):** from simulations alone the engine finds Δφ ∝ `G^1 · hbar^-1 · mass^2 · separation^-3 · branch_separation^2 · time^1` (max residual 0.000823), i.e. the established far-field law — classified ESTABLISHED_RESULT.
* **Calibration trade-off (candidate, novelty NOT ASSESSED):** when the classical measurement–feedback model is true, the coherent quantum model can mimic it unless environmental decoherence is independently bounded to within a factor s* = 1 + |Δφ_g| / (2 Γ_env t); the closed form agrees with the full robust engine to 0.404 % over 8 random designs. It follows from the decoherence threshold Γ* = |dΔφ/dt|/2 established numerically here and is closely related to known decoherence–coupling trade-offs for classical channels (Kafri–Taylor–Milburn 2014; Oppenheim 2023). A DOI-linked literature review is required before any novelty claim (gate G2).

## 6. Optimised design under explicit constraints

Within bounds m ≤ 1e-13 kg, Δx ≤ 250 µm, t ≤ 5 s, surface gap ≥ 10 µm and Casimir ≤ 10 % of the gravitational phase: m = 9.8e-14 kg (R = 1.88e-06 m), d = 0.000423 m, Δx = 0.000203 m, t = 0.133 s → Δφ = -1.149 rad, predicted witness -1.102, about 50 shots per setting for a 5σ statistical witness violation.

Dossier consistency check: **NOT PASSED** — technological readiness below 4: requirements exceed demonstrated capability.
Overall technology readiness: TRL 1. Conceptual design only. The required parameters exceed demonstrated capabilities by orders of magnitude; no apparatus meeting this specification is known to exist.

## 7. Honest conclusion

The platform reproduces the established BMV predictions, quantifies every competing explanation it implements, and finds designs where implemented classical, semiclassical and hybrid models are statistically distinguishable from the coherent quantum model *in simulation*. It also shows (i) that distinguishing a classical measurement–feedback channel requires an independent decoherence calibration tighter than s*, (ii) that Diósi–Penrose collapse would erase the signal at these parameters, and (iii) that the required masses, splittings, gradients and charge control lie far beyond demonstrated capability. No discovery about the nature of gravity is claimed. The classical-gravity + quantum-matter mechanism of Aziz & Howl (2025) is registered but not implemented, so a positive witness could not yet be said to exclude it.
