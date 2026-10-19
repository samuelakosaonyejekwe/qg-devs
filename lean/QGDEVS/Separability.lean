import QGDEVS.DephasingThreshold
import QGDEVS.Witness
import Mathlib.Analysis.Calculus.Deriv.Slope

/-!
# Separability of the dephased BMV state and sharpness of the dephasing threshold

For equal decay exponents `x_A = x_B = x`, the dephased BMV state (`dephasedState φ x x`) is
**separable iff it is PPT iff** `2 e^{−x} |sin(Δφ/2)| ≤ 1 − e^{−2x}` (equivalently
`|sin(Δφ/2)| ≤ sinh x`). The separable decomposition is explicit. After removing the local
`Z`-phases, take Bloch vectors

  `a = (τ p, ε A, η A)`, `b = (τ p, η B, ε B)`,  `τ, ε, η ∈ {±1}`,
  `p = e^{−x}`, `A = √((1 − p²)/2)`, `B = −p sin(Δφ/2) / A`,

with weights `(1 + τ cos(Δφ/2))/8`. That is 8 product states. `a` is pure, and `‖b‖ ≤ 1` is
exactly the PPT condition.

Sharpness: for a constant entangling rate `Δφ(t) = ω t` and constant `Γ < |ω|/2`, the state is
NPT (hence entangled) at some `t > 0`. Together, `Γ ≥ |ω|/2 ⇔` separable for all `t ≥ 0`.
-/

open Matrix Complex Filter Topology
open scoped Kronecker ComplexOrder

namespace QGDEVS

open QGDEVS.Witness (IsDensity)

/-- A two-qubit matrix is separable if it is a finite convex combination of products of 2×2
density matrices. -/
def IsSeparable (ρ : Matrix Idx Idx ℂ) : Prop :=
  ∃ (ι : Type) (_ : Fintype ι) (w : ι → ℝ) (A B : ι → Matrix (Fin 2) (Fin 2) ℂ),
    (∀ k, 0 ≤ w k) ∧ ∑ k, w k = 1 ∧ (∀ k, IsDensity (A k)) ∧ (∀ k, IsDensity (B k)) ∧
      ρ = ∑ k, w k • (A k ⊗ₖ B k)

/-! ### Separable ⇒ PPT -/

lemma ptB_kronecker (A B : Matrix (Fin 2) (Fin 2) ℂ) :
    partialTransposeB (A ⊗ₖ B) = A ⊗ₖ Bᵀ := by
  ext ⟨i, j⟩ ⟨k, l⟩
  simp [partialTransposeB, kroneckerMap_apply]

lemma ptB_sum {ι : Type} [Fintype ι] (w : ι → ℝ) (M : ι → Matrix Idx Idx ℂ) :
    partialTransposeB (∑ k, w k • M k) = ∑ k, w k • partialTransposeB (M k) := by
  ext a b
  simp [partialTransposeB, Matrix.sum_apply]

lemma posSemidef_real_smul {M : Matrix Idx Idx ℂ} (hM : M.PosSemidef) {w : ℝ} (hw : 0 ≤ w) :
    (w • M).PosSemidef := by
  have : w • M = (w : ℂ) • M := by ext a b; simp [Complex.real_smul]
  rw [this]
  exact hM.smul (Complex.zero_le_real.mpr hw)

/-- **Separable ⇒ PPT** (any two-qubit matrix). -/
theorem IsSeparable.ptB_posSemidef {ρ : Matrix Idx Idx ℂ} (h : IsSeparable ρ) :
    (partialTransposeB ρ).PosSemidef := by
  obtain ⟨ι, _, w, A, B, hw, -, hA, hB, rfl⟩ := h
  rw [ptB_sum]
  refine posSemidef_sum _ (fun k _ => posSemidef_real_smul ?_ (hw k))
  rw [ptB_kronecker]
  exact (hA k).1.kronecker (hB k).1.transpose

/-! ### Bloch-vector density matrices -/

/-- `ρ(a) = ½ (1 + a·σ)`. -/
noncomputable def blochState (a : Fin 3 → ℝ) : Matrix (Fin 2) (Fin 2) ℂ :=
  !![(((1 + a 2) / 2 : ℝ) : ℂ), ((a 0 : ℝ) : ℂ) / 2 - I * ((a 1 / 2 : ℝ) : ℂ);
     ((a 0 : ℝ) : ℂ) / 2 + I * ((a 1 / 2 : ℝ) : ℂ), (((1 - a 2) / 2 : ℝ) : ℂ)]

lemma bloch_quad_nonneg (ax ay az P Q R T : ℝ) (hP : 0 ≤ P) (hQ : 0 ≤ Q)
    (hRT : R ^ 2 + T ^ 2 = P * Q) (ha : ax ^ 2 + ay ^ 2 + az ^ 2 ≤ 1) :
    0 ≤ (1 + az) * P + (1 - az) * Q + 2 * (ax * R + ay * T) := by
  have hz1 : az ^ 2 ≤ 1 := by nlinarith [sq_nonneg ax, sq_nonneg ay]
  have hz : -1 ≤ az ∧ az ≤ 1 := by constructor <;> nlinarith [sq_nonneg (az + 1), sq_nonneg (az - 1)]
  set K := ax * R + ay * T
  set L := (1 + az) * P + (1 - az) * Q
  have hK : K ^ 2 ≤ (1 - az ^ 2) * (P * Q) := by
    have hcs : K ^ 2 + (ax * T - ay * R) ^ 2 = (ax ^ 2 + ay ^ 2) * (R ^ 2 + T ^ 2) := by ring
    rw [hRT] at hcs
    have hPQ : 0 ≤ P * Q := mul_nonneg hP hQ
    nlinarith [sq_nonneg (ax * T - ay * R)]
  have hL : 0 ≤ L := by
    have : 0 ≤ 1 + az := by linarith
    have : 0 ≤ 1 - az := by linarith
    positivity
  have hL2 : 4 * K ^ 2 ≤ L ^ 2 := by
    nlinarith [sq_nonneg ((1 + az) * P - (1 - az) * Q)]
  nlinarith [sq_nonneg (L + 2 * K), sq_nonneg (L - 2 * K)]

/-- `ρ(a)` is a density matrix whenever `‖a‖ ≤ 1`. -/
theorem blochState_density (a : Fin 3 → ℝ) (ha : a 0 ^ 2 + a 1 ^ 2 + a 2 ^ 2 ≤ 1) :
    IsDensity (blochState a) := by
  refine ⟨?_, ?_⟩
  · refine posSemidef_iff_dotProduct_mulVec.mpr ⟨?_, fun x => ?_⟩
    · ext i j
      fin_cases i <;> fin_cases j <;>
        simp [blochState, Complex.ext_iff]
    · have hq : star x ⬝ᵥ (blochState a *ᵥ x) =
          ((((1 + a 2) * ((x 0).re ^ 2 + (x 0).im ^ 2) + (1 - a 2) * ((x 1).re ^ 2 + (x 1).im ^ 2) +
            2 * (a 0 * ((x 0).re * (x 1).re + (x 0).im * (x 1).im) +
              a 1 * ((x 0).re * (x 1).im - (x 0).im * (x 1).re))) / 2 : ℝ) : ℂ) := by
        simp [dotProduct, mulVec, Fin.sum_univ_two, blochState, Complex.ext_iff, pow_two]
        constructor <;> ring
      rw [hq]
      refine Complex.zero_le_real.mpr (div_nonneg ?_ (by norm_num))
      exact bloch_quad_nonneg _ _ _ _ _ _ _ (by positivity) (by positivity) (by ring) ha
  · simp [blochState, trace_fin_two]
    ring

/-! ### Unitary conjugation by local diagonal phases -/

/-- Local phase `diag(e^{i r z_0}, e^{i r z_1})`. -/
noncomputable def zPhase (r : ℝ) : Matrix (Fin 2) (Fin 2) ℂ :=
  diagonal fun i => Complex.exp (I * ((r * z i : ℝ) : ℂ))

lemma zPhase_unitary (r : ℝ) : (zPhase r)ᴴ * zPhase r = 1 := by
  rw [zPhase, diagonal_conjTranspose, diagonal_mul_diagonal, ← diagonal_one]
  congr 1
  funext i
  simp only [Pi.star_apply, star_exp_I_mul]
  rw [← Complex.exp_add, neg_add_cancel, Complex.exp_zero]

lemma density_conj {U ρ : Matrix (Fin 2) (Fin 2) ℂ} (hU : Uᴴ * U = 1) (hρ : IsDensity ρ) :
    IsDensity (U * ρ * Uᴴ) := by
  refine ⟨hρ.1.mul_mul_conjTranspose_same U, ?_⟩
  rw [trace_mul_comm, ← Matrix.mul_assoc, hU, Matrix.one_mul]
  exact hρ.2

lemma conj_sum_kron {ι : Type} [Fintype ι] (U V : Matrix (Fin 2) (Fin 2) ℂ) (w : ι → ℝ)
    (A B : ι → Matrix (Fin 2) (Fin 2) ℂ) :
    (U ⊗ₖ V) * (∑ k, w k • (A k ⊗ₖ B k)) * (U ⊗ₖ V)ᴴ =
      ∑ k, w k • ((U * A k * Uᴴ) ⊗ₖ (V * B k * Vᴴ)) := by
  rw [Finset.mul_sum, Finset.sum_mul]
  refine Finset.sum_congr rfl (fun k _ => ?_)
  rw [Matrix.mul_smul, Matrix.smul_mul, conjTranspose_kronecker, mul_kronecker_mul,
    mul_kronecker_mul]

lemma IsSeparable.conj {ρ : Matrix Idx Idx ℂ} (h : IsSeparable ρ) (r₁ r₂ : ℝ) :
    IsSeparable ((zPhase r₁ ⊗ₖ zPhase r₂) * ρ * (zPhase r₁ ⊗ₖ zPhase r₂)ᴴ) := by
  obtain ⟨ι, hι, w, A, B, hw, hsum, hA, hB, rfl⟩ := h
  exact ⟨ι, hι, w, fun k => zPhase r₁ * A k * (zPhase r₁)ᴴ, fun k => zPhase r₂ * B k * (zPhase r₂)ᴴ,
    hw, hsum, fun k => density_conj (zPhase_unitary r₁) (hA k),
    fun k => density_conj (zPhase_unitary r₂) (hB k), conj_sum_kron _ _ _ _ _⟩

/-! ### The phase-free core and its explicit separable decomposition -/

/-- `n_{ab} = (z_i z_j − z_k z_l)/2 ∈ {−1, 0, 1}` for `a = (i,j)`, `b = (k,l)`. -/
noncomputable def nIdx (a b : Idx) : ℝ := (z a.1 * z a.2 - z b.1 * z b.2) / 2

/-- Generic core: real part `¼ p^{[i≠k]} p^{[j≠l]} (1 − n² + n² c)`, imaginary part `n T / 4`. -/
noncomputable def sepCore (p c T : ℝ) : Matrix Idx Idx ℂ := fun a b =>
  ((((if a.1 = b.1 then 1 else p) * (if a.2 = b.2 then 1 else p) *
      (1 - nIdx a b ^ 2 + nIdx a b ^ 2 * c) / 4 : ℝ)) : ℂ) + I * ((nIdx a b * T / 4 : ℝ) : ℂ)

/-- Ensemble weights `(1 + τ c)/8`, indexed by `(τ, ε, η)`. -/
noncomputable def ensW (c : ℝ) (k : Fin 2 × Fin 2 × Fin 2) : ℝ := (1 + z k.1 * c) / 8

/-- Bloch vector of subsystem A: `(τ p, ε A, η A)`. -/
noncomputable def ensA (p A : ℝ) (k : Fin 2 × Fin 2 × Fin 2) : Fin 3 → ℝ :=
  ![z k.1 * p, z k.2.1 * A, z k.2.2 * A]

/-- Bloch vector of subsystem B: `(τ p, η B, ε B)`. -/
noncomputable def ensB (p B : ℝ) (k : Fin 2 × Fin 2 × Fin 2) : Fin 3 → ℝ :=
  ![z k.1 * p, z k.2.2 * B, z k.2.1 * B]

set_option maxHeartbeats 4000000 in
/-- **Explicit separable decomposition** (polynomial identity). -/
theorem ensemble_eq (p c A B : ℝ) :
    ∑ k, ensW c k • (blochState (ensA p A k) ⊗ₖ blochState (ensB p B k)) =
      sepCore p c (-(A * B)) := by
  ext ⟨i, j⟩ ⟨k, l⟩
  fin_cases i <;> fin_cases j <;> fin_cases k <;> fin_cases l <;>
    simp [Matrix.sum_apply, Fintype.sum_prod_type, Fin.sum_univ_two, kroneckerMap_apply,
      blochState, ensW, ensA, ensB, sepCore, nIdx, Complex.ext_iff, Complex.one_re,
      Complex.one_im] <;>
    norm_num <;>
    first | (constructor <;> ring) | ring

lemma z_sq (i : Fin 2) : z i ^ 2 = 1 := by fin_cases i <;> norm_num [z]

lemma nIdx_cases (a b : Idx) : nIdx a b = 0 ∨ nIdx a b = 1 ∨ nIdx a b = -1 := by
  obtain ⟨i, j⟩ := a; obtain ⟨k, l⟩ := b
  fin_cases i <;> fin_cases j <;> fin_cases k <;> fin_cases l <;> norm_num [nIdx]

lemma core_entry (c s p : ℝ) (i j k l : Fin 2) :
    (1 / 4 : ℂ) * ((((if i = k then 1 else p) * (if j = l then 1 else p) : ℝ)) : ℂ) *
        ((((1 - nIdx (i, j) (k, l) ^ 2 + nIdx (i, j) (k, l) ^ 2 * c : ℝ)) : ℂ) +
          I * ((nIdx (i, j) (k, l) * s : ℝ) : ℂ)) =
      sepCore p c (p * s) (i, j) (k, l) := by
  fin_cases i <;> fin_cases j <;> fin_cases k <;> fin_cases l <;>
    simp [sepCore, nIdx, Complex.ext_iff] <;> first | (constructor <;> ring) | ring

lemma decay_split' (x : ℝ) (i j k l : Fin 2) :
    Real.exp (-(x * neq i k) - x * neq j l) =
      (if i = k then 1 else Real.exp (-x)) * (if j = l then 1 else Real.exp (-x)) := by
  by_cases hik : i = k <;> by_cases hjl : j = l
  · subst hik; subst hjl; simp [neq]
  · subst hik; simp [neq, hjl]
  · subst hjl; simp [neq, hik]
  · simp [neq, hik, hjl]
    rw [← Real.exp_add]; ring_nf

/-- The dephased state is a local-phase conjugate of the generic core. -/
theorem dephasedState_eq_conj (φ : Idx → ℝ) (x α β γ δ : ℝ)
    (h : ∀ i j, φ (i, j) = phaseModel α β γ δ i j) :
    dephasedState φ x x =
      (zPhase β ⊗ₖ zPhase γ) *
        sepCore (Real.exp (-x)) (Real.cos (2 * δ)) (Real.exp (-x) * Real.sin (2 * δ)) *
        (zPhase β ⊗ₖ zPhase γ)ᴴ := by
  ext ⟨i, j⟩ ⟨k, l⟩
  rw [zPhase, zPhase, diagonal_kronecker_diagonal, diagonal_conjTranspose, mul_diagonal,
    diagonal_mul, ← core_entry]
  simp only [dephasedState, phaseMatrix, decayMatrix, Pi.star_apply, star_mul', star_exp_I_mul]
  rw [decay_split', h i j, h k l]
  have hm := nIdx_cases (i, j) (k, l)
  have key : Complex.exp (I * ((phaseModel α β γ δ i j - phaseModel α β γ δ k l : ℝ) : ℂ)) =
      Complex.exp (I * ((β * z i : ℝ) : ℂ)) * Complex.exp (I * ((γ * z j : ℝ) : ℂ)) *
        Complex.exp (I * ((2 * δ * nIdx (i, j) (k, l) : ℝ) : ℂ)) *
        Complex.exp (-(I * ((β * z k : ℝ) : ℂ))) * Complex.exp (-(I * ((γ * z l : ℝ) : ℂ))) := by
    simp only [← Complex.exp_add]
    congr 1
    simp only [phaseModel, nIdx]
    push_cast; ring
  rw [key, exp_I_two_mul _ _ hm]
  push_cast
  ring

/-- `2 e^{−x} sinh x = 1 − e^{−2x}`. -/
lemma two_exp_neg_mul_sinh (x : ℝ) : 2 * Real.exp (-x) * Real.sinh x = 1 - Real.exp (-x) ^ 2 := by
  rw [Real.sinh_eq]
  have : Real.exp (-x) * Real.exp x = 1 := by rw [← Real.exp_add]; simp
  nlinarith [this]

/-- **Separability of the core** under the PPT condition. -/
theorem sepCore_separable {p c s : ℝ} (hp : 0 < p) (hcs : c ^ 2 + s ^ 2 = 1)
    (hcond : 2 * p * |s| ≤ 1 - p ^ 2) : IsSeparable (sepCore p c (p * s)) := by
  have hk : 0 ≤ (1 - p ^ 2) / 2 := by have := abs_nonneg s; nlinarith
  set A := Real.sqrt ((1 - p ^ 2) / 2) with hA
  have hA2 : A ^ 2 = (1 - p ^ 2) / 2 := Real.sq_sqrt hk
  set B := -(p * s) / A with hB
  have hAB : -(A * B) = p * s := by
    by_cases h0 : A = 0
    · have h1 : 1 - p ^ 2 = 0 := by nlinarith [hA2, h0]
      have h2 : |s| = 0 := by
        have := abs_nonneg s
        nlinarith
      rw [abs_eq_zero] at h2
      simp [h0, h2]
    · rw [hB]; field_simp
  have hB2 : B ^ 2 ≤ A ^ 2 := by
    by_cases h0 : A = 0
    · simp [hB, h0]
    · have hApos : 0 < A ^ 2 := by positivity
      have hsq : (2 * p * |s|) ^ 2 ≤ (1 - p ^ 2) ^ 2 := by
        have := abs_nonneg s
        exact pow_le_pow_left₀ (by positivity) hcond 2
      have hs2 : |s| ^ 2 = s ^ 2 := sq_abs s
      have : (p * s) ^ 2 ≤ (A ^ 2) ^ 2 := by rw [hA2]; nlinarith
      rw [hB, div_pow, neg_sq, div_le_iff₀ hApos]
      nlinarith
  have hc1 : |c| ≤ 1 := by
    rw [abs_le]; constructor <;> nlinarith [sq_nonneg s, sq_nonneg (c + 1), sq_nonneg (c - 1)]
  refine ⟨Fin 2 × Fin 2 × Fin 2, inferInstance, ensW c, fun k => blochState (ensA p A k),
    fun k => blochState (ensB p B k), ?_, ?_, ?_, ?_, ?_⟩
  · rintro ⟨t, e, h⟩
    have := abs_le.mp hc1
    fin_cases t <;> simp [ensW] <;> linarith
  · simp [ensW, Fintype.sum_prod_type, Fin.sum_univ_two]; ring
  · rintro ⟨t, e, h⟩
    apply blochState_density
    simp only [ensA, Matrix.cons_val_zero, Matrix.cons_val_one, Matrix.cons_val_two,
      Matrix.head_cons, Matrix.tail_cons, mul_pow, z_sq]
    nlinarith
  · rintro ⟨t, e, h⟩
    apply blochState_density
    simp only [ensB, Matrix.cons_val_zero, Matrix.cons_val_one, Matrix.cons_val_two,
      Matrix.head_cons, Matrix.tail_cons, mul_pow, z_sq]
    nlinarith
  · rw [ensemble_eq, hAB]

/-! ### Main theorems -/

/-- **Separability criterion** for the dephased BMV state with `x_A = x_B = x`:
separable ⇔ `2 e^{−x} |sin(Δφ/2)| ≤ 1 − e^{−2x}`. -/
theorem dephasedState_separable_iff (φ : Idx → ℝ) (x : ℝ) :
    IsSeparable (dephasedState φ x x) ↔
      2 * Real.exp (-x) * |Real.sin (entanglingPhase (fun i j => φ (i, j)) / 2)| ≤
        1 - Real.exp (-x) ^ 2 := by
  constructor
  · intro h
    exact (ptB_posSemidef_iff φ x).mp h.ptB_posSemidef
  · intro hcond
    obtain ⟨⟨α, β, γ, δ⟩, hdec, -⟩ := phase_decomposition_existsUnique (fun i j => φ (i, j))
    have hδ := phase_decomposition_delta (fun i j => φ (i, j)) α β γ δ hdec
    have hΔ : entanglingPhase (fun i j => φ (i, j)) / 2 = 2 * δ := by
      simp only [entanglingPhase]; linarith
    rw [hΔ] at hcond
    rw [dephasedState_eq_conj φ x α β γ δ (fun i j => hdec i j)]
    exact (sepCore_separable (Real.exp_pos _) (Real.cos_sq_add_sin_sq _) hcond).conj β γ

/-- **PPT ⇔ separable** for the dephased BMV family (`x_A = x_B = x`, any phases). -/
theorem dephasedState_separable_iff_ppt (φ : Idx → ℝ) (x : ℝ) :
    IsSeparable (dephasedState φ x x) ↔ (partialTransposeB (dephasedState φ x x)).PosSemidef := by
  rw [dephasedState_separable_iff, ptB_posSemidef_iff]

/-- **Separability criterion, sinh form**: separable ⇔ `|sin(Δφ/2)| ≤ sinh x`. -/
theorem dephasedState_separable_iff_sinh (φ : Idx → ℝ) (x : ℝ) :
    IsSeparable (dephasedState φ x x) ↔
      |Real.sin (entanglingPhase (fun i j => φ (i, j)) / 2)| ≤ Real.sinh x := by
  rw [dephasedState_separable_iff, ← two_exp_neg_mul_sinh]
  have : 0 < 2 * Real.exp (-x) := by positivity
  exact mul_le_mul_iff_of_pos_left this

/-- **DephasingThreshold (separable form)**: under the hypotheses of `dephasing_threshold`
(`Δφ(0) = 0`, `|dΔφ/dt| ≤ 2Γ` on `t ≥ 0`), the state with `x = Γ t` is separable for all
`t ≥ 0`. -/
theorem dephasing_threshold_separable {Γ : ℝ} (φ : ℝ → Idx → ℝ) (dΔ : ℝ → ℝ)
    (hderiv : ∀ t, 0 ≤ t →
      HasDerivAt (fun τ => entanglingPhase (fun i j => φ τ (i, j))) (dΔ t) t)
    (hrate : ∀ t, 0 ≤ t → |dΔ t| ≤ 2 * Γ)
    (h0 : entanglingPhase (fun i j => φ 0 (i, j)) = 0) {t : ℝ} (ht : 0 ≤ t) :
    IsSeparable (dephasedState (φ t) (Γ * t) (Γ * t)) :=
  (dephasedState_separable_iff_ppt _ _).mpr (dephasing_threshold φ dΔ hderiv hrate h0 ht)

/-- **Sharpness**: for a constant entangling rate `Δφ(t) = ω t` and constant `Γ < |ω|/2`
there is `t > 0` at which `ρ^{T_B}` is not PSD (NPT), hence the state is entangled. -/
theorem dephasing_threshold_sharp (φ : ℝ → Idx → ℝ) {ω Γ : ℝ}
    (hΔ : ∀ t, entanglingPhase (fun i j => φ t (i, j)) = ω * t) (hΓ : Γ < |ω| / 2) :
    ∃ t > 0, ¬ (partialTransposeB (dephasedState (φ t) (Γ * t) (Γ * t))).PosSemidef ∧
      ¬ IsSeparable (dephasedState (φ t) (Γ * t) (Γ * t)) := by
  set u := |ω| / 2 with hu
  let f : ℝ → ℝ := fun t => Real.sin (u * t) - Real.sinh (Γ * t)
  have hf : HasDerivAt f (u - Γ) 0 := by
    have h1 := ((hasDerivAt_id (0 : ℝ)).const_mul u).sin
    have h2 := ((hasDerivAt_id (0 : ℝ)).const_mul Γ).sinh
    convert h1.sub h2 using 1
    · funext y; simp [f]
    · simp
  have hlim := hf.tendsto_slope_zero_right
  have hpos : (0 : ℝ) < u - Γ := by linarith
  have ev1 : ∀ᶠ t in 𝓝[>] (0 : ℝ), 0 < t⁻¹ • (f (0 + t) - f 0) :=
    hlim.eventually (lt_mem_nhds hpos)
  have ev2 : ∀ᶠ t in 𝓝[>] (0 : ℝ), 0 < t := self_mem_nhdsWithin
  obtain ⟨t, h1, ht⟩ := (ev1.and ev2).exists
  have hf0 : f 0 = 0 := by simp [f]
  rw [zero_add, hf0, sub_zero, smul_eq_mul] at h1
  have hft : 0 < f t := pos_of_mul_pos_right h1 (inv_pos.mpr ht).le
  have hsin : Real.sinh (Γ * t) < Real.sin (u * t) := by simp only [f] at hft; linarith
  have habs : |Real.sin (ω * t / 2)| = |Real.sin (u * t)| := by
    rcases le_or_gt 0 ω with hω | hω
    · rw [hu, abs_of_nonneg hω]; ring_nf
    · rw [hu, abs_of_neg hω]
      have : ω * t / 2 = -(-ω / 2 * t) := by ring
      rw [this, Real.sin_neg, abs_neg]
  have hnot : ¬ (partialTransposeB (dephasedState (φ t) (Γ * t) (Γ * t))).PosSemidef := by
    rw [ptB_posSemidef_iff, hΔ, habs, ← two_exp_neg_mul_sinh]
    intro hle
    have hp : 0 < 2 * Real.exp (-(Γ * t)) := by positivity
    have := (mul_le_mul_iff_of_pos_left hp).mp hle
    linarith [le_abs_self (Real.sin (u * t))]
  exact ⟨t, ht, hnot, fun hs => hnot hs.ptB_posSemidef⟩

/-- **Threshold is exact**: for `Δφ(t) = ω t` and constant `Γ`, the state is separable at every
`t ≥ 0` iff `Γ ≥ |ω|/2`. -/
theorem never_entangled_iff (φ : ℝ → Idx → ℝ) (ω Γ : ℝ)
    (hΔ : ∀ t, entanglingPhase (fun i j => φ t (i, j)) = ω * t) :
    (∀ t, 0 ≤ t → IsSeparable (dephasedState (φ t) (Γ * t) (Γ * t))) ↔ |ω| / 2 ≤ Γ := by
  constructor
  · intro h
    by_contra hlt
    obtain ⟨t, ht, -, hns⟩ := dephasing_threshold_sharp φ hΔ (not_le.mp hlt)
    exact hns (h t ht.le)
  · intro hΓ t ht
    have hfun : (fun τ => entanglingPhase (fun i j => φ τ (i, j))) = fun τ => ω * τ :=
      funext hΔ
    refine dephasing_threshold_separable φ (fun _ => ω) (fun s _ => ?_) (fun s _ => ?_) ?_ ht
    · rw [hfun]
      simpa using (hasDerivAt_id s).const_mul ω
    · linarith
    · rw [hΔ]; ring

end QGDEVS
