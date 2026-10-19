"""Suite 12 (registry) — explicit competing hypotheses for two-mass gravitational experiments.

Every hypothesis H_k maps an experiment design x, physical parameters θ_k and nuisance parameters η_k
to a joint density matrix of the two branch qubits, from which predictive distributions of measured
outcomes follow (spec Part II §B). No model is privileged: each is evaluated through exactly the
same measurement chain and the same nuisance treatment.

A model's `meta` block is its G1 (theory gate) record: dynamics, assumptions, approximations,
admissible domain, known limits, references and implementation/assurance status.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from . import bmv, em, qg_eft
from .constants import hbar
from .decoherence import diosi_penrose_rate


@dataclass
class Scenario:
    """Everything shared by all hypotheses for one experimental configuration."""
    design: bmv.BMVDesign
    gamma_env_A: float = 0.0                 # s^-1, environmental decoherence of A (from Suite 7)
    gamma_env_B: float = 0.0
    nongrav_energies: dict = field(default_factory=lambda: {k: 0.0 for k in bmv.BRANCH_LABELS})  # J
    finite_size: bool = True

    def grav_energies(self, mass_scale: float = 1.0) -> dict:
        E = bmv.gravitational_branch_energies(self.design, self.finite_size)
        return {k: v * mass_scale**2 for k, v in E.items()}


from .nuisance import Nuisance  # noqa: E402  (re-exported)


COMMON_NUISANCE = [
    Nuisance("env_decoherence_scale", 0.5, 2.0, 1.0, "1",
             "multiplier on independently calibrated environmental decoherence rates"),
    Nuisance("mass_scale", 0.99, 1.01, 1.0, "1", "relative mass calibration (enters gravity as m_A m_B)"),
    Nuisance("local_phase_A", -0.05, 0.05, 0.0, "rad", "residual local phase calibration error on A"),
    Nuisance("local_phase_B", -0.05, 0.05, 0.0, "rad", "residual local phase calibration error on B"),
]


def _local_phase(ph: dict, a: float, b: float) -> dict:
    return {k: v + a * bmv.Z_SIGN[k[0]] + b * bmv.Z_SIGN[k[1]] for k, v in ph.items()}


def _phases(E: dict, t: float) -> dict:
    return bmv.phases_from_energies(E, t)


def _add(*dicts):
    return {k: sum(d[k] for d in dicts) for k in bmv.BRANCH_LABELS}


@dataclass
class Hypothesis:
    id: str
    name: str
    family: str
    meta: dict
    extra_nuisance: list[Nuisance]
    implemented: bool
    _state: Callable | None = None

    @property
    def nuisance(self) -> list[Nuisance]:
        return COMMON_NUISANCE + self.extra_nuisance

    def nominal_eta(self) -> dict:
        return {n.name: n.nominal for n in self.nuisance}

    def state(self, sc: Scenario, eta: dict | None = None) -> np.ndarray:
        if not self.implemented:
            raise NotImplementedError(f"{self.id} is registered but not implemented: {self.meta['status_note']}")
        e = self.nominal_eta()
        e.update(eta or {})
        return self._state(sc, e)

    def describe(self) -> dict:
        return {"id": self.id, "name": self.name, "family": self.family, "implemented": self.implemented,
                "nuisance": [n.__dict__ for n in self.nuisance], **self.meta}


def _env_decay(sc: Scenario, e: dict) -> tuple[float, float]:
    t = sc.design.time
    s = e["env_decoherence_scale"]
    return sc.gamma_env_A * s * t, sc.gamma_env_B * s * t


# ----------------------------------------------------------------------------- model dynamics
def _quantum_coherent(sc: Scenario, e: dict) -> np.ndarray:
    t = sc.design.time
    ph = _phases(_add(sc.grav_energies(e["mass_scale"]), sc.nongrav_energies), t)
    ph = _local_phase(ph, e["local_phase_A"], e["local_phase_B"])
    return bmv.joint_state(ph, *_env_decay(sc, e))


def _quantum_eft(sc: Scenario, e: dict) -> np.ndarray:
    t = sc.design.time
    d = bmv.branch_distances(sc.design)
    m2 = e["mass_scale"]
    corr = {k: qg_eft.eft_potential_terms(sc.design.mass_A * m2, sc.design.mass_B * m2, r)
            ["quantum_one_loop_correction_J"] for k, r in d.items()}
    ph = _phases(_add(sc.grav_energies(e["mass_scale"]), sc.nongrav_energies, corr), t)
    ph = _local_phase(ph, e["local_phase_A"], e["local_phase_B"])
    return bmv.joint_state(ph, *_env_decay(sc, e))


def _semiclassical_mean_field(sc: Scenario, e: dict) -> np.ndarray:
    """Gravity sourced by the expectation value of the other mass's distribution (p_L = p_R = ½).

    Branch i of A acquires the phase -(t/ħ) Σ_j p_j U_ij: purely local, so gravity cannot entangle.
    Electromagnetic interactions remain fully quantum (they are not modified by this hypothesis).
    """
    t = sc.design.time
    Eg = sc.grav_energies(e["mass_scale"])
    UA = {i: 0.5 * (Eg[i + "L"] + Eg[i + "R"]) for i in "LR"}
    UB = {j: 0.5 * (Eg["L" + j] + Eg["R" + j]) for j in "LR"}
    Emf = {k: UA[k[0]] + UB[k[1]] for k in bmv.BRANCH_LABELS}
    ph = _phases(_add(Emf, sc.nongrav_energies), t)
    ph = _local_phase(ph, e["local_phase_A"], e["local_phase_B"])
    return bmv.joint_state(ph, *_env_decay(sc, e))


def _classical_channel(sc: Scenario, e: dict) -> np.ndarray:
    """Classical measurement–feedback (LOCC) gravity, Kafri–Taylor–Milburn type.

    The gravitational branch interaction is reproduced on average, but because it is mediated by
    classical information each mass must suffer extra dephasing Γ_cc = κ Γ*, Γ* = |Δφ_g|/(2t), κ ≥ 1.
    At κ ≥ 1 the gravitational interaction alone can never create entanglement (verified numerically).
    """
    t = sc.design.time
    Eg = sc.grav_energies(e["mass_scale"])
    dphi_g = bmv.entangling_phase(_phases(Eg, t))
    g_cc = e["kappa_cc"] * bmv.entanglement_dephasing_threshold(dphi_g / t)
    ph = _phases(_add(Eg, sc.nongrav_energies), t)
    ph = _local_phase(ph, e["local_phase_A"], e["local_phase_B"])
    dA, dB = _env_decay(sc, e)
    return bmv.joint_state(ph, dA + g_cc * t, dB + g_cc * t)


def _diosi_penrose(sc: Scenario, e: dict) -> np.ndarray:
    """Coherent Newtonian interaction plus gravitational collapse decoherence (Diósi–Penrose)."""
    t = sc.design.time
    ph = _phases(_add(sc.grav_energies(e["mass_scale"]), sc.nongrav_energies), t)
    ph = _local_phase(ph, e["local_phase_A"], e["local_phase_B"])
    d = sc.design
    gA = diosi_penrose_rate(d.mass_A, d.radius_A, d.dx_A, e["dp_convention"])["rate"]
    gB = diosi_penrose_rate(d.mass_B, d.radius_B, d.dx_B, e["dp_convention"])["rate"]
    dA, dB = _env_decay(sc, e)
    return bmv.joint_state(ph, dA + gA * t, dB + gB * t)


def _no_branch_coupling(sc: Scenario, e: dict) -> np.ndarray:
    """Null: gravity does not couple to the branch degree of freedom at all (only non-gravitational physics)."""
    t = sc.design.time
    ph = _phases(sc.nongrav_energies, t)
    ph = _local_phase(ph, e["local_phase_A"], e["local_phase_B"])
    return bmv.joint_state(ph, *_env_decay(sc, e))


REFS = {
    "BMV": ["Bose et al., PRL 119, 240401 (2017), doi:10.1103/PhysRevLett.119.240401",
            "Marletto & Vedral, PRL 119, 240402 (2017), doi:10.1103/PhysRevLett.119.240402"],
    "KTM": ["Kafri, Taylor & Milburn, NJP 16, 065020 (2014), doi:10.1088/1367-2630/16/6/065020",
            "Oppenheim, PRX 13, 041040 (2023), doi:10.1103/PhysRevX.13.041040"],
    "SN": ["Møller (1962); Rosenfeld, Nucl. Phys. 40, 353 (1963)",
           "Diósi, Phys. Lett. A 105, 199 (1984); Penrose, GRG 28, 581 (1996)"],
    "DP": ["Diósi, PRA 40, 1165 (1989), doi:10.1103/PhysRevA.40.1165",
           "Penrose, Gen. Rel. Grav. 28, 581 (1996), doi:10.1007/BF02105068"],
    "EFT": ["Bjerrum-Bohr, Donoghue & Holstein, PRD 67, 084033 (2003), doi:10.1103/PhysRevD.67.084033"],
    "AH": ["Aziz & Howl, Nature 646, 813–817 (2025), doi:10.1038/s41586-025-09595-7",
           "Marletto, Oppenheim, Vedral & Wilson, arXiv:2511.07348 (preprint; disputes the interpretation)"],
}

HYPOTHESES: dict[str, Hypothesis] = {}


def _reg(h: Hypothesis):
    HYPOTHESES[h.id] = h


_reg(Hypothesis(
    "QG-COH", "Quantum-coherent gravitational interaction (linearised quantum gravity, Newtonian limit)",
    "quantum", {
        "dynamics": "H = Σ_ij U_ij |ij><ij|,  U_ij = mutual energy of uniform spheres at branch distance r_ij",
        "assumptions": ["gravity acts as a quantum (non-LOCC) mediator", "static branches during interaction",
                        "non-relativistic sources; retardation negligible", "uniform spherical mass distributions"],
        "approximations": ["Newtonian limit of linearised gravity (tree level)", "two-level branch encoding"],
        "admissible_domain": "r_ij >> l_P; r/c << t; |Φ|/c² << 1; non-overlapping branches",
        "known_limits": ["Δφ → (2Gm²t/ħ)(1/d - 1/√(d²+Δx²)) for point masses, parallel geometry",
                         "reduces to classical Newtonian force for branch expectation values"],
        "entangling_by_gravity": True, "references": REFS["BMV"],
        "assurance": "NUMERICALLY VERIFIED", "status_note": "flagship benchmark; not an original prediction"},
    [], True, _quantum_coherent))

_reg(Hypothesis(
    "QG-EFT1", "Quantum gravity EFT with one-loop correction", "quantum", {
        "dynamics": "U_ij → U_ij [1 + 3G(m_A+m_B)/(r c²) quantum part: 41Għ/(10π r² c³)] (quantum term only added)",
        "assumptions": ["perturbative EFT of gravity valid", "point-mass sources"],
        "approximations": ["one-loop", "non-relativistic"], "admissible_domain": "r >> l_P",
        "known_limits": ["→ QG-COH as ħ G / r² c³ → 0"], "entangling_by_gravity": True,
        "references": REFS["EFT"], "assurance": "PARTIALLY VERIFIED",
        "status_note": "correction ~1e-60 relative at μm scales: experimentally indistinguishable from QG-COH"},
    [], True, _quantum_eft))

_reg(Hypothesis(
    "SC-MF", "Semiclassical mean-field gravity (Møller–Rosenfeld / Schrödinger–Newton type)", "semiclassical", {
        "dynamics": "Each mass evolves in the gravitational field of the other's expected mass density",
        "assumptions": ["G_μν = 8πG <T_μν>/c⁴ sources gravity", "no wave-function collapse on measurement"],
        "approximations": ["equal branch weights; field of the averaged density", "self-gravity of each branch neglected"],
        "admissible_domain": "same as QG-COH",
        "known_limits": ["Δφ_grav ≡ 0 (no gravitational entanglement)", "local phases equal to branch-averaged potentials"],
        "entangling_by_gravity": False, "references": REFS["SN"], "assurance": "NUMERICALLY VERIFIED",
        "status_note": "known to conflict with standard measurement theory if taken as fundamental (Page & Geilker 1981)"},
    [], True, _semiclassical_mean_field))

_reg(Hypothesis(
    "CC-KTM", "Classical-channel (measurement–feedback) gravity, classical–quantum hybrid", "hybrid", {
        "dynamics": "dρ/dt = -i[H_g, ρ] + Σ_X Γ_cc/2 (Z_X ρ Z_X - ρ),  Γ_cc = κ|Δφ_g|/(2t), κ ≥ 1",
        "assumptions": ["gravity transmits only classical information (LOCC)", "Markovian continuous measurement"],
        "approximations": ["two-level branch encoding", "symmetric split of the decoherence between masses"],
        "admissible_domain": "same as QG-COH",
        "known_limits": ["κ = 1 is the minimal decoherence compatible with no gravitational entanglement",
                         "mean dynamics equal to QG-COH (same Newtonian force)"],
        "entangling_by_gravity": False, "references": REFS["KTM"], "assurance": "NUMERICALLY VERIFIED",
        "status_note": "threshold Γ* = |dΔφ/dt|/2 derived numerically in this platform (tests/test_bmv.py)"},
    [Nuisance("kappa_cc", 1.0, 3.0, 1.0, "1", "excess of classical-channel decoherence over its minimum")],
    True, _classical_channel))

_reg(Hypothesis(
    "DP-COLL", "Coherent gravity with Diósi–Penrose gravitational collapse", "collapse", {
        "dynamics": "QG-COH plus single-mass dephasing Γ_DP = κ_DP [U(Δx) - U(0)]/ħ (uniform sphere)",
        "assumptions": ["objective collapse rate set by gravitational self-energy difference",
                        "mass density smeared at the particle radius"],
        "approximations": ["uniform sphere density (no atomic-scale cut-off)"],
        "admissible_domain": "Δx > 0; non-relativistic",
        "known_limits": ["Γ_DP → 0 as Δx → 0", "Γ_DP = κ G m²(6/(5R) - 1/Δx)/ħ for Δx ≥ 2R"],
        "entangling_by_gravity": True, "references": REFS["DP"], "assurance": "NUMERICALLY VERIFIED",
        "status_note": "parameter-free with radius cut-off; experimentally constrained (e.g. Donadi et al., Nat. Phys. 17, 74 (2021))"},
    [Nuisance("dp_convention", 1.0, 2.0, 1.0, "1", "Diósi (1) vs Penrose (2) self-energy convention")],
    True, _diosi_penrose))

_reg(Hypothesis(
    "NULL-NG", "No gravitational coupling of branches (non-gravitational physics only)", "null", {
        "dynamics": "H = Σ_ij U^EM_ij |ij><ij| (Casimir–Polder, Coulomb, induced dipole, dipole–dipole)",
        "assumptions": ["gravity is branch-independent", "all electromagnetic interactions quantum-coherent"],
        "approximations": ["retarded Casimir–Polder far-field form"], "admissible_domain": "r >> R",
        "known_limits": ["any entanglement is of electromagnetic origin"], "entangling_by_gravity": False,
        "references": ["Casimir & Polder, Phys. Rev. 73, 360 (1948)",
                       "van de Kamp et al., PRA 102, 062807 (2020)"],
        "assurance": "NUMERICALLY VERIFIED", "status_note": "confounder control"},
    [], True, _no_branch_coupling))

from . import model_ah  # noqa: E402  (bottom import: model_ah imports Nuisance from this module)

_reg(Hypothesis(
    "CG-QFT-AH", "Classical gravity coupled to quantum matter fields (Aziz–Howl mechanism)", "hybrid",
    model_ah.META, model_ah.EXTRA_NUISANCE, True, model_ah.ah_state))


def get(hid: str) -> Hypothesis:
    return HYPOTHESES[hid]


def implemented() -> list[Hypothesis]:
    return [h for h in HYPOTHESES.values() if h.implemented]
