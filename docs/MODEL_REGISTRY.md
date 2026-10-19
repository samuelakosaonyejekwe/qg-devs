# Scientific model registry

Generated 2026-10-19 12:26 UTC from `qgdevs/models.py` (version 0.1.0). Each entry is the model's G1 (theory gate) record. No model is privileged; all are evaluated through the same measurement chain and nuisance treatment.

## QG-COH — Quantum-coherent gravitational interaction (linearised quantum gravity, Newtonian limit)

* **Family:** quantum  ·  **Implemented:** yes  ·  **Assurance:** NUMERICALLY VERIFIED
* **Gravity can entangle:** True
* **Dynamics:** H = Σ_ij U_ij |ij><ij|,  U_ij = mutual energy of uniform spheres at branch distance r_ij
* **Assumptions:** gravity acts as a quantum (non-LOCC) mediator; static branches during interaction; non-relativistic sources; retardation negligible; uniform spherical mass distributions
* **Approximations:** Newtonian limit of linearised gravity (tree level); two-level branch encoding
* **Admissible domain:** r_ij >> l_P; r/c << t; |Φ|/c² << 1; non-overlapping branches
* **Known limits:** Δφ → (2Gm²t/ħ)(1/d - 1/√(d²+Δx²)) for point masses, parallel geometry; reduces to classical Newtonian force for branch expectation values
* **Nuisance parameters:** `env_decoherence_scale` ∈ [0.5, 2.0] 1 — multiplier on independently calibrated environmental decoherence rates; `mass_scale` ∈ [0.99, 1.01] 1 — relative mass calibration (enters gravity as m_A m_B); `local_phase_A` ∈ [-0.05, 0.05] rad — residual local phase calibration error on A; `local_phase_B` ∈ [-0.05, 0.05] rad — residual local phase calibration error on B
* **References:** Bose et al., PRL 119, 240401 (2017), doi:10.1103/PhysRevLett.119.240401; Marletto & Vedral, PRL 119, 240402 (2017), doi:10.1103/PhysRevLett.119.240402
* **Status note:** flagship benchmark; not an original prediction

## QG-EFT1 — Quantum gravity EFT with one-loop correction

* **Family:** quantum  ·  **Implemented:** yes  ·  **Assurance:** PARTIALLY VERIFIED
* **Gravity can entangle:** True
* **Dynamics:** U_ij → U_ij [1 + 3G(m_A+m_B)/(r c²) quantum part: 41Għ/(10π r² c³)] (quantum term only added)
* **Assumptions:** perturbative EFT of gravity valid; point-mass sources
* **Approximations:** one-loop; non-relativistic
* **Admissible domain:** r >> l_P
* **Known limits:** → QG-COH as ħ G / r² c³ → 0
* **Nuisance parameters:** `env_decoherence_scale` ∈ [0.5, 2.0] 1 — multiplier on independently calibrated environmental decoherence rates; `mass_scale` ∈ [0.99, 1.01] 1 — relative mass calibration (enters gravity as m_A m_B); `local_phase_A` ∈ [-0.05, 0.05] rad — residual local phase calibration error on A; `local_phase_B` ∈ [-0.05, 0.05] rad — residual local phase calibration error on B
* **References:** Bjerrum-Bohr, Donoghue & Holstein, PRD 67, 084033 (2003), doi:10.1103/PhysRevD.67.084033
* **Status note:** correction ~1e-60 relative at μm scales: experimentally indistinguishable from QG-COH

## SC-MF — Semiclassical mean-field gravity (Møller–Rosenfeld / Schrödinger–Newton type)

* **Family:** semiclassical  ·  **Implemented:** yes  ·  **Assurance:** NUMERICALLY VERIFIED
* **Gravity can entangle:** False
* **Dynamics:** Each mass evolves in the gravitational field of the other's expected mass density
* **Assumptions:** G_μν = 8πG <T_μν>/c⁴ sources gravity; no wave-function collapse on measurement
* **Approximations:** equal branch weights; field of the averaged density; self-gravity of each branch neglected
* **Admissible domain:** same as QG-COH
* **Known limits:** Δφ_grav ≡ 0 (no gravitational entanglement); local phases equal to branch-averaged potentials
* **Nuisance parameters:** `env_decoherence_scale` ∈ [0.5, 2.0] 1 — multiplier on independently calibrated environmental decoherence rates; `mass_scale` ∈ [0.99, 1.01] 1 — relative mass calibration (enters gravity as m_A m_B); `local_phase_A` ∈ [-0.05, 0.05] rad — residual local phase calibration error on A; `local_phase_B` ∈ [-0.05, 0.05] rad — residual local phase calibration error on B
* **References:** Møller (1962); Rosenfeld, Nucl. Phys. 40, 353 (1963); Diósi, Phys. Lett. A 105, 199 (1984); Penrose, GRG 28, 581 (1996)
* **Status note:** known to conflict with standard measurement theory if taken as fundamental (Page & Geilker 1981)

## CC-KTM — Classical-channel (measurement–feedback) gravity, classical–quantum hybrid

* **Family:** hybrid  ·  **Implemented:** yes  ·  **Assurance:** NUMERICALLY VERIFIED
* **Gravity can entangle:** False
* **Dynamics:** dρ/dt = -i[H_g, ρ] + Σ_X Γ_cc/2 (Z_X ρ Z_X - ρ),  Γ_cc = κ|Δφ_g|/(2t), κ ≥ 1
* **Assumptions:** gravity transmits only classical information (LOCC); Markovian continuous measurement
* **Approximations:** two-level branch encoding; symmetric split of the decoherence between masses
* **Admissible domain:** same as QG-COH
* **Known limits:** κ = 1 is the minimal decoherence compatible with no gravitational entanglement; mean dynamics equal to QG-COH (same Newtonian force)
* **Nuisance parameters:** `env_decoherence_scale` ∈ [0.5, 2.0] 1 — multiplier on independently calibrated environmental decoherence rates; `mass_scale` ∈ [0.99, 1.01] 1 — relative mass calibration (enters gravity as m_A m_B); `local_phase_A` ∈ [-0.05, 0.05] rad — residual local phase calibration error on A; `local_phase_B` ∈ [-0.05, 0.05] rad — residual local phase calibration error on B; `kappa_cc` ∈ [1.0, 3.0] 1 — excess of classical-channel decoherence over its minimum
* **References:** Kafri, Taylor & Milburn, NJP 16, 065020 (2014), doi:10.1088/1367-2630/16/6/065020; Oppenheim, PRX 13, 041040 (2023), doi:10.1103/PhysRevX.13.041040
* **Status note:** threshold Γ* = |dΔφ/dt|/2 derived numerically in this platform (tests/test_bmv.py)

## DP-COLL — Coherent gravity with Diósi–Penrose gravitational collapse

* **Family:** collapse  ·  **Implemented:** yes  ·  **Assurance:** NUMERICALLY VERIFIED
* **Gravity can entangle:** True
* **Dynamics:** QG-COH plus single-mass dephasing Γ_DP = κ_DP [U(Δx) - U(0)]/ħ (uniform sphere)
* **Assumptions:** objective collapse rate set by gravitational self-energy difference; mass density smeared at the particle radius
* **Approximations:** uniform sphere density (no atomic-scale cut-off)
* **Admissible domain:** Δx > 0; non-relativistic
* **Known limits:** Γ_DP → 0 as Δx → 0; Γ_DP = κ G m²(6/(5R) - 1/Δx)/ħ for Δx ≥ 2R
* **Nuisance parameters:** `env_decoherence_scale` ∈ [0.5, 2.0] 1 — multiplier on independently calibrated environmental decoherence rates; `mass_scale` ∈ [0.99, 1.01] 1 — relative mass calibration (enters gravity as m_A m_B); `local_phase_A` ∈ [-0.05, 0.05] rad — residual local phase calibration error on A; `local_phase_B` ∈ [-0.05, 0.05] rad — residual local phase calibration error on B; `dp_convention` ∈ [1.0, 2.0] 1 — Diósi (1) vs Penrose (2) self-energy convention
* **References:** Diósi, PRA 40, 1165 (1989), doi:10.1103/PhysRevA.40.1165; Penrose, Gen. Rel. Grav. 28, 581 (1996), doi:10.1007/BF02105068
* **Status note:** parameter-free with radius cut-off; experimentally constrained (e.g. Donadi et al., Nat. Phys. 17, 74 (2021))

## NULL-NG — No gravitational coupling of branches (non-gravitational physics only)

* **Family:** null  ·  **Implemented:** yes  ·  **Assurance:** NUMERICALLY VERIFIED
* **Gravity can entangle:** False
* **Dynamics:** H = Σ_ij U^EM_ij |ij><ij| (Casimir–Polder, Coulomb, induced dipole, dipole–dipole)
* **Assumptions:** gravity is branch-independent; all electromagnetic interactions quantum-coherent
* **Approximations:** retarded Casimir–Polder far-field form
* **Admissible domain:** r >> R
* **Known limits:** any entanglement is of electromagnetic origin
* **Nuisance parameters:** `env_decoherence_scale` ∈ [0.5, 2.0] 1 — multiplier on independently calibrated environmental decoherence rates; `mass_scale` ∈ [0.99, 1.01] 1 — relative mass calibration (enters gravity as m_A m_B); `local_phase_A` ∈ [-0.05, 0.05] rad — residual local phase calibration error on A; `local_phase_B` ∈ [-0.05, 0.05] rad — residual local phase calibration error on B
* **References:** Casimir & Polder, Phys. Rev. 73, 360 (1948); van de Kamp et al., PRA 102, 062807 (2020)
* **Status note:** confounder control

## CG-QFT-AH — Classical gravity coupled to quantum matter fields (Aziz–Howl mechanism)

* **Family:** hybrid  ·  **Implemented:** NO (registered only)  ·  **Assurance:** UNVERIFIED
* **Gravity can entangle:** True
* **Dynamics:** not implemented — requires the QFT matter-propagator derivation of the reference
* **Assumptions:** classical gravitational field; quantum field theory of matter
* **Approximations:** —
* **Admissible domain:** unspecified in this platform
* **Known limits:** —
* **Nuisance parameters:** `env_decoherence_scale` ∈ [0.5, 2.0] 1 — multiplier on independently calibrated environmental decoherence rates; `mass_scale` ∈ [0.99, 1.01] 1 — relative mass calibration (enters gravity as m_A m_B); `local_phase_A` ∈ [-0.05, 0.05] rad — residual local phase calibration error on A; `local_phase_B` ∈ [-0.05, 0.05] rad — residual local phase calibration error on B
* **References:** Aziz & Howl, Nature 646, 813–817 (2025), doi:10.1038/s41586-025-09595-7; Marletto, Oppenheim, Vedral & Wilson, arXiv:2511.07348 (preprint; disputes the interpretation)
* **Status note:** REGISTERED, NOT IMPLEMENTED: needed before any claim that observed entanglement excludes all classical-gravity models; interpretation disputed in the literature
