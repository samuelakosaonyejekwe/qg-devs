"""Suite 8 — Electromagnetic and environmental interaction physics (non-gravitational confounders).

These channels can generate branch-dependent phases — and therefore entanglement — without any
gravitational involvement. The competing-model engine adds them to the coherent-interaction model
to test whether an observed signal could be explained without gravity.

* Retarded Casimir–Polder interaction of two dielectric spheres (R << r, r >> material resonance
  wavelengths): U = -(23 ħ c / 4π) R_A³ R_B³ cm_A cm_B / r⁷   (Casimir & Polder 1948; as used for
  BMV in Bose et al. 2017 and van de Kamp et al., PRA 102, 062807 (2020)).
* Coulomb interaction of residual net charges; charge–induced-dipole interaction;
  permanent electric dipole–dipole interaction.
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import brentq

from .constants import hbar, c, eps0, G, e as e_charge


def casimir_polder_energy(R_A: float, R_B: float, cm_A: float, cm_B: float, r: float) -> float:
    return -23 * hbar * c / (4 * np.pi) * R_A**3 * R_B**3 * cm_A * cm_B / r**7


def coulomb_energy(q_A: float, q_B: float, r: float) -> float:
    return q_A * q_B / (4 * np.pi * eps0 * r)


def charge_induced_dipole_energy(q: float, R_other: float, cm_other: float, r: float) -> float:
    """U = -q² α / (2 (4πε0)² r⁴) with α = 4πε0 R³ cm  →  U = -q² R³ cm / (8π ε0 r⁴)."""
    return -q**2 * R_other**3 * cm_other / (8 * np.pi * eps0 * r**4)


def dipole_dipole_energy(p_A: np.ndarray, p_B: np.ndarray, r_vec: np.ndarray) -> float:
    r = np.linalg.norm(r_vec)
    n = r_vec / r
    return float((np.dot(p_A, p_B) - 3 * np.dot(p_A, n) * np.dot(p_B, n)) / (4 * np.pi * eps0 * r**3))


def branch_energies(design, cm_A: float, cm_B: float, q_A: float = 0.0, q_B: float = 0.0,
                    p_A=None, p_B=None, include: tuple[str, ...] = ("casimir", "coulomb", "induced", "dipole")):
    """Non-gravitational branch energies [J] for a BMVDesign, by channel."""
    from .bmv import branch_positions
    pos = branch_positions(design)
    out: dict[str, dict[str, float]] = {}
    for i in "LR":
        for j in "LR":
            rv = pos[f"B_{j}"] - pos[f"A_{i}"]
            r = float(np.linalg.norm(rv))
            ch = {}
            if "casimir" in include:
                ch["casimir"] = casimir_polder_energy(design.radius_A, design.radius_B, cm_A, cm_B, r)
            if "coulomb" in include:
                ch["coulomb"] = coulomb_energy(q_A, q_B, r)
            if "induced" in include:
                ch["induced"] = (charge_induced_dipole_energy(q_A, design.radius_B, cm_B, r)
                                 + charge_induced_dipole_energy(q_B, design.radius_A, cm_A, r))
            if "dipole" in include and p_A is not None and p_B is not None:
                ch["dipole"] = dipole_dipole_energy(np.asarray(p_A), np.asarray(p_B), rv)
            out[f"{i}{j}"] = ch
    return out


def total_by_branch(channels: dict[str, dict[str, float]]) -> dict[str, float]:
    return {k: float(sum(v.values())) for k, v in channels.items()}


def casimir_to_gravity_ratio(m: float, R: float, cm: float, r: float) -> float:
    return abs(casimir_polder_energy(R, R, cm, cm, r)) / (G * m * m / r)


def min_distance_for_gravity_dominance(m: float, R: float, cm: float, ratio: float = 0.1) -> float:
    """Smallest surface-independent distance r at which |U_CP| / |U_grav| ≤ ratio:
    r⁶ = 23 ħ c R⁶ cm² / (4π G m² ratio)."""
    return float((23 * hbar * c * R**6 * cm**2 / (4 * np.pi * G * m**2 * ratio)) ** (1 / 6))


def max_charge_for(design, max_delta_phi: float, cm: float) -> float:
    """Largest equal residual charge (in units of e) on both masses keeping |Δφ_Coulomb| ≤ max_delta_phi."""
    from .bmv import entangling_phase, phases_from_energies

    def dphi(n_e):
        ch = branch_energies(design, cm, cm, n_e * e_charge, n_e * e_charge, include=("coulomb", "induced"))
        return abs(entangling_phase(phases_from_energies(total_by_branch(ch), design.time))) - max_delta_phi

    if dphi(1.0) > 0:
        return 0.0
    hi = 1.0
    while dphi(hi) < 0 and hi < 1e12:
        hi *= 10
    # decide on the sign at the bracket end, not on the loop counter (a root at exactly 1e12 e is still a root)
    return float(brentq(dphi, hi / 10, hi)) if dphi(hi) >= 0 else float("inf")


# ----------------------------------------------------------------------------- further backgrounds
def patch_dipole_rms(R: float, V_rms: float, patch_size: float) -> float:
    """RMS electric dipole moment [C m] per Cartesian component of a conducting sphere whose surface carries
    N = 4πR²/ℓ² independent patches of rms potential V_rms (statistical patch model, ESTIMATED).

    Derivation: the l = 1 exterior multipole of a sphere with surface potential V(Ω) gives
    p = 4πε0 R² (3/4π) ∫ V n̂ dΩ; for independent patches of solid angle ℓ²/R² the variance of each component
    is N V_rms² ℓ⁴/(3R⁴), hence p_rms = 4πε0 R ℓ V_rms √(3/4π).
    """
    return float(4 * np.pi * eps0 * R * patch_size * V_rms * np.sqrt(3 / (4 * np.pi)))


def patch_dipole_dphi_distribution(design, V_rms: float = 0.01, patch_size: float = 1e-7, n: int = 2000,
                                   seed: int = 0) -> dict:
    """Monte-Carlo distribution of the entangling phase from random patch dipoles on both masses
    (orientations fixed during a run). Returns percentiles of |Δφ_patch| [rad]."""
    from .bmv import branch_positions, entangling_phase, phases_from_energies
    rng = np.random.default_rng(seed)
    pA0 = patch_dipole_rms(design.radius_A, V_rms, patch_size)
    pB0 = patch_dipole_rms(design.radius_B, V_rms, patch_size)
    pos = branch_positions(design)
    out = []
    for _ in range(n):
        pA, pB = rng.normal(0, pA0, 3), rng.normal(0, pB0, 3)
        E = {f"{i}{j}": dipole_dipole_energy(pA, pB, pos[f"B_{j}"] - pos[f"A_{i}"]) for i in "LR" for j in "LR"}
        out.append(abs(entangling_phase(phases_from_energies(E, design.time))))
    out = np.array(out)
    return {"p_rms_A_Cm": pA0, "median_abs_dphi_rad": float(np.median(out)),
            "p95_abs_dphi_rad": float(np.percentile(out, 95)), "V_rms_V": V_rms, "patch_size_m": patch_size,
            "status": "ESTIMATED (statistical patch model; measure V_rms and ℓ for real surfaces)"}


def diamagnetic_moment(chi: float, R: float, B: np.ndarray) -> np.ndarray:
    """Induced magnetic moment [A m²] of a weakly magnetic sphere (|χ| ≪ 1) in field B: m = χ V B / μ0."""
    from .constants import mu0
    return chi * (4 / 3 * np.pi * R**3) * np.asarray(B, float) / mu0


def magnetic_dipole_energy(mA: np.ndarray, mB: np.ndarray, r_vec: np.ndarray) -> float:
    from .constants import mu0
    r = np.linalg.norm(r_vec)
    n = r_vec / r
    return float(mu0 / (4 * np.pi * r**3) * (np.dot(mA, mB) - 3 * np.dot(mA, n) * np.dot(mB, n)))


def spin_dipolar_branch_energies(design, quant_axis=(0.0, 0.0, 1.0)) -> dict[str, float]:
    """Direct magnetic dipole–dipole coupling between the two embedded electron spins, which label the branches
    (L ↔ m_s = +½, R ↔ m_s = −½ along the quantisation axis): U_ij = (μ0/4π r_ij³)(g μ_B/2)² s_i s_j (1 − 3 cos²θ_ij),
    secular (energy-conserving) part only. Because it depends on the branch labels it is itself ENTANGLING and must be
    separated from gravity (e.g. by spin-echo refocusing or distance)."""
    from .bmv import branch_positions
    from .constants import mu0, mu_B, g_e
    pos = branch_positions(design)
    z = np.asarray(quant_axis, float) / np.linalg.norm(quant_axis)
    mu = g_e * mu_B / 2
    s = {"L": 1, "R": -1}
    out = {}
    for i in "LR":
        for j in "LR":
            rv = pos[f"B_{j}"] - pos[f"A_{i}"]
            r = np.linalg.norm(rv)
            c = np.dot(rv / r, z)
            out[f"{i}{j}"] = float(mu0 / (4 * np.pi * r**3) * mu * mu * s[i] * s[j] * (1 - 3 * c * c))
    return out


def _dphi_of(design, E: dict) -> float:
    from .bmv import entangling_phase, phases_from_energies
    return abs(entangling_phase(phases_from_energies(E, design.time)))


def max_electric_dipole(design, budget: float = 0.05) -> float:
    """Largest equal electric dipole moment [C m] on both masses (worst-case orientation over a grid of
    directions) keeping |Δφ_dipole| ≤ budget. Δφ ∝ p², so p_max = p₁ √(budget/Δφ(p₁))."""
    from .bmv import branch_positions
    pos = branch_positions(design)
    p1, worst = 1e-27, 0.0
    dirs = [np.array(v, float) for v in ((1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 0), (1, 0, 1), (0, 1, 1), (1, 1, 1))]
    for a in dirs:
        for b in dirs:
            pa, pb = p1 * a / np.linalg.norm(a), p1 * b / np.linalg.norm(b)
            E = {f"{i}{j}": dipole_dipole_energy(pa, pb, pos[f"B_{j}"] - pos[f"A_{i}"]) for i in "LR" for j in "LR"}
            worst = max(worst, _dphi_of(design, E))
    return float(p1 * np.sqrt(budget / worst)) if worst > 0 else float("inf")


def diamagnetic_branch_energies(design, chi: float, B) -> dict[str, float]:
    from .bmv import branch_positions
    pos = branch_positions(design)
    mA = diamagnetic_moment(chi, design.radius_A, B)
    mB = diamagnetic_moment(chi, design.radius_B, B)
    return {f"{i}{j}": magnetic_dipole_energy(mA, mB, pos[f"B_{j}"] - pos[f"A_{i}"]) for i in "LR" for j in "LR"}


def max_bias_field(design, chi: float, budget: float = 0.05) -> float:
    """Largest uniform field [T] (worst orientation of x, y, z) during the interaction keeping the induced
    diamagnetic dipole–dipole |Δφ| ≤ budget. Δφ ∝ B², so B_max = B₁ √(budget/Δφ(B₁))."""
    worst = max(_dphi_of(design, diamagnetic_branch_energies(design, chi, np.eye(3)[k] * 1e-3)) for k in range(3))
    return float(1e-3 * np.sqrt(budget / worst)) if worst > 0 else float("inf")
