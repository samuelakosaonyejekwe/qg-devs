"""Dimensional analysis in the SI base (kg, m, s, A, K, mol, cd).

A `Dim` is an exponent vector over the seven SI base dimensions. Quantities flowing through
configuration validation and the hypothesis-discovery engine are checked with it so that
dimensionally inconsistent inputs or candidate laws are rejected before any computation.
"""
from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction

BASE = ("kg", "m", "s", "A", "K", "mol", "cd")


@dataclass(frozen=True)
class Dim:
    exps: tuple[Fraction, ...] = tuple(Fraction(0) for _ in BASE)

    @staticmethod
    def of(**kw) -> "Dim":
        return Dim(tuple(Fraction(kw.get(b, 0)) for b in BASE))

    def __mul__(self, o: "Dim") -> "Dim":
        return Dim(tuple(a + b for a, b in zip(self.exps, o.exps)))

    def __truediv__(self, o: "Dim") -> "Dim":
        return Dim(tuple(a - b for a, b in zip(self.exps, o.exps)))

    def __pow__(self, p) -> "Dim":
        p = Fraction(p).limit_denominator(1000)
        return Dim(tuple(a * p for a in self.exps))

    @property
    def dimensionless(self) -> bool:
        return all(x == 0 for x in self.exps)

    def __str__(self) -> str:
        parts = [f"{b}^{x}" if x != 1 else b for b, x in zip(BASE, self.exps) if x != 0]
        return " ".join(parts) if parts else "1"


ONE = Dim.of()
MASS = Dim.of(kg=1)
LENGTH = Dim.of(m=1)
TIME = Dim.of(s=1)
TEMPERATURE = Dim.of(K=1)
CURRENT = Dim.of(A=1)
ENERGY = Dim.of(kg=1, m=2, s=-2)
ACTION = ENERGY * TIME
PRESSURE = Dim.of(kg=1, m=-1, s=-2)
RATE = Dim.of(s=-1)
CHARGE = Dim.of(A=1, s=1)
VELOCITY = LENGTH / TIME
DENSITY = MASS / LENGTH**3
G_DIM = Dim.of(m=3, kg=-1, s=-2)
EPS0_DIM = Dim.of(kg=-1, m=-3, s=4, A=2)
MAGNETIC_FIELD = Dim.of(kg=1, s=-2, A=-1)

# Dimensions of every named configuration quantity used by the platform.
QUANTITY_DIMS: dict[str, Dim] = {
    "mass": MASS, "radius": LENGTH, "separation": LENGTH, "branch_separation": LENGTH,
    "gap": LENGTH, "time": TIME, "interaction_time": TIME, "temperature": TEMPERATURE,
    "pressure": PRESSURE, "density": DENSITY, "charge": CHARGE, "rate": RATE,
    "energy": ENERGY, "phase": ONE, "G": G_DIM, "hbar": ACTION, "c": VELOCITY,
    "k_B": ENERGY / TEMPERATURE, "eps0": EPS0_DIM, "magnetic_field": MAGNETIC_FIELD,
    "magnetic_gradient": MAGNETIC_FIELD / LENGTH, "frequency": RATE,
}

UNIT_SCALE = {
    # length
    "m": ("separation", 1.0), "mm": ("separation", 1e-3), "um": ("separation", 1e-6),
    "µm": ("separation", 1e-6), "μm": ("separation", 1e-6), "micrometre": ("separation", 1e-6),
    "micrometer": ("separation", 1e-6), "micron": ("separation", 1e-6), "nm": ("separation", 1e-9),
    "cm": ("separation", 1e-2),
    # mass
    "kg": ("mass", 1.0), "g": ("mass", 1e-3), "mg": ("mass", 1e-6), "ug": ("mass", 1e-9),
    "µg": ("mass", 1e-9), "ng": ("mass", 1e-12), "pg": ("mass", 1e-15), "fg": ("mass", 1e-18),
    "amu": ("mass", 1.66053906892e-27), "u": ("mass", 1.66053906892e-27),
    # time
    "s": ("time", 1.0), "ms": ("time", 1e-3), "us": ("time", 1e-6), "µs": ("time", 1e-6),
    "ns": ("time", 1e-9), "min": ("time", 60.0), "second": ("time", 1.0), "seconds": ("time", 1.0),
    # temperature
    "K": ("temperature", 1.0), "mK": ("temperature", 1e-3), "uK": ("temperature", 1e-6),
    "µK": ("temperature", 1e-6),
    # pressure
    "Pa": ("pressure", 1.0), "mbar": ("pressure", 100.0), "bar": ("pressure", 1e5),
    "Torr": ("pressure", 133.322368), "torr": ("pressure", 133.322368),
}


def to_si(value: float, unit: str) -> tuple[float, str]:
    """Convert a value in a supported unit to SI. Returns (si_value, quantity_kind)."""
    if unit not in UNIT_SCALE:
        raise ValueError(f"unsupported unit '{unit}'")
    kind, scale = UNIT_SCALE[unit]
    return value * scale, kind


def monomial_dim(exponents: dict[str, float]) -> Dim:
    """Dimension of a power-law monomial  prod_i q_i^{e_i}  over named quantities."""
    d = ONE
    for name, ex in exponents.items():
        d = d * QUANTITY_DIMS[name] ** ex
    return d
