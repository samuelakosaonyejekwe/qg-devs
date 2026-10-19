"""Material properties used by apparatus, decoherence and background-force models.

Each value carries a provenance status. "handbook" values are standard room-temperature reference
figures; "estimate" values (notably the imaginary permittivity at thermal-infrared frequencies, which
controls black-body emission/absorption decoherence) vary strongly between samples and must be
replaced by measured values for a real apparatus before any feasibility claim is made.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class Material:
    key: str
    name: str
    density: float                 # kg m^-3
    eps_real: float                # static/IR relative permittivity (real part)
    eps_imag: float                # thermal-IR imaginary permittivity
    magnetic_susceptibility: float  # SI volume susceptibility (dimensionless)
    notes: str
    status: dict

    def clausius_mossotti(self) -> complex:
        eps = complex(self.eps_real, self.eps_imag)
        return (eps - 1) / (eps + 2)

    def as_dict(self) -> dict:
        d = asdict(self)
        cm = self.clausius_mossotti()
        d["clausius_mossotti"] = {"re": cm.real, "im": cm.imag}
        return d


MATERIALS: dict[str, Material] = {m.key: m for m in [
    Material("diamond", "Diamond (single-crystal, with NV centre for spin readout)", 3510.0, 5.7, 0.0,
             -2.2e-5,
             "Spin-embedded mass in the original BMV proposal. Low IR absorption for high-purity type IIa.",
             {"density": "handbook", "eps_real": "handbook (n≈2.4)", "eps_imag":
              "estimate — sample dependent; 0 is an idealisation, supply measured value",
              "magnetic_susceptibility": "handbook (diamagnetic)"}),
    Material("silica", "Fused silica (SiO2)", 2200.0, 3.8, 0.1, -1.1e-5,
             "Common levitated-optomechanics material; appreciable IR absorption.",
             {"density": "handbook", "eps_real": "handbook (static)", "eps_imag":
              "estimate (thermal-IR, order of magnitude)", "magnetic_susceptibility": "handbook"}),
    Material("silicon", "Silicon (intrinsic)", 2329.0, 11.7, 0.0, -4.2e-6,
             "High density of states for patch potentials; semiconductor.",
             {"density": "handbook", "eps_real": "handbook", "eps_imag": "estimate",
              "magnetic_susceptibility": "handbook"}),
    Material("osmium", "Osmium (densest stable element; metallic)", 22590.0, 1e6, 0.0, 1.5e-5,
             "Maximises mass per volume (gravity/Casimir ratio) but metallic: Clausius–Mossotti → 1.",
             {"density": "handbook", "eps_real": "metal approximation (perfect conductor)",
              "eps_imag": "not applicable", "magnetic_susceptibility": "handbook (paramagnetic)"}),
    Material("gold", "Gold", 19300.0, 1e6, 0.0, -3.4e-5,
             "Used for test masses in torsion balances and mm-scale gravity experiments.",
             {"density": "handbook", "eps_real": "metal approximation", "eps_imag": "not applicable",
              "magnetic_susceptibility": "handbook"}),
]}


def get(key: str) -> Material:
    if key not in MATERIALS:
        raise KeyError(f"unknown material '{key}'; available: {sorted(MATERIALS)}")
    return MATERIALS[key]
