# CG-QFT-AH: classical gravity coupled to quantum matter fields (Aziz–Howl mechanism)

Module: `qgdevs/model_ah.py` · Tests: `tests/test_model_ah.py` (24 tests) · Assurance: **PARTIALLY VERIFIED**

## 1. Sources

| Role | Reference | Text used |
|---|---|---|
| Primary | J. Aziz & R. Howl, *Classical theories of gravity produce entanglement*, Nature **646**, 813–817 (2025), doi:10.1038/s41586-025-09595-7 | arXiv:2510.19714, LaTeX source of v3 (1 Jul 2026, "Nature format", which includes the Supplementary Information) and v1 (22 Oct 2025) |
| Critique | C. Marletto, J. Oppenheim, V. Vedral & E. Wilson, *Classical gravity cannot mediate entanglement*, arXiv:2511.07348 (2025) | LaTeX source of v1 |
| Related critique (not analysed in detail) | L. Diósi, arXiv:2511.00852 (2025): an exact Heisenberg-picture treatment finds no entanglement | abstract only |

The Nature page is paywalled, so all formulas below come from the arXiv source. Equations are cited by
their **LaTeX labels** (for example `eq:betaCG`), because the arXiv PDF and the Nature version number
them differently. The key formulas (`eq:betaCG`, `eq:vartheta`, the 24/25 operator-potential variant)
are the same in v1 and v3. v3 adds the validity condition `t ≲ 2mR²/ħ` (footnotes `fn10` and `fn15`)
and an extended appendix on Gaussian wavepackets with free evolution.

## 2. Physical setup (paper §"Experiment")

- Two uniform spheres, each with mass M and radius R. Each is placed in a superposition of two
  locations separated by Δx, as N00N states of N atoms with atomic mass m (M = Nm). The spin-tagged
  Stern–Gerlach version (Bose et al. 2017) is used. Branch distances are d_ij, with the closest pair
  being d_RL.
- Matter is a **massive complex scalar quantum field** φ̂. The atoms are position-like wavepackets
  φ̃_κi = θ_κi/√V, with V = 4πR³/3 (`eq:Nstate`).
- **Classical gravity** is linearised GR with a **c-number** metric perturbation coupled to the quantised
  matter stress tensor (`eq:HCQ`):

  > Ĥ^CG_int = −½ ∫ d³x h^{μν}(x) T̂_{μν}(x)

  In the Newtonian limit, h_μν = −2Φ δ_μν/c² (`eq:HintNonRel`):

  > Ĥ^CG_int = (4/c²) ∫ d³x Φ(x) ( π̂ π̂† − (m²c²/2ħ²) φ̂†φ̂ )

  Here **Φ takes the same value in every branch**. That is what "classical" means in the paper.
- **Sourcing** of Φ (semiclassical Einstein / Møller–Rosenfeld, `eq:semiclassicalPhi`):
  Φ = Φ_C1 + Φ_C2, with Φ_Cκ = ½(Φ_κL + Φ_κR), where Φ_κi is the uniform-sphere potential.
- **Comparison (QG):** in perturbative quantum gravity the branch phase is (`eq:alphaTheta`)
  φ_ij = G M² t /(ħ d_ij), and φ := φ_RL.

## 3. How entanglement arises (paper §"Classical gravity")

1. **Dyson orders 1–3.** The amplitudes factorise: α_ij = 1 − i(φ_1i + φ_2j) − ½(φ_1i + φ_2j)² (`eq:alphaCG`),
   with φ_κi = (M t/ħV) ∫ θ_κi Φ (`eq:phiki`). This is a **product state** (`eq:PsiRelativeClassicalPhase`),
   the same as mean-field gravity (the platform's SC-MF).
2. **Dyson order 4.** The diagram in Fig. 2e has **two virtual-matter propagators** running between the
   objects, with four classical-potential insertions. Its amplitude (`eq:beta4ijFull`) is

   > β⁽⁴⁾_ij ≈ (M² t² m⁴ / (4π² ħ⁶ V²)) ( i ∫d³x ∫d³y Φ(x) Φ(y) θ_1i(x) θ_2j(y) / |x − y| )²

   The 1/|x − y| comes from the massive matter propagator, taken on its resonance k⁰ = mc/ħ through the
   delta-function (long-time) approximation in `eq:virtialdecay2`–`eq:intkandk0`. Because x lies in
   object 1i and y in object 2j, the amplitude depends on the branch, even though Φ does not.
3. **Closed form** (Δx ≫ R, d_ij ≫ R, `eq:betaCG`, `eq:vartheta`):

   > β⁽⁴⁾_ij ≈ ( (6/25) · i G² m² M³ R t / (ħ³ d_ij) )²,  ϑ := β⁽⁴⁾_RL,  √ϑ = (6/25) G² m² M³ R t / (ħ³ d_RL)

   The state is eq:stateAfterG with α_RL containing ϑ, normalised by 1/𝒩.
4. **Operator-valued potential (App. "Virtual matter in quantum gravity", `eq:alpha4RL`).**
   κ⁽⁴⁾_ij = ((24/25) i G² m² M³ R t/(ħ³ d_ij))² = 16 β⁽⁴⁾_ij. App. "Stochastic classical gravity" argues
   that Diósi–Penrose / Tilloy–Diósi-type classical gravity evolves with κ⁽⁴⁾ plus DP decoherence. In that
   class, entanglement survives when |κ⁽⁴⁾_RL| ≫ σ_G = E_G t.

**Derivation check (done here).** For d ≫ R and Δx ≫ R, Φ inside sphere 1i is dominated by half its own
interior potential, so ∫ Φ θ_1i d³x = −(4π/5) G M R². By the shell theorem the double integral is
(16π²/25) G² M² R⁴ / d_ij. Inserting this into `eq:beta4ijFull` with V = 4πR³/3 gives exactly 6/25.
Monte Carlo evaluation of `eq:beta4ijFull` with the full Φ of `eq:semiclassicalPhi`
(`beta4_integral_mc`) converges to this value. It agrees to < 2·10⁻³ at R/d ~ 2·10⁻⁵, and to 1–15 %
when R/Δx ~ 0.004–0.04.

**Scalings.** For identical spheres:

| Quantity | AH (`eq:vartheta`, squared) | QG-COH (`eq:alphaTheta`) |
|---|---|---|
| Mass of the objects | ϑ ∝ M⁶ R² (∝ M^{20/3} at fixed density) | φ ∝ M² |
| Interaction time | t² | t |
| Separation | d⁻² | d⁻¹ |
| ħ | ħ⁻⁶ | ħ⁻¹ |
| G | G⁴ | G¹ |
| Constituent (field-quantum) mass m | **m⁴** | none |

The ratio is ϑ/φ = (36/625) G³ m⁴ M⁴ R² t / (ħ⁵ d_RL).

**Regime of validity stated by the paper:**
- R ≫ ħ/(mc);
- c t ≫ d_ij and t ≫ ħ/(mc²);
- **t ≲ 2mR²/ħ**, so that the single-atom wavepackets do not spread (v3 `fn10`, `fn15`);
- Δx ≫ R and d_ij ≫ R;
- static Φ;
- perturbative |β⁽⁴⁾| ≪ 1 (the paper treats ϑ ≈ 0.1 as "significant").

The v3 Gaussian appendix (`eq:beta210`, `eq:beta210Long`, `eq:beta00`) shows that **outside t ≲ 2mR²/ħ**
(α = ħt/m ≫ σ²) the amplitude changes qualitatively. It scales as α⁵/d⁸, with exponential factors
e^{−σ_L²d²/(2α²)} and oscillations e^{id²/2α}. Those regime-dependent formulas are **not implemented**.

## 4. The dispute (arXiv:2511.07348, Marletto–Oppenheim–Vedral–Wilson)

- **Disputed assumption 1: consistency of the matter propagator.** In the non-relativistic limit
  H_int ≈ V₁ + V₂ is ultra-local. AH also need H_0 ≈ H₁ + H₂ on the initial subspace, because the
  wavepackets must be approximate product eigenstates that acquire only a global phase (`eq:globalphase`).
  Taken together, these generate a **product unitary**. According to MOVW, the 1/|x − y| amplitude
  appears only because the (∇φ̂)² momentum term is dropped in Eq. 23 but reinstated in the propagator
  (Eq. 63), and because the mass-shell momentum k⁰ = mc/ħ is supplied by neither the particles nor the
  static potential. With the correct non-relativistic propagator they find δ(x − y), so the amplitude is
  **zero** for non-overlapping wavepackets.
- **Disputed assumption 2: the criterion for gravity being "responsible".** "No entanglement until H_int is
  switched on" cannot tell mediation apart from a quantum matter–matter interaction that a classical
  field merely triggers. Even if the effect existed, the mediator would be quantum matter, not gravity.
  On this view, gravitationally mediated entanglement remains a witness of quantum gravity.
- **Perturbative artefact.** Truncating the expansion of a product unitary at 4th order can mimic
  entanglement. MOVW give an explicit qubit example.
- **Effect on the predicted observable.** If MOVW are right, **AH predicts exactly zero gravitational
  entanglement**, so CG-QFT-AH coincides with SC-MF. If AH are right, the observable is the small
  amplitude above. In the platform, `ah_sourcing_factor` cannot reach 0 (range [1, 16]). The MOVW outcome
  is therefore represented by the existing SC-MF hypothesis, not by a nuisance setting of this model.

## 5. Implementation choices

- **Dynamics.** The state is built in two steps:
  - Mean-field local phases, exactly as in SC-MF, from orders 1–3 (`eq:alphaCG`).
  - Then, for each branch, the 4th-order amplitude β⁽⁴⁾_ij = −s X_ij², with
    X_ij = (6/25) G² m² (M_A M_B)^{3/2} (R_A R_B)^{1/2} t/(ħ³ d_ij).
  - Non-gravitational energies are added coherently. Environmental dephasing is applied exactly as in
    `bmv.joint_state`.
- **Representation `amplitude` (default).** a_ij = (1 + β⁽⁴⁾_ij) e^{iφ_ij}, normalised as in `eq:stateAfterG`.
  This is the paper's perturbative result as written.
- **Representation `phase`.** e^{i(φ_ij + s X_ij²)}. This follows the "contribution iϑ_RL" wording in the
  paper's appendix.
  - The paper does **not** fix the non-perturbative completion. The two representations agree on the
    leading-order concurrence |β_LL + β_RR − β_LR − β_RL|/2 (tested to 5 %).
  - They differ in the Z-basis populations: under `amplitude` these move at O(ϑ).
- **Unequal masses.** `eq:betaCG` is given only for identical spheres. M³R → (M_A M_B)^{3/2}(R_A R_B)^{1/2}
  follows the structure of `eq:beta4ijFull`: each factor β carries one external leg of each object. The
  prefactor becomes M_A M_B/(V_A V_B), and ∫Φθ_κ ∝ M_κ R_κ². This is a **platform extension**,
  checked numerically against `eq:beta4ijFull`.
- **Constituent mass.** m defaults to carbon-12 (diamond, matching `BMVDesign.density = 3510`). It can be
  overridden with `eta["ah_constituent_mass_kg"]`.
- **Model-specific nuisance.** `ah_sourcing_factor` ∈ [1, 16], nominal 1:
  - 1 is semiclassical-Einstein sourcing (`eq:betaCG`);
  - 16 is the operator-valued or stochastic potential factor reported by the paper.
- **Validity.** `ah_validity(design)` evaluates every condition in §3 and reports violations. `state()`
  does not raise outside this domain, so the discrimination engine can still run; the flags must be
  reported alongside any result.

## 6. Quantitative comparison: Bose et al. 2017 benchmark (`bmv.BMVDesign(geometry="linear")`)

**Design:** M = 10⁻¹⁴ kg diamond, R = 0.879 µm, separation 450 µm, Δx = 250 µm, linear geometry,
t = 2.5 s, m = ¹²C. Branch distances: LL = RR = 450 µm, LR = 200 µm (closest), RL = 700 µm.

| Quantity | QG-COH | CG-QFT-AH (s = 1) | CG-QFT-AH (s = 16) |
|---|---|---|---|
| Closest-pair parameter | φ_LR = 0.791 rad | ϑ_LR = X² = 1.58 × 10⁻²⁹ | 2.5 × 10⁻²⁸ |
| Entangling strength | \|Δφ\| = 0.314 rad | ε = 1.09 × 10⁻²⁹ | 1.74 × 10⁻²⁸ |
| Concurrence | 0.156 | 5.4 × 10⁻³⁰ (leading order) | 8.7 × 10⁻²⁹ |
| Ratio AH / QG | — | 3.5 × 10⁻²⁹ | 5.5 × 10⁻²⁸ |

**Validity.** The paper's own condition t ≲ 2mR²/ħ = 2.9 × 10⁻⁴ s is **violated by a factor of 8.6 × 10³**.
The closed form is therefore outside its stated domain for this design. In the v3 Gaussian analysis the
relevant parameters would be α ≫ σ² and α ≫ σd. All other conditions hold.

**Discrimination engine** (tomography, 1 % readout error, robust over all nuisance):

| True model | Alternative | Divergence D per shot | Result |
|---|---|---|---|
| CG-QFT-AH | SC-MF | 0 | **indistinguishable**; the states agree to double precision |
| CG-QFT-AH | QG-COH | 3.6 × 10⁻³ | distinguishable with ≈155 shots per setting (same as SC-MF vs QG-COH) |
| QG-COH | CG-QFT-AH | 5.3 × 10⁻³ | distinguishable with ≈104 shots per setting |

**Conclusion for the benchmark.**
- The AH effect is 29 orders of magnitude below QG-COH. Observing the QG-COH-level entanglement
  (C ≈ 0.16, CPK witness −0.31) would therefore exclude CG-QFT-AH at this design, as it does SC-MF.
- AH cannot be told apart from mean-field gravity here. This matches the paper's own statement that
  the mechanism is "not an issue for near-future experiments like [Bose et al.]".

### Where the two become comparable, and which observables separate them

- **Same Bose geometry, varying only M.** The ratio ε_AH/|Δφ_QG| grows as M^{14/3}. It is 7.5 × 10⁻²⁰ at
  10⁻¹² kg, 1.6 × 10⁻¹⁰ at 10⁻¹⁰ kg and 0.35 at 10⁻⁸ kg. The heavier cases leave the AH domain
  (R ≈ Δx, non-perturbative).
- **Fig. 4 ϑ = 0.1 line (ytterbium, d = 10R).** It runs along M ∝ t^{−1/3}. It passes through M ≈ 3 × 10⁻¹¹ kg
  at t = 1 s and M ≈ 3 × 10⁻⁶ kg at t = 10⁻¹⁵ s; this was reproduced to 0.08 dex from the published figure.
- **A design inside every one of the paper's conditions where AH is resolvable.** M = 10⁻⁹ kg,
  Δx = 2 mm, separation 4 mm, linear geometry, t = 20 ms. The results:
  - ε_AH = 1.3 × 10⁻², with AH concurrence 6.8 × 10⁻³.
  - AH vs SC-MF needs ≈1.6 × 10⁴ shots per setting.
  - QG-COH would give |Δφ| ≈ 2 × 10⁶ rad, so it is still trivially distinguishable.

**Observables that distinguish AH from QG-COH** (and from SC-MF):

1. **Magnitude scaling:** ϑ ∝ M⁶R²t²/d² against φ ∝ M²t/d. Doubling t multiplies the AH entangling
   strength by 4 and the QG phase by 2. Doubling d divides them by 4 and 2 respectively.
2. **Constituent-mass (material/isotope) dependence:** ϑ ∝ m⁴ at fixed M, R and geometry. QG-COH depends
   only on M. A ¹²C → ¹³C change at fixed M would alter the AH signal by (13/12)⁴ = 1.38 and leave QG-COH
   unchanged. This is the cleanest discriminator of mechanism.
3. **ħ dependence:** ħ⁻⁶ against ħ⁻¹. This is not experimentally variable, but it means the AH effect has no
   classical-force counterpart. QG-COH's mean phases do (the Newtonian force).
4. **Character of the correlation:**
   - QG-COH produces a pure ZZ phase, so the populations stay ¼ each.
   - The AH amplitude (default representation) shifts the Z-basis branch populations at O(ϑ).
   - With the protocol frame calibrated on Newtonian local phases, the CPK witness certifies QG-COH but
     not the AH state (+1 × 10⁻⁴ in the Planck-regime design), whereas PPT/negativity does.
   - Caveat: this signature depends on the representation, which is not fixed by the paper.
5. **No standard decoherence suppression:** the paper argues the virtual-matter amplitude survives
   Diósi–Penrose-type decoherence when |κ⁽⁴⁾| ≫ E_G t.

## 7. What could not be verified

- **The non-perturbative completion** of the 4th-order amplitude (amplitude vs phase, and the sign of
  β⁽⁴⁾ = (i√ϑ)² = −ϑ against the text's "√ϑ" and "iϑ"). The paper is internally ambiguous. Both
  representations are implemented; they agree at leading order.
- **The appendix claim** "|κ⁽⁴⁾_RL| > σ_G for t > ≈ 10⁻¹⁹ s" (ytterbium, M = 10 mg, d_RL = 10R). Using the
  paper's κ⁽⁴⁾ and E_G = 6GM²/(5R) (ρ_Yb = 6.9 g cm⁻³) gives t ≈ 1.2 × 10⁻¹⁶ s. Not reproduced: the
  discrepancy is ≈10³ and its origin is unknown.
- **The small-superposition statement** "ϑ̄/φ̄ is identical to ϑ/φ" with ϑ̄ = ϑΔx²/d². Applying `eq:betaCG`
  branch by branch gives the same Δx²/d² scaling but an O(1) geometric factor: 3 (linear) or 2
  (parallel), because ϑ ∝ d⁻² while φ ∝ d⁻¹. This is tested.
- **Regimes beyond t ≲ 2mR²/ħ.** The v3 Gaussian free-evolution formulas are not implemented. They
  involve extra assumptions (σ_L vs σ, wavepacket aspect ratio δ) that the platform design does not
  specify. For the benchmark design the implemented closed form is outside its stated domain. The
  predicted magnitude there is not a faithful AH prediction; it is only an extrapolation of
  `eq:betaCG`.
- **Physical reality of the effect.** It is disputed (MOVW arXiv:2511.07348, Diósi arXiv:2511.00852,
  Tang et al. arXiv:2512.13675). The last of these argues that bound matter suppresses the effect
  exponentially at macroscopic separations. For an atom bound in a diamond lattice, the free-field
  wavepacket assumption is not established.
