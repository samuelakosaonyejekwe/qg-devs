"""Suite 1 — Quantum mechanics and quantum-state dynamics.

Conventions
-----------
* Hamiltonians passed to the evolution routines are expressed as H/hbar, i.e. in rad s^-1,
  so that d|psi>/dt = -i H |psi>.  Lindblad operators L_k are likewise in s^-1/2.
* Composite systems use the standard Kronecker ordering: index = i_0 * d_1 * ... + i_1 * ... .
* Vectorisation is column-stacking: vec(A X B) = (B^T kron A) vec(X).

Every routine here is independent of the gravitational models so that it can be verified
against exactly solvable quantum problems before being coupled to gravity (spec §21).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import reduce

import numpy as np
from scipy.integrate import solve_ivp
from scipy.linalg import expm
from scipy.sparse import csr_matrix, identity as sp_identity, kron as sp_kron
from scipy.sparse.linalg import expm_multiply

I2 = np.eye(2, dtype=complex)
X = np.array([[0, 1], [1, 0]], dtype=complex)
Y = np.array([[0, -1j], [1j, 0]], dtype=complex)
Z = np.array([[1, 0], [0, -1]], dtype=complex)
PAULI = {"I": I2, "X": X, "Y": Y, "Z": Z}


def kron(*ops: np.ndarray) -> np.ndarray:
    return reduce(np.kron, ops)


def ket(*amps) -> np.ndarray:
    v = np.asarray(amps, dtype=complex).ravel()
    return v / np.linalg.norm(v)


def dm(psi: np.ndarray) -> np.ndarray:
    psi = np.asarray(psi, dtype=complex).ravel()
    return np.outer(psi, psi.conj())


def embed(op: np.ndarray, site: int, dims: list[int]) -> np.ndarray:
    """Embed a single-subsystem operator into a composite space."""
    return kron(*[op if k == site else np.eye(d, dtype=complex) for k, d in enumerate(dims)])


# ----------------------------------------------------------------------------- state checks
@dataclass
class StateCheck:
    trace: float
    hermiticity_error: float
    min_eigenvalue: float
    purity: float
    tol: float
    passed: bool = field(init=False)

    def __post_init__(self):
        self.passed = (abs(self.trace - 1) <= self.tol and self.hermiticity_error <= self.tol
                       and self.min_eigenvalue >= -self.tol)

    def as_dict(self) -> dict:
        return {"trace": self.trace, "hermiticity_error": self.hermiticity_error,
                "min_eigenvalue": self.min_eigenvalue, "purity": self.purity,
                "tolerance": self.tol, "passed": self.passed}


def check_density_matrix(rho: np.ndarray, tol: float = 1e-9) -> StateCheck:
    """Physical admissibility: unit trace, Hermitian, positive semidefinite (spec Part II §E)."""
    rho = np.asarray(rho, dtype=complex)
    herm = float(np.max(np.abs(rho - rho.conj().T))) if rho.size else 0.0
    ev = np.linalg.eigvalsh(0.5 * (rho + rho.conj().T))
    return StateCheck(float(np.real(np.trace(rho))), herm, float(ev.min()),
                      float(np.real(np.trace(rho @ rho))), tol)


def check_ket(psi: np.ndarray, tol: float = 1e-12) -> dict:
    n = float(np.linalg.norm(psi))
    return {"norm": n, "tolerance": tol, "passed": abs(n - 1) <= tol}


def nearest_physical(rho: np.ndarray) -> np.ndarray:
    """Project a Hermitian matrix onto the set of density matrices (Smolin–Gambetta–Smith 2012)."""
    rho = 0.5 * (rho + rho.conj().T)
    rho = rho / np.real(np.trace(rho))
    w, v = np.linalg.eigh(rho)
    order = np.argsort(w)[::-1]
    w, v = w[order], v[:, order]
    lam = np.zeros_like(w)
    acc = 0.0
    n = len(w)
    for i in range(n - 1, -1, -1):
        if w[i] + acc / (i + 1) < 0:
            acc += w[i]
            lam[i] = 0.0
        else:
            lam[: i + 1] = w[: i + 1] + acc / (i + 1)
            break
    return (v * lam) @ v.conj().T


# ----------------------------------------------------------------------------- reductions
def partial_trace(rho: np.ndarray, dims: list[int], keep: list[int]) -> np.ndarray:
    n = len(dims)
    r = rho.reshape(dims + dims)
    trace_out = [k for k in range(n) if k not in keep]
    # repeatedly trace the highest-index subsystem first so axis numbers stay valid
    cur_n = n
    for k in sorted(trace_out, reverse=True):
        r = np.trace(r, axis1=k, axis2=k + cur_n)
        cur_n -= 1
    dk = int(np.prod([dims[k] for k in keep]))
    return r.reshape(dk, dk)


def partial_transpose(rho: np.ndarray, dims: list[int], sys: int) -> np.ndarray:
    n = len(dims)
    r = rho.reshape(dims + dims)
    axes = list(range(2 * n))
    axes[sys], axes[sys + n] = axes[sys + n], axes[sys]
    return r.transpose(axes).reshape(rho.shape)


# ----------------------------------------------------------------------------- measures
def purity(rho: np.ndarray) -> float:
    return float(np.real(np.trace(rho @ rho)))


def von_neumann_entropy(rho: np.ndarray, base: float = 2.0) -> float:
    w = np.linalg.eigvalsh(rho)
    w = w[w > 1e-15]
    return float(-np.sum(w * np.log(w)) / np.log(base))


def negativity(rho: np.ndarray, dims: list[int] = (2, 2), sys: int = 1) -> float:
    """N(rho) = (||rho^{T_B}||_1 - 1)/2 (Vidal & Werner 2002). Zero for PPT states."""
    ev = np.linalg.eigvalsh(partial_transpose(rho, list(dims), sys))
    return float(max(0.0, -np.sum(ev[ev < 0])))


def log_negativity(rho: np.ndarray, dims: list[int] = (2, 2), sys: int = 1) -> float:
    return float(np.log2(2 * negativity(rho, dims, sys) + 1))


def concurrence(rho: np.ndarray) -> float:
    """Wootters concurrence for two qubits (Wootters 1998)."""
    yy = np.kron(Y, Y)
    rt = yy @ rho.conj() @ yy
    ev = np.sqrt(np.abs(np.linalg.eigvals(rho @ rt)))
    ev = np.sort(np.real(ev))[::-1]
    return float(max(0.0, ev[0] - ev[1] - ev[2] - ev[3]))


def fidelity(rho: np.ndarray, sigma: np.ndarray) -> float:
    """Uhlmann fidelity F = (tr sqrt(sqrt(rho) sigma sqrt(rho)))^2."""
    w, v = np.linalg.eigh(rho)
    sr = (v * np.sqrt(np.clip(w, 0, None))) @ v.conj().T
    m = sr @ sigma @ sr
    ev = np.linalg.eigvalsh(0.5 * (m + m.conj().T))
    return float(np.sum(np.sqrt(np.clip(ev, 0, None))) ** 2)


def l1_coherence(rho: np.ndarray) -> float:
    return float(np.sum(np.abs(rho)) - np.sum(np.abs(np.diag(rho))))


def expectation(rho: np.ndarray, op: np.ndarray) -> float:
    return float(np.real(np.trace(rho @ op)))


def pauli_expectations(rho: np.ndarray) -> dict[str, float]:
    """All 16 two-qubit Pauli expectation values <s_a ⊗ s_b>."""
    return {a + b: expectation(rho, np.kron(PAULI[a], PAULI[b])) for a in "IXYZ" for b in "IXYZ"}


# ----------------------------------------------------------------------------- dynamics
def unitary_propagator(H: np.ndarray, t: float) -> np.ndarray:
    """exp(-i H t) for Hermitian H via eigendecomposition (exact to round-off, unitary by construction)."""
    w, v = np.linalg.eigh(H)
    return (v * np.exp(-1j * w * t)) @ v.conj().T


def evolve_ket(psi0: np.ndarray, H: np.ndarray, times: np.ndarray) -> np.ndarray:
    w, v = np.linalg.eigh(H)
    c0 = v.conj().T @ psi0
    return np.array([v @ (np.exp(-1j * w * t) * c0) for t in times])


def evolve_ket_rk(psi0, H, times, rtol=1e-10, atol=1e-12, method="DOP853"):
    """Independent adaptive Runge–Kutta solution of the Schrödinger equation (verification path)."""
    sol = solve_ivp(lambda t, y: -1j * (H @ y), (times[0], times[-1]), psi0.astype(complex),
                    t_eval=times, rtol=rtol, atol=atol, method=method)
    return sol.y.T


def liouvillian(H: np.ndarray, Ls: list[np.ndarray] | None = None) -> np.ndarray:
    """Dense Lindblad generator  L[rho] = -i[H,rho] + sum_k (L rho L† - ½{L†L, rho})  (column-stacked)."""
    d = H.shape[0]
    Id = np.eye(d, dtype=complex)
    Lv = -1j * (np.kron(Id, H) - np.kron(H.T, Id))
    for L in Ls or []:
        LdL = L.conj().T @ L
        Lv += np.kron(L.conj(), L) - 0.5 * np.kron(Id, LdL) - 0.5 * np.kron(LdL.T, Id)
    return Lv


def liouvillian_sparse(H, Ls=None):
    d = H.shape[0]
    Id = sp_identity(d, dtype=complex, format="csr")
    Hs = csr_matrix(H)
    Lv = -1j * (sp_kron(Id, Hs) - sp_kron(Hs.T, Id))
    for L in Ls or []:
        Ls_ = csr_matrix(L)
        LdL = Ls_.conj().T @ Ls_
        Lv = Lv + sp_kron(Ls_.conj(), Ls_) - 0.5 * sp_kron(Id, LdL) - 0.5 * sp_kron(LdL.T, Id)
    return Lv.tocsr()


def vec(rho: np.ndarray) -> np.ndarray:
    return rho.reshape(-1, order="F")


def unvec(v: np.ndarray, d: int) -> np.ndarray:
    return v.reshape(d, d, order="F")


def evolve_lindblad(rho0, H, Ls, times, method: str = "expm"):
    """Lindblad evolution.

    method="expm"  : sparse Krylov action of the exact propagator exp(L t) (Al-Mohy & Higham 2011)
    method="rk"    : adaptive DOP853 integration of d vec(rho)/dt = L vec(rho) (independent check)
    """
    d = rho0.shape[0]
    times = np.asarray(times, dtype=float)
    if method == "expm":
        Lv = liouvillian_sparse(H, Ls)
        if len(times) > 1 and np.allclose(np.diff(times), times[1] - times[0]):
            out = expm_multiply(Lv, vec(rho0), start=times[0], stop=times[-1], num=len(times), endpoint=True)
            return np.array([unvec(v, d) for v in out])
        return np.array([unvec(expm_multiply(Lv * t, vec(rho0)), d) for t in times])
    if method == "rk":
        Lv = liouvillian(H, Ls)
        sol = solve_ivp(lambda t, y: Lv @ y, (times[0], times[-1]), vec(rho0).astype(complex),
                        t_eval=times, rtol=1e-10, atol=1e-12, method="DOP853")
        return np.array([unvec(sol.y[:, k], d) for k in range(len(times))])
    raise ValueError(method)


def evolve_lindblad_rk4_fixed(rho0, H, Ls, t_final: float, nsteps: int) -> np.ndarray:
    """Fixed-step classical RK4 in matrix form; used for convergence-order verification (expected order 4)."""
    Ls = Ls or []
    Heff_terms = [L.conj().T @ L for L in Ls]

    def f(r):
        out = -1j * (H @ r - r @ H)
        for L, LdL in zip(Ls, Heff_terms):
            out += L @ r @ L.conj().T - 0.5 * (LdL @ r + r @ LdL)
        return out

    dt = t_final / nsteps
    r = rho0.astype(complex).copy()
    for _ in range(nsteps):
        k1 = f(r); k2 = f(r + 0.5 * dt * k1); k3 = f(r + 0.5 * dt * k2); k4 = f(r + dt * k3)
        r = r + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
    return r


def mcwf_trajectories(psi0, H, Ls, times, ntraj: int = 200, seed: int = 0, substeps: int = 20):
    """Monte-Carlo wave-function (quantum-jump) unravelling (Dalibard, Castin & Mølmer 1992).

    Returns the trajectory-averaged density matrices; converges to the Lindblad solution as
    O(1/sqrt(ntraj)) statistically and O(dt) in time step (first-order jump scheme).
    """
    rng = np.random.default_rng(seed)
    Ls = Ls or []
    Heff = H - 0.5j * sum((L.conj().T @ L for L in Ls), np.zeros_like(H))
    d = len(psi0)
    times = np.asarray(times)
    acc = np.zeros((len(times), d, d), dtype=complex)
    for _ in range(ntraj):
        psi = psi0.astype(complex).copy()
        acc[0] += dm(psi)
        for k in range(1, len(times)):
            dt = (times[k] - times[k - 1]) / substeps
            U = expm(-1j * Heff * dt)
            for _ in range(substeps):
                probs = np.array([dt * np.real(np.vdot(L @ psi, L @ psi)) for L in Ls])
                if Ls and rng.random() < probs.sum():
                    j = rng.choice(len(Ls), p=probs / probs.sum())
                    psi = Ls[j] @ psi
                else:
                    psi = U @ psi
                psi /= np.linalg.norm(psi)
            acc[k] += dm(psi)
    return acc / ntraj


# ----------------------------------------------------------------------------- measurement & tomography
PAULI_SETTINGS = [a + b for a in "XYZ" for b in "XYZ"]


def _eigvecs(label: str):
    """Eigenbasis for single-qubit Pauli measurement; outcome +1 first."""
    if label == "Z":
        return np.array([[1, 0], [0, 1]], dtype=complex)
    if label == "X":
        return np.array([[1, 1], [1, -1]], dtype=complex) / np.sqrt(2)
    if label == "Y":
        return np.array([[1, 1], [1j, -1j]], dtype=complex) / np.sqrt(2)
    raise ValueError(label)


def outcome_probabilities(rho: np.ndarray, setting: str) -> np.ndarray:
    """Born probabilities for the four outcomes (++, +-, -+, --) of a two-qubit Pauli setting."""
    Va, Vb = _eigvecs(setting[0]), _eigvecs(setting[1])
    p = np.empty(4)
    for i, (a, b) in enumerate([(0, 0), (0, 1), (1, 0), (1, 1)]):
        v = np.kron(Va[:, a], Vb[:, b])
        p[i] = np.real(np.vdot(v, rho @ v))
    p = np.clip(p, 0, None)
    return p / p.sum()


def apply_readout_error(p: np.ndarray, eps_a: float, eps_b: float) -> np.ndarray:
    """Independent symmetric bit-flip readout error on each qubit."""
    Ma = np.array([[1 - eps_a, eps_a], [eps_a, 1 - eps_a]])
    Mb = np.array([[1 - eps_b, eps_b], [eps_b, 1 - eps_b]])
    return np.kron(Ma, Mb) @ p


def correlator_from_probs(p: np.ndarray) -> float:
    return float(p[0] - p[1] - p[2] + p[3])


def linear_inversion(counts: dict[str, np.ndarray]) -> np.ndarray:
    """Two-qubit state from the 9 Pauli-setting count vectors via linear inversion."""
    E = {"II": 1.0}
    marg_a: dict[str, list] = {}
    marg_b: dict[str, list] = {}
    for s, n in counts.items():
        n = np.asarray(n, float)
        p = n / n.sum()
        E[s] = correlator_from_probs(p)
        marg_a.setdefault(s[0], []).append(p[0] + p[1] - p[2] - p[3])
        marg_b.setdefault(s[1], []).append(p[0] - p[1] + p[2] - p[3])
    for a, v in marg_a.items():
        E[a + "I"] = float(np.mean(v))
    for b, v in marg_b.items():
        E["I" + b] = float(np.mean(v))
    rho = np.zeros((4, 4), dtype=complex)
    for k, val in E.items():
        rho += val * np.kron(PAULI[k[0]], PAULI[k[1]])
    return rho / 4


def mle_tomography(counts: dict[str, np.ndarray], iters: int = 2000, tol: float = 1e-12) -> np.ndarray:
    """Maximum-likelihood state reconstruction by the iterative RρR algorithm (Hradil 1997; Řeháček et al. 2007).

    The result is always a valid density matrix, unlike linear inversion.
    """
    projectors, freqs = [], []
    for s, n in counts.items():
        Va, Vb = _eigvecs(s[0]), _eigvecs(s[1])
        n = np.asarray(n, float)
        for i, (a, b) in enumerate([(0, 0), (0, 1), (1, 0), (1, 1)]):
            v = np.kron(Va[:, a], Vb[:, b])
            projectors.append(np.outer(v, v.conj()))
            freqs.append(n[i])
    P = np.array(projectors)
    f = np.array(freqs)
    f = f / f.sum()
    rho = np.eye(4, dtype=complex) / 4
    norm_op = P.sum(axis=0)
    norm_inv = np.linalg.inv(norm_op)
    for _ in range(iters):
        probs = np.real(np.einsum("kij,ji->k", P, rho))
        probs = np.clip(probs, 1e-15, None)
        R = np.einsum("k,kij->ij", f / probs, P)
        R = norm_inv @ R
        new = R @ rho @ R.conj().T
        new = new / np.real(np.trace(new))
        if np.max(np.abs(new - rho)) < tol:
            rho = new
            break
        rho = new
    return 0.5 * (rho + rho.conj().T)
