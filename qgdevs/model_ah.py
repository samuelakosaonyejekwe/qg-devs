"""CG-QFT-AH — classical gravity coupled to quantum matter fields (Aziz–Howl virtual-matter mechanism).

Primary source
    J. Aziz & R. Howl, "Classical theories of gravity produce entanglement", Nature 646, 813–817 (2025),
    doi:10.1038/s41586-025-09595-7; arXiv:2510.19714 (v1 22 Oct 2025; v3 1 Jul 2026, "Nature format").
    Equation labels below are the LaTeX labels of the arXiv source (identical formulas in v1 and v3).

Critique
    C. Marletto, J. Oppenheim, V. Vedral & E. Wilson, "Classical gravity cannot mediate entanglement",
    arXiv:2511.07348 (2025): argue that the model, under its own assumptions, produces no entanglement
    (ultra-local H_int ≈ V1+V2 together with H_0 ≈ H1+H2 on the initial subspace gives a product unitary;
    the amplitude arises from inconsistently dropping/re-introducing the (∇φ)² term), and that even if it
    did, the entanglement would be mediated by quantum matter, not by gravity.

What the paper computes (non-relativistic limit, semiclassical-Einstein sourcing)
    * Classical metric perturbation h_μν = -2Φ δ_μν / c² couples to a quantised complex scalar matter
      field φ (eq:HCQ → eq:HintNonRel):
          H_int^CG = (4/c²) ∫ d³x Φ(x) [ π π† − (m²c²/2ħ²) φ†φ ],
      with m the mass of a field quantum (an atom) and Φ the *same* c-number potential in every branch.
    * Φ is sourced by ⟨T_00⟩ (Møller–Rosenfeld), eq:semiclassicalPhi:
          Φ(x) = Φ_C1(x) + Φ_C2(x),  Φ_Cκ = ½(Φ_κL + Φ_κR),  Φ_κi = uniform-sphere potential.
    * Orders 1–3 of the Dyson series give only local phases (eq:alphaCG, eq:PsiRelativeClassicalPhase):
      the state is that of mean-field (SC-MF) gravity.
    * At 4th order a diagram with two virtual-matter propagators between the objects (Fig. 2e) gives
      the branch-dependent amplitude, eq:beta4ijFull
          β⁽⁴⁾_ij ≈ (M² t² m⁴ / (4π² ħ⁶ V²)) ( i ∫d³x ∫d³y Φ(x) Φ(y) θ_1i(x) θ_2j(y) / |x−y| )²,
      evaluated for Δx ≫ R, d_ij ≫ R as eq:betaCG
          β⁽⁴⁾_ij ≈ ( (6/25) i G² m² M³ R t / (ħ³ d_ij) )²,
      and, for d_RL ≪ Δx, ϑ := β⁽⁴⁾_RL with eq:vartheta  √ϑ = (6/25) G² m² M³ R t / (ħ³ d_RL).
    * α_ij ≈ 1 + (local terms) + β⁽⁴⁾_ij  (state eq:stateAfterG, normalised by 1/𝒩).
    * App. "Virtual matter in quantum gravity": with an operator-valued Newtonian potential the same
      process gives κ⁽⁴⁾_ij = ((24/25) i G² m² M³ R t/(ħ³ d_ij))² = 16 β⁽⁴⁾_ij; App. "Stochastic classical
      gravity" argues the Diósi–Penrose/Tilloy–Diósi class evolves with κ⁽⁴⁾ (16×) plus DP decoherence.

Implementation choices (documented in docs/AZIZ_HOWL_MODEL.md)
    * Representation "amplitude" (default, faithful to the perturbative result): branch amplitudes
      a_ij = 1 + s β⁽⁴⁾_ij with β⁽⁴⁾_ij = −X_ij² real (the (i·)² of eq:betaCG), multiplied by the mean-field
      local phases, normalised as in eq:stateAfterG.
    * Representation "phase" (interpretive alternative): exponentiate as a branch phase ϑ_ij = s X_ij²
      (the paper's Appendix refers to "the contribution iϑ_RL"). The paper does not fix the
      non-perturbative completion; both agree on the leading-order concurrence |Σ± β_ij|/2.
    * Unequal masses: eq:betaCG is stated for identical spheres. Following the structure of
      eq:beta4ijFull (one external leg of each object per propagator factor), the platform uses
      M³R → (M_A M_B)^{3/2} (R_A R_B)^{1/2}; this reduces exactly to eq:betaCG for M_A = M_B and is
      checked against direct numerical evaluation of eq:beta4ijFull (beta4_integral_mc).
"""
from __future__ import annotations

import numpy as np

from . import bmv
from .constants import G, c, hbar, u
from .nuisance import Nuisance

# --------------------------------------------------------------------------- constants / defaults
COEFF_SEMICLASSICAL = 6.0 / 25.0      # eq:betaCG / eq:vartheta
COEFF_OPERATOR_POTENTIAL = 24.0 / 25.0  # App. "Virtual matter in quantum gravity", eq:alpha4RL
CARBON12_MASS = 12.0 * u              # default field-quantum mass for the platform's diamond spheres (kg)
YTTERBIUM_MASS = 173.045 * u          # material of the paper's Fig. 4 (standard atomic weight of Yb)
PERTURBATIVE_LIMIT = 0.1              # paper: "ϑ ≈ 0.1" marks a significant effect (Fig. 4 red line)

REFERENCES = [
    "Aziz & Howl, Nature 646, 813–817 (2025), doi:10.1038/s41586-025-09595-7; arXiv:2510.19714",
    "Marletto, Oppenheim, Vedral & Wilson, 'Classical gravity cannot mediate entanglement', "
    "arXiv:2511.07348 (2025) — disputes that the model entangles at all",
    "Diósi, 'No, classical gravity does not entangle quantized matter fields', arXiv:2511.00852 (2025)",
    "Bose et al., PRL 119, 240401 (2017), doi:10.1103/PhysRevLett.119.240401 (benchmark design)",
]

META = {
    "dynamics": ("Mean-field (Møller–Rosenfeld) local phases plus the 4th-order virtual-matter amplitude "
                 "β⁽⁴⁾_ij = −s[(6/25) G² m² (M_A M_B)^{3/2} (R_A R_B)^{1/2} t/(ħ³ d_ij)]² on each branch "
                 "(Aziz–Howl eq:betaCG; m = mass of a matter-field quantum), state normalised as eq:stateAfterG"),
    "assumptions": [
        "gravitational field classical: the same c-number Φ(x) in every branch",
        "matter is a quantised (complex scalar) field; objects are N00N states of position-like wavepackets",
        "Φ sourced by ⟨T_00⟩ (semiclassical Einstein / Møller–Rosenfeld), static during the interaction",
        "free evolution H_0 contributes only a global phase (wavepackets stay fixed)",
        "gravity is the only interaction (non-gravitational branch energies added coherently, as for all models)",
    ],
    "approximations": [
        "non-relativistic matter, R ≫ ħ/(mc); Newtonian limit h_μν = −2Φδ_μν/c²",
        "delta-function (long-time) approximation of the time integrals, eq:intkandk0 (ct ≫ d, t ≫ ħ/(mc²))",
        "Δx ≫ R and d_ij ≫ R (monopole term only) in eq:betaCG",
        "4th-order Dyson truncation: valid only for |β⁽⁴⁾| ≪ 1",
        "platform extension to unequal masses: M³R → (M_A M_B)^{3/2}(R_A R_B)^{1/2}",
        "two-level branch encoding; constituent mass m = carbon-12 by default (diamond)",
    ],
    "admissible_domain": ("R ≫ ħ/(mc); c t ≫ d_ij; t ≲ 2 m R²/ħ (wavepacket non-spreading, arXiv v3 "
                          "footnotes); Δx ≫ R; d_ij ≫ R; |β⁽⁴⁾_ij| ≪ 1 — see ah_validity()"),
    "known_limits": [
        "s → 0 or m → 0 or G → 0: reduces exactly to SC-MF (no gravitational entanglement)",
        "√ϑ ∝ G² m² M³ R t ħ⁻³ d⁻¹  ⇒  ϑ ∝ G⁴ m⁴ M⁶ R² t² ħ⁻⁶ d⁻²  (QG-COH: φ ∝ G M² t ħ⁻¹ d⁻¹)",
        "d_RL = 10R: ϑ independent of the material density (Fig. 4 caption)",
        "κ⁽⁴⁾ = 16 β⁽⁴⁾ for an operator-valued Newtonian potential (paper's App.)",
        "leading-order concurrence = |β_LL + β_RR − β_LR − β_RL| / 2",
    ],
    "entangling_by_gravity": True,
    "references": REFERENCES,
    "assurance": "PARTIALLY VERIFIED",
    "status_note": (
        "Implements the paper's closed form eq:betaCG (6/25 prefactor re-derived from eq:beta4ijFull and "
        "checked numerically; Fig. 4 ϑ=0.1 line reproduced). Gaps: (i) the non-perturbative completion "
        "(amplitude vs phase) is not fixed by the paper; (ii) the platform's benchmark designs violate the "
        "paper's own validity condition t ≲ 2mR²/ħ (arXiv v3), where the v3 Gaussian free-evolution "
        "appendix gives different, regime-dependent formulas not implemented here; (iii) the mechanism is "
        "disputed (arXiv:2511.07348, arXiv:2511.00852): it may be identically zero. For the Bose et al. "
        "benchmark the predicted effect (~1e-29) is observationally indistinguishable from SC-MF."),
}

EXTRA_NUISANCE = [
    Nuisance("ah_sourcing_factor", 1.0, 16.0, 1.0, "1",
             "multiplier on β⁽⁴⁾: 1 = semiclassical-Einstein sourcing (Aziz–Howl eq:betaCG); 16 = "
             "operator-valued/stochastic (Diósi–Penrose-type) potential, κ⁽⁴⁾ = 16 β⁽⁴⁾ (paper's App.)"),
]


# --------------------------------------------------------------------------- closed form (eq:betaCG)
def ah_amplitude_root(m_A: float, R_A: float, m_B: float, R_B: float, d: float, t: float,
                      constituent_mass: float = CARBON12_MASS,
                      coefficient: float = COEFF_SEMICLASSICAL) -> float:
    """X = √|β⁽⁴⁾| = coeff · G² m² (M_A M_B)^{3/2} (R_A R_B)^{1/2} t / (ħ³ d)   [dimensionless].

    For M_A = M_B = M, R_A = R_B = R this is exactly eq:vartheta: √ϑ = (6/25) G² m² M³ R t/(ħ³ d).
    """
    return (coefficient * G**2 * constituent_mass**2 * (m_A * m_B) ** 1.5 * np.sqrt(R_A * R_B) * t
            / (hbar**3 * d))


def ah_beta4(design: bmv.BMVDesign, constituent_mass: float = CARBON12_MASS,
             sourcing_factor: float = 1.0, mass_scale: float = 1.0, t: float | None = None) -> dict[str, float]:
    """β⁽⁴⁾_ij = −s X_ij² (real, ≤ 0) for every branch pair (keys LL/LR/RL/RR, A-branch first)."""
    t = design.time if t is None else t
    mA, mB = design.mass_A * mass_scale, design.mass_B * mass_scale
    d = bmv.branch_distances(design)
    return {k: -sourcing_factor * ah_amplitude_root(mA, design.radius_A, mB, design.radius_B, r, t,
                                                     constituent_mass) ** 2
            for k, r in d.items()}


def ah_branch_phases(design: bmv.BMVDesign, constituent_mass: float = CARBON12_MASS,
                     sourcing_factor: float = 1.0, mass_scale: float = 1.0) -> dict[str, float]:
    """Virtual-matter contribution in the *phase representation*: ϑ_ij = s X_ij² [rad].

    Interpretive (the paper's App. writes the 4th-order contribution as "iϑ_RL"); only the
    combination Δϑ = ϑ_LL + ϑ_RR − ϑ_LR − ϑ_RL is entangling. The mean-field local phases are NOT
    included (see mean_field_phases).
    """
    b = ah_beta4(design, constituent_mass, sourcing_factor, mass_scale)
    return {k: -v for k, v in b.items()}


def ah_entangling_strength(design: bmv.BMVDesign, constituent_mass: float = CARBON12_MASS,
                           sourcing_factor: float = 1.0) -> float:
    """ε = |β_LL + β_RR − β_LR − β_RL|; leading-order concurrence = ε/2 (QG-COH analogue: |Δφ|)."""
    b = ah_beta4(design, constituent_mass, sourcing_factor)
    return float(abs(b["LL"] + b["RR"] - b["LR"] - b["RL"]))


def vartheta(M: float, R: float, d: float, t: float, constituent_mass: float,
             coefficient: float = COEFF_SEMICLASSICAL) -> float:
    """ϑ (eq:vartheta squared) for identical spheres."""
    return ah_amplitude_root(M, R, M, R, d, t, constituent_mass, coefficient) ** 2


def qg_phase(M: float, d: float, t: float) -> float:
    """QG-COH branch phase φ = G M² t/(ħ d) (paper eq:alphaTheta), for comparison."""
    return G * M**2 * t / (hbar * d)


# --------------------------------------------------------------------------- numerical eq:beta4ijFull
def _sphere_potential_vec(M: float, R: float, s: np.ndarray) -> np.ndarray:
    """Uniform-sphere potential (paper's Φ_κi): −GM[(3/(2R) − s²/(2R³))θ(R−s) + θ(s−R)/s]."""
    s = np.asarray(s, dtype=float)
    out = np.empty_like(s)
    inside = s < R
    out[inside] = -G * M * (1.5 / R - s[inside] ** 2 / (2 * R**3))
    out[~inside] = -G * M / s[~inside]
    return out


def semiclassical_potential(design: bmv.BMVDesign, x: np.ndarray, mass_scale: float = 1.0) -> np.ndarray:
    """eq:semiclassicalPhi: Φ = ½(Φ_AL + Φ_AR) + ½(Φ_BL + Φ_BR) at points x (shape (n, 3))."""
    p = bmv.branch_positions(design)
    mA, mB = design.mass_A * mass_scale, design.mass_B * mass_scale
    phi = np.zeros(len(x))
    for key, M, R in (("A_L", mA, design.radius_A), ("A_R", mA, design.radius_A),
                      ("B_L", mB, design.radius_B), ("B_R", mB, design.radius_B)):
        phi += 0.5 * _sphere_potential_vec(M, R, np.linalg.norm(x - p[key], axis=1))
    return phi


def _uniform_ball(n: int, R: float, rng: np.random.Generator) -> np.ndarray:
    v = rng.normal(size=(n, 3))
    v /= np.linalg.norm(v, axis=1)[:, None]
    return v * R * rng.random(n)[:, None] ** (1 / 3)


def beta4_integral_mc(design: bmv.BMVDesign, constituent_mass: float = CARBON12_MASS,
                      n: int = 200_000, seed: int = 0) -> dict[str, dict[str, float]]:
    """Monte Carlo evaluation of eq:beta4ijFull with the full semiclassical Φ of eq:semiclassicalPhi.

    Returns, per branch, X_ij = √|β⁽⁴⁾_ij| and its MC standard error. The prefactor M²/V² of
    eq:beta4ijFull is generalised to M_A M_B/(V_A V_B) (one leg of each object per propagator factor).
    """
    rng = np.random.default_rng(seed)
    p = bmv.branch_positions(design)
    VA = 4 / 3 * np.pi * design.radius_A**3
    VB = 4 / 3 * np.pi * design.radius_B**3
    pref = (np.sqrt(design.mass_A * design.mass_B) * design.time * constituent_mass**2
            / (2 * np.pi * hbar**3 * np.sqrt(VA * VB)))
    out = {}
    for i in "LR":
        x = p[f"A_{i}"] + _uniform_ball(n, design.radius_A, rng)
        phx = semiclassical_potential(design, x)
        for j in "LR":
            y = p[f"B_{j}"] + _uniform_ball(n, design.radius_B, rng)
            f = phx * semiclassical_potential(design, y) / np.linalg.norm(x - y, axis=1)
            integral = VA * VB * f.mean()
            err = VA * VB * f.std(ddof=1) / np.sqrt(n)
            out[i + j] = {"X": float(pref * integral), "X_stderr": float(pref * err)}
    return out


# --------------------------------------------------------------------------- validity
def ah_validity(design: bmv.BMVDesign, constituent_mass: float = CARBON12_MASS,
                sourcing_factor: float = 1.0) -> dict:
    """The paper's own conditions for eq:betaCG, evaluated for a design (all must hold)."""
    m, t = constituent_mass, design.time
    R = min(design.radius_A, design.radius_B)
    d = bmv.branch_distances(design)
    dmin, dmax = min(d.values()), max(d.values())
    dx = min(design.dx_A, design.dx_B)
    b = ah_beta4(design, m, sourcing_factor)
    t_spread = 2 * m * R**2 / hbar
    checks = {
        "nonrelativistic_R_gg_compton": {"value": R / (hbar / (m * c)), "required": ">> 1"},
        "long_time_ct_gg_d": {"value": c * t / dmax, "required": ">> 1"},
        "no_wavepacket_spreading_t_le_2mR2_over_hbar": {"value": t / t_spread, "required": "<~ 1",
                                                        "t_limit_s": t_spread},
        "superposition_gg_R": {"value": dx / R, "required": ">> 1"},
        "separation_gg_R": {"value": dmin / R, "required": ">> 1"},
        "perturbative_max_abs_beta4": {"value": max(abs(v) for v in b.values()),
                                       "required": f"<< 1 (paper: significant at {PERTURBATIVE_LIMIT})"},
        "equal_masses_as_in_paper": {"value": design.mass_A / design.mass_B, "required": "= 1"},
    }
    ok = {
        "nonrelativistic_R_gg_compton": checks["nonrelativistic_R_gg_compton"]["value"] > 1e3,
        "long_time_ct_gg_d": checks["long_time_ct_gg_d"]["value"] > 1e3,
        "no_wavepacket_spreading_t_le_2mR2_over_hbar": checks["no_wavepacket_spreading_t_le_2mR2_over_hbar"]["value"] <= 1.0,
        "superposition_gg_R": checks["superposition_gg_R"]["value"] > 10,
        "separation_gg_R": checks["separation_gg_R"]["value"] > 10,
        "perturbative_max_abs_beta4": checks["perturbative_max_abs_beta4"]["value"] < PERTURBATIVE_LIMIT,
        "equal_masses_as_in_paper": abs(checks["equal_masses_as_in_paper"]["value"] - 1) < 1e-9,
    }
    for k in checks:
        checks[k]["satisfied"] = bool(ok[k])
    return {"checks": checks, "all_satisfied": bool(all(ok.values())),
            "violated": [k for k, v in ok.items() if not v]}


# --------------------------------------------------------------------------- state
def mean_field_energies(sc, mass_scale: float = 1.0) -> dict[str, float]:
    """Orders 1–3 (eq:alphaCG): each mass sees the branch-averaged classical potential of the other.

    Identical to the platform's SC-MF construction; self-potential terms are branch-independent.
    """
    Eg = sc.grav_energies(mass_scale)
    UA = {i: 0.5 * (Eg[i + "L"] + Eg[i + "R"]) for i in "LR"}
    UB = {j: 0.5 * (Eg["L" + j] + Eg["R" + j]) for j in "LR"}
    return {k: UA[k[0]] + UB[k[1]] for k in bmv.BRANCH_LABELS}


def ah_state(sc, eta: dict, representation: str = "amplitude",
             constituent_mass: float | None = None) -> np.ndarray:
    """4×4 density matrix (basis |LL>,|LR>,|RL>,|RR>) with models.Hypothesis.state semantics.

    eta: env_decoherence_scale, mass_scale, local_phase_A, local_phase_B, ah_sourcing_factor
    (optional: ah_constituent_mass_kg). Non-gravitational energies are added coherently and
    environmental dephasing is applied exactly as in bmv.joint_state.
    """
    d = sc.design
    t = d.time
    m = constituent_mass if constituent_mass is not None else eta.get("ah_constituent_mass_kg", CARBON12_MASS)
    s = eta.get("ah_sourcing_factor", 1.0)
    ms = eta.get("mass_scale", 1.0)
    E = mean_field_energies(sc, ms)
    E = {k: E[k] + sc.nongrav_energies.get(k, 0.0) for k in bmv.BRANCH_LABELS}
    ph = bmv.phases_from_energies(E, t)
    a, b = eta.get("local_phase_A", 0.0), eta.get("local_phase_B", 0.0)
    ph = {k: v + a * bmv.Z_SIGN[k[0]] + b * bmv.Z_SIGN[k[1]] for k, v in ph.items()}
    beta = ah_beta4(d, m, s, ms)
    if representation == "amplitude":
        amp = np.array([(1.0 + beta[k]) * np.exp(1j * ph[k]) for k in bmv.BRANCH_LABELS])
    elif representation == "phase":
        amp = np.array([np.exp(1j * (ph[k] - beta[k])) for k in bmv.BRANCH_LABELS])
    else:
        raise ValueError(f"unknown representation '{representation}'")
    nrm = np.linalg.norm(amp)
    if nrm == 0:
        raise ValueError("all branch amplitudes vanish: far outside the perturbative domain")
    psi = amp / nrm
    rho = np.outer(psi, psi.conj())
    s_env = eta.get("env_decoherence_scale", 1.0)
    dA, dB = sc.gamma_env_A * s_env * t, sc.gamma_env_B * s_env * t
    ia = np.array([0, 0, 1, 1])
    ib = np.array([0, 1, 0, 1])
    rho *= np.exp(-dA * (ia[:, None] != ia[None, :]))
    rho *= np.exp(-dB * (ib[:, None] != ib[None, :]))
    return rho


def ah_state_phase(sc, eta: dict) -> np.ndarray:
    """Phase-representation variant of ah_state (for sensitivity studies)."""
    return ah_state(sc, eta, representation="phase")


def benchmark_comparison(design: bmv.BMVDesign | None = None,
                         constituent_mass: float = CARBON12_MASS) -> dict:
    """AH vs QG-COH entangling strength for a design (default: Bose et al. 2017 linear benchmark)."""
    design = design or bmv.BMVDesign(geometry="linear")
    d = bmv.branch_distances(design)
    dphi = bmv.entangling_phase(bmv.phases_from_energies(bmv.gravitational_branch_energies(design), design.time))
    X = {k: ah_amplitude_root(design.mass_A, design.radius_A, design.mass_B, design.radius_B, r,
                              design.time, constituent_mass) for k, r in d.items()}
    eps = ah_entangling_strength(design, constituent_mass)
    eps16 = ah_entangling_strength(design, constituent_mass, 16.0)
    kmin = min(d, key=d.get)
    return {
        "branch_distances_m": d,
        "qg_delta_phi_rad": float(dphi),
        "qg_concurrence": float(abs(np.sin(dphi / 2))),
        "ah_X_ij": X,
        "ah_vartheta_closest_pair": float(X[kmin] ** 2),
        "qg_phi_closest_pair_rad": float(qg_phase(np.sqrt(design.mass_A * design.mass_B), d[kmin], design.time)),
        "ah_entangling_strength": eps,
        "ah_entangling_strength_x16": eps16,
        "ah_leading_order_concurrence": eps / 2,
        "ratio_ah_to_qg_entangling": float(eps / abs(dphi)) if dphi else float("inf"),
        "validity": ah_validity(design, constituent_mass),
    }
