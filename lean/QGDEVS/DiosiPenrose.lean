import Mathlib.Analysis.SpecialFunctions.Pow.Real

/-!
# Diósi–Penrose energy difference for a displaced uniform sphere

Mirrors `qgdevs.gravity.gravitational_self_energy_difference` (non-overlapping branch, `d ≥ 2R`)
and `qgdevs.decoherence.diosi_penrose_rate` (`Γ_DP = κ E_Δ / ħ`):

  `E_Δ(d) = G m² (6/(5R) − 1/d)`   for `d ≥ 2R > 0`.

We prove `0 < E_Δ < 6 G m² / (5R)` (finite, strictly positive collapse rate), that `E_Δ` is
increasing in `d`, and the corresponding bounds for `Γ_DP`.
-/

namespace QGDEVS

/-- `E_Δ(d) = G m² (6/(5R) − 1/d)` (valid for `d ≥ 2R`). -/
noncomputable def dpEnergy (G m R d : ℝ) : ℝ := G * m ^ 2 * (6 / (5 * R) - 1 / d)

/-- Diósi–Penrose rate `Γ = κ E_Δ / ħ`. -/
noncomputable def dpRate (κ G m R d hbar : ℝ) : ℝ := κ * dpEnergy G m R d / hbar

variable {G m R d hbar κ : ℝ}

lemma inv_lt_six_fifths (hR : 0 < R) (hd : 2 * R ≤ d) : 1 / d < 6 / (5 * R) := by
  have hd0 : 0 < d := by linarith
  rw [div_lt_div_iff₀ hd0 (by positivity)]
  linarith

/-- **DPEnergyDifference**: for `d ≥ 2R > 0`, `G > 0`, `m ≠ 0`:
`0 < E_Δ < 6 G m² / (5R)`. -/
theorem dpEnergy_bounds (hG : 0 < G) (hm : m ≠ 0) (hR : 0 < R) (hd : 2 * R ≤ d) :
    0 < dpEnergy G m R d ∧ dpEnergy G m R d < 6 * G * m ^ 2 / (5 * R) := by
  have hd0 : 0 < d := by linarith
  have hGm : 0 < G * m ^ 2 := by positivity
  have h1 := inv_lt_six_fifths hR hd
  refine ⟨mul_pos hGm (by linarith), ?_⟩
  have : dpEnergy G m R d = G * m ^ 2 * (6 / (5 * R)) - G * m ^ 2 * (1 / d) := by
    unfold dpEnergy; ring
  rw [this]
  have h2 : 0 < G * m ^ 2 * (1 / d) := by positivity
  have h3 : G * m ^ 2 * (6 / (5 * R)) = 6 * G * m ^ 2 / (5 * R) := by ring
  linarith

/-- `E_Δ` is monotone (non-decreasing) in the displacement `d` on `d ≥ 2R`. -/
theorem dpEnergy_mono (hG : 0 < G) (hR : 0 < R) {d₁ d₂ : ℝ} (h₁ : 2 * R ≤ d₁) (h₁₂ : d₁ ≤ d₂) :
    dpEnergy G m R d₁ ≤ dpEnergy G m R d₂ := by
  have hd0 : 0 < d₁ := by linarith
  unfold dpEnergy
  have : 1 / d₂ ≤ 1 / d₁ := one_div_le_one_div_of_le hd0 h₁₂
  have hGm : 0 ≤ G * m ^ 2 := by positivity
  nlinarith

/-- Finite, strictly positive collapse rate: for `κ > 0`, `ħ > 0`,
`0 < Γ_DP < 6 κ G m² / (5 R ħ)`. -/
theorem dpRate_bounds (hκ : 0 < κ) (hh : 0 < hbar) (hG : 0 < G) (hm : m ≠ 0) (hR : 0 < R)
    (hd : 2 * R ≤ d) :
    0 < dpRate κ G m R d hbar ∧ dpRate κ G m R d hbar < 6 * κ * G * m ^ 2 / (5 * R * hbar) := by
  obtain ⟨h1, h2⟩ := dpEnergy_bounds hG hm hR hd
  unfold dpRate
  refine ⟨by positivity, ?_⟩
  rw [div_lt_div_iff₀ hh (by positivity)]
  have : κ * dpEnergy G m R d < κ * (6 * G * m ^ 2 / (5 * R)) := mul_lt_mul_of_pos_left h2 hκ
  have e : κ * (6 * G * m ^ 2 / (5 * R)) * (5 * R) = 6 * κ * G * m ^ 2 := by
    field_simp
  calc κ * dpEnergy G m R d * (5 * R * hbar)
      = (κ * dpEnergy G m R d * (5 * R)) * hbar := by ring
    _ < (κ * (6 * G * m ^ 2 / (5 * R)) * (5 * R)) * hbar := by
        apply mul_lt_mul_of_pos_right _ hh
        exact mul_lt_mul_of_pos_right this (by positivity)
    _ = 6 * κ * G * m ^ 2 * hbar := by rw [e]

end QGDEVS
