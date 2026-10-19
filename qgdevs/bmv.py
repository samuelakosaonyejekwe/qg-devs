"""Suite 4 — Gravity-mediated entanglement and quantum information (flagship).

Two masses A and B, each prepared in an equal spatial superposition of two branches (L, R) that are
mapped onto a two-level (qubit) degree of freedom, e.g. an embedded spin in a Stern–Gerlach
interferometer (Bose et al., PRL 119, 240401 (2017); Marletto & Vedral, PRL 119, 240402 (2017)).

For branch pair (i, j) the interaction energy U_ij generates the phase
    φ_ij = -(1/ħ) ∫ U_ij(t) dt          (static case: φ_ij = -U_ij t / ħ).
Writing z_L = +1, z_R = -1 the phases decompose uniquely as
    φ_ij = α + β z_i + γ z_j + (Δφ/4) z_i z_j,     Δφ = φ_LL + φ_RR - φ_LR - φ_RL,
so only Δφ is entangling; β, γ are local phases removable by local Z rotations.

With independent branch dephasing on each mass (single-mass coherence decay rates Γ_A, Γ_B,
e.g. from collisions, black-body radiation, or a collapse model), the joint state is exactly
    ρ_{ij,kl}(t) = ¼ exp[i(φ_ij - φ_kl)] exp[-Γ_A t (1-δ_ik)] exp[-Γ_B t (1-δ_jl)],
because the dephasing generators commute with the diagonal interaction. The same result is
obtained independently by the Lindblad solver (verified in tests).

Pure-state concurrence is |sin(Δφ/2)| (verified against the Wootters formula in tests).
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict

import numpy as np
from scipy.optimize import minimize

from . import quantum as qm
from .constants import G, hbar
from .gravity import sphere_mutual_energy

BRANCH_LABELS = ["LL", "LR", "RL", "RR"]
Z_SIGN = {"L": +1, "R": -1}


@dataclass
class BMVDesign:
    """Physical configuration of a two-mass gravity-mediated-entanglement experiment (SI units)."""
    mass_A: float = 1e-14            # kg
    mass_B: float = 1e-14            # kg
    density: float = 3510.0          # kg m^-3 (diamond) — used for radius
    separation: float = 450e-6       # m, centre-to-centre distance of the two interferometers
    dx_A: float = 250e-6             # m, branch separation of A
    dx_B: float = 250e-6             # m, branch separation of B
    geometry: str = "parallel"       # "parallel" | "linear" | "angled"
    angle_deg: float = 90.0          # for "angled": angle between split axis and the A–B line
    time: float = 2.5                # s, interaction time
    gamma_A: float = 0.0             # s^-1, single-mass branch-coherence decay rate (total, A)
    gamma_B: float = 0.0             # s^-1, (total, B)

    @property
    def radius_A(self) -> float:
        return (3 * self.mass_A / (4 * np.pi * self.density)) ** (1 / 3)

    @property
    def radius_B(self) -> float:
        return (3 * self.mass_B / (4 * np.pi * self.density)) ** (1 / 3)

    def as_dict(self) -> dict:
        d = asdict(self)
        d["radius_A"] = self.radius_A
        d["radius_B"] = self.radius_B
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "BMVDesign":
        keys = cls.__dataclass_fields__.keys()
        return cls(**{k: v for k, v in d.items() if k in keys})


def split_axis(geometry: str, angle_deg: float = 90.0) -> np.ndarray:
    if geometry == "linear":
        return np.array([1.0, 0.0, 0.0])
    if geometry == "parallel":
        return np.array([0.0, 1.0, 0.0])
    if geometry == "angled":
        a = np.deg2rad(angle_deg)
        return np.array([np.cos(a), np.sin(a), 0.0])
    raise ValueError(f"unknown geometry '{geometry}'")


def branch_positions(design: BMVDesign) -> dict[str, np.ndarray]:
    """Centres of mass of each branch. A is centred at the origin, B at (separation, 0, 0)."""
    n = split_axis(design.geometry, design.angle_deg)
    cA, cB = np.zeros(3), np.array([design.separation, 0.0, 0.0])
    return {"A_L": cA + 0.5 * design.dx_A * n, "A_R": cA - 0.5 * design.dx_A * n,
            "B_L": cB + 0.5 * design.dx_B * n, "B_R": cB - 0.5 * design.dx_B * n}


def branch_distances(design: BMVDesign) -> dict[str, float]:
    p = branch_positions(design)
    return {f"{i}{j}": float(np.linalg.norm(p[f"A_{i}"] - p[f"B_{j}"])) for i in "LR" for j in "LR"}


def check_geometry(design: BMVDesign) -> list[str]:
    """Physical-admissibility problems with a design (empty list = admissible)."""
    issues = []
    for k, v in design.as_dict().items():
        if isinstance(v, float) and k not in ("angle_deg",) and v < 0:
            issues.append(f"{k} must be non-negative")
    if design.mass_A <= 0 or design.mass_B <= 0:
        issues.append("masses must be positive")
    if design.time <= 0:
        issues.append("interaction time must be positive")
    d = branch_distances(design)
    rmin = min(d.values())
    if rmin <= design.radius_A + design.radius_B:
        issues.append(f"branches overlap or touch: closest branch distance {rmin:.3e} m "
                      f"<= sum of radii {design.radius_A + design.radius_B:.3e} m")
    if design.dx_A <= 2 * design.radius_A or design.dx_B <= 2 * design.radius_B:
        issues.append("branch separation not larger than particle diameter (branches spatially overlap)")
    return issues


# ----------------------------------------------------------------------------- interaction energies
def gravitational_branch_energies(design: BMVDesign, finite_size: bool = True) -> dict[str, float]:
    d = branch_distances(design)
    if finite_size:
        return {k: sphere_mutual_energy(design.mass_A, design.radius_A, design.mass_B, design.radius_B, r)
                for k, r in d.items()}
    return {k: -G * design.mass_A * design.mass_B / r for k, r in d.items()}


def phases_from_energies(energies: dict[str, float], t: float) -> dict[str, float]:
    return {k: -U * t / hbar for k, U in energies.items()}


def entangling_phase(phases: dict[str, float]) -> float:
    return phases["LL"] + phases["RR"] - phases["LR"] - phases["RL"]


def decompose_phases(phases: dict[str, float]) -> dict[str, float]:
    """Unique decomposition φ_ij = α + β z_i + γ z_j + (Δφ/4) z_i z_j."""
    p = phases
    return {"alpha": (p["LL"] + p["LR"] + p["RL"] + p["RR"]) / 4,
            "beta": (p["LL"] + p["LR"] - p["RL"] - p["RR"]) / 4,
            "gamma": (p["LL"] - p["LR"] + p["RL"] - p["RR"]) / 4,
            "delta_phi": entangling_phase(p)}


def parallel_geometry_delta_phi_analytic(m_A, m_B, d, dx, t) -> float:
    """Closed form for the parallel geometry with equal branch separations (point masses):
       Δφ = (2 G m_A m_B t / ħ) (1/d - 1/sqrt(d² + dx²)).
    """
    return 2 * G * m_A * m_B * t / hbar * (1 / d - 1 / np.sqrt(d**2 + dx**2))


# ----------------------------------------------------------------------------- states
def joint_state(phases: dict[str, float], decay_A: float = 0.0, decay_B: float = 0.0) -> np.ndarray:
    """Density matrix in the basis |LL>,|LR>,|RL>,|RR> for an initial |+>|+> state.

    decay_A, decay_B are the integrated single-mass coherence-decay exponents ∫Γ dt.
    """
    ph = np.array([phases[k] for k in BRANCH_LABELS])
    rho = 0.25 * np.exp(1j * (ph[:, None] - ph[None, :]))
    a = np.array([0, 0, 1, 1])
    b = np.array([0, 1, 0, 1])
    rho *= np.exp(-decay_A * (a[:, None] != a[None, :]))
    rho *= np.exp(-decay_B * (b[:, None] != b[None, :]))
    return rho


def interaction_hamiltonian(energies: dict[str, float]) -> np.ndarray:
    """Diagonal branch Hamiltonian H/ħ [rad/s] in the |LL>,|LR>,|RL>,|RR> basis."""
    return np.diag([energies[k] / hbar for k in BRANCH_LABELS]).astype(complex)


def dephasing_operators(gamma_A: float, gamma_B: float) -> list[np.ndarray]:
    """Lindblad operators reproducing single-mass coherence decay rates Γ (D[√(Γ/2) Z] decays coherences at Γ)."""
    ops = []
    if gamma_A > 0:
        ops.append(np.sqrt(gamma_A / 2) * qm.embed(qm.Z, 0, [2, 2]))
    if gamma_B > 0:
        ops.append(np.sqrt(gamma_B / 2) * qm.embed(qm.Z, 1, [2, 2]))
    return ops


def local_phase_correction(phases: dict[str, float]) -> np.ndarray:
    """Local unitary R_z(β) ⊗ R_z(γ) removing the non-entangling phases (applied by the experimenter)."""
    dec = decompose_phases(phases)
    ua = np.diag(np.exp(-1j * dec["beta"] * np.array([1, -1])))
    ub = np.diag(np.exp(-1j * dec["gamma"] * np.array([1, -1])))
    return np.kron(ua, ub)


# ----------------------------------------------------------------------------- witnesses
def cpk_witness_value(rho: np.ndarray) -> float:
    """<W> with W = 1 - X⊗X - Y⊗Z - Z⊗Y (Chevalier, Paige & Kim, PRA 102, 022428 (2020)).

    For any product state a·(b_x, b_z, b_y) ≤ 1, hence <W> ≥ 0 for every separable state;
    <W> < 0 certifies entanglement using only three local measurement settings.
    """
    e = qm.pauli_expectations(rho)
    return 1 - e["XX"] - e["YZ"] - e["ZY"]


def cpk_witness_best_sign(rho: np.ndarray) -> float:
    """min over the two valid sign variants W± = 1 - X⊗X ∓ (Y⊗Z + Z⊗Y).

    Both are witnesses: for product states a·(b_x, ±b_z, ±b_y) ≤ 1. The sign that certifies
    depends on the sign of Δφ, which is known in advance from the model.
    """
    e = qm.pauli_expectations(rho)
    return min(1 - e["XX"] - e["YZ"] - e["ZY"], 1 - e["XX"] + e["YZ"] + e["ZY"])


def _local_unitary(angles):
    def u(a, b, c):
        return (np.array([[np.exp(-0.5j * (a + c)) * np.cos(b / 2), -np.exp(-0.5j * (a - c)) * np.sin(b / 2)],
                          [np.exp(0.5j * (a - c)) * np.sin(b / 2), np.exp(0.5j * (a + c)) * np.cos(b / 2)]]))
    return np.kron(u(*angles[:3]), u(*angles[3:]))


def optimised_cpk_witness(rho: np.ndarray, restarts: int = 6, seed: int = 0) -> dict:
    """Minimise <W_CPK> over local measurement frames (local unitaries U_A ⊗ U_B).

    Returns the minimal witness value and the frame rotations an experimenter must apply.
    """
    rng = np.random.default_rng(seed)

    def f(x):
        U = _local_unitary(x)
        return cpk_witness_value(U @ rho @ U.conj().T)

    best = None
    starts = [np.zeros(6)] + [rng.uniform(-np.pi, np.pi, 6) for _ in range(restarts)]
    for x0 in starts:
        r = minimize(f, x0, method="BFGS")
        if best is None or r.fun < best.fun:
            best = r
    return {"value": float(best.fun), "frame_euler_angles_rad": [float(v) for v in best.x],
            "settings": ["XX", "YZ", "ZY"], "certifies_entanglement": bool(best.fun < 0)}


def ppt_witness(rho: np.ndarray) -> dict:
    """Optimal decomposable witness W = (|v><v|)^{T_B} for the most negative PT eigenvector v.

    <W>_ρ equals the most negative eigenvalue of ρ^{T_B}; its Pauli decomposition gives the
    measurement settings needed to estimate it from data.
    """
    pt = qm.partial_transpose(rho, [2, 2], 1)
    w, v = np.linalg.eigh(pt)
    vec_ = v[:, 0]
    W = qm.partial_transpose(np.outer(vec_, vec_.conj()), [2, 2], 1)
    coeffs = {a + b: float(np.real(np.trace(W @ np.kron(qm.PAULI[a], qm.PAULI[b]))) / 4)
              for a in "IXYZ" for b in "IXYZ"}
    coeffs = {k: v_ for k, v_ in coeffs.items() if abs(v_) > 1e-12}
    return {"value": float(w[0]), "pauli_coefficients": coeffs,
            "settings_required": sorted({k for k in coeffs if "I" not in k}),
            "certifies_entanglement": bool(w[0] < 0)}


# ----------------------------------------------------------------------------- full prediction
def predict(design: BMVDesign, finite_size: bool = True, extra_energies: dict[str, float] | None = None,
            times: np.ndarray | None = None) -> dict:
    """Complete coherent-interaction prediction for a design (the 'quantum mediator' hypothesis).

    extra_energies: optional non-gravitational branch energies [J] (e.g. Casimir–Polder, Coulomb),
    added to the gravitational ones so that their contribution to Δφ can be isolated.
    """
    issues = check_geometry(design)
    Eg = gravitational_branch_energies(design, finite_size)
    E = dict(Eg)
    if extra_energies:
        E = {k: Eg[k] + extra_energies.get(k, 0.0) for k in Eg}
    ph = phases_from_energies(E, design.time)
    ph_g = phases_from_energies(Eg, design.time)
    rho = joint_state(ph, design.gamma_A * design.time, design.gamma_B * design.time)
    U = local_phase_correction(ph)
    rho_c = U @ rho @ U.conj().T
    check = qm.check_density_matrix(rho)
    warnings = []
    big = max(abs(v) for v in ph.values())
    if big > 1e6:
        warnings.append(f"branch phases reach {big:.2e} rad: Δφ mod 2π is resolved only to ~{big * 2.2e-16:.1e} rad and "
                        "the result is dominated by non-gravitational (e.g. Coulomb) energies; entanglement measures "
                        "are not physically meaningful here — remove the residual charge or screen it")
    out = {
        "warnings": warnings,
        "design": design.as_dict(),
        "admissibility_issues": issues,
        "branch_distances_m": branch_distances(design),
        "gravitational_energies_J": Eg,
        "total_energies_J": E,
        "phases_rad": ph,
        "phase_decomposition": decompose_phases(ph),
        "delta_phi_gravity_rad": entangling_phase(ph_g),
        "delta_phi_total_rad": entangling_phase(ph),
        "concurrence": qm.concurrence(rho),
        "negativity": qm.negativity(rho),
        "log_negativity": qm.log_negativity(rho),
        "purity": qm.purity(rho),
        "pure_state_concurrence_bound": float(abs(np.sin(entangling_phase(ph) / 2))),
        "witness_cpk_local_corrected": cpk_witness_best_sign(rho_c),
        "witness_ppt": ppt_witness(rho),
        "state_check": check.as_dict(),
        "density_matrix_real": rho.real.tolist(),
        "density_matrix_imag": rho.imag.tolist(),
    }
    if times is not None:
        out["time_series"] = time_series(design, np.asarray(times), finite_size, extra_energies)
    return out


def time_series(design: BMVDesign, times: np.ndarray, finite_size=True, extra_energies=None) -> dict:
    Eg = gravitational_branch_energies(design, finite_size)
    E = {k: Eg[k] + (extra_energies or {}).get(k, 0.0) for k in Eg}
    rows = {"t": [], "delta_phi": [], "concurrence": [], "negativity": [], "witness_cpk": [], "purity": []}
    for t in times:
        ph = phases_from_energies(E, t)
        rho = joint_state(ph, design.gamma_A * t, design.gamma_B * t)
        U = local_phase_correction(ph)
        rows["t"].append(float(t))
        rows["delta_phi"].append(entangling_phase(ph))
        rows["concurrence"].append(qm.concurrence(rho))
        rows["negativity"].append(qm.negativity(rho))
        rows["witness_cpk"].append(cpk_witness_best_sign(U @ rho @ U.conj().T))
        rows["purity"].append(qm.purity(rho))
    return rows


def entanglement_dephasing_threshold(delta_phi_rate: float) -> float:
    """Minimal symmetric single-mass coherence-decay rate Γ* above which a ZZ-coupled qubit pair
    starting in |+>|+> never becomes entangled:  Γ* = |dΔφ/dt| / 2.

    Derived numerically (see tests/test_bmv.py::test_dephasing_threshold) and consistent with the
    decoherence–coupling trade-off of classical measurement-feedback channels (Kafri, Taylor & Milburn,
    NJP 16, 065020 (2014)). Used by the classical-channel competing model.
    """
    return abs(delta_phi_rate) / 2
