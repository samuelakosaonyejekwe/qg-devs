"""Suite 3 — Quantum gravity and effective field theory (controlled low-energy approximations).

No experimentally established complete theory of quantum gravity exists; this module implements
explicitly stated, benchmarked low-energy results only, each labelled with its assumptions.

1. Linearised quantum gravity, tree level, static non-relativistic sources:
   the graviton-mediated interaction reduces to the Newtonian operator potential
   V̂ = -G m_A m_B / |x̂_A - x̂_B|  (e.g. Christodoulou et al., PRL 130, 100202 (2023);
   Bose et al. PRD 105, 106028 (2022)). This is what the BMV "quantum coherent" model uses.

2. One-loop effective-field-theory correction for two non-relativistic masses
   (Bjerrum-Bohr, Donoghue & Holstein, PRD 67, 084033 (2003), doi:10.1103/PhysRevD.67.084033):
     V(r) = -G m1 m2 / r [ 1 + 3 G (m1+m2) / (r c²) + 41 G ħ / (10 π r² c³) ].
   The second term is a classical (post-Newtonian, gauge-dependent) correction; the third is the
   genuine quantum correction. The module reports both separately.
"""
from __future__ import annotations

import numpy as np

from .constants import G, c, hbar, l_P

BDH_QUANTUM_COEFF = 41 / (10 * np.pi)


def eft_potential_terms(m1: float, m2: float, r: float) -> dict:
    newton = -G * m1 * m2 / r
    classical_corr = newton * 3 * G * (m1 + m2) / (r * c**2)
    quantum_corr = newton * BDH_QUANTUM_COEFF * G * hbar / (r**2 * c**3)
    return {
        "newtonian_J": newton,
        "classical_pn_correction_J": classical_corr,
        "quantum_one_loop_correction_J": quantum_corr,
        "quantum_relative_size": BDH_QUANTUM_COEFF * l_P**2 / r**2,
        "reference": "Bjerrum-Bohr, Donoghue & Holstein, PRD 67, 084033 (2003)",
        "validity": "r >> l_P, non-relativistic point masses, perturbative EFT below the Planck scale",
    }


def eft_branch_phase_correction(m1: float, m2: float, r: float, t: float) -> float:
    """Additional branch phase [rad] from the one-loop quantum correction over time t."""
    return -eft_potential_terms(m1, m2, r)["quantum_one_loop_correction_J"] * t / hbar


def graviton_exchange_regime_check(m: float, r: float, dx: float, t: float) -> dict:
    """Checks that the static, non-relativistic, Newtonian-limit approximation used for BMV holds.

    * light-crossing time r/c << interaction time t (retardation negligible),
    * gravitational potential |Φ|/c² << 1,
    * branch separation dx << r is NOT required, but dx < r must hold for distinct branches.
    """
    return {
        "retardation_ratio": (r / c) / t,
        "potential_over_c2": G * m / (r * c**2),
        "branch_geometry_ok": dx < r,
        "within_domain": (r / c) / t < 1e-6 and G * m / (r * c**2) < 1e-6 and dx < r,
    }
