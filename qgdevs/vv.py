"""Suite 16 — Calibration, verification, validation and uncertainty: benchmark registry.

Each benchmark compares a solver output with an analytic result, an independent algorithm, or a known
limiting case, against a tolerance fixed *in advance* with a written justification (gate G3). The
registry is the single source of truth: the test suite, the verification dashboard and the gate
evaluator all run the same functions. Failures are recorded, never hidden.
"""
from __future__ import annotations

import time
import traceback
from dataclasses import dataclass
from typing import Callable

import numpy as np

from . import quantum as qm, gravity as gr, bmv, interferometry as itf, optomech as om, decoherence as dec, em
from .constants import G, hbar


@dataclass
class Benchmark:
    id: str
    suite: int
    title: str
    kind: str              # analytic | independent_algorithm | limiting_case | convergence | statistical | property
    tolerance: float
    justification: str
    reference: str
    fn: Callable[[], tuple[float, float]]  # returns (measured_error_or_value, reference_value)
    compare: str = "abs_error"              # abs_error | min_value | max_value | in_range
    slow: bool = False


REGISTRY: list[Benchmark] = []


def bench(**kw):
    def deco(fn):
        REGISTRY.append(Benchmark(fn=fn, **kw))
        return fn
    return deco


def _order(errors, hs):
    p = np.polyfit(np.log(hs), np.log(errors), 1)
    return float(p[0])


# ----------------------------------------------------------------------------- Suite 1
@bench(id="S1-unitarity", suite=1, title="Propagator unitarity for random Hermitian H (d=8)", kind="property",
       tolerance=1e-12, justification="eigendecomposition is backward stable; error ~ d·ε_machine",
       reference="exact property ‖U†U − I‖ = 0")
def _():
    rng = np.random.default_rng(1)
    A = rng.normal(size=(8, 8)) + 1j * rng.normal(size=(8, 8))
    H = A + A.conj().T
    U = qm.unitary_propagator(H, 3.7)
    return float(np.max(np.abs(U.conj().T @ U - np.eye(8)))), 0.0


@bench(id="S1-rabi", suite=1, title="Rabi oscillation P(t) = sin²(Ωt/2)", kind="analytic", tolerance=1e-12,
       justification="exact propagation; round-off only", reference="Rabi, Phys. Rev. 51, 652 (1937)")
def _():
    Om = 2 * np.pi * 1.3
    H = 0.5 * Om * qm.X
    ts = np.linspace(0, 2, 50)
    psi = qm.evolve_ket(np.array([1, 0], complex), H, ts)
    return float(np.max(np.abs(np.abs(psi[:, 1]) ** 2 - np.sin(Om * ts / 2) ** 2))), 0.0


@bench(id="S1-schrodinger-rk-vs-exact", suite=1, title="Adaptive RK vs exact Schrödinger evolution (d=6)",
       kind="independent_algorithm", tolerance=1e-8, justification="DOP853 with rtol 1e-10 over ~20 periods",
       reference="independent algorithms")
def _():
    rng = np.random.default_rng(2)
    A = rng.normal(size=(6, 6)) + 1j * rng.normal(size=(6, 6))
    H = (A + A.conj().T) / 2
    psi0 = qm.ket(*rng.normal(size=6))
    ts = np.linspace(0, 5, 11)
    return float(np.max(np.abs(qm.evolve_ket(psi0, H, ts) - qm.evolve_ket_rk(psi0, H, ts)))), 0.0


@bench(id="S1-lindblad-expm-vs-rk", suite=1, title="Lindblad: Krylov exp(Lt) vs DOP853 (two qubits, 3 channels)",
       kind="independent_algorithm", tolerance=1e-8, justification="both methods converged to ≪1e-9",
       reference="independent algorithms")
def _():
    H = qm.kron(qm.Z, qm.Z) * 0.7 + qm.kron(qm.X, qm.I2) * 0.3
    Ls = [0.2 * qm.kron(qm.Z, qm.I2), 0.1 * qm.kron(qm.I2, np.array([[0, 1], [0, 0]], complex)), 0.15 * qm.kron(qm.X, qm.X)]
    rho0 = qm.dm(qm.ket(1, 1, 1, 1))
    ts = np.linspace(0, 4, 9)
    a = qm.evolve_lindblad(rho0, H, Ls, ts, "expm")
    b = qm.evolve_lindblad(rho0, H, Ls, ts, "rk")
    return float(np.max(np.abs(a - b))), 0.0


@bench(id="S1-lindblad-physicality", suite=1, title="Trace, Hermiticity, positivity along Lindblad evolution",
       kind="property", tolerance=1e-10, justification="CPTP generator; numerical drift bounded by solver tolerance",
       reference="Lindblad, CMP 48, 119 (1976)")
def _():
    H = qm.kron(qm.Z, qm.Z) * 0.7
    Ls = [0.3 * qm.kron(np.array([[0, 1], [0, 0]], complex), qm.I2), 0.2 * qm.kron(qm.I2, qm.Z)]
    rhos = qm.evolve_lindblad(qm.dm(qm.ket(1, 1, 1, 1)), H, Ls, np.linspace(0, 10, 21))
    worst = 0.0
    for r in rhos:
        c = qm.check_density_matrix(r)
        worst = max(worst, abs(c.trace - 1), c.hermiticity_error, max(0.0, -c.min_eigenvalue))
    return worst, 0.0


@bench(id="S1-amplitude-damping", suite=1, title="Amplitude damping: excited population e^{-γt}", kind="analytic",
       tolerance=1e-9, justification="Krylov expm accuracy", reference="textbook (Breuer & Petruccione 2002)")
def _():
    g = 0.37
    L = np.sqrt(g) * np.array([[0, 1], [0, 0]], complex)
    ts = np.linspace(0, 5, 11)
    r = qm.evolve_lindblad(np.diag([0, 1]).astype(complex), np.zeros((2, 2), complex), [L], ts)
    return float(np.max(np.abs(r[:, 1, 1].real - np.exp(-g * ts)))), 0.0


@bench(id="S1-rk4-order", suite=1, title="Fixed-step RK4 Lindblad convergence order", kind="convergence",
       tolerance=0.15, justification="classical RK4 has order 4; ±0.15 allows pre-asymptotic effects",
       reference="Butcher (2016)", compare="abs_error")
def _():
    H = qm.kron(qm.Z, qm.Z) * 1.1 + qm.kron(qm.X, qm.I2) * 0.4
    Ls = [0.3 * qm.kron(qm.Z, qm.I2)]
    rho0 = qm.dm(qm.ket(1, 1, 1, 1))
    ref = qm.evolve_lindblad(rho0, H, Ls, [0.0, 2.0])[-1]
    ns = [20, 40, 80, 160]
    errs = [np.max(np.abs(qm.evolve_lindblad_rk4_fixed(rho0, H, Ls, 2.0, n) - ref)) for n in ns]
    return abs(_order(errs, [2.0 / n for n in ns]) - 4.0), 0.0


@bench(id="S1-mcwf-vs-lindblad", suite=1, title="Quantum trajectories reproduce the master equation (3σ)",
       kind="statistical", tolerance=3.0, justification="Monte-Carlo error ∝ 1/√N; compare in units of σ",
       reference="Dalibard, Castin & Mølmer, PRL 68, 580 (1992)", slow=True)
def _():
    g = 0.5
    L = np.sqrt(g) * np.array([[0, 1], [0, 0]], complex)
    H = 0.8 * qm.X
    ts = np.linspace(0, 2, 5)
    ex = qm.evolve_lindblad(qm.dm(qm.ket(0, 1)), H, [L], ts)
    N = 400
    mc = qm.mcwf_trajectories(qm.ket(0, 1), H, [L], ts, ntraj=N, seed=3, substeps=200)
    p_ex = ex[:, 1, 1].real
    p_mc = mc[:, 1, 1].real
    sig = np.sqrt(np.clip(p_ex * (1 - p_ex), 1e-6, None) / N)
    # first-order jump scheme adds O(dt) bias; dt here is 2e-3
    return float(np.max(np.abs(p_mc - p_ex) / sig)), 0.0


@bench(id="S1-tomography-exact", suite=1, title="Linear-inversion tomography exact from exact probabilities",
       kind="analytic", tolerance=1e-6, justification="counts scaled to 1e9 per setting; rounding only",
       reference="Pauli-basis reconstruction")
def _():
    rng = np.random.default_rng(4)
    psi = qm.ket(*(rng.normal(size=4) + 1j * rng.normal(size=4)))
    rho = qm.dm(psi)
    counts = {s: np.round(qm.outcome_probabilities(rho, s) * 1e9) for s in qm.PAULI_SETTINGS}
    return float(np.max(np.abs(qm.linear_inversion(counts) - rho))), 0.0


@bench(id="S1-mle-tomography", suite=1, title="MLE tomography fidelity at 1e5 shots/setting", kind="statistical",
       tolerance=0.995, justification="expected infidelity ~1e-4 at these counts; 0.995 is a conservative floor",
       reference="Hradil, PRA 55, R1561 (1997)", compare="min_value")
def _():
    rng = np.random.default_rng(5)
    rho = bmv.joint_state({"LL": 0.3, "LR": -0.2, "RL": 0.1, "RR": 0.9}, 0.2, 0.1)
    counts = {s: rng.multinomial(100000, qm.outcome_probabilities(rho, s)) for s in qm.PAULI_SETTINGS}
    return qm.fidelity(qm.mle_tomography(counts), rho), 1.0


# ----------------------------------------------------------------------------- Suite 2
@bench(id="S2-shell-theorem", suite=2, title="Non-overlapping uniform spheres interact as point masses",
       kind="analytic", tolerance=1e-12, justification="exact branch in implementation; relative error",
       reference="Newton's shell theorem")
def _():
    return abs(gr.sphere_mutual_energy(2.0, 0.1, 3.0, 0.2, 0.5) / (-G * 6 / 0.5) - 1), 0.0


@bench(id="S2-self-energy", suite=2, title="Mutual energy of coincident uniform spheres = −6Gm²/(5R)",
       kind="analytic", tolerance=1e-10, justification="adaptive quadrature with epsrel 1e-12", reference="classical result")
def _():
    m, R = 1e-14, 1e-6
    return abs(gr.sphere_mutual_energy(m, R, m, R, 0.0) / (-6 * G * m * m / (5 * R)) - 1), 0.0


@bench(id="S2-overlap-continuity", suite=2, title="Overlapping-sphere energy continuous at d = 2R", kind="property",
       tolerance=1e-8, justification="quadrature branch must join analytic branch", reference="continuity")
def _():
    m, R = 1.0, 1.0
    return abs(gr.sphere_mutual_energy(m, R, m, R, 2 * R * (1 - 1e-10)) - gr.sphere_mutual_energy(m, R, m, R, 2 * R)) / (G), 0.0


@bench(id="S2-kepler-energy", suite=2, title="Velocity-Verlet energy conservation over 10 orbits",
       kind="property", tolerance=1e-5, justification="symplectic O(dt²) bounded energy error at 2000 steps/orbit",
       reference="Hairer, Lubich & Wanner (2006)")
def _():
    M, m, a = 1.0e3, 1.0, 1.0
    v = np.sqrt(G * (M + m) / a)
    pos = np.array([[0, 0, 0], [a, 0, 0]], float)
    vel = np.array([[0, -v * m / (M + m), 0], [0, v * M / (M + m), 0]])
    T = gr.kepler_period(a, M + m)
    ts, P, V = gr.nbody_verlet(pos, vel, [M, m], T / 2000, 20000, save_every=1000)
    E0 = gr.nbody_energy(P[0], V[0], np.array([M, m]))
    return float(max(abs(gr.nbody_energy(p, vv, np.array([M, m])) / E0 - 1) for p, vv in zip(P, V))), 0.0


@bench(id="S2-verlet-order", suite=2, title="Velocity-Verlet convergence order (position after one orbit)",
       kind="convergence", tolerance=0.15, justification="second-order method", reference="Verlet (1967)")
def _():
    M, m, a = 1.0e3, 1.0, 1.0
    v = np.sqrt(G * (M + m) / a)
    pos = np.array([[0, 0, 0], [a, 0, 0]], float)
    vel = np.array([[0, -v * m / (M + m), 0], [0, v * M / (M + m), 0]])
    T = gr.kepler_period(a, M + m)
    errs, hs = [], []
    for n in (200, 400, 800, 1600):
        ts, P, _ = gr.nbody_verlet(pos, vel, [M, m], T / n, n, save_every=n)
        errs.append(np.linalg.norm(P[-1][1] - P[-1][0] - (pos[1] - pos[0])))
        hs.append(T / n)
    return abs(_order(errs, hs) - 2.0), 0.0


@bench(id="S2-mercury-precession", suite=2, title="Schwarzschild perihelion advance (Mercury) vs 6πGM/(c²a(1−e²))",
       kind="analytic", tolerance=1e-5, justification="relative; higher-order GR terms ~ GM/(c²a) ≈ 3e-8 plus solver tol",
       reference="Einstein (1915)")
def _():
    M = 1.98847e30
    n = gr.perihelion_precession_numeric(M, 5.7909e10, 0.2056)
    a = gr.perihelion_precession_analytic(M, 5.7909e10, 0.2056)
    return abs(n / a - 1), 0.0


@bench(id="S2-light-deflection", suite=2, title="Solar light deflection vs 4GM/(c²b)", kind="analytic", tolerance=1e-4,
       justification="relative; second-order term (15π/16)(GM/c²b) ≈ 6e-6", reference="Einstein (1916)")
def _():
    M, b = 1.98847e30, 6.957e8
    return abs(gr.light_deflection_numeric(M, b) / gr.light_deflection_analytic(M, b) - 1), 0.0


# ----------------------------------------------------------------------------- Suite 4
@bench(id="S4-concurrence-formula", suite=4, title="Pure BMV state: concurrence = |sin(Δφ/2)| (random phases)",
       kind="analytic", tolerance=1e-12,
       justification="SVD form of Wootters' formula is backward stable; the original eigenvalue form lost √ε≈1e-8 on "
                     "rank-deficient states (found by the independent C++ comparison; implementation fixed, tolerance restored)",
       reference="Wootters, PRL 80, 2245 (1998)")
def _():
    rng = np.random.default_rng(6)
    worst = 0.0
    for _ in range(50):
        ph = dict(zip(bmv.BRANCH_LABELS, rng.uniform(-10, 10, 4)))
        worst = max(worst, abs(qm.concurrence(bmv.joint_state(ph)) - abs(np.sin(bmv.entangling_phase(ph) / 2))))
    return worst, 0.0


@bench(id="S4-analytic-vs-lindblad", suite=4, title="Analytic dephased BMV state vs Lindblad solver",
       kind="independent_algorithm", tolerance=1e-9, justification="Krylov expm; dephasing commutes with H",
       reference="independent algorithms")
def _():
    d = bmv.BMVDesign(geometry="linear", gamma_A=0.05, gamma_B=0.08)
    E = bmv.gravitational_branch_energies(d)
    H = bmv.interaction_hamiltonian(E)
    rho0 = qm.dm(np.ones(4) / 2)
    r_num = qm.evolve_lindblad(rho0, H, bmv.dephasing_operators(d.gamma_A, d.gamma_B), [0, d.time])[-1]
    r_an = bmv.joint_state(bmv.phases_from_energies(E, d.time), d.gamma_A * d.time, d.gamma_B * d.time)
    return float(np.max(np.abs(r_num - r_an))), 0.0


@bench(id="S4-parallel-closed-form", suite=4, title="Parallel-geometry Δφ vs closed form (point masses)",
       kind="analytic", tolerance=1e-12, justification="relative; identical formula evaluated two ways",
       reference="Bose et al. 2017 geometry")
def _():
    d = bmv.BMVDesign(geometry="parallel")
    num = bmv.entangling_phase(bmv.phases_from_energies(bmv.gravitational_branch_energies(d, False), d.time))
    an = bmv.parallel_geometry_delta_phi_analytic(d.mass_A, d.mass_B, d.separation, d.dx_A, d.time)
    return abs(num / an - 1), 0.0


@bench(id="S4-witness-product-states", suite=4, title="CPK witness ≥ 0 on 2000 random product mixed states",
       kind="property", tolerance=-1e-12, justification="witness property (product bound a·b' ≤ 1)",
       reference="Chevalier, Paige & Kim, PRA 102, 022428 (2020)", compare="min_value")
def _():
    rng = np.random.default_rng(7)
    worst = np.inf
    for _ in range(2000):
        def rnd():
            v = rng.normal(size=3)
            v *= rng.uniform() ** (1 / 3) / np.linalg.norm(v)
            return 0.5 * (qm.I2 + v[0] * qm.X + v[1] * qm.Y + v[2] * qm.Z)
        worst = min(worst, bmv.cpk_witness_best_sign(np.kron(rnd(), rnd())))
    return float(worst), 0.0


@bench(id="S4-dephasing-threshold", suite=4, title="No entanglement at Γ = Γ*; entanglement at Γ = 0.9Γ*",
       kind="property", tolerance=1e-12, justification="Γ* = |dΔφ/dt|/2 threshold; negativity must vanish at Γ*",
       reference="derived in this platform; cf. Kafri, Taylor & Milburn 2014")
def _():
    rate = 1.0
    worst = 0.0
    below = 0.0
    for t in np.linspace(0, 30, 3001):
        ph = {"LL": rate * t / 4, "RR": rate * t / 4, "LR": -rate * t / 4, "RL": -rate * t / 4}
        g = bmv.entanglement_dephasing_threshold(rate)
        worst = max(worst, qm.negativity(bmv.joint_state(ph, g * t, g * t)))
        below = max(below, qm.negativity(bmv.joint_state(ph, 0.9 * g * t, 0.9 * g * t)))
    return (worst if below > 1e-4 else 1.0), 0.0


# ----------------------------------------------------------------------------- Suites 5–8
@bench(id="S5-free-spreading", suite=5, title="Split-step free Gaussian width vs analytic", kind="analytic",
       tolerance=1e-8, justification="relative; free evolution is exact in Fourier space", reference="textbook")
def _():
    m = 1e-25
    x = np.linspace(-2e-5, 2e-5, 4096)
    ts, ps = itf.split_step_1d(itf.gaussian_packet(x, 0, 5e-7), x, np.zeros_like(x), m, 1e-5, 200, save_every=200)
    return abs(itf.moments(ps[-1], x)[1] / itf.free_gaussian_width(5e-7, m, ts[-1]) - 1), 0.0


@bench(id="S5-ehrenfest-gravity", suite=5, title="Wave packet in uniform gravity follows −gt²/2", kind="analytic",
       tolerance=1e-6, justification="relative; Ehrenfest exact for linear potential", reference="Ehrenfest (1927)")
def _():
    m = 1e-25
    x = np.linspace(-4e-5, 4e-5, 8192)
    ts, ps = itf.split_step_1d(itf.gaussian_packet(x, 0, 5e-7), x, m * 9.81 * x, m, 1e-5, 100, save_every=100)
    return abs(itf.moments(ps[-1], x)[0] / (-0.5 * 9.81 * ts[-1] ** 2) - 1), 0.0


@bench(id="S5-kasevich-chu", suite=5, title="Atom-interferometer phase: closed form vs path calculation",
       kind="independent_algorithm", tolerance=1e-10, justification="relative", reference="Kasevich & Chu, PRL 67, 181 (1991)")
def _():
    k = 4 * np.pi / 780e-9
    return abs(itf.kasevich_chu_phase(k, 9.81, 0.1) / itf.kasevich_chu_phase_from_paths(k, 9.81, 0.1, m=1.443e-25) - 1), 0.0


@bench(id="S6-tmsv-log-negativity", suite=6, title="Two-mode squeezed vacuum: E_N = 2r", kind="analytic",
       tolerance=1e-10, justification="closed form", reference="Vidal & Werner (2002); Adesso & Illuminati (2007)")
def _():
    r = 0.37
    c, s = np.cosh(2 * r), np.sinh(2 * r)
    V = 0.5 * np.array([[c, 0, s, 0], [0, c, 0, -s], [s, 0, c, 0], [0, -s, 0, c]])
    return abs(om.log_negativity_gaussian(V) - 2 * r), 0.0


@bench(id="S6-vacuum-stationary", suite=6, title="Uncoupled damped oscillators at T=0 stay unentangled",
       kind="limiting_case", tolerance=1e-12, justification="no coupling ⇒ E_N = 0 exactly", reference="limiting case")
def _():
    o = om.evolve_coupled_oscillators(1e-14, 1e-14, 1e-4, 2 * np.pi, 0.0, 0.1, 0.0, 10.0, 20, coupling_scale=0.0)
    return float(max(o["log_negativity"])), 0.0


@bench(id="S7-dp-closed-form", suite=7, title="Diósi–Penrose E_Δ = Gm²(6/5R − 1/d) for d ≥ 2R", kind="analytic",
       tolerance=1e-10, justification="relative; quadrature vs closed form", reference="Diósi 1989; Penrose 1996")
def _():
    m, R, d = 1e-14, 1e-6, 5e-6
    return abs(dec.diosi_penrose_rate(m, R, d)["E_delta_J"] / (G * m * m * (6 / (5 * R) - 1 / d)) - 1), 0.0


@bench(id="S8-casimir-scaling", suite=8, title="Casimir–Polder r⁻⁷ scaling", kind="property", tolerance=1e-12,
       justification="exact power law", reference="Casimir & Polder (1948)")
def _():
    a = em.casimir_polder_energy(1e-6, 1e-6, 0.6, 0.6, 1e-4)
    b = em.casimir_polder_energy(1e-6, 1e-6, 0.6, 0.6, 2e-4)
    return abs(a / b - 2**7) / 2**7, 0.0


# ----------------------------------------------------------------------------- Suites 12, 14, 18
@bench(id="S12-known-indistinguishable", suite=12, title="QG-COH vs QG-EFT1 reported indistinguishable",
       kind="property", tolerance=1e-12, justification="one-loop correction ~1e-60 relative ⇒ D ≈ 0",
       reference="identifiability test with known answer")
def _():
    from .models import Scenario, HYPOTHESES
    from .discrimination import robust_divergence, MeasurementChain, protocol_frame
    sc = Scenario(bmv.BMVDesign(geometry="linear"), 0.01, 0.01)
    ch = MeasurementChain(frame=protocol_frame(sc))
    return robust_divergence(HYPOTHESES["QG-COH"], HYPOTHESES["QG-EFT1"], sc, ch, restarts=0)["D_per_shot"], 0.0


@bench(id="S12-known-distinguishable", suite=12, title="QG-COH vs SC-MF distinguishable (D > 1e-4)",
       kind="property", tolerance=1e-4, justification="entanglement vs separable predictions differ at O(Δφ²)",
       reference="identifiability test with known answer", compare="min_value")
def _():
    from .models import Scenario, HYPOTHESES
    from .discrimination import robust_divergence, MeasurementChain, protocol_frame
    sc = Scenario(bmv.BMVDesign(geometry="linear"), 0.01, 0.01)
    ch = MeasurementChain(frame=protocol_frame(sc))
    return robust_divergence(HYPOTHESES["QG-COH"], HYPOTHESES["SC-MF"], sc, ch, restarts=1)["D_per_shot"], 0.0


@bench(id="S14-blind-law-recovery", suite=14, title="Blind recovery of Δφ ∝ G m² Δx² t /(ħ d³)",
       kind="property", tolerance=0.0, justification="exponents must rationalise exactly to the known law",
       reference="Bose et al. 2017")
def _():
    from .discovery import bmv_scaling_study
    law = bmv_scaling_study(regime="far", n=128)["law"]
    ok = (law["rational_exponents"] == {"mass": "2", "separation": "-3", "branch_separation": "2", "time": "1"}
          and law["constant_exponents"] == {"G": "1", "hbar": "-1"})
    return (0.0 if ok else 1.0), 0.0


@bench(id="S18-ledger-tamper", suite=18, title="Ledger detects retrospective alteration", kind="property",
       tolerance=0.0, justification="hash chain must break on any edit", reference="hash-chain integrity")
def _():
    import tempfile, json
    from pathlib import Path
    from .evidence import Ledger
    with tempfile.TemporaryDirectory() as td:
        L = Ledger(Path(td) / "l.jsonl")
        L.append("preregistration", {"prediction": 0.31})
        L.append("result", {"witness": -0.2})
        ok_before = L.verify()["valid"]
        lines = L.path.read_text().splitlines()
        e = json.loads(lines[0]); e["payload"]["prediction"] = 0.5
        lines[0] = json.dumps(e)
        L.path.write_text("\n".join(lines) + "\n")
        detected = not L.verify()["valid"]
    return (0.0 if ok_before and detected else 1.0), 0.0


def run(ids: list[str] | None = None, include_slow: bool = False) -> dict:
    results = []
    for b in REGISTRY:
        if ids and b.id not in ids:
            continue
        if b.slow and not include_slow and not ids:
            continue
        t0 = time.perf_counter()
        try:
            val, ref = b.fn()
            if b.compare == "min_value":
                passed = val >= b.tolerance
            else:
                passed = abs(val) <= b.tolerance
            err = None
        except Exception:
            val, ref, passed, err = None, None, False, traceback.format_exc(limit=3)
        results.append({"id": b.id, "suite": b.suite, "title": b.title, "kind": b.kind, "value": val,
                        "tolerance": b.tolerance, "compare": b.compare, "passed": bool(passed),
                        "justification": b.justification, "reference": b.reference, "error": err,
                        "seconds": round(time.perf_counter() - t0, 4)})
    n_fail = sum(not r["passed"] for r in results)
    return {"summary": {"total": len(results), "passed": len(results) - n_fail, "failed": n_fail},
            "results": results}
