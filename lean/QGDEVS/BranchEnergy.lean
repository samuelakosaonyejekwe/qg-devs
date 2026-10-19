import Mathlib.Analysis.SpecialFunctions.Pow.Real
import Mathlib.Topology.Algebra.Order.Field
import Mathlib.Order.Filter.AtTopBot.Basic
import Mathlib.Tactic.FieldSimp
import Mathlib.Tactic.Positivity
import Mathlib.Tactic.Linarith

/-!
# Finiteness of the Newtonian branch energies and phases

Mirrors `qgdevs.gravity.point_potential_energy` and `qgdevs.bmv.phases_from_energies`
(static case `φ = −U t / ħ`).

On the admissible domain `r ≥ r_min > 0` (non-overlapping branches, `r_min` e.g. the sum of the
radii) the branch energy is negative and uniformly bounded, and so is the accumulated phase.
At `r → 0⁺` the point potential is unbounded below — the singularity that the admissible domain
excludes (`qgdevs.bmv.check_geometry`).
-/

open Filter Topology

namespace QGDEVS

/-- Newtonian point-mass interaction energy `U(r) = −G m_A m_B / r`. -/
noncomputable def pointEnergy (G mA mB r : ℝ) : ℝ := -(G * mA * mB) / r

/-- Static branch phase `φ = −U t / ħ`. -/
noncomputable def branchPhase (G mA mB r t hbar : ℝ) : ℝ := -(pointEnergy G mA mB r) * t / hbar

variable {G mA mB r rmin t hbar : ℝ}

/-- **BranchEnergyFinite** (sign): the branch energy is strictly negative for `r > 0`. -/
theorem pointEnergy_neg (hG : 0 < G) (hA : 0 < mA) (hB : 0 < mB) (hr : 0 < r) :
    pointEnergy G mA mB r < 0 := by
  unfold pointEnergy
  have : 0 < G * mA * mB / r := by positivity
  rw [neg_div]; linarith

/-- **BranchEnergyFinite** (uniform bound): `|U(r)| ≤ G m_A m_B / r_min` for all `r ≥ r_min > 0`. -/
theorem pointEnergy_abs_le (hG : 0 < G) (hA : 0 < mA) (hB : 0 < mB) (hmin : 0 < rmin)
    (hr : rmin ≤ r) : |pointEnergy G mA mB r| ≤ G * mA * mB / rmin := by
  have hr0 : 0 < r := lt_of_lt_of_le hmin hr
  have hneg := pointEnergy_neg hG hA hB hr0
  rw [abs_of_neg hneg, pointEnergy, neg_div, neg_neg]
  have hc : 0 < G * mA * mB := by positivity
  exact div_le_div_of_nonneg_left hc.le hmin hr

/-- **BranchEnergyFinite** (combined statement on the admissible domain `r ≥ r_min > 0`):
`−G m_A m_B / r_min ≤ U(r) < 0`. -/
theorem branchEnergy_finite (hG : 0 < G) (hA : 0 < mA) (hB : 0 < mB) (hmin : 0 < rmin)
    (hr : rmin ≤ r) :
    -(G * mA * mB / rmin) ≤ pointEnergy G mA mB r ∧ pointEnergy G mA mB r < 0 := by
  have h := pointEnergy_abs_le hG hA hB hmin hr
  exact ⟨by linarith [neg_abs_le (pointEnergy G mA mB r)],
    pointEnergy_neg hG hA hB (lt_of_lt_of_le hmin hr)⟩

/-- **BranchEnergyFinite** (phase bound): for `t ≥ 0`, `ħ > 0`, `r ≥ r_min > 0`,
`0 ≤ φ ≤ G m_A m_B t / (ħ r_min)`. -/
theorem branchPhase_bounds (hG : 0 < G) (hA : 0 < mA) (hB : 0 < mB) (hmin : 0 < rmin)
    (hr : rmin ≤ r) (ht : 0 ≤ t) (hh : 0 < hbar) :
    0 ≤ branchPhase G mA mB r t hbar ∧
      branchPhase G mA mB r t hbar ≤ G * mA * mB * t / (hbar * rmin) := by
  have hr0 : 0 < r := lt_of_lt_of_le hmin hr
  have hphase : branchPhase G mA mB r t hbar = G * mA * mB * t / (hbar * r) := by
    unfold branchPhase pointEnergy
    field_simp
  rw [hphase]
  have hc : 0 ≤ G * mA * mB * t := by positivity
  refine ⟨by positivity, ?_⟩
  exact div_le_div_of_nonneg_left hc (by positivity) (mul_le_mul_of_nonneg_left hr hh.le)

/-- Consequence for the entangling phase: if each of the four branch phases lies in `[0, B]`,
then `|Δφ| ≤ 2 B` where `Δφ = φ_LL + φ_RR − φ_LR − φ_RL`. -/
theorem entanglingPhase_abs_le {φLL φLR φRL φRR B : ℝ}
    (h1 : 0 ≤ φLL ∧ φLL ≤ B) (h2 : 0 ≤ φLR ∧ φLR ≤ B) (h3 : 0 ≤ φRL ∧ φRL ≤ B)
    (h4 : 0 ≤ φRR ∧ φRR ≤ B) : |φLL + φRR - φLR - φRL| ≤ 2 * B := by
  rw [abs_le]; constructor <;> linarith [h1.1, h1.2, h2.1, h2.2, h3.1, h3.2, h4.1, h4.2]

/-- **PointSingularity** (elementary form): the point potential is unbounded below near `0⁺`:
for every bound `M` there is `r > 0` (indeed below any `ε > 0`) with `U(r) < −M`. -/
theorem pointEnergy_unbounded_near_zero (hG : 0 < G) (hA : 0 < mA) (hB : 0 < mB) (M ε : ℝ)
    (hε : 0 < ε) : ∃ r, 0 < r ∧ r < ε ∧ pointEnergy G mA mB r < -M := by
  set c := G * mA * mB with hc
  have hc0 : 0 < c := by positivity
  -- choose r = c / (|M| + 1 + c/ε)
  set K := |M| + 1 + c / ε with hK
  have hK0 : 0 < K := by positivity
  refine ⟨c / K, by positivity, ?_, ?_⟩
  · rw [div_lt_iff₀ hK0]
    have : c / ε * ε = c := div_mul_cancel₀ c hε.ne'
    have h2 : c < (c / ε) * ε + (|M| + 1) * ε := by
      have : 0 < (|M| + 1) * ε := by positivity
      linarith
    nlinarith [this, h2]
  · unfold pointEnergy
    rw [← hc, neg_div, div_div_eq_mul_div, mul_div_assoc, mul_div_cancel₀ K hc0.ne']
    have : |M| + 1 ≤ K := by
      have : 0 ≤ c / ε := by positivity
      linarith
    linarith [le_abs_self M]

/-- **PointSingularity** (filter form): `U(r) → −∞` as `r → 0⁺`. -/
theorem pointEnergy_tendsto_atBot (hG : 0 < G) (hA : 0 < mA) (hB : 0 < mB) :
    Tendsto (fun r => pointEnergy G mA mB r) (𝓝[>] 0) atBot := by
  have hc : 0 < G * mA * mB := by positivity
  have h1 : Tendsto (fun r : ℝ => (G * mA * mB) * r⁻¹) (𝓝[>] 0) atTop :=
    tendsto_inv_nhdsGT_zero.const_mul_atTop hc
  have h2 := tendsto_neg_atTop_atBot.comp h1
  refine h2.congr' (Eventually.of_forall fun r => ?_)
  simp [pointEnergy, Function.comp, div_eq_mul_inv, neg_mul]

end QGDEVS
