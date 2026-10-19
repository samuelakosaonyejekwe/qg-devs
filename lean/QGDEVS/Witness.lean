import Mathlib.Analysis.Matrix.Order
import Mathlib.LinearAlgebra.Matrix.Kronecker

/-!
# The Chevalier–Paige–Kim (CPK) entanglement witness

Mirrors `qgdevs.bmv.cpk_witness_value` / `cpk_witness_best_sign`:
`W± = 1 − X⊗X ∓ (Y⊗Z + Z⊗Y)`.

1. Vector level: for Bloch vectors `‖a‖, ‖b‖ ≤ 1`,
   `a_x b_x + a_y b_z + a_z b_y ≤ 1` and `a_x b_x − a_y b_z − a_z b_y ≤ 1`.
2. Mixture level: any convex combination of product expectation values obeys the same bound.
3. Density-matrix level: every 2×2 density matrix has Bloch vector of norm ≤ 1, and for every
   separable two-qubit state `ρ = Σ_k w_k ρA_k ⊗ ρB_k` (`w_k ≥ 0`, each `ρA_k, ρB_k` PSD with
   unit trace) we have `Re tr(ρ W±) ≥ 0`. Hence `Re tr(ρ W±) < 0` certifies entanglement.
-/

open Matrix Complex
open scoped Kronecker ComplexOrder

namespace QGDEVS.Witness

/-! ### Vector level -/

/-- **WitnessProductBound** (`+` sign). -/
theorem cpk_product_bound (a b : Fin 3 → ℝ) (ha : a 0 ^ 2 + a 1 ^ 2 + a 2 ^ 2 ≤ 1)
    (hb : b 0 ^ 2 + b 1 ^ 2 + b 2 ^ 2 ≤ 1) :
    a 0 * b 0 + a 1 * b 2 + a 2 * b 1 ≤ 1 := by
  nlinarith [sq_nonneg (a 0 - b 0), sq_nonneg (a 1 - b 2), sq_nonneg (a 2 - b 1)]

/-- **WitnessProductBound** (`−` sign). -/
theorem cpk_product_bound_neg (a b : Fin 3 → ℝ) (ha : a 0 ^ 2 + a 1 ^ 2 + a 2 ^ 2 ≤ 1)
    (hb : b 0 ^ 2 + b 1 ^ 2 + b 2 ^ 2 ≤ 1) :
    a 0 * b 0 - a 1 * b 2 - a 2 * b 1 ≤ 1 := by
  nlinarith [sq_nonneg (a 0 - b 0), sq_nonneg (a 1 + b 2), sq_nonneg (a 2 + b 1)]

/-- Both signs at once: for `s = ±1`, `a_x b_x + s (a_y b_z + a_z b_y) ≤ 1`. -/
theorem cpk_product_bound_sign (a b : Fin 3 → ℝ) (s : ℝ) (hs : s = 1 ∨ s = -1)
    (ha : a 0 ^ 2 + a 1 ^ 2 + a 2 ^ 2 ≤ 1) (hb : b 0 ^ 2 + b 1 ^ 2 + b 2 ^ 2 ≤ 1) :
    a 0 * b 0 + s * (a 1 * b 2 + a 2 * b 1) ≤ 1 := by
  rcases hs with rfl | rfl
  · have := cpk_product_bound a b ha hb; linarith
  · have := cpk_product_bound_neg a b ha hb; linarith

/-- **WitnessProductBound** (convexity / separable mixtures of Bloch vectors): if
`w_k ≥ 0`, `Σ w_k = 1` and all Bloch vectors lie in the unit ball, then
`Σ_k w_k (a_k·x b_k·x + s (a_k·y b_k·z + a_k·z b_k·y)) ≤ 1` for `s = ±1`. -/
theorem cpk_mixture_bound {ι : Type*} (S : Finset ι) (w : ι → ℝ) (a b : ι → Fin 3 → ℝ)
    (s : ℝ) (hs : s = 1 ∨ s = -1) (hw : ∀ k ∈ S, 0 ≤ w k) (hsum : ∑ k ∈ S, w k = 1)
    (ha : ∀ k ∈ S, a k 0 ^ 2 + a k 1 ^ 2 + a k 2 ^ 2 ≤ 1)
    (hb : ∀ k ∈ S, b k 0 ^ 2 + b k 1 ^ 2 + b k 2 ^ 2 ≤ 1) :
    ∑ k ∈ S, w k * (a k 0 * b k 0 + s * (a k 1 * b k 2 + a k 2 * b k 1)) ≤ 1 := by
  calc ∑ k ∈ S, w k * (a k 0 * b k 0 + s * (a k 1 * b k 2 + a k 2 * b k 1))
      ≤ ∑ k ∈ S, w k * 1 := by
        apply Finset.sum_le_sum
        intro k hk
        exact mul_le_mul_of_nonneg_left
          (cpk_product_bound_sign (a k) (b k) s hs (ha k hk) (hb k hk)) (hw k hk)
    _ = 1 := by simp [hsum]

/-! ### Density-matrix level -/

/-- Pauli matrices. -/
def σx : Matrix (Fin 2) (Fin 2) ℂ := !![0, 1; 1, 0]
def σy : Matrix (Fin 2) (Fin 2) ℂ := !![0, -I; I, 0]
def σz : Matrix (Fin 2) (Fin 2) ℂ := !![1, 0; 0, -1]

/-- A (2×2) density matrix: positive semidefinite with unit trace. -/
def IsDensity (ρ : Matrix (Fin 2) (Fin 2) ℂ) : Prop := ρ.PosSemidef ∧ ρ.trace = 1

/-- Bloch vector `r_i = Re tr(ρ σ_i)`. -/
noncomputable def bloch (ρ : Matrix (Fin 2) (Fin 2) ℂ) : Fin 3 → ℝ :=
  ![(ρ * σx).trace.re, (ρ * σy).trace.re, (ρ * σz).trace.re]

lemma trace_mul_σx (ρ : Matrix (Fin 2) (Fin 2) ℂ) : (ρ * σx).trace = ρ 0 1 + ρ 1 0 := by
  simp [trace_fin_two, mul_apply, Fin.sum_univ_two, σx]

lemma trace_mul_σy (ρ : Matrix (Fin 2) (Fin 2) ℂ) : (ρ * σy).trace = ρ 0 1 * I - ρ 1 0 * I := by
  simp [trace_fin_two, mul_apply, Fin.sum_univ_two, σy]; ring

lemma trace_mul_σz (ρ : Matrix (Fin 2) (Fin 2) ℂ) : (ρ * σz).trace = ρ 0 0 - ρ 1 1 := by
  simp [trace_fin_two, mul_apply, Fin.sum_univ_two, σz]; ring

/-- Entry structure of a 2×2 density matrix. -/
lemma density_entries {ρ : Matrix (Fin 2) (Fin 2) ℂ} (h : IsDensity ρ) :
    ρ 1 0 = star (ρ 0 1) ∧ (ρ 0 0).im = 0 ∧ (ρ 1 1).im = 0 ∧ (ρ 0 0).re + (ρ 1 1).re = 1 ∧
      (ρ 0 1).re ^ 2 + (ρ 0 1).im ^ 2 ≤ (ρ 0 0).re * (ρ 1 1).re := by
  obtain ⟨hpsd, htr⟩ := h
  have hH := hpsd.isHermitian
  have h10 : ρ 1 0 = star (ρ 0 1) := (hH.apply 1 0).symm
  have h00 : star (ρ 0 0) = ρ 0 0 := hH.apply 0 0
  have h11 : star (ρ 1 1) = ρ 1 1 := hH.apply 1 1
  have i00 : (ρ 0 0).im = 0 := by
    have := congrArg Complex.im h00; simp at this; linarith
  have i11 : (ρ 1 1).im = 0 := by
    have := congrArg Complex.im h11; simp at this; linarith
  have hdet := hpsd.det_nonneg
  rw [det_fin_two, h10] at hdet
  have hre := (Complex.nonneg_iff.mp hdet).1
  have htr' : (ρ 0 0).re + (ρ 1 1).re = 1 := by
    have := congrArg Complex.re htr
    simpa [trace_fin_two] using this
  refine ⟨h10, i00, i11, htr', ?_⟩
  simp [Complex.mul_re, i00, i11] at hre
  nlinarith [hre]

/-- **Bloch ball**: the Bloch vector of a 2×2 density matrix has norm ≤ 1. -/
theorem bloch_norm_le_one {ρ : Matrix (Fin 2) (Fin 2) ℂ} (h : IsDensity ρ) :
    bloch ρ 0 ^ 2 + bloch ρ 1 ^ 2 + bloch ρ 2 ^ 2 ≤ 1 := by
  obtain ⟨h10, i00, i11, htr, hdet⟩ := density_entries h
  simp only [bloch, Matrix.cons_val_zero, Matrix.cons_val_one, Matrix.cons_val_two,
    Matrix.head_cons, Matrix.tail_cons, trace_mul_σx, trace_mul_σy, trace_mul_σz, h10]
  simp [Complex.mul_re]
  nlinarith [hdet, htr]

/-- Expectation values `tr(ρ σ_i)` of a density matrix are real. -/
lemma trace_pauli_im {ρ : Matrix (Fin 2) (Fin 2) ℂ} (h : IsDensity ρ) :
    (ρ * σx).trace.im = 0 ∧ (ρ * σy).trace.im = 0 ∧ (ρ * σz).trace.im = 0 ∧
      ρ.trace.im = 0 := by
  obtain ⟨h10, i00, i11, -, -⟩ := density_entries h
  rw [trace_mul_σx, trace_mul_σy, trace_mul_σz, h10, trace_fin_two]
  simp [Complex.mul_im, i00, i11]

/-- The CPK witness operator `W_s = 1⊗1 − X⊗X − s (Y⊗Z + Z⊗Y)`. -/
noncomputable def cpkW (s : ℝ) : Matrix (Fin 2 × Fin 2) (Fin 2 × Fin 2) ℂ :=
  (1 : Matrix (Fin 2) (Fin 2) ℂ) ⊗ₖ (1 : Matrix (Fin 2) (Fin 2) ℂ) - σx ⊗ₖ σx -
    (s : ℂ) • (σy ⊗ₖ σz + σz ⊗ₖ σy)

lemma trace_kron_mul (A B X Y : Matrix (Fin 2) (Fin 2) ℂ) :
    ((A ⊗ₖ B) * (X ⊗ₖ Y)).trace = (A * X).trace * (B * Y).trace := by
  rw [← mul_kronecker_mul, trace_kronecker]

/-- **CPK witness, product states**: `Re tr((ρA ⊗ ρB) W_s) ≥ 0` for `s = ±1`. -/
theorem cpk_product_state_nonneg {ρA ρB : Matrix (Fin 2) (Fin 2) ℂ} (hA : IsDensity ρA)
    (hB : IsDensity ρB) (s : ℝ) (hs : s = 1 ∨ s = -1) :
    0 ≤ ((ρA ⊗ₖ ρB) * cpkW s).trace.re := by
  have hbound := cpk_product_bound_sign (bloch ρA) (bloch ρB) s hs
    (bloch_norm_le_one hA) (bloch_norm_le_one hB)
  obtain ⟨ax, ay, az, -⟩ := trace_pauli_im hA
  obtain ⟨bx, by_, bz, -⟩ := trace_pauli_im hB
  have expand : ((ρA ⊗ₖ ρB) * cpkW s).trace =
      (ρA * 1).trace * (ρB * 1).trace - (ρA * σx).trace * (ρB * σx).trace -
        (s : ℂ) * ((ρA * σy).trace * (ρB * σz).trace + (ρA * σz).trace * (ρB * σy).trace) := by
    simp only [cpkW, Matrix.mul_sub, Matrix.mul_add, Matrix.mul_smul, trace_sub, trace_add,
      trace_smul, trace_kron_mul, smul_eq_mul]
  rw [expand]
  simp only [Matrix.mul_one, hA.2, hB.2]
  simp only [bloch, Matrix.cons_val_zero, Matrix.cons_val_one, Matrix.cons_val_two,
    Matrix.head_cons, Matrix.tail_cons] at hbound
  simp [Complex.mul_re, ax, ay, az, bx, by_, bz]
  linarith

/-- **CPK witness, separable states**: for `ρ = Σ_k w_k (ρA_k ⊗ ρB_k)` with `w_k ≥ 0` and all
`ρA_k, ρB_k` density matrices, `Re tr(ρ W_s) ≥ 0` for `s = ±1`. Consequently a negative witness
value certifies entanglement. (Normalisation `Σ w_k = 1` is not even needed for the sign.) -/
theorem cpk_separable_nonneg {ι : Type*} (S : Finset ι) (w : ι → ℝ)
    (ρA ρB : ι → Matrix (Fin 2) (Fin 2) ℂ) (hw : ∀ k ∈ S, 0 ≤ w k)
    (hA : ∀ k ∈ S, IsDensity (ρA k)) (hB : ∀ k ∈ S, IsDensity (ρB k))
    (s : ℝ) (hs : s = 1 ∨ s = -1) :
    0 ≤ ((∑ k ∈ S, w k • (ρA k ⊗ₖ ρB k)) * cpkW s).trace.re := by
  rw [Finset.sum_mul, trace_sum, Complex.re_sum]
  apply Finset.sum_nonneg
  intro k hk
  rw [Matrix.smul_mul, trace_smul, Complex.smul_re]
  exact mul_nonneg (hw k hk) (cpk_product_state_nonneg (hA k hk) (hB k hk) s hs)

end QGDEVS.Witness
