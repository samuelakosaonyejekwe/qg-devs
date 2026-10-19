import Mathlib.Analysis.SpecialFunctions.Trigonometric.Bounds
import Mathlib.LinearAlgebra.Matrix.Kronecker

/-!
# Pure-state concurrence of the BMV state

For the pure state `|ψ⟩ = Σ_{ij} ψ_{ij} |ij⟩` with `ψ_{ij} = exp(i φ_{ij}) / 2`
(index order `LL, LR, RL, RR`), the Wootters concurrence is `C = |⟨ψ| σ_y ⊗ σ_y |ψ*⟩|`.
We prove `C = |sin(Δφ / 2)|` with `Δφ = φ_LL + φ_RR − φ_LR − φ_RL = 4 δ`
(`qgdevs.bmv.predict`: `pure_state_concurrence_bound`).
-/

open Matrix Complex
open scoped Kronecker

namespace QGDEVS.Concurrence

/-- Pauli `σ_y = [[0, −i], [i, 0]]`. -/
def sigmaY : Matrix (Fin 2) (Fin 2) ℂ := !![0, -I; I, 0]

/-- Pure-state amplitudes `ψ_{ij} = exp(i φ_{ij}) / 2`. -/
noncomputable def psi (φ : Fin 2 × Fin 2 → ℝ) : Fin 2 × Fin 2 → ℂ :=
  fun a => Complex.exp (I * (φ a : ℂ)) / 2

/-- Spin-flip overlap `⟨ψ| σ_y ⊗ σ_y |ψ*⟩ = Σ_{a b} conj(ψ_a) (σ_y ⊗ σ_y)_{ab} conj(ψ_b)`. -/
noncomputable def spinFlipOverlap (φ : Fin 2 × Fin 2 → ℝ) : ℂ :=
  ∑ a, ∑ b, star (psi φ a) * (sigmaY ⊗ₖ sigmaY) a b * star (psi φ b)

/-- Pure-state concurrence `C(ψ) = |⟨ψ| σ_y ⊗ σ_y |ψ*⟩|`. -/
noncomputable def concurrence (φ : Fin 2 × Fin 2 → ℝ) : ℝ := ‖spinFlipOverlap φ‖

lemma star_exp_I (r : ℝ) : star (Complex.exp (I * (r : ℂ))) = Complex.exp (I * ((-r : ℝ) : ℂ)) := by
  rw [Complex.star_def, ← Complex.exp_conj]
  congr 1
  simp [Complex.conj_ofReal]

lemma spinFlipOverlap_eq (φ : Fin 2 × Fin 2 → ℝ) :
    spinFlipOverlap φ =
      (1 / 2 : ℂ) * (Complex.exp (I * ((-(φ (0, 1) + φ (1, 0)) : ℝ) : ℂ)) -
        Complex.exp (I * ((-(φ (0, 0) + φ (1, 1)) : ℝ) : ℂ))) := by
  simp only [spinFlipOverlap, Fintype.sum_prod_type, Fin.sum_univ_two, kroneckerMap_apply,
    sigmaY, psi, star_div₀, star_exp_I, Matrix.of_apply, Matrix.cons_val', Matrix.cons_val_zero,
    Matrix.cons_val_one, Matrix.empty_val', Matrix.cons_val_fin_one]
  have h2 : star (2 : ℂ) = 2 := by simp
  simp only [h2]
  have e1 : Complex.exp (I * ((-(φ (0, 1) + φ (1, 0)) : ℝ) : ℂ)) =
      Complex.exp (I * ((-φ (0, 1) : ℝ) : ℂ)) * Complex.exp (I * ((-φ (1, 0) : ℝ) : ℂ)) := by
    rw [← Complex.exp_add]; congr 1; push_cast; ring
  have e2 : Complex.exp (I * ((-(φ (0, 0) + φ (1, 1)) : ℝ) : ℂ)) =
      Complex.exp (I * ((-φ (0, 0) : ℝ) : ℂ)) * Complex.exp (I * ((-φ (1, 1) : ℝ) : ℂ)) := by
    rw [← Complex.exp_add]; congr 1; push_cast; ring
  rw [e1, e2]
  ring_nf
  simp only [Complex.I_sq]
  ring

/-- **PureConcurrence**: `C(ψ) = |sin(Δφ / 2)|` for every real phase table. -/
theorem pure_concurrence (φ : Fin 2 × Fin 2 → ℝ) :
    concurrence φ = |Real.sin ((φ (0, 0) + φ (1, 1) - φ (0, 1) - φ (1, 0)) / 2)| := by
  set A : ℝ := -(φ (0, 1) + φ (1, 0))
  set B : ℝ := -(φ (0, 0) + φ (1, 1))
  set Δ : ℝ := φ (0, 0) + φ (1, 1) - φ (0, 1) - φ (1, 0) with hΔ
  have hA : A = B + Δ := by simp only [A, B, Δ]; ring
  unfold concurrence
  rw [spinFlipOverlap_eq]
  have hfac : Complex.exp (I * (A : ℂ)) - Complex.exp (I * (B : ℂ)) =
      Complex.exp (I * (B : ℂ)) * (Complex.exp (I * (Δ : ℂ)) - 1) := by
    rw [mul_sub, ← Complex.exp_add, hA]; push_cast; ring_nf
  rw [hfac, norm_mul, norm_mul, Complex.norm_exp_I_mul_ofReal_sub_one]
  have hB : ‖Complex.exp (I * (B : ℂ))‖ = 1 := by
    rw [mul_comm]; exact Complex.norm_exp_ofReal_mul_I B
  rw [hB, norm_mul, Real.norm_eq_abs]
  simp

end QGDEVS.Concurrence
