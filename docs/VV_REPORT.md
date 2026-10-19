# Verification & validation report

Generated 2026-10-19 17:53 UTC · QG-DEVS 0.2.0 · code SHA-256 `e2bd0b6180d58316…` · Python 3.12.3 · Linux-6.18.33.1-microsoft-standard-WSL2-x86_64-with-glibc2.39

**35 / 35 benchmarks passed, 0 failed.**

Tolerances were fixed in advance with the justification shown (gate G3). A passing verification benchmark shows the software solves its equations correctly; it is **not** evidence that any physical theory is correct.

| Result | ID | Suite | Kind | Value | Tolerance | Justification | Reference | s |
|---|---|---|---|---|---|---|---|---|
| PASS | `S1-unitarity` | 1 | property | 1.554e-15 | ≤ 1.0e-12 | eigendecomposition is backward stable; error ~ d·ε_machine | exact property ‖U†U − I‖ = 0 | 0.0015 |
| PASS | `S1-rabi` | 1 | analytic | 4.441e-16 | ≤ 1.0e-12 | exact propagation; round-off only | Rabi, Phys. Rev. 51, 652 (1937) | 0.0015 |
| PASS | `S1-schrodinger-rk-vs-exact` | 1 | independent_algorithm | 6.839e-11 | ≤ 1.0e-08 | DOP853 with rtol 1e-10 over ~20 periods | independent algorithms | 0.0385 |
| PASS | `S1-lindblad-expm-vs-rk` | 1 | independent_algorithm | 3.648e-11 | ≤ 1.0e-08 | both methods converged to ≪1e-9 | independent algorithms | 0.068 |
| PASS | `S1-lindblad-physicality` | 1 | property | 4.441e-16 | ≤ 1.0e-10 | CPTP generator; numerical drift bounded by solver tolerance | Lindblad, CMP 48, 119 (1976) | 0.0572 |
| PASS | `S1-amplitude-damping` | 1 | analytic | 1.388e-16 | ≤ 1.0e-09 | Krylov expm accuracy | textbook (Breuer & Petruccione 2002) | 0.0248 |
| PASS | `S1-rk4-order` | 1 | convergence | 1.072e-03 | ≤ 1.5e-01 | classical RK4 has order 4; ±0.15 allows pre-asymptotic effects | Butcher (2016) | 0.05 |
| PASS | `S1-mcwf-vs-lindblad` | 1 | statistical | 7.737e-01 | ≤ 3.0e+00 | Monte-Carlo error ∝ 1/√N; compare in units of σ | Dalibard, Castin & Mølmer, PRL 68, 580 (1992) | 13.8266 |
| PASS | `S1-tomography-exact` | 1 | analytic | 4.700e-10 | ≤ 1.0e-06 | counts scaled to 1e9 per setting; rounding only | Pauli-basis reconstruction | 0.0055 |
| PASS | `S1-mle-tomography` | 1 | statistical | 9.999e-01 | ≥ 9.9e-01 | expected infidelity ~1e-4 at these counts; 0.995 is a conservative floor | Hradil, PRA 55, R1561 (1997) | 0.1197 |
| PASS | `S2-shell-theorem` | 2 | analytic | 0.000e+00 | ≤ 1.0e-12 | exact branch in implementation; relative error | Newton's shell theorem | 0.0 |
| PASS | `S2-self-energy` | 2 | analytic | 2.220e-16 | ≤ 1.0e-10 | adaptive quadrature with epsrel 1e-12 | classical result | 0.0001 |
| PASS | `S2-overlap-continuity` | 2 | property | 5.000e-11 | ≤ 1.0e-08 | quadrature branch must join analytic branch | continuity | 0.0001 |
| PASS | `S2-kepler-energy` | 2 | property | 2.435e-11 | ≤ 1.0e-05 | symplectic O(dt²) bounded energy error at 2000 steps/orbit | Hairer, Lubich & Wanner (2006) | 0.9556 |
| PASS | `S2-verlet-order` | 2 | convergence | 1.703e-04 | ≤ 1.5e-01 | second-order method | Verlet (1967) | 0.1567 |
| PASS | `S2-mercury-precession` | 2 | analytic | 2.145e-07 | ≤ 1.0e-05 | relative; higher-order GR terms ~ GM/(c²a) ≈ 3e-8 plus solver tol | Einstein (1915) | 0.2084 |
| PASS | `S2-light-deflection` | 2 | analytic | 6.252e-06 | ≤ 1.0e-04 | relative; second-order term (15π/16)(GM/c²b) ≈ 6e-6 | Einstein (1916) | 0.6178 |
| PASS | `S4-concurrence-formula` | 4 | analytic | 1.443e-15 | ≤ 1.0e-12 | SVD form of Wootters' formula is backward stable; the original eigenvalue form lost √ε≈1e-8 on rank-deficient states (found by the independent C++ comparison; implementation fixed, tolerance restored) | Wootters, PRL 80, 2245 (1998) | 0.0098 |
| PASS | `S4-analytic-vs-lindblad` | 4 | independent_algorithm | 5.722e-17 | ≤ 1.0e-09 | Krylov expm; dephasing commutes with H | independent algorithms | 0.0076 |
| PASS | `S4-parallel-closed-form` | 4 | analytic | 6.661e-16 | ≤ 1.0e-12 | relative; identical formula evaluated two ways | Bose et al. 2017 geometry | 0.0001 |
| PASS | `S4-witness-product-states` | 4 | property | 2.020e-02 | ≥ -1.0e-12 | witness property (product bound a·b' ≤ 1) | Chevalier, Paige & Kim, PRA 102, 022428 (2020) | 1.7472 |
| PASS | `S4-dephasing-threshold` | 4 | property | 1.415e-16 | ≤ 1.0e-12 | Γ* = |dΔφ/dt|/2 threshold; negativity must vanish at Γ* | derived in this platform; cf. Kafri, Taylor & Milburn 2014 | 0.6066 |
| PASS | `S5-free-spreading` | 5 | analytic | 3.032e-13 | ≤ 1.0e-08 | relative; free evolution is exact in Fourier space | textbook | 0.053 |
| PASS | `S5-ehrenfest-gravity` | 5 | analytic | 6.406e-13 | ≤ 1.0e-06 | relative; Ehrenfest exact for linear potential | Ehrenfest (1927) | 0.0607 |
| PASS | `S5-kasevich-chu` | 5 | independent_algorithm | 2.220e-16 | ≤ 1.0e-10 | relative | Kasevich & Chu, PRL 67, 181 (1991) | 0.0 |
| PASS | `S5-recombination-coherent-overlap` | 5 | analytic | 0.000e+00 | ≤ 1.0e-12 | closed form exp(−|β|²/2) evaluated two ways | Englert, Schwinger & Scully, Found. Phys. 18, 1045 (1988) | 0.0 |
| PASS | `S6-tmsv-log-negativity` | 6 | analytic | 0.000e+00 | ≤ 1.0e-10 | closed form | Vidal & Werner (2002); Adesso & Illuminati (2007) | 0.0002 |
| PASS | `S6-vacuum-stationary` | 6 | limiting_case | 0.000e+00 | ≤ 1.0e-12 | no coupling ⇒ E_N = 0 exactly | limiting case | 0.003 |
| PASS | `S7-dp-closed-form` | 7 | analytic | 2.220e-16 | ≤ 1.0e-10 | relative; quadrature vs closed form | Diósi 1989; Penrose 1996 | 0.0 |
| PASS | `S7-csl-point-limit` | 7 | limiting_case | 4.761e-07 | ≤ 1.0e-05 | relative; residual form-factor correction is O((R/r_C)²) = 1e-6 | Bassi et al., RMP 85, 471 (2013) | 0.0008 |
| PASS | `S8-casimir-scaling` | 8 | property | 0.000e+00 | ≤ 1.0e-12 | exact power law | Casimir & Polder (1948) | 0.0 |
| PASS | `S12-known-indistinguishable` | 12 | property | 0.000e+00 | ≤ 1.0e-12 | one-loop correction ~1e-60 relative ⇒ D ≈ 0 | identifiability test with known answer | 0.1406 |
| PASS | `S12-known-distinguishable` | 12 | property | 3.392e-03 | ≥ 1.0e-04 | entanglement vs separable predictions differ at O(Δφ²) | identifiability test with known answer | 0.2961 |
| PASS | `S14-blind-law-recovery` | 14 | property | 0.000e+00 | ≤ 0.0e+00 | exponents must rationalise exactly to the known law | Bose et al. 2017 | 2.8946 |
| PASS | `S18-ledger-tamper` | 18 | property | 0.000e+00 | ≤ 0.0e+00 | hash chain must break on any edit | hash-chain integrity | 0.0149 |

## Lean 4 formal verification

43 proved · 0 partial · 0 open (from `lean/proof_status.json`; machine-checked by `lean/check.sh`).

| Status | Lean name | Statement |
|---|---|---|
| proved | `QGDEVS.phase_decomposition_existsUnique` | For every real phase table φ : {L,R}×{L,R} → ℝ there is exactly one (α,β,γ,δ) ∈ ℝ⁴ with φ_ij = α + β z_i + γ z_j + δ z_i z_j for all i,j, where z_L = 1, z_R = −1. |
| proved | `QGDEVS.phase_decomposition_delta` | If φ_ij = α + β z_i + γ z_j + δ z_i z_j for all i,j then 4δ = φ_LL + φ_RR − φ_LR − φ_RL (= Δφ). |
| proved | `QGDEVS.phase_decomposition_coeffs` | The unique coefficients equal the closed forms used in decompose_phases: α = Σφ/4, β = (φLL+φLR−φRL−φRR)/4, γ = (φLL−φLR+φRL−φRR)/4, δ = Δφ/4. |
| proved | `QGDEVS.entanglingPhase_local_invariant` | Δφ is invariant under adding arbitrary local phases a_i + b_j to the table (only δ is entangling). |
| proved | `QGDEVS.Witness.cpk_product_bound` | For real 3-vectors a, b with ‖a‖² ≤ 1, ‖b‖² ≤ 1: a_x b_x + a_y b_z + a_z b_y ≤ 1. |
| proved | `QGDEVS.Witness.cpk_product_bound_neg` | Sign variant: a_x b_x − a_y b_z − a_z b_y ≤ 1 under the same hypotheses. |
| proved | `QGDEVS.Witness.cpk_mixture_bound` | Convexity: for weights w_k ≥ 0 with Σw_k = 1 and Bloch vectors a_k, b_k in the unit ball, Σ_k w_k (a_k,x b_k,x + s(a_k,y b_k,z + a_k,z b_k,y)) ≤ 1 for s = ±1. |
| proved | `QGDEVS.Witness.bloch_norm_le_one` | Every 2×2 complex density matrix (PSD, trace 1) has Bloch vector r_i = Re tr(ρσ_i) with r_x²+r_y²+r_z² ≤ 1. |
| proved | `QGDEVS.Witness.cpk_product_state_nonneg` | For density matrices ρA, ρB and W_s = 1⊗1 − X⊗X − s(Y⊗Z + Z⊗Y), s = ±1: Re tr((ρA⊗ρB) W_s) ≥ 0. |
| proved | `QGDEVS.Witness.cpk_separable_nonneg` | For every separable two-qubit state ρ = Σ_k w_k ρA_k ⊗ ρB_k (finite sum, w_k ≥ 0, all factors density matrices): Re tr(ρ W_s) ≥ 0 for s = ±1. Hence a negative CPK witness value certifies entanglement. |
| proved | `QGDEVS.pointEnergy_neg` | U(r) = −G mA mB / r < 0 for r > 0. |
| proved | `QGDEVS.pointEnergy_abs_le` | |U(r)| ≤ G mA mB / r_min for all r ≥ r_min > 0. |
| proved | `QGDEVS.branchEnergy_finite` | On the admissible domain r ≥ r_min > 0: −G mA mB / r_min ≤ U(r) < 0 (finite, negative, uniformly bounded). |
| proved | `QGDEVS.branchPhase_bounds` | The static branch phase φ = −U t/ħ satisfies 0 ≤ φ ≤ G mA mB t/(ħ r_min) for r ≥ r_min > 0, t ≥ 0. |
| proved | `QGDEVS.entanglingPhase_abs_le` | If each branch phase lies in [0, B] then |Δφ| ≤ 2B. |
| proved | `QGDEVS.pointEnergy_unbounded_near_zero` | Point singularity: for every M and every ε > 0 there is 0 < r < ε with U(r) < −M (unbounded below near 0⁺). |
| proved | `QGDEVS.pointEnergy_tendsto_atBot` | Point singularity (filter form): U(r) → −∞ as r → 0⁺. |
| proved | `QGDEVS.dephasedState_posSemidef` | The dephased BMV state ρ_{ij,kl} = ¼ e^{i(φ_ij−φ_kl)} e^{−x_A[i≠k] − x_B[j≠l]} is positive semidefinite for all real phases and x_A, x_B ≥ 0 (proof: ρ = (uu†) ∘ (D_A ⊗ D_B), Kronecker and Schur products of PSD matrices). |
| proved | `QGDEVS.dephasedState_isHermitian` | The dephased BMV state is Hermitian. |
| proved | `QGDEVS.dephasedState_trace` | tr ρ = 1. |
| proved | `QGDEVS.dephasedState_density` | With constant rates (x = Γ t), Γ_A, Γ_B ≥ 0 and t ≥ 0, ρ is a density matrix: PSD, Hermitian, unit trace. |
| proved | `QGDEVS.Concurrence.pure_concurrence` | For |ψ⟩ with amplitudes e^{iφ_ij}/2, the Wootters pure-state concurrence |⟨ψ|σy⊗σy|ψ*⟩| equals |sin(Δφ/2)|, Δφ = φLL+φRR−φLR−φRL (= 4δ). |
| proved | `QGDEVS.dpEnergy_bounds` | For d ≥ 2R > 0: E_Δ = G m²(6/(5R) − 1/d) satisfies 0 < E_Δ < 6Gm²/(5R). |
| proved | `QGDEVS.dpEnergy_mono` | E_Δ is non-decreasing in d on d ≥ 2R. |
| proved | `QGDEVS.dpRate_bounds` | Γ_DP = κ E_Δ/ħ satisfies 0 < Γ_DP < 6κGm²/(5Rħ) (finite, strictly positive collapse rate). |
| proved | `QGDEVS.cpRatio_strictAntiOn` | The ratio (23ħcR⁶cm²/(4πr⁷)) / (Gm²/r) is strictly decreasing in r on (0, ∞). |
| proved | `QGDEVS.cpRatio_le_iff` | For target T > 0 and r_min > 0 with r_min⁶ = 23ħcR⁶cm²/(4πGm²T): for all r > 0, ratio(r) ≤ T ⇔ r ≥ r_min. |
| proved | `QGDEVS.rmin_existsUnique` | There is exactly one r_min > 0 with r_min⁶ = 23ħcR⁶cm²/(4πGm²T), namely (·)^{1/6}. |
| proved | `QGDEVS.ptCore_decomp` | Explicit spectral decomposition of the phase-free core of ρ^{T_B} (Γ_A = Γ_B): eigenvalues (1+p²±2p cos(Δφ/2))/4 and (1−p²±2p sin(Δφ/2))/4 with explicit eigenvectors, p = e^{−x}. |
| proved | `QGDEVS.ptB_posSemidef_iff` | Exact PPT criterion: for any real phase table and any x, ρ^{T_B} (x_A = x_B = x) is PSD iff 2e^{−x}|sin(Δφ/2)| ≤ 1 − e^{−2x} (equivalently |sin(Δφ/2)| ≤ sinh x). |
| proved | `QGDEVS.ptB_posSemidef_of_abs_le` | If |Δφ| ≤ 2x then ρ^{T_B} is PSD (the state is PPT). |
| proved | `QGDEVS.dephasing_threshold` | Time-dependent threshold: if Δφ(0) = 0, Δφ is differentiable on t ≥ 0 and |dΔφ/dt| ≤ 2Γ for all t ≥ 0, then for every t ≥ 0 the state with Γ_A = Γ_B = Γ (x = Γt) has PSD partial transpose (PPT). This is the Γ ≥ |dΔφ/dt|/2 criterion of entanglement_dephasing_threshold, stated as PPT. |
| proved | `QGDEVS.IsSeparable.ptB_posSemidef` | Every separable two-qubit matrix (in the sense of IsSeparable) has positive semidefinite partial transpose (separable ⇒ PPT). IsSeparable ρ :≡ ∃ finite index set ι, weights w_k ≥ 0 with Σ w_k = 1, and 2×2 density matrices (PSD, trace 1) ρA_k, ρB_k with ρ = Σ_k w_k • (ρA_k ⊗ ρB_k). |
| proved | `QGDEVS.blochState_density` | ρ(a) = ½(1 + a·σ) is a density matrix (PSD, trace 1) whenever a_x²+a_y²+a_z² ≤ 1. |
| proved | `QGDEVS.ensemble_eq` | Explicit 8-term product-state ensemble: Σ_{τ,ε,η=±1} (1+τc)/8 · ρ(τp, εA, ηA) ⊗ ρ(τp, ηB, εB) equals the phase-free core state with real part ¼p^{[i≠k]+[j≠l]}(1−n²+n²c) and imaginary part −n·A·B/4. |
| proved | `QGDEVS.sepCore_separable` | The phase-free core with parameters p > 0, c²+s² = 1 is separable whenever 2p|s| ≤ 1−p² (A = √((1−p²)/2), B = −ps/A). |
| proved | `QGDEVS.dephasedState_eq_conj` | dephasedState φ x x = (U_β ⊗ U_γ) · core(e^{−x}, cos(Δφ/2), e^{−x} sin(Δφ/2)) · (U_β ⊗ U_γ)† with local diagonal phase unitaries U_r = diag(e^{irz_i}). |
| proved | `QGDEVS.dephasedState_separable_iff` | For any real phase table and any x (x_A = x_B = x): the dephased BMV state is separable ⇔ 2e^{−x}|sin(Δφ/2)| ≤ 1 − e^{−2x}. IsSeparable ρ :≡ ∃ finite index set ι, weights w_k ≥ 0 with Σ w_k = 1, and 2×2 density matrices (PSD, trace 1) ρA_k, ρB_k with ρ = Σ_k w_k • (ρA_k ⊗ ρB_k). |
| proved | `QGDEVS.dephasedState_separable_iff_ppt` | For the dephased BMV family (x_A = x_B = x, any phases): separable ⇔ ρ^{T_B} PSD (PPT ⇔ separable, proved directly for this family without general Peres–Horodecki). |
| proved | `QGDEVS.dephasedState_separable_iff_sinh` | Separable ⇔ |sin(Δφ/2)| ≤ sinh x. |
| proved | `QGDEVS.dephasing_threshold_separable` | If Δφ(0) = 0 and |dΔφ/dt| ≤ 2Γ on t ≥ 0 (Δφ differentiable there), then for every t ≥ 0 the state with x_A = x_B = Γt is separable. |
| proved | `QGDEVS.dephasing_threshold_sharp` | If Δφ(t) = ωt for all t and Γ < |ω|/2 (any real ω, Γ), there exists t > 0 at which ρ^{T_B} (x = Γt) is not PSD and the state is not separable (entangled). |
| proved | `QGDEVS.never_entangled_iff` | For Δφ(t) = ωt and constant Γ (x = Γt): the state is separable at every t ≥ 0 ⇔ Γ ≥ |ω|/2. The threshold Γ* = |ω|/2 is exact. |
