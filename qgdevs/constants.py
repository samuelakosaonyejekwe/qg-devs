"""Physical constants with provenance.

Values are CODATA 2022 recommended values (NIST SP 961, 2024; https://physics.nist.gov/cuu/Constants/).
Exact SI-defining constants carry zero standard uncertainty. Every constant records its source so
that downstream outputs can cite the exact numerical basis of a calculation.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

CODATA_SOURCE = "CODATA 2022 (NIST, https://physics.nist.gov/cuu/Constants/)"


@dataclass(frozen=True)
class Constant:
    symbol: str
    name: str
    value: float
    unit: str
    std_uncertainty: float
    source: str = CODATA_SOURCE

    @property
    def relative_uncertainty(self) -> float:
        return self.std_uncertainty / abs(self.value) if self.value else 0.0

    def as_dict(self) -> dict:
        d = asdict(self)
        d["relative_uncertainty"] = self.relative_uncertainty
        return d


_CONSTANTS = [
    Constant("G", "Newtonian constant of gravitation", 6.67430e-11, "m^3 kg^-1 s^-2", 0.00015e-11),
    Constant("hbar", "reduced Planck constant", 1.054571817e-34, "J s", 0.0),
    Constant("h", "Planck constant", 6.62607015e-34, "J s", 0.0),
    Constant("c", "speed of light in vacuum", 299792458.0, "m s^-1", 0.0),
    Constant("k_B", "Boltzmann constant", 1.380649e-23, "J K^-1", 0.0),
    Constant("e", "elementary charge", 1.602176634e-19, "C", 0.0),
    Constant("eps0", "vacuum electric permittivity", 8.8541878188e-12, "F m^-1", 0.0000000014e-12),
    Constant("mu0", "vacuum magnetic permeability", 1.25663706127e-6, "N A^-2", 0.00000000020e-6),
    Constant("u", "atomic mass constant", 1.66053906892e-27, "kg", 0.00000000052e-27),
    Constant("m_e", "electron mass", 9.1093837139e-31, "kg", 0.0000000028e-31),
    Constant("mu_B", "Bohr magneton", 9.2740100657e-24, "J T^-1", 0.0000000029e-24),
    Constant("g_e", "electron g-factor magnitude", 2.00231930436092, "1", 0.00000000000036),
    Constant("N_A", "Avogadro constant", 6.02214076e23, "mol^-1", 0.0),
    Constant("g_n", "standard acceleration of gravity (conventional)", 9.80665, "m s^-2", 0.0,
             "CGPM 1901 conventional value"),
]

CONSTANTS: dict[str, Constant] = {c.symbol: c for c in _CONSTANTS}

G = CONSTANTS["G"].value
hbar = CONSTANTS["hbar"].value
h = CONSTANTS["h"].value
c = CONSTANTS["c"].value
k_B = CONSTANTS["k_B"].value
e = CONSTANTS["e"].value
eps0 = CONSTANTS["eps0"].value
mu0 = CONSTANTS["mu0"].value
u = CONSTANTS["u"].value
m_e = CONSTANTS["m_e"].value
mu_B = CONSTANTS["mu_B"].value
g_e = CONSTANTS["g_e"].value
N_A = CONSTANTS["N_A"].value
g_n = CONSTANTS["g_n"].value

# Derived Planck units (computed, not separately sourced)
l_P = (hbar * G / c**3) ** 0.5
m_P = (hbar * c / G) ** 0.5
t_P = l_P / c


def table() -> list[dict]:
    """All constants as serialisable records (for the API, UI and provenance records)."""
    return [c.as_dict() for c in _CONSTANTS]
