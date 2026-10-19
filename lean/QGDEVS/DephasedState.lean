import Mathlib.Analysis.Matrix.Order
import Mathlib.Analysis.SpecialFunctions.Exp
import Mathlib.Analysis.SpecialFunctions.Sqrt

/-!
# Positivity of the dephased BMV joint state

Mirrors `qgdevs.bmv.joint_state`: in the product basis `|ij⟩`, `i, j ∈ {L = 0, R = 1}`
(index type `Fin 2 × Fin 2`, lexicographic order `LL, LR, RL, RR`),

  `ρ_{ij,kl} = ¼ · exp(i (φ_ij − φ_kl)) · exp(−x_A [i ≠ k] − x_B [j ≠ l])`

where `x_A, x_B ≥ 0` are the integrated single-mass coherence-decay exponents
(`x = Γ t` for constant rates). We prove that `ρ` is positive semidefinite, Hermitian and has
unit trace for **all** real phases and all `x_A, x_B ≥ 0`.

Proof route: `ρ = (u u†) ⊙ (D_A ⊗ D_B)` with `u_a = exp(i φ_a)/2`, `D_X = [[1, e^{-x}], [e^{-x}, 1]]`;
`D_X` is PSD, the Kronecker product of PSD matrices is PSD (`Matrix.PosSemidef.kronecker`) and
the Schur/Hadamard product of PSD matrices is PSD (`Matrix.PosSemidef.hadamard`).
-/

open Matrix Complex
open scoped Kronecker ComplexOrder

namespace QGDEVS

/-- Two-qubit index: `(i, j)` = (branch of mass A, branch of mass B). -/
abbrev Idx := Fin 2 × Fin 2

/-- The Iverson bracket `[i ≠ k]` as a real number. -/
def neq (i k : Fin 2) : ℝ := if i = k then 0 else 1

/-- The 4×4 decay matrix `D_{ij,kl} = exp(−x_A [i≠k] − x_B [j≠l])`. -/
noncomputable def decayMatrix (xA xB : ℝ) : Matrix Idx Idx ℂ :=
  fun a b => ((Real.exp (-(xA * neq a.1 b.1) - xB * neq a.2 b.2) : ℝ) : ℂ)

/-- The 4×4 phase matrix `exp(i (φ_a − φ_b))`. -/
noncomputable def phaseMatrix (φ : Idx → ℝ) : Matrix Idx Idx ℂ :=
  fun a b => Complex.exp (I * ((φ a - φ b : ℝ) : ℂ))

/-- The dephased BMV joint state (`qgdevs.bmv.joint_state` with `decay_A = xA`, `decay_B = xB`). -/
noncomputable def dephasedState (φ : Idx → ℝ) (xA xB : ℝ) : Matrix Idx Idx ℂ :=
  fun a b => (1 / 4 : ℂ) * phaseMatrix φ a b * decayMatrix xA xB a b

/-- Single-mass decay matrix `D_X = [[1, e^{-x}], [e^{-x}, 1]]`. -/
noncomputable def decay1 (x : ℝ) : Matrix (Fin 2) (Fin 2) ℂ :=
  fun i k => ((Real.exp (-(x * neq i k)) : ℝ) : ℂ)

/-- Amplitude vector `u_a = exp(i φ_a) / 2`. -/
noncomputable def amp (φ : Idx → ℝ) : Idx → ℂ := fun a => Complex.exp (I * (φ a : ℂ)) / 2

lemma star_exp_I_mul (r : ℝ) : star (Complex.exp (I * (r : ℂ))) = Complex.exp (-(I * (r : ℂ))) := by
  rw [Complex.star_def, ← Complex.exp_conj]
  congr 1
  simp [Complex.conj_ofReal]

lemma decayMatrix_eq_kronecker (xA xB : ℝ) :
    decayMatrix xA xB = decay1 xA ⊗ₖ decay1 xB := by
  ext ⟨i, j⟩ ⟨k, l⟩
  simp only [decayMatrix, decay1, kroneckerMap_apply]
  rw [← Complex.ofReal_mul, ← Real.exp_add]
  congr 2

lemma dephasedState_eq_hadamard (φ : Idx → ℝ) (xA xB : ℝ) :
    dephasedState φ xA xB = vecMulVec (amp φ) (star (amp φ)) ⊙ (decay1 xA ⊗ₖ decay1 xB) := by
  rw [← decayMatrix_eq_kronecker]
  ext a b
  simp only [dephasedState, phaseMatrix, hadamard_apply, vecMulVec_apply, amp, Pi.star_apply,
    star_div₀, star_exp_I_mul]
  have h2 : star (2 : ℂ) = 2 := by simp
  rw [h2]
  have : Complex.exp (I * ((φ a - φ b : ℝ) : ℂ)) =
      Complex.exp (I * (φ a : ℂ)) * Complex.exp (-(I * (φ b : ℂ))) := by
    rw [← Complex.exp_add]; congr 1; push_cast; ring
  rw [this]
  ring

/-- `D_X = (1 − e^{-x}) I + (√e^{-x})² J` is positive semidefinite for `x ≥ 0`. -/
lemma decay1_posSemidef {x : ℝ} (hx : 0 ≤ x) : (decay1 x).PosSemidef := by
  set p := Real.exp (-x) with hp
  have hp1 : p ≤ 1 := by rw [hp]; exact Real.exp_le_one_iff.mpr (by linarith)
  have hp0 : 0 ≤ p := (Real.exp_pos _).le
  have hdecomp : decay1 x =
      vecMulVec (fun _ => ((Real.sqrt p : ℝ) : ℂ)) (star fun _ => ((Real.sqrt p : ℝ) : ℂ)) +
        diagonal (fun _ => ((1 - p : ℝ) : ℂ)) := by
    have hs : ((Real.sqrt p : ℝ) : ℂ) * ((Real.sqrt p : ℝ) : ℂ) = (p : ℂ) := by
      rw [← Complex.ofReal_mul, Real.mul_self_sqrt hp0]
    ext i k
    fin_cases i <;> fin_cases k <;>
      simp [decay1, neq, vecMulVec_apply, diagonal, Complex.conj_ofReal, hs, ← hp]
  rw [hdecomp]
  refine (posSemidef_vecMulVec_self_star _).add (PosSemidef.diagonal ?_)
  intro i
  simp only [Pi.zero_apply]
  exact Complex.zero_le_real.mpr (by linarith)

/-- **DephasedStatePSD** (positivity): the dephased BMV joint state is positive semidefinite for
all real phases `φ` and all decay exponents `xA, xB ≥ 0`. -/
theorem dephasedState_posSemidef (φ : Idx → ℝ) {xA xB : ℝ} (hA : 0 ≤ xA) (hB : 0 ≤ xB) :
    (dephasedState φ xA xB).PosSemidef := by
  rw [dephasedState_eq_hadamard]
  exact (posSemidef_vecMulVec_self_star _).hadamard
    ((decay1_posSemidef hA).kronecker (decay1_posSemidef hB))

/-- **DephasedStatePSD** (Hermiticity). -/
theorem dephasedState_isHermitian (φ : Idx → ℝ) {xA xB : ℝ} (hA : 0 ≤ xA) (hB : 0 ≤ xB) :
    (dephasedState φ xA xB).IsHermitian :=
  (dephasedState_posSemidef φ hA hB).isHermitian

/-- **DephasedStatePSD** (normalisation): `tr ρ = 1` (holds for all real parameters). -/
theorem dephasedState_trace (φ : Idx → ℝ) (xA xB : ℝ) :
    (dephasedState φ xA xB).trace = 1 := by
  simp only [trace, diag, dephasedState, phaseMatrix, decayMatrix, neq, Fintype.sum_prod_type,
    Fin.sum_univ_two, sub_self, ite_true, Complex.ofReal_zero, mul_zero, Complex.exp_zero]
  norm_num

/-- **DephasedStatePSD** (constant rates): with `x = Γ t`, `Γ_A, Γ_B ≥ 0`, `t ≥ 0`, the state is a
density matrix (PSD, Hermitian, unit trace). -/
theorem dephasedState_density (φ : Idx → ℝ) {ΓA ΓB t : ℝ} (hA : 0 ≤ ΓA) (hB : 0 ≤ ΓB)
    (ht : 0 ≤ t) :
    (dephasedState φ (ΓA * t) (ΓB * t)).PosSemidef ∧
      (dephasedState φ (ΓA * t) (ΓB * t)).IsHermitian ∧
      (dephasedState φ (ΓA * t) (ΓB * t)).trace = 1 :=
  ⟨dephasedState_posSemidef φ (mul_nonneg hA ht) (mul_nonneg hB ht),
   dephasedState_isHermitian φ (mul_nonneg hA ht) (mul_nonneg hB ht),
   dephasedState_trace φ _ _⟩

end QGDEVS
