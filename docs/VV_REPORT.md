# Verification & validation report

Generated 2026-10-19 12:26 UTC · QG-DEVS 0.1.0 · code SHA-256 `0e35432ec83abbab…` · Python 3.12.3 · Linux-6.18.33.1-microsoft-standard-WSL2-x86_64-with-glibc2.39

**33 / 33 benchmarks passed, 0 failed.**

Tolerances were fixed in advance with the justification shown (gate G3). A passing verification benchmark shows the software solves its equations correctly; it is **not** evidence that any physical theory is correct.

| Result | ID | Suite | Kind | Value | Tolerance | Justification | Reference | s |
|---|---|---|---|---|---|---|---|---|
| PASS | `S1-unitarity` | 1 | property | 1.554e-15 | ≤ 1.0e-12 | eigendecomposition is backward stable; error ~ d·ε_machine | exact property ‖U†U − I‖ = 0 | 0.0095 |
| PASS | `S1-rabi` | 1 | analytic | 4.441e-16 | ≤ 1.0e-12 | exact propagation; round-off only | Rabi, Phys. Rev. 51, 652 (1937) | 0.0019 |
| PASS | `S1-schrodinger-rk-vs-exact` | 1 | independent_algorithm | 6.839e-11 | ≤ 1.0e-08 | DOP853 with rtol 1e-10 over ~20 periods | independent algorithms | 0.0356 |
| PASS | `S1-lindblad-expm-vs-rk` | 1 | independent_algorithm | 3.648e-11 | ≤ 1.0e-08 | both methods converged to ≪1e-9 | independent algorithms | 0.0578 |
| PASS | `S1-lindblad-physicality` | 1 | property | 4.441e-16 | ≤ 1.0e-10 | CPTP generator; numerical drift bounded by solver tolerance | Lindblad, CMP 48, 119 (1976) | 0.0495 |
| PASS | `S1-amplitude-damping` | 1 | analytic | 1.388e-16 | ≤ 1.0e-09 | Krylov expm accuracy | textbook (Breuer & Petruccione 2002) | 0.0121 |
| PASS | `S1-rk4-order` | 1 | convergence | 1.072e-03 | ≤ 1.5e-01 | classical RK4 has order 4; ±0.15 allows pre-asymptotic effects | Butcher (2016) | 0.0583 |
| PASS | `S1-mcwf-vs-lindblad` | 1 | statistical | 7.737e-01 | ≤ 3.0e+00 | Monte-Carlo error ∝ 1/√N; compare in units of σ | Dalibard, Castin & Mølmer, PRL 68, 580 (1992) | 28.191 |
| PASS | `S1-tomography-exact` | 1 | analytic | 4.700e-10 | ≤ 1.0e-06 | counts scaled to 1e9 per setting; rounding only | Pauli-basis reconstruction | 0.015 |
| PASS | `S1-mle-tomography` | 1 | statistical | 9.999e-01 | ≥ 9.9e-01 | expected infidelity ~1e-4 at these counts; 0.995 is a conservative floor | Hradil, PRA 55, R1561 (1997) | 0.3373 |
| PASS | `S2-shell-theorem` | 2 | analytic | 0.000e+00 | ≤ 1.0e-12 | exact branch in implementation; relative error | Newton's shell theorem | 0.0 |
| PASS | `S2-self-energy` | 2 | analytic | 2.220e-16 | ≤ 1.0e-10 | adaptive quadrature with epsrel 1e-12 | classical result | 0.0001 |
| PASS | `S2-overlap-continuity` | 2 | property | 5.000e-11 | ≤ 1.0e-08 | quadrature branch must join analytic branch | continuity | 0.0003 |
| PASS | `S2-kepler-energy` | 2 | property | 2.435e-11 | ≤ 1.0e-05 | symplectic O(dt²) bounded energy error at 2000 steps/orbit | Hairer, Lubich & Wanner (2006) | 3.1577 |
| PASS | `S2-verlet-order` | 2 | convergence | 1.703e-04 | ≤ 1.5e-01 | second-order method | Verlet (1967) | 0.5553 |
| PASS | `S2-mercury-precession` | 2 | analytic | 2.145e-07 | ≤ 1.0e-05 | relative; higher-order GR terms ~ GM/(c²a) ≈ 3e-8 plus solver tol | Einstein (1915) | 0.6792 |
| PASS | `S2-light-deflection` | 2 | analytic | 6.252e-06 | ≤ 1.0e-04 | relative; second-order term (15π/16)(GM/c²b) ≈ 6e-6 | Einstein (1916) | 3.0522 |
| PASS | `S4-concurrence-formula` | 4 | analytic | 1.443e-15 | ≤ 1.0e-12 | SVD form of Wootters' formula is backward stable; the original eigenvalue form lost √ε≈1e-8 on rank-deficient states (found by the independent C++ comparison; implementation fixed, tolerance restored) | Wootters, PRL 80, 2245 (1998) | 0.0595 |
| PASS | `S4-analytic-vs-lindblad` | 4 | independent_algorithm | 5.722e-17 | ≤ 1.0e-09 | Krylov expm; dephasing commutes with H | independent algorithms | 0.0426 |
| PASS | `S4-parallel-closed-form` | 4 | analytic | 6.661e-16 | ≤ 1.0e-12 | relative; identical formula evaluated two ways | Bose et al. 2017 geometry | 0.0001 |
| PASS | `S4-witness-product-states` | 4 | property | 2.020e-02 | ≥ -1.0e-12 | witness property (product bound a·b' ≤ 1) | Chevalier, Paige & Kim, PRA 102, 022428 (2020) | 7.3715 |
| PASS | `S4-dephasing-threshold` | 4 | property | 1.415e-16 | ≤ 1.0e-12 | Γ* = |dΔφ/dt|/2 threshold; negativity must vanish at Γ* | derived in this platform; cf. Kafri, Taylor & Milburn 2014 | 2.1909 |
| PASS | `S5-free-spreading` | 5 | analytic | 3.032e-13 | ≤ 1.0e-08 | relative; free evolution is exact in Fourier space | textbook | 0.2729 |
| PASS | `S5-ehrenfest-gravity` | 5 | analytic | 6.406e-13 | ≤ 1.0e-06 | relative; Ehrenfest exact for linear potential | Ehrenfest (1927) | 0.2029 |
| PASS | `S5-kasevich-chu` | 5 | independent_algorithm | 2.220e-16 | ≤ 1.0e-10 | relative | Kasevich & Chu, PRL 67, 181 (1991) | 0.0 |
| PASS | `S6-tmsv-log-negativity` | 6 | analytic | 0.000e+00 | ≤ 1.0e-10 | closed form | Vidal & Werner (2002); Adesso & Illuminati (2007) | 0.0002 |
| PASS | `S6-vacuum-stationary` | 6 | limiting_case | 0.000e+00 | ≤ 1.0e-12 | no coupling ⇒ E_N = 0 exactly | limiting case | 0.0392 |
| PASS | `S7-dp-closed-form` | 7 | analytic | 2.220e-16 | ≤ 1.0e-10 | relative; quadrature vs closed form | Diósi 1989; Penrose 1996 | 0.0 |
| PASS | `S8-casimir-scaling` | 8 | property | 0.000e+00 | ≤ 1.0e-12 | exact power law | Casimir & Polder (1948) | 0.0 |
| PASS | `S12-known-indistinguishable` | 12 | property | 0.000e+00 | ≤ 1.0e-12 | one-loop correction ~1e-60 relative ⇒ D ≈ 0 | identifiability test with known answer | 0.8153 |
| PASS | `S12-known-distinguishable` | 12 | property | 3.392e-03 | ≥ 1.0e-04 | entanglement vs separable predictions differ at O(Δφ²) | identifiability test with known answer | 1.8573 |
| PASS | `S14-blind-law-recovery` | 14 | property | 0.000e+00 | ≤ 0.0e+00 | exponents must rationalise exactly to the known law | Bose et al. 2017 | 8.5972 |
| PASS | `S18-ledger-tamper` | 18 | property | 0.000e+00 | ≤ 0.0e+00 | hash chain must break on any edit | hash-chain integrity | 0.0048 |
