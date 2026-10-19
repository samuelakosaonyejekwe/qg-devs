"""Suite 6 — Quantum optomechanics and massive quantum systems.

Gaussian-state model of two harmonically trapped masses coupled by gravity (Krisnanda et al.,
npj Quantum Inf. 6, 12 (2020); Qvarfort et al., Nat. Commun. 11, 1 (2020) for related proposals).
Expanding -G m_A m_B / |d + x_B - x_A| to second order gives the bilinear coupling
    H_int = (2 G m_A m_B / d³) x_A x_B         (masses aligned along the separation axis).
The covariance matrix V of (x_A, p_A, x_B, p_B) obeys dV/dt = A V + V Aᵀ + D (Ferraro, Olivares &
Paris 2005) with viscous damping γ and thermal bath occupation n_th; entanglement is quantified by
the logarithmic negativity E_N = max(0, -ln 2ν̃₋) of the partially transposed state (ħ = 1 units in
the dimensionless quadratures X = x/(√2 x_zpf), P = p/(√2 p_zpf)).

Also: resolved-sideband cavity cooling limit and thermal occupation helpers.
"""
from __future__ import annotations

import numpy as np
from scipy.integrate import solve_ivp

from .constants import hbar, k_B, G


def thermal_occupation(omega: float, T: float) -> float:
    return 0.0 if T <= 0 else 1.0 / np.expm1(hbar * omega / (k_B * T))


def sideband_cooling_limit(kappa: float, omega_m: float) -> float:
    """Minimum phonon occupation for resolved-sideband cavity cooling, n_min = (κ / 4ω_m)²
    (Marquardt et al. PRL 99, 093902 (2007); Wilson-Rae et al. PRL 99, 093901 (2007))."""
    return (kappa / (4 * omega_m)) ** 2


def gravitational_coupling_rate(m_A: float, m_B: float, d: float, omega: float) -> float:
    """g [rad/s] in H_int = ħ g (a+a†)(b+b†):  g = 2 G m_A m_B x_zpfA x_zpfB / (ħ d³)."""
    xA = np.sqrt(hbar / (2 * m_A * omega))
    xB = np.sqrt(hbar / (2 * m_B * omega))
    return 2 * G * m_A * m_B * xA * xB / (hbar * d**3)


def _drift(omega: float, g: float, gamma: float, shift_A: float, shift_B: float | None = None) -> np.ndarray:
    """Drift matrix for quadratures (X_A, P_A, X_B, P_B) with X = (a+a†)/√2, P = -i(a-a†)/√2.

    H/ħ = ω(X²+P²)/2 ×2 + 2g X_A X_B − s_A X_A² − s_B X_B²: gravity also softens each trap (self-terms
    −G m_A m_B x_X²/d³ of the expansion), entering as s_X on the X² coefficient.
    """
    w = omega
    sA = shift_A
    sB = shift_A if shift_B is None else shift_B
    return np.array([[-gamma / 2, w, 0, 0],
                     [-(w - 2 * sA), -gamma / 2, -2 * g, 0],
                     [0, 0, -gamma / 2, w],
                     [-2 * g, 0, -(w - 2 * sB), -gamma / 2]])


def log_negativity_gaussian(V: np.ndarray) -> float:
    """E_N for a two-mode Gaussian state from the covariance matrix (vacuum = identity/2 convention)."""
    A, B, C = V[:2, :2], V[2:, 2:], V[:2, 2:]
    delta_t = np.linalg.det(A) + np.linalg.det(B) - 2 * np.linalg.det(C)
    disc = delta_t**2 - 4 * np.linalg.det(V)
    nu_minus = np.sqrt(max((delta_t - np.sqrt(max(disc, 0))) / 2, 0))
    return float(max(0.0, -np.log(2 * nu_minus)))


def evolve_coupled_oscillators(m_A: float, m_B: float, d: float, omega: float, T_bath: float,
                               gamma: float, n_init: float, t_final: float, n_out: int = 200,
                               coupling_scale: float = 1.0, squeeze_r: float = 0.0) -> dict:
    """Covariance-matrix dynamics; coupling_scale = 0 switches gravity's bilinear term off (classical
    reference with no coherent coupling), 1 = quantum-coherent Newtonian coupling."""
    g = coupling_scale * gravitational_coupling_rate(m_A, m_B, d, omega)
    # second-order self-term −G m_A m_B x_A²/d³ = −ħ s_A X_A² with s_A = g·x_zpfA/x_zpfB = g·√(m_B/m_A)
    # (and A ↔ B); for equal masses both reduce to g
    A = _drift(omega, g, gamma, g * np.sqrt(m_B / m_A), g * np.sqrt(m_A / m_B))
    n_th = thermal_occupation(omega, T_bath)
    D = gamma * (n_th + 0.5) * np.eye(4)  # symmetric damping: vacuum (V = I/2) is stationary at n_th = 0
    s = (2 * n_init + 1) / 2
    single = np.diag([s * np.exp(-2 * squeeze_r), s * np.exp(2 * squeeze_r)])
    V0 = np.zeros((4, 4))
    V0[:2, :2] = single
    V0[2:, 2:] = single

    def f(t, y):
        V = y.reshape(4, 4)
        return (A @ V + V @ A.T + D).ravel()

    ts = np.linspace(0, t_final, n_out)
    sol = solve_ivp(f, (0, t_final), V0.ravel(), t_eval=ts, rtol=1e-10, atol=1e-12, method="DOP853")
    if not sol.success:
        raise RuntimeError(f"covariance integration failed: {sol.message}")
    EN = [log_negativity_gaussian(sol.y[:, k].reshape(4, 4)) for k in range(len(ts))]
    # normal modes of the conservative part: stable only while every mode frequency² is positive
    stable = bool(np.all(np.real(np.linalg.eigvals(A + gamma / 2 * np.eye(4))) <= 1e-12 * max(omega, 1.0)))
    return {"t": ts.tolist(), "log_negativity": EN, "coupling_rate_rad_s": g, "dynamically_stable": stable,
            "thermal_occupation_bath": n_th, "omega": omega,
            "note": "Gaussian-state model; classical-mediator hypotheses predict E_N = 0 identically"}
