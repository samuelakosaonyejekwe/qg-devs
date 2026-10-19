# QGDEVS — Lean 4 formal verification for QG-DEVS

Machine-checked theorems about the mathematics used by the QG-DEVS Python platform
(`qgdevs/bmv.py`, `qgdevs/gravity.py`, `qgdevs/decoherence.py`, `qgdevs/em.py`).

- Toolchain: `leanprover/lean4:v4.34.1`, Mathlib `v4.34.1`
- Library: `QGDEVS` (root `QGDEVS.lean`)
- Machine-readable status: `proof_status.json`. The dashboard may show FORMALLY VERIFIED only for
  entries with `"status": "proved"`.
- No `sorry`, `admit`, or new `axiom`. Every headline theorem depends only on
  `propext`, `Classical.choice`, `Quot.sound` (see `scripts/Axioms.lean`).

## Verify

```sh
./check.sh
```

`check.sh` does three things:
1. It fails if the token `sorry`, `admit` or `axiom` appears in `QGDEVS.lean` or `QGDEVS/*.lean`.
2. It runs `lake build`.
3. It runs `#print axioms` on all 32 headline theorems and fails if any of them uses an axiom
   other than the three standard ones (including `sorryAx`).

## Setup (reuses a prebuilt Mathlib)

`.lake/` is git-ignored. Mathlib is not downloaded or rebuilt. Each entry of
`.lake/packages/` is a symlink to the already-built packages in
`/home/akosa/bespokesoftware/lean/.lake/packages`, and `lake-manifest.json` pins the same revisions.
To recreate the links on a fresh checkout:

```sh
mkdir -p .lake/packages
for p in /home/akosa/bespokesoftware/lean/.lake/packages/*; do ln -s "$p" .lake/packages/; done
lake build
```

If that prebuilt tree is not available, use `lake exe cache get`, then `lake build`.
Only the 8 QGDEVS modules get compiled. A clean build of them took 285 s (about 5 minutes) on this
machine, and a no-op rebuild takes about 15 s.

## Theorems

| Target | File | Main Lean names | Status |
|---|---|---|---|
| 1 PhaseDecomposition | `QGDEVS/PhaseDecomposition.lean` | `phase_decomposition_existsUnique`, `phase_decomposition_delta`, `phase_decomposition_coeffs`, `entanglingPhase_local_invariant` | proved |
| 2 WitnessProductBound | `QGDEVS/Witness.lean` | `Witness.cpk_product_bound`, `Witness.cpk_product_bound_neg`, `Witness.cpk_mixture_bound`, `Witness.bloch_norm_le_one`, `Witness.cpk_product_state_nonneg`, `Witness.cpk_separable_nonneg` | proved |
| 3 BranchEnergyFinite | `QGDEVS/BranchEnergy.lean` | `pointEnergy_neg`, `pointEnergy_abs_le`, `branchEnergy_finite`, `branchPhase_bounds`, `entanglingPhase_abs_le`, `pointEnergy_unbounded_near_zero`, `pointEnergy_tendsto_atBot` | proved |
| 4 DephasedStatePSD | `QGDEVS/DephasedState.lean` | `dephasedState_posSemidef`, `dephasedState_isHermitian`, `dephasedState_trace`, `dephasedState_density` | proved |
| 5 PureConcurrence | `QGDEVS/Concurrence.lean` | `Concurrence.pure_concurrence` | proved |
| 6 DPEnergyDifference | `QGDEVS/DiosiPenrose.lean` | `dpEnergy_bounds`, `dpEnergy_mono`, `dpRate_bounds` | proved |
| 7 GravityDominance | `QGDEVS/GravityDominance.lean` | `cpRatio_strictAntiOn`, `cpRatio_le_iff`, `rmin_existsUnique` | proved |
| 8 DephasingThreshold | `QGDEVS/DephasingThreshold.lean` | `ptCore_decomp`, `ptB_posSemidef_iff`, `ptB_posSemidef_of_abs_le`, `dephasing_threshold` | proved (as PPT) |

All names are in namespace `QGDEVS`.

### How the statements differ from the original targets

These are all deliberate. None of them weakens a target without saying so.

- **(1)** Branches are `Fin 2` (`0 = L`, `1 = R`) with `z = ![1, -1]`. Existence and uniqueness are
  stated as `∃!` over `ℝ × ℝ × ℝ × ℝ`. The closed-form coefficients of `decompose_phases` are also
  proved.
- **(2)** This is stronger than the target. On top of the vector bound and its convex-combination
  form, it proves the density-matrix statement: every 2×2 density matrix has a Bloch vector of
  norm at most 1, and `Re tr(ρ W±) ≥ 0` for every finite separable decomposition
  `ρ = Σ w_k ρA_k ⊗ ρB_k`. The sign result does not need `Σ w_k = 1`.
- **(3)** "Finite" is made precise as a uniform bound on the admissible domain `r ≥ r_min > 0`. The
  singularity is proved twice: as an elementary ε–M statement and as `Tendsto … (𝓝[>] 0) atBot`.
  It also proves `|Δφ| ≤ 2B` when every branch phase lies in `[0, B]`. Only the point-mass form is
  covered. The finite-size `sphere_mutual_energy` (an overlap integral) is not formalised.
- **(4)** This is stated for general integrated decay exponents `x_A, x_B ≥ 0`, which is what
  `joint_state` takes. The `Γ t` form follows as a corollary. The PSD proof combines
  `Matrix.PosSemidef.kronecker` and `Matrix.PosSemidef.hadamard` from Mathlib.
- **(5)** The concurrence is defined as `‖Σ_ab conj(ψ_a) (σy⊗σy)_ab conj(ψ_b)‖`. The result
  `|sin(Δφ/2)|` holds for every real phase table.
- **(6)** `E_Δ` is used in its closed form `G m²(6/(5R) − 1/d)`, valid for `d ≥ 2R`, as the
  definition. That closed form is not derived from the overlap integral. The theorem needs only
  `m ≠ 0`, and the upper bound is strict.
- **(7)** The ratio is the literal expression `(23ħcR⁶cm²/(4πr⁷)) / (Gm²/r)`. The theorem needs
  only `cm ≠ 0`, which is weaker than `cm > 0`. The `iff` holds for every `r > 0`. Existence and
  uniqueness of `r_min` is proved separately.
- **(8)** This is fully proved, and it is stronger than the target: an exact *iff* criterion for
  positivity of the partial transpose (`ρ^{T_B} ⪰ 0 ⇔ |sin(Δφ/2)| ≤ sinh x`) holds for any phase
  table when `x_A = x_B = x`. The time-dependent threshold `|dΔφ/dt| ≤ 2Γ ⇒ PPT for all t ≥ 0`
  follows from it via the mean-value inequality. Two things remain open, and both are listed in
  `proof_status.json`:
  - **PPT ⇒ separable** for two qubits (Peres–Horodecki) is not formalised. The verified claim is
    therefore "PPT, i.e. no NPT entanglement and zero negativity", not "separable".
  - **Sharpness** of `Γ* = |ω|/2` for constant rates (`Γ < |ω|/2` ⇒ NPT at small `t`) is not
    formalised.
