"""Suite 5 — Quantum and matter-wave interferometry.

* Split-step Fourier solver for the Schrödinger equation in 1-D and 2-D with arbitrary potentials
  (second-order Strang splitting; verified against free Gaussian spreading and Ehrenfest motion
  in a uniform gravitational field).
* Light-pulse (Kasevich–Chu) atom-interferometer phase Δφ = k_eff g T² and its independent
  evaluation from propagation + laser phases.
* Closed-loop Stern–Gerlach interferometer for a spin-embedded mass (e.g. NV centre in diamond):
  branch trajectories x±(t) for the four-pulse protocol, the magnetic-field gradient required for a
  target branch separation, and time-integrated gravitational branch phases φ_ij = -(1/ħ)∫U_ij dt.
"""
from __future__ import annotations

import numpy as np
from scipy.integrate import quad

from .constants import hbar, G, mu_B, g_e, g_n


# ----------------------------------------------------------------------------- split-step Schrödinger
def split_step_1d(psi0: np.ndarray, x: np.ndarray, V: np.ndarray, m: float, dt: float, nsteps: int,
                  save_every: int = 1) -> tuple[np.ndarray, np.ndarray]:
    """ψ(t) with exp(-iVdt/2ħ) exp(-iTdt/ħ) exp(-iVdt/2ħ) splitting on a periodic grid."""
    dxg = x[1] - x[0]
    k = 2 * np.pi * np.fft.fftfreq(len(x), dxg)
    half_v = np.exp(-0.5j * V * dt / hbar)
    kin = np.exp(-1j * hbar * k**2 * dt / (2 * m))
    psi = psi0.astype(complex).copy()
    out, ts = [psi.copy()], [0.0]
    for n in range(1, nsteps + 1):
        psi = half_v * np.fft.ifft(kin * np.fft.fft(half_v * psi))
        if n % save_every == 0:
            out.append(psi.copy()); ts.append(n * dt)
    return np.array(ts), np.array(out)


def split_step_2d(psi0: np.ndarray, x: np.ndarray, y: np.ndarray, V: np.ndarray, m: float, dt: float,
                  nsteps: int, save_every: int = 1):
    kx = 2 * np.pi * np.fft.fftfreq(len(x), x[1] - x[0])
    ky = 2 * np.pi * np.fft.fftfreq(len(y), y[1] - y[0])
    KX, KY = np.meshgrid(kx, ky, indexing="xy")
    half_v = np.exp(-0.5j * V * dt / hbar)
    kin = np.exp(-1j * hbar * (KX**2 + KY**2) * dt / (2 * m))
    psi = psi0.astype(complex).copy()
    out, ts = [np.abs(psi) ** 2], [0.0]
    for n in range(1, nsteps + 1):
        psi = half_v * np.fft.ifft2(kin * np.fft.fft2(half_v * psi))
        if n % save_every == 0:
            out.append(np.abs(psi) ** 2); ts.append(n * dt)
    return np.array(ts), np.array(out), psi


def gaussian_packet(x: np.ndarray, x0: float, sigma: float, k0: float = 0.0) -> np.ndarray:
    psi = np.exp(-((x - x0) ** 2) / (4 * sigma**2) + 1j * k0 * x)
    return psi / np.sqrt(np.sum(np.abs(psi) ** 2) * (x[1] - x[0]))


def free_gaussian_width(sigma0: float, m: float, t: float) -> float:
    """Analytic σ(t) = σ0 sqrt(1 + (ħt / 2mσ0²)²)."""
    return sigma0 * np.sqrt(1 + (hbar * t / (2 * m * sigma0**2)) ** 2)


def moments(psi: np.ndarray, x: np.ndarray) -> tuple[float, float]:
    p = np.abs(psi) ** 2
    p = p / p.sum()
    mu = float(np.sum(p * x))
    return mu, float(np.sqrt(np.sum(p * (x - mu) ** 2)))


# ----------------------------------------------------------------------------- light-pulse atom interferometer
def kasevich_chu_phase(k_eff: float, g: float, T: float) -> float:
    """Δφ = φ(0) - 2φ(T) + φ(2T) = -k_eff g T² for k_eff pointing up (against gravity)."""
    return -k_eff * g * T**2


def kasevich_chu_phase_from_paths(k_eff: float, g: float, T: float, z0: float = 0.0, v0: float = 0.0,
                                  m: float = 1.443e-25) -> float:
    """Independent evaluation: laser phases imprinted at the classical path positions.

    For a uniform field the propagation phases of the two arms cancel exactly, leaving
    Δφ = k_eff [z1(0) - z_u(T) - z_l(T) + z2(2T)] (Storey & Cohen-Tannoudji 1994)."""
    vr = hbar * k_eff / m

    def z(t, z_, v_):
        return z_ + v_ * t - 0.5 * g * t**2

    zu_T = z(T, z0, v0 + vr)
    zl_T = z(T, z0, v0)
    zl_vel_T = v0 - g * T
    # after the mirror pulse the upper arm loses vr, the lower arm gains vr
    z2 = z(T, zl_T, zl_vel_T + vr)
    return float(k_eff * (z0 - zu_T - zl_T + z2))


# ----------------------------------------------------------------------------- Stern–Gerlach closed loop
def sg_acceleration(m: float, grad_B: float) -> float:
    """Branch acceleration magnitude a = g_e μ_B |∂B| / (2m) for an electron spin m_s = ±½."""
    return g_e * mu_B * grad_B / (2 * m)


def sg_required_gradient(m: float, dx: float, tau: float) -> float:
    """Gradient [T/m] so that the four-pulse protocol reaches separation dx: dx = 2 a τ²."""
    a = dx / (2 * tau**2)
    return 2 * m * a / (g_e * mu_B)


def sg_trajectory(t: np.ndarray, a: float, tau: float, hold: float) -> np.ndarray:
    """Displacement of the '+' branch: +a for τ, -a for τ (stop at a τ²), hold, -a for τ, +a for τ."""
    t = np.asarray(t, float)
    x = np.zeros_like(t)
    T1, T2, T3, T4 = tau, 2 * tau, 2 * tau + hold, 3 * tau + hold
    xmax = a * tau**2
    for i, s in enumerate(t):
        if s <= T1:
            x[i] = 0.5 * a * s**2
        elif s <= T2:
            u = s - T1
            x[i] = 0.5 * a * tau**2 + a * tau * u - 0.5 * a * u**2
        elif s <= T3:
            x[i] = xmax
        elif s <= T4:
            u = s - T3
            x[i] = xmax - 0.5 * a * u**2
        else:
            u = s - T4
            x[i] = 0.5 * a * tau**2 - a * tau * u + 0.5 * a * u**2
    return np.clip(x, 0, None)


def sg_bmv_phases(m_A: float, m_B: float, d: float, tau: float, hold: float, dx_target: float,
                  geometry: str = "parallel", n_quad: int = 2000) -> dict:
    """Time-integrated branch phases for two closed-loop SG interferometers.

    Each branch is displaced by ±x(t)/... along the split axis; the separation between a mass's
    branches is 2 x(t) with x_max = dx_target/2.
    """
    a = dx_target / 2 / tau**2
    total = 4 * tau + hold
    ts = np.linspace(0, total, n_quad)
    xs = sg_trajectory(ts, a, tau, hold)
    n = np.array([0.0, 1.0, 0.0]) if geometry == "parallel" else np.array([1.0, 0.0, 0.0])
    cB = np.array([d, 0, 0])
    sign = {"L": 1, "R": -1}
    phases = {}
    for i in "LR":
        for j in "LR":
            r = np.array([np.linalg.norm(cB + sign[j] * xx * n - sign[i] * xx * n) for xx in xs])
            U = -G * m_A * m_B / r
            phases[i + j] = float(-np.trapezoid(U, ts) / hbar)
    dphi = phases["LL"] + phases["RR"] - phases["LR"] - phases["RL"]
    return {"phases": phases, "delta_phi": dphi, "total_time": total, "acceleration": a,
            "required_gradient_T_per_m": sg_required_gradient(m_A, dx_target, tau),
            "trajectory_t": ts[::20].tolist(), "trajectory_x": xs[::20].tolist()}
