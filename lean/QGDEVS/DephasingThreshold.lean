import QGDEVS.PhaseDecomposition
import QGDEVS.DephasedState
import Mathlib.Analysis.SpecialFunctions.Trigonometric.Bounds
import Mathlib.Analysis.SpecialFunctions.Trigonometric.DerivHyp
import Mathlib.Analysis.Calculus.MeanValue

/-!
# Dephasing threshold for gravity-mediated entanglement (PPT criterion)

Mirrors `qgdevs.bmv.entanglement_dephasing_threshold` (`Γ* = |dΔφ/dt| / 2`).

Setting: the dephased BMV state `ρ = dephasedState φ x x` (equal decay exponents `x_A = x_B = x`,
`x = Γ t` for a constant rate) with an *arbitrary* real phase table `φ`, entangling phase
`Δφ = φ_LL + φ_RR − φ_LR − φ_RL`, and `p = e^{−x}`.

Main results (all machine-checked):

* `ptB_posSemidef_iff`: the partial transpose `ρ^{T_B}` is PSD **iff**
  `2 p |sin(Δφ/2)| ≤ 1 − p²` (equivalently `|sin(Δφ/2)| ≤ sinh x`). This comes from the
  explicit spectral decomposition of `ρ^{T_B}` with eigenvalues
  `(1 + p² ± 2p cos(Δφ/2))/4` and `(1 − p² ± 2p sin(Δφ/2))/4` (`ptCore_decomp`).
* `ptB_posSemidef_of_abs_le`: if `|Δφ| ≤ 2x` then `ρ^{T_B}` is PSD.
* `dephasing_threshold`: if `Δφ(0) = 0` and `|dΔφ/dt| ≤ 2Γ` for all `t ≥ 0`, then for every
  `t ≥ 0` the state with `x = Γ t` has PSD partial transpose (it is PPT), i.e. the
  threshold `Γ ≥ |dΔφ/dt| / 2` precludes NPT entanglement at all times.

Remaining (not formalised here): for two qubits, PPT ⇔ separable (Peres 1996; Horodecki³ 1996).
That external theorem is what turns "PPT" into "separable / not entangled"; it is *not* part of
this library and is recorded as such in `proof_status.json`.
-/

open Matrix Complex
open scoped ComplexOrder

namespace QGDEVS

/-- Partial transpose on subsystem B: `(M^{T_B})_{(i,j),(k,l)} = M_{(i,l),(k,j)}`. -/
def partialTransposeB (M : Matrix Idx Idx ℂ) : Matrix Idx Idx ℂ :=
  fun a b => M (a.1, b.2) (b.1, a.2)

/-- `m_{ab} = (z_i z_l − z_k z_j)/2 ∈ {−1, 0, 1}` for `a = (i,j)`, `b = (k,l)`. -/
noncomputable def mIdx (a b : Idx) : ℝ := (z a.1 * z b.2 - z b.1 * z a.2) / 2

/-- Phase-free core of `ρ^{T_B}`, parametrised by `c = cos(Δφ/2)`, `s = sin(Δφ/2)`, `p = e^{−x}`. -/
noncomputable def ptCore (c s p : ℝ) : Matrix Idx Idx ℂ := fun a b =>
  (1 / 4 : ℂ) * (((if a.1 = b.1 then 1 else p : ℝ)) : ℂ) * (((if a.2 = b.2 then 1 else p : ℝ)) : ℂ) *
    (((1 - mIdx a b ^ 2 + mIdx a b ^ 2 * c : ℝ) : ℂ) + I * ((mIdx a b * s : ℝ) : ℂ))

/-- Eigenvectors of `ptCore`. -/
noncomputable def ev1 : Idx → ℂ := fun _ => 1
noncomputable def ev2 : Idx → ℂ := fun a => ((z a.1 * z a.2 : ℝ) : ℂ)
noncomputable def ev3 : Idx → ℂ := fun a => ((z a.1 : ℝ) : ℂ) - I * ((z a.2 : ℝ) : ℂ)
noncomputable def ev4 : Idx → ℂ := fun a => ((z a.1 : ℝ) : ℂ) + I * ((z a.2 : ℝ) : ℂ)

/-- Rank-one projector-like matrix `v v†`. -/
noncomputable def r1 (v : Idx → ℂ) : Matrix Idx Idx ℂ := vecMulVec v (star v)

/-- **Spectral decomposition** of the core of `ρ^{T_B}` (a polynomial identity in `c, s, p`). -/
theorem ptCore_decomp (c s p : ℝ) :
    ptCore c s p =
      (((1 + p ^ 2 + 2 * p * c) / 16 : ℝ) : ℂ) • r1 ev1 +
      (((1 + p ^ 2 - 2 * p * c) / 16 : ℝ) : ℂ) • r1 ev2 +
      (((1 - p ^ 2 + 2 * p * s) / 32 : ℝ) : ℂ) • r1 ev3 +
      (((1 - p ^ 2 - 2 * p * s) / 32 : ℝ) : ℂ) • r1 ev4 := by
  ext ⟨i, j⟩ ⟨k, l⟩
  fin_cases i <;> fin_cases j <;> fin_cases k <;> fin_cases l <;>
    simp [ptCore, mIdx, r1, ev1, ev2, ev3, ev4, vecMulVec_apply, Complex.ext_iff, pow_two] <;>
    first | (constructor <;> ring) | ring

lemma r1_smul_posSemidef (v : Idx → ℂ) {μ : ℝ} (hμ : 0 ≤ μ) : ((μ : ℂ) • r1 v).PosSemidef := by
  have hs : ((Real.sqrt μ : ℝ) : ℂ) * ((Real.sqrt μ : ℝ) : ℂ) = (μ : ℂ) := by
    rw [← Complex.ofReal_mul, Real.mul_self_sqrt hμ]
  have : (μ : ℂ) • r1 v = r1 (fun a => ((Real.sqrt μ : ℝ) : ℂ) * v a) := by
    ext a b
    simp only [r1, vecMulVec_apply, Matrix.smul_apply, smul_eq_mul, Pi.star_apply, star_mul',
      Complex.star_def, Complex.conj_ofReal]
    rw [← hs]; ring
  rw [this]
  exact posSemidef_vecMulVec_self_star _

/-- `ptCore` is PSD as soon as the two possibly-negative eigenvalues are nonnegative. -/
theorem ptCore_posSemidef {c s p : ℝ} (hc : |c| ≤ 1) (hp : 0 ≤ p)
    (h3 : 0 ≤ 1 - p ^ 2 + 2 * p * s) (h4 : 0 ≤ 1 - p ^ 2 - 2 * p * s) :
    (ptCore c s p).PosSemidef := by
  rw [ptCore_decomp]
  have hc' := abs_le.mp hc
  have e1 : 0 ≤ (1 + p ^ 2 + 2 * p * c) / 16 := by nlinarith [sq_nonneg (1 - p)]
  have e2 : 0 ≤ (1 + p ^ 2 - 2 * p * c) / 16 := by nlinarith [sq_nonneg (1 - p)]
  refine (((r1_smul_posSemidef _ e1).add (r1_smul_posSemidef _ e2)).add
    (r1_smul_posSemidef _ (by linarith))).add (r1_smul_posSemidef _ (by linarith))

/-- Quadratic form of `ptCore` on `ev3`. -/
lemma ptCore_quad3 (c s p : ℝ) :
    star ev3 ⬝ᵥ (ptCore c s p *ᵥ ev3) = (((1 - p ^ 2 + 2 * p * s) * 2 : ℝ) : ℂ) := by
  simp [dotProduct, mulVec, Fintype.sum_prod_type, Fin.sum_univ_two, ptCore, mIdx, ev3,
    Complex.ext_iff, pow_two]
  constructor <;> ring

/-- Quadratic form of `ptCore` on `ev4`. -/
lemma ptCore_quad4 (c s p : ℝ) :
    star ev4 ⬝ᵥ (ptCore c s p *ᵥ ev4) = (((1 - p ^ 2 - 2 * p * s) * 2 : ℝ) : ℂ) := by
  simp [dotProduct, mulVec, Fintype.sum_prod_type, Fin.sum_univ_two, ptCore, mIdx, ev4,
    Complex.ext_iff, pow_two]
  constructor <;> ring

/-- Converse: if `ptCore` is PSD then both possibly-negative eigenvalues are nonnegative. -/
theorem ptCore_eigs_of_posSemidef {c s p : ℝ} (h : (ptCore c s p).PosSemidef) :
    0 ≤ 1 - p ^ 2 + 2 * p * s ∧ 0 ≤ 1 - p ^ 2 - 2 * p * s := by
  have q3 := h.dotProduct_mulVec_nonneg ev3
  have q4 := h.dotProduct_mulVec_nonneg ev4
  rw [ptCore_quad3] at q3
  rw [ptCore_quad4] at q4
  have q3' := Complex.zero_le_real.mp q3
  have q4' := Complex.zero_le_real.mp q4
  constructor <;> linarith

/-! ### Relating `ρ^{T_B}` to the core by a diagonal unitary -/

/-- `m_{ab} ∈ {0, 1, −1}`. -/
lemma mIdx_cases (a b : Idx) : mIdx a b = 0 ∨ mIdx a b = 1 ∨ mIdx a b = -1 := by
  obtain ⟨i, j⟩ := a; obtain ⟨k, l⟩ := b
  fin_cases i <;> fin_cases j <;> fin_cases k <;> fin_cases l <;> norm_num [mIdx]

lemma exp_I_two_mul (θ m : ℝ) (hm : m = 0 ∨ m = 1 ∨ m = -1) :
    Complex.exp (I * ((θ * m : ℝ) : ℂ)) =
      (((1 - m ^ 2 + m ^ 2 * Real.cos θ : ℝ)) : ℂ) + I * ((m * Real.sin θ : ℝ) : ℂ) := by
  rcases hm with rfl | rfl | rfl
  · simp
  · rw [mul_comm I, Complex.exp_mul_I]
    push_cast; ring_nf
  · rw [mul_comm I, Complex.exp_mul_I]
    push_cast
    simp only [mul_neg, mul_one, Complex.cos_neg, Complex.sin_neg]; ring

lemma decay_split (x : ℝ) (i j k l : Fin 2) :
    Real.exp (-(x * neq i k) - x * neq l j) =
      (if i = k then 1 else Real.exp (-x)) * (if j = l then 1 else Real.exp (-x)) := by
  by_cases hik : i = k <;> by_cases hjl : j = l
  · subst hik; subst hjl; simp [neq]
  · subst hik; simp [neq, hjl, Ne.symm hjl]
  · subst hjl; simp [neq, hik]
  · simp [neq, hik, hjl, Ne.symm hjl]
    rw [← Real.exp_add]; ring_nf

/-- The local diagonal unitary `V_{(i,j)} = exp(i(β z_i − γ z_j))`. -/
noncomputable def locU (β γ : ℝ) : Idx → ℂ :=
  fun a => Complex.exp (I * ((β * z a.1 - γ * z a.2 : ℝ) : ℂ))

theorem ptB_eq_conj (φ : Idx → ℝ) (x α β γ δ : ℝ)
    (h : ∀ i j, φ (i, j) = phaseModel α β γ δ i j) :
    partialTransposeB (dephasedState φ x x) =
      diagonal (locU β γ) * ptCore (Real.cos (2 * δ)) (Real.sin (2 * δ)) (Real.exp (-x)) *
        (diagonal (locU β γ))ᴴ := by
  ext ⟨i, j⟩ ⟨k, l⟩
  rw [diagonal_conjTranspose, mul_diagonal, diagonal_mul]
  simp only [partialTransposeB, dephasedState, phaseMatrix, decayMatrix, ptCore, locU,
    Pi.star_apply, star_exp_I_mul]
  rw [decay_split, h i l, h k j]
  have hm := mIdx_cases (i, j) (k, l)
  have key : Complex.exp (I * ((phaseModel α β γ δ i l - phaseModel α β γ δ k j : ℝ) : ℂ)) =
      Complex.exp (I * ((β * z i - γ * z j : ℝ) : ℂ)) *
        Complex.exp (I * ((2 * δ * mIdx (i, j) (k, l) : ℝ) : ℂ)) *
        Complex.exp (-(I * ((β * z k - γ * z l : ℝ) : ℂ))) := by
    rw [← Complex.exp_add, ← Complex.exp_add]
    congr 1
    simp only [phaseModel, mIdx]
    push_cast; ring
  rw [key, exp_I_two_mul _ _ hm]
  push_cast
  ring

lemma locU_unitary (β γ : ℝ) :
    (diagonal (locU β γ))ᴴ * diagonal (locU β γ) = 1 := by
  rw [diagonal_conjTranspose, diagonal_mul_diagonal, ← diagonal_one]
  congr 1
  funext a
  simp only [locU, Pi.star_apply, star_exp_I_mul]
  rw [← Complex.exp_add, neg_add_cancel, Complex.exp_zero]

/-! ### Main theorems -/

/-- **DephasingThreshold** (exact PPT criterion): for any real phase table `φ` and any `x`,
`ρ^{T_B}` is PSD iff `2 e^{−x} |sin(Δφ/2)| ≤ 1 − e^{−2x}`. -/
theorem ptB_posSemidef_iff (φ : Idx → ℝ) (x : ℝ) :
    (partialTransposeB (dephasedState φ x x)).PosSemidef ↔
      2 * Real.exp (-x) * |Real.sin (entanglingPhase (fun i j => φ (i, j)) / 2)| ≤
        1 - Real.exp (-x) ^ 2 := by
  obtain ⟨⟨α, β, γ, δ⟩, hdec, -⟩ := phase_decomposition_existsUnique (fun i j => φ (i, j))
  have hδ := phase_decomposition_delta (fun i j => φ (i, j)) α β γ δ hdec
  have hΔ : entanglingPhase (fun i j => φ (i, j)) / 2 = 2 * δ := by
    simp only [entanglingPhase]; linarith
  rw [hΔ, ptB_eq_conj φ x α β γ δ (fun i j => hdec i j)]
  set p := Real.exp (-x) with hp
  have hp0 : 0 ≤ p := (Real.exp_pos _).le
  set c := Real.cos (2 * δ)
  set s := Real.sin (2 * δ)
  constructor
  · intro hpsd
    have hcore : (ptCore c s p).PosSemidef := by
      have := hpsd.conjTranspose_mul_mul_same (diagonal (locU β γ))
      have e : (diagonal (locU β γ))ᴴ *
          (diagonal (locU β γ) * ptCore c s p * (diagonal (locU β γ))ᴴ) *
            diagonal (locU β γ) = ptCore c s p := by
        rw [← Matrix.mul_assoc, ← Matrix.mul_assoc, locU_unitary, Matrix.one_mul,
          Matrix.mul_assoc, locU_unitary, Matrix.mul_one]
      rwa [e] at this
    obtain ⟨h3, h4⟩ := ptCore_eigs_of_posSemidef hcore
    have : |2 * p * s| ≤ 1 - p ^ 2 := abs_le.mpr ⟨by linarith, by linarith⟩
    rwa [abs_mul, abs_of_nonneg (by positivity : (0 : ℝ) ≤ 2 * p)] at this
  · intro hcond
    have hs1 := neg_abs_le s
    have hs2 := le_abs_self s
    have h3 : 0 ≤ 1 - p ^ 2 + 2 * p * s := by nlinarith
    have h4 : 0 ≤ 1 - p ^ 2 - 2 * p * s := by nlinarith
    exact (ptCore_posSemidef (Real.abs_cos_le_one _) hp0 h3 h4).mul_mul_conjTranspose_same _

/-- **DephasingThreshold** (sufficient condition): if `|Δφ| ≤ 2x` then `ρ^{T_B}` is PSD. -/
theorem ptB_posSemidef_of_abs_le (φ : Idx → ℝ) {x : ℝ}
    (hx : |entanglingPhase (fun i j => φ (i, j))| ≤ 2 * x) :
    (partialTransposeB (dephasedState φ x x)).PosSemidef := by
  rw [ptB_posSemidef_iff]
  set Δ := entanglingPhase (fun i j => φ (i, j))
  have hx0 : 0 ≤ x := by linarith [abs_nonneg Δ]
  have h1 : |Real.sin (Δ / 2)| ≤ x := by
    calc |Real.sin (Δ / 2)| ≤ |Δ / 2| := Real.abs_sin_le_abs
      _ = |Δ| / 2 := by rw [abs_div, abs_two]
      _ ≤ x := by linarith
  have h2 : x ≤ Real.sinh x := Real.self_le_sinh_iff.mpr hx0
  have h3 : 2 * Real.exp (-x) * Real.sinh x = 1 - Real.exp (-x) ^ 2 := by
    rw [Real.sinh_eq]
    have : Real.exp (-x) * Real.exp x = 1 := by rw [← Real.exp_add]; simp
    nlinarith [this]
  have hp : 0 ≤ 2 * Real.exp (-x) := by positivity
  calc 2 * Real.exp (-x) * |Real.sin (Δ / 2)| ≤ 2 * Real.exp (-x) * Real.sinh x :=
        mul_le_mul_of_nonneg_left (h1.trans h2) hp
    _ = 1 - Real.exp (-x) ^ 2 := h3

/-- **DephasingThreshold** (time-dependent form, `Γ_A = Γ_B = Γ`): let `φ t` be the branch-phase
table at time `t`, with entangling phase `Δφ(t)` differentiable on `t ≥ 0`, `Δφ(0) = 0` and
`|dΔφ/dt| ≤ 2Γ` for all `t ≥ 0`. Then for every `t ≥ 0` the dephased state with decay exponent
`x = Γ t` has positive semidefinite partial transpose (is PPT). -/
theorem dephasing_threshold {Γ : ℝ} (φ : ℝ → Idx → ℝ) (dΔ : ℝ → ℝ)
    (hderiv : ∀ t, 0 ≤ t →
      HasDerivAt (fun τ => entanglingPhase (fun i j => φ τ (i, j))) (dΔ t) t)
    (hrate : ∀ t, 0 ≤ t → |dΔ t| ≤ 2 * Γ)
    (h0 : entanglingPhase (fun i j => φ 0 (i, j)) = 0) {t : ℝ} (ht : 0 ≤ t) :
    (partialTransposeB (dephasedState (φ t) (Γ * t) (Γ * t))).PosSemidef := by
  apply ptB_posSemidef_of_abs_le
  set f := fun τ => entanglingPhase (fun i j => φ τ (i, j)) with hf
  have hmv := norm_image_sub_le_of_norm_deriv_le_segment' (f := f) (a := 0) (b := t)
    (f' := dΔ) (C := 2 * Γ)
    (fun y hy => (hderiv y hy.1).hasDerivWithinAt)
    (fun y hy => by rw [Real.norm_eq_abs]; exact hrate y hy.1) t ⟨ht, le_rfl⟩
  have hf0 : f 0 = 0 := h0
  rw [hf0, sub_zero, sub_zero, Real.norm_eq_abs] at hmv
  calc |entanglingPhase (fun i j => φ t (i, j))| = |f t| := rfl
    _ ≤ 2 * Γ * t := hmv
    _ = 2 * (Γ * t) := by ring

end QGDEVS
