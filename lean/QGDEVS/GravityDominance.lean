import Mathlib.Analysis.SpecialFunctions.Pow.Real

/-!
# Casimir–Polder versus Newtonian energy: gravity-dominance distance

Mirrors `qgdevs.em` (retarded Casimir–Polder far-field form
`|U_CP| = 23 ħ c R⁶ cm² / (4π r⁷)` for two identical spheres) and the closed form
`r_min⁶ = 23 ħ c R⁶ cm² / (4π G m² ratio)` used to find the separation beyond which the CP
energy is at most a target fraction of the Newtonian energy `G m² / r`.

All parameters are positive reals (we only need `cm ≠ 0`, which is weaker than `cm > 0`).
-/

namespace QGDEVS

/-- The ratio `|U_CP| / |U_N| = (23 ħ c R⁶ cm² / (4π r⁷)) / (G m² / r)`. -/
noncomputable def cpRatio (hbar c R cm G m r : ℝ) : ℝ :=
  (23 * hbar * c * R ^ 6 * cm ^ 2 / (4 * Real.pi * r ^ 7)) / (G * m ^ 2 / r)

/-- The constant `K = 23 ħ c R⁶ cm² / (4π G m²)` so that `ratio = K / r⁶`. -/
noncomputable def cpConst (hbar c R cm G m : ℝ) : ℝ :=
  23 * hbar * c * R ^ 6 * cm ^ 2 / (4 * Real.pi * G * m ^ 2)

variable {hbar c R cm G m : ℝ}

lemma cpRatio_eq (hG : 0 < G) (hm : m ≠ 0) {r : ℝ} (hr : 0 < r) :
    cpRatio hbar c R cm G m r = cpConst hbar c R cm G m / r ^ 6 := by
  unfold cpRatio cpConst
  have : (0 : ℝ) < Real.pi := Real.pi_pos
  field_simp

lemma cpConst_pos (hh : 0 < hbar) (hc : 0 < c) (hR : 0 < R) (hcm : cm ≠ 0) (hG : 0 < G)
    (hm : m ≠ 0) : 0 < cpConst hbar c R cm G m := by
  unfold cpConst
  have : (0 : ℝ) < Real.pi := Real.pi_pos
  positivity

/-- **GravityDominance** (monotonicity): the CP/Newton ratio is strictly decreasing on `r > 0`. -/
theorem cpRatio_strictAntiOn (hh : 0 < hbar) (hc : 0 < c) (hR : 0 < R) (hcm : cm ≠ 0)
    (hG : 0 < G) (hm : m ≠ 0) : StrictAntiOn (cpRatio hbar c R cm G m) (Set.Ioi 0) := by
  intro r hr s hs hrs
  simp only [Set.mem_Ioi] at hr hs
  rw [cpRatio_eq hG hm hr, cpRatio_eq hG hm hs]
  have hK := cpConst_pos hh hc hR hcm hG hm
  have h6 : r ^ 6 < s ^ 6 := pow_lt_pow_left₀ hrs hr.le (by norm_num)
  exact div_lt_div_of_pos_left hK (by positivity) h6

/-- **GravityDominance** (threshold): for a target ratio `T > 0` and `r_min > 0` with
`r_min⁶ = 23 ħ c R⁶ cm² / (4π G m² T)`, for every `r > 0`:
`ratio(r) ≤ T ↔ r_min ≤ r`. -/
theorem cpRatio_le_iff (hh : 0 < hbar) (hc : 0 < c) (hR : 0 < R) (hcm : cm ≠ 0) (hG : 0 < G)
    (hm : m ≠ 0) {T rmin : ℝ} (hT : 0 < T) (hrmin : 0 < rmin)
    (hdef : rmin ^ 6 = 23 * hbar * c * R ^ 6 * cm ^ 2 / (4 * Real.pi * G * m ^ 2 * T))
    {r : ℝ} (hr : 0 < r) :
    cpRatio hbar c R cm G m r ≤ T ↔ rmin ≤ r := by
  rw [cpRatio_eq hG hm hr]
  have hK := cpConst_pos hh hc hR hcm hG hm
  have hdef' : rmin ^ 6 = cpConst hbar c R cm G m / T := by
    rw [hdef]; unfold cpConst; field_simp
  rw [div_le_iff₀ (by positivity), ← div_le_iff₀' hT, ← hdef']
  exact pow_le_pow_iff_left₀ hrmin.le hr.le (by norm_num)

/-- Existence and uniqueness of the gravity-dominance distance
`r_min = (23 ħ c R⁶ cm² / (4π G m² T))^{1/6}` (as computed in `qgdevs.em`). -/
theorem rmin_existsUnique (hh : 0 < hbar) (hc : 0 < c) (hR : 0 < R) (hcm : cm ≠ 0)
    (hG : 0 < G) (hm : m ≠ 0) {T : ℝ} (hT : 0 < T) :
    ∃! rmin : ℝ, 0 < rmin ∧
      rmin ^ 6 = 23 * hbar * c * R ^ 6 * cm ^ 2 / (4 * Real.pi * G * m ^ 2 * T) := by
  set X := 23 * hbar * c * R ^ 6 * cm ^ 2 / (4 * Real.pi * G * m ^ 2 * T) with hX
  have hX0 : 0 < X := by
    have : (0 : ℝ) < Real.pi := Real.pi_pos
    rw [hX]; positivity
  refine ⟨X ^ ((6 : ℕ)⁻¹ : ℝ), ⟨Real.rpow_pos_of_pos hX0 _, ?_⟩, ?_⟩
  · exact Real.rpow_inv_natCast_pow hX0.le (by norm_num)
  · rintro y ⟨hy, hy6⟩
    have h1 : (X ^ ((6 : ℕ)⁻¹ : ℝ)) ^ 6 = X := Real.rpow_inv_natCast_pow hX0.le (by norm_num)
    have h2 : y ^ 6 = (X ^ ((6 : ℕ)⁻¹ : ℝ)) ^ 6 := by rw [h1, hy6]
    exact (pow_left_inj₀ hy.le (Real.rpow_pos_of_pos hX0 _).le (by norm_num)).mp h2

end QGDEVS
