import Mathlib.Tactic
import Mathlib.Basic.Real.Basic

/-!
# Phase decomposition of the BMV branch phases

Mirrors `qgdevs.bmv.decompose_phases` / `qgdevs.bmv.entangling_phase`.

Branch labels `L, R` are encoded as `Fin 2` (`0 = L`, `1 = R`) with signs `z L = 1`, `z R = -1`.
Every phase table `φ : Fin 2 → Fin 2 → ℝ` decomposes *uniquely* as
`φ i j = α + β z_i + γ z_j + δ z_i z_j`, and the entangling coefficient satisfies
`4 δ = φ_LL + φ_RR - φ_LR - φ_RL` (`= Δφ`).
-/

namespace QGDEVS

/-- Branch sign: `z 0 = z_L = 1`, `z 1 = z_R = -1`. -/
def z : Fin 2 → ℝ := ![1, -1]

@[simp] lemma z_zero : z 0 = 1 := rfl
@[simp] lemma z_one : z 1 = -1 := rfl

/-- Entangling phase `Δφ = φ_LL + φ_RR - φ_LR - φ_RL` (`qgdevs.bmv.entangling_phase`). -/
def entanglingPhase (φ : Fin 2 → Fin 2 → ℝ) : ℝ := φ 0 0 + φ 1 1 - φ 0 1 - φ 1 0

/-- The bilinear model `α + β z_i + γ z_j + δ z_i z_j`. -/
def phaseModel (α β γ δ : ℝ) (i j : Fin 2) : ℝ := α + β * z i + γ * z j + δ * (z i * z j)

/-- Explicit coefficients, exactly as in `qgdevs.bmv.decompose_phases`. -/
noncomputable def decompCoeffs (φ : Fin 2 → Fin 2 → ℝ) : ℝ × ℝ × ℝ × ℝ :=
  ((φ 0 0 + φ 0 1 + φ 1 0 + φ 1 1) / 4,
   (φ 0 0 + φ 0 1 - φ 1 0 - φ 1 1) / 4,
   (φ 0 0 - φ 0 1 + φ 1 0 - φ 1 1) / 4,
   entanglingPhase φ / 4)

lemma phaseModel_eq_iff (φ : Fin 2 → Fin 2 → ℝ) (α β γ δ : ℝ) :
    (∀ i j, φ i j = phaseModel α β γ δ i j) ↔
      (φ 0 0 = α + β + γ + δ ∧ φ 0 1 = α + β - γ - δ ∧
       φ 1 0 = α - β + γ - δ ∧ φ 1 1 = α - β - γ + δ) := by
  constructor
  · intro h
    refine ⟨?_, ?_, ?_, ?_⟩ <;>
      [rw [h 0 0]; rw [h 0 1]; rw [h 1 0]; rw [h 1 1]] <;> simp [phaseModel] <;> ring
  · rintro ⟨h00, h01, h10, h11⟩ i j
    fin_cases i <;> fin_cases j <;> simp [phaseModel, h00, h01, h10, h11] <;> ring

/-- **PhaseDecomposition** (existence + uniqueness): for every real phase table there is exactly
one coefficient quadruple `(α, β, γ, δ)` with `φ i j = α + β z_i + γ z_j + δ z_i z_j`
for all branch labels `i j`. -/
theorem phase_decomposition_existsUnique (φ : Fin 2 → Fin 2 → ℝ) :
    ∃! c : ℝ × ℝ × ℝ × ℝ, ∀ i j, φ i j = phaseModel c.1 c.2.1 c.2.2.1 c.2.2.2 i j := by
  refine ⟨decompCoeffs φ, ?_, ?_⟩
  · refine (phaseModel_eq_iff _ _ _ _ _).2 ?_
    simp only [decompCoeffs, entanglingPhase]
    refine ⟨?_, ?_, ?_, ?_⟩ <;> ring
  · rintro ⟨α, β, γ, δ⟩ h
    rw [phaseModel_eq_iff] at h
    obtain ⟨h00, h01, h10, h11⟩ := h
    simp only [decompCoeffs, entanglingPhase, h00, h01, h10, h11, Prod.mk.injEq]
    refine ⟨?_, ?_, ?_, ?_⟩ <;> ring

/-- **PhaseDecomposition** (entangling coefficient): whenever the decomposition holds,
`4 δ = φ_LL + φ_RR - φ_LR - φ_RL`. -/
theorem phase_decomposition_delta (φ : Fin 2 → Fin 2 → ℝ) (α β γ δ : ℝ)
    (h : ∀ i j, φ i j = phaseModel α β γ δ i j) :
    4 * δ = φ 0 0 + φ 1 1 - φ 0 1 - φ 1 0 := by
  rw [phaseModel_eq_iff] at h
  obtain ⟨h00, h01, h10, h11⟩ := h
  rw [h00, h01, h10, h11]; ring

/-- The unique coefficients are given by the closed forms used in `decompose_phases`. -/
theorem phase_decomposition_coeffs (φ : Fin 2 → Fin 2 → ℝ) (α β γ δ : ℝ)
    (h : ∀ i j, φ i j = phaseModel α β γ δ i j) :
    (α, β, γ, δ) = decompCoeffs φ := by
  obtain ⟨c, -, hc⟩ := phase_decomposition_existsUnique φ
  have h1 := hc (α, β, γ, δ) h
  have h2 := hc (decompCoeffs φ) (by
    refine (phaseModel_eq_iff _ _ _ _ _).2 ?_; simp only [decompCoeffs, entanglingPhase]
    refine ⟨?_, ?_, ?_, ?_⟩ <;> ring)
  rw [h1, h2]

/-- Only `δ` (equivalently `Δφ`) is invariant under local phase changes: adding arbitrary local
phases `a i + b j` to the table leaves `Δφ` unchanged. -/
theorem entanglingPhase_local_invariant (φ : Fin 2 → Fin 2 → ℝ) (a b : Fin 2 → ℝ) :
    entanglingPhase (fun i j => φ i j + a i + b j) = entanglingPhase φ := by
  simp only [entanglingPhase]; ring

end QGDEVS
