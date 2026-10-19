"""Suite 2 — Classical gravitation and numerical relativity (classical predictions only).

Everything in this module is a *classical* gravitational prediction. Quantised-field descriptions
live in `qgdevs.qg_eft` and the competing-model registry; the separation is deliberate (spec Suite 2).

Contents
* Newtonian potentials of point masses and uniform spheres (including overlapping spheres, needed
  for gravitational self-energy differences in collapse models).
* N-body integration with a symplectic velocity-Verlet scheme and an adaptive RK reference.
* Schwarzschild geodesics: perihelion precession and light deflection benchmarks.
* Weak-field (linearised GR) metric quantities: Newtonian potential, Shapiro delay, redshift.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
from scipy.integrate import quad, solve_ivp

from .constants import G, c


# ----------------------------------------------------------------------------- potentials
def point_potential_energy(m1: float, m2: float, r: float) -> float:
    """U = -G m1 m2 / r  [J]."""
    return -G * m1 * m2 / r


def sphere_potential(M: float, R: float, s: float) -> float:
    """Gravitational potential Φ(s) [J/kg] of a uniform sphere (mass M, radius R) at distance s from its centre."""
    if s >= R:
        return -G * M / s
    return -G * M * (3 * R**2 - s**2) / (2 * R**3)


@lru_cache(maxsize=4096)
def sphere_mutual_energy(m1: float, R1: float, m2: float, R2: float, d: float) -> float:
    """Mutual gravitational energy [J] of two uniform spheres whose centres are a distance d apart.

    For d >= R1 + R2 this equals the point-mass result exactly (shell theorem). For overlapping spheres
    it is evaluated as U = ∫ ρ1 Φ2 dV by integrating over spherical shells about sphere 2's centre:
    the area of the shell of radius s lying inside sphere 1 is 2π s² (1 - cos θ0), cos θ0 = (s²+d²-R1²)/(2sd).
    """
    if d >= R1 + R2:
        return -G * m1 * m2 / d
    rho1 = m1 / (4 / 3 * np.pi * R1**3)

    def area_inside(s):
        if d == 0:
            return 4 * np.pi * s**2 if s <= R1 else 0.0
        cos0 = (s**2 + d**2 - R1**2) / (2 * s * d)
        if cos0 >= 1:
            return 0.0
        if cos0 <= -1:
            return 4 * np.pi * s**2
        return 2 * np.pi * s**2 * (1 - cos0)

    lo, hi = max(0.0, d - R1), d + R1
    pts = [p for p in (R2, abs(d - R1), R1 - d) if lo < p < hi]
    # shells with s < R1 - d lie wholly inside sphere 1; area_inside returns 4πs² for them
    val, _ = quad(lambda s: area_inside(s) * sphere_potential(m2, R2, s), lo, hi,
                  points=pts or None, limit=400, epsabs=0, epsrel=1e-12)
    return rho1 * val


def sphere_self_energy(m: float, R: float) -> float:
    """Gravitational self-energy of a uniform sphere: -3 G m² / (5 R)."""
    return -3 * G * m**2 / (5 * R)


def gravitational_self_energy_difference(m: float, R: float, d: float) -> float:
    """E_Δ = U(d) - U(0) [J], with U the mutual energy between two copies of a uniform sphere.

    This is the Diósi–Penrose quantity for a superposition of a uniform sphere displaced by d.
    For d >= 2R it equals G m² (6/(5R) - 1/d). Conventions in the literature differ by a factor of
    two (Penrose 1996 vs Diósi 1987); see qgdevs.models.DiosiPenrose for the convention used.
    """
    return sphere_mutual_energy(m, R, m, R, d) - sphere_mutual_energy(m, R, m, R, 0.0)


# ----------------------------------------------------------------------------- N-body
def nbody_accelerations(pos: np.ndarray, masses: np.ndarray, softening: float = 0.0) -> np.ndarray:
    diff = pos[None, :, :] - pos[:, None, :]
    r2 = np.sum(diff**2, axis=-1) + softening**2
    np.fill_diagonal(r2, np.inf)
    inv_r3 = r2 ** -1.5
    return G * np.einsum("ij,ijk,j->ik", inv_r3, diff, masses)


def nbody_energy(pos, vel, masses) -> float:
    ke = 0.5 * np.sum(masses * np.sum(vel**2, axis=1))
    pe = 0.0
    n = len(masses)
    for i in range(n):
        for j in range(i + 1, n):
            pe -= G * masses[i] * masses[j] / np.linalg.norm(pos[i] - pos[j])
    return float(ke + pe)


def nbody_verlet(pos0, vel0, masses, dt: float, nsteps: int, save_every: int = 1):
    """Symplectic velocity-Verlet integration (second order; bounded long-time energy error)."""
    pos, vel = np.array(pos0, float), np.array(vel0, float)
    masses = np.asarray(masses, float)
    a = nbody_accelerations(pos, masses)
    traj_p, traj_v, ts = [pos.copy()], [vel.copy()], [0.0]
    for k in range(1, nsteps + 1):
        vel += 0.5 * dt * a
        pos += dt * vel
        a = nbody_accelerations(pos, masses)
        vel += 0.5 * dt * a
        if k % save_every == 0:
            traj_p.append(pos.copy()); traj_v.append(vel.copy()); ts.append(k * dt)
    return np.array(ts), np.array(traj_p), np.array(traj_v)


def nbody_rk(pos0, vel0, masses, t_final: float, n_out: int = 200, rtol=1e-11, atol=1e-14):
    """Adaptive DOP853 reference integration for independent verification of the Verlet solver."""
    pos0, vel0 = np.asarray(pos0, float), np.asarray(vel0, float)
    n, dim = pos0.shape
    masses = np.asarray(masses, float)

    def f(t, y):
        p = y[: n * dim].reshape(n, dim)
        v = y[n * dim:]
        return np.concatenate([v, nbody_accelerations(p, masses).ravel()])

    ts = np.linspace(0, t_final, n_out)
    sol = solve_ivp(f, (0, t_final), np.concatenate([pos0.ravel(), vel0.ravel()]), t_eval=ts,
                    rtol=rtol, atol=atol, method="DOP853")
    return ts, sol.y[: n * dim].T.reshape(-1, n, dim), sol.y[n * dim:].T.reshape(-1, n, dim)


def kepler_period(a: float, M_total: float) -> float:
    return 2 * np.pi * np.sqrt(a**3 / (G * M_total))


# ----------------------------------------------------------------------------- Schwarzschild geodesics
def schwarzschild_radius(M: float) -> float:
    return 2 * G * M / c**2


def perihelion_precession_numeric(M: float, a: float, e: float, n_orbits: int = 1) -> float:
    """Perihelion advance per orbit [rad] from the exact Schwarzschild orbit equation
        u'' + u = GM/h² + 3GM u²/c²,   u = 1/r,
    integrated in the azimuth φ; the advance is located from successive maxima of u.
    """
    p = a * (1 - e**2)
    # Initial condition at perihelion of the osculating ellipse. h² chosen so that the Newtonian
    # part reproduces the ellipse; the GR term then produces the precession.
    h2 = G * M * p
    u0 = (1 + e) / p
    mu = G * M / h2
    eps = 3 * G * M / c**2

    def f(phi, y):
        return [y[1], mu + eps * y[0] ** 2 - y[0]]

    def du_zero(phi, y):  # perihelion: u' = 0 with u'' < 0
        return y[1]
    du_zero.direction = -1

    sol = solve_ivp(f, (0, 2 * np.pi * (n_orbits + 0.5)), [u0, 0.0], events=du_zero,
                    rtol=1e-13, atol=1e-16 * u0, method="DOP853", max_step=0.01)
    phis = [p_ for p_ in sol.t_events[0] if p_ > 1.0]
    return float((phis[n_orbits - 1] - 2 * np.pi * n_orbits) / n_orbits)


def perihelion_precession_analytic(M: float, a: float, e: float) -> float:
    """Leading-order GR result Δφ = 6πGM / (c² a (1-e²)) [rad per orbit] (Einstein 1915)."""
    return 6 * np.pi * G * M / (c**2 * a * (1 - e**2))


def light_deflection_numeric(M: float, b: float) -> float:
    """Total deflection of a light ray with impact parameter b from the null orbit equation u'' + u = 3GMu²/c²."""
    eps = 3 * G * M / c**2

    def f(phi, y):
        return [y[1], eps * y[0] ** 2 - y[0]]

    def escaped(phi, y):
        return y[0]
    escaped.terminal = True
    escaped.direction = -1
    sol = solve_ivp(f, (0, 4 * np.pi), [0.0, 1.0 / b], events=escaped, rtol=1e-13, atol=1e-20,
                    method="DOP853", max_step=1e-3)
    return float(sol.t_events[0][0] - np.pi)


def light_deflection_analytic(M: float, b: float) -> float:
    """Weak-field deflection 4GM/(c² b)."""
    return 4 * G * M / (c**2 * b)


def shapiro_delay(M: float, r1: float, r2: float, b: float) -> float:
    """One-way Shapiro delay (2GM/c³) ln[(r1 + sqrt(r1²-b²))(r2 + sqrt(r2²-b²))/b²]  [s]."""
    return 2 * G * M / c**3 * np.log((r1 + np.sqrt(r1**2 - b**2)) * (r2 + np.sqrt(r2**2 - b**2)) / b**2)


def weak_field_metric_g00(M: float, r: float) -> float:
    """g_00 = -(1 + 2Φ/c²) for the linearised Schwarzschild metric (signature -+++)."""
    return -(1 - 2 * G * M / (r * c**2))


def gravitational_redshift(M: float, r_emit: float, r_obs: float) -> float:
    """Fractional frequency shift Δν/ν between static observers in the Schwarzschild metric (exact)."""
    rs = schwarzschild_radius(M)
    return float(np.sqrt((1 - rs / r_emit) / (1 - rs / r_obs)) - 1)
