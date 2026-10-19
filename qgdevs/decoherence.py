"""Suite 7 — Quantum decoherence and open systems: environmental decoherence budget.

All rates are single-mass branch-coherence decay rates Γ [s^-1] for a spatial superposition of
separation Δx, i.e. |ρ_LR(t)| = |ρ_LR(0)| e^{-Γ t}. They feed `bmv.joint_state` and the Lindblad
dephasing operators. Each mechanism states its validity regime; outside it the result is flagged.

References
* Joos & Zeh, Z. Phys. B 59, 223 (1985); Schlosshauer, "Decoherence and the Quantum-to-Classical
  Transition", Springer (2007), ch. 3 — scattering decoherence, long-wavelength localisation rates.
* Romero-Isart, PRA 84, 052121 (2011), doi:10.1103/PhysRevA.84.052121 — black-body emission,
  absorption and scattering for dielectric spheres.
* Diósi, PRA 40, 1165 (1989); Penrose, Gen. Rel. Grav. 28, 581 (1996) — gravitational collapse.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
from scipy.special import zeta

from .constants import hbar, k_B, c, u as amu
from .gravity import gravitational_self_energy_difference

M_N2 = 28.0134 * amu  # default residual gas: nitrogen


def mean_speed(T: float, m_gas: float = M_N2) -> float:
    return float(np.sqrt(8 * k_B * T / (np.pi * m_gas)))


def gas_collision_rate(R: float, pressure: float, T_gas: float, m_gas: float = M_N2, dx: float | None = None) -> dict:
    """Saturated-regime collisional decoherence: every collision resolves which-path.

    Γ = n σ v̄ with n = P/(k_B T), σ = πR² (geometric cross-section), v̄ the mean thermal speed.
    Valid when Δx exceeds the thermal de Broglie wavelength of the gas molecules (N₂: ~3e-10 m at 1 K, ~2e-11 m at 300 K),
    which holds for all BMV-scale superpositions. This is a conservative (upper-bound-like) estimate:
    a single collision is assumed to destroy coherence (Schlosshauer 2007, §3.4).
    """
    n = pressure / (k_B * T_gas)
    v = mean_speed(T_gas, m_gas)
    lam_gas = 2 * np.pi * hbar / np.sqrt(2 * np.pi * m_gas * k_B * T_gas)
    if dx is None or dx > lam_gas:
        regime = "saturated (Δx >> λ_gas)"
    else:  # each collision then carries only partial which-path information: the rate is an upper bound
        regime = "NOT saturated (Δx ≤ λ_gas): saturated rate shown is an upper bound"
    return {"rate": float(n * np.pi * R**2 * v), "number_density_m3": n, "mean_speed_m_s": v,
            "gas_thermal_wavelength_m": float(lam_gas), "regime": regime}


def blackbody_rates(R: float, dx: float, T_env: float, T_int: float, cm: complex) -> dict:
    """Black-body scattering, absorption and emission decoherence (long-wavelength limit Δx << λ_th).

    Λ_sc = 8!·8ζ(9) c R⁶ /(9π) (k_B T_env/ħc)⁹ Re(cm)²
    Λ_abs = 16π⁵ c R³ /189 (k_B T_env/ħc)⁶ Im(cm),   Λ_em: same with T_int
    Γ = Λ Δx²   where cm = (ε-1)/(ε+2) is the Clausius–Mossotti factor.
    If Δx exceeds the thermal photon wavelength the rate saturates; the function then returns the
    rate evaluated at Δx = λ_th and flags the regime.
    """
    def lam_th(T):
        return 2 * np.pi * hbar * c / (k_B * T) if T > 0 else np.inf

    def a(T):
        return k_B * T / (hbar * c)

    out = {}
    for name, T, Lfun in [
        ("scattering", T_env, lambda T: 40320 * 8 * zeta(9) * c * R**6 / (9 * np.pi) * a(T)**9 * cm.real**2),
        ("absorption", T_env, lambda T: 16 * np.pi**5 * c * R**3 / 189 * a(T)**6 * cm.imag),
        ("emission", T_int, lambda T: 16 * np.pi**5 * c * R**3 / 189 * a(T)**6 * cm.imag),
    ]:
        if T <= 0:
            out[name] = {"rate": 0.0, "Lambda_m2_s": 0.0, "regime": "T = 0"}
            continue
        L = float(Lfun(T))
        lt = lam_th(T)
        eff = min(dx, lt)
        out[name] = {"rate": L * eff**2, "Lambda_m2_s": L, "thermal_wavelength_m": lt,
                     "regime": "long-wavelength (Δx << λ_th)" if dx < lt else "saturated (Δx >= λ_th): rate capped at Λ λ_th²"}
    return out


def diosi_penrose_rate(m: float, R: float, dx: float, convention_factor: float = 1.0) -> dict:
    """Γ_DP = κ E_Δ / ħ with E_Δ = U(Δx) - U(0) for a uniform sphere (gravity.gravitational_self_energy_difference).

    κ = 1 gives Diósi's mass-density convention with uniform-sphere smearing; κ = 2 corresponds to
    Penrose's E_G defined via the difference of mass distributions. The convention is recorded in
    every output because the literature differs by this factor.
    """
    E = gravitational_self_energy_difference(m, R, dx)
    return {"rate": convention_factor * E / hbar, "E_delta_J": E, "convention_factor": convention_factor,
            "regime": "uniform-sphere mass density smeared at the particle radius"}


def budget(m: float, R: float, dx: float, *, pressure: float, T_gas: float, T_env: float, T_int: float,
           cm: complex, t: float, include_dp: bool = False, dp_convention: float = 1.0,
           m_gas: float = M_N2, include_csl: bool = False, csl_lambda: float = 1e-16) -> dict:
    """Total decoherence budget for one superposed mass over interaction time t.

    Established environmental mechanisms only by default; hypothetical collapse models (Diósi–Penrose, CSL)
    are opt-in and flagged with "hypothetical": True so they are never mixed silently into the total."""
    items = {}
    g = gas_collision_rate(R, pressure, T_gas, m_gas, dx)
    items["gas_collisions"] = g
    for k, v in blackbody_rates(R, dx, T_env, T_int, cm).items():
        items[f"blackbody_{k}"] = v
    if include_dp:
        items["diosi_penrose_collapse"] = {**diosi_penrose_rate(m, R, dx, dp_convention), "hypothetical": True}
    if include_csl:
        items["csl_collapse"] = {**csl_rate(m, R, dx, csl_lambda), "hypothetical": True}
    env_total = sum(v["rate"] for v in items.values() if not v.get("hypothetical"))
    total = sum(v["rate"] for v in items.values())
    for v in items.values():
        v["gamma_t"] = v["rate"] * t
        v["coherence_factor"] = float(np.exp(-v["rate"] * t))
    dominant = max(items, key=lambda k: items[k]["rate"]) if items else None
    fastest = max((v["rate"] for v in items.values()), default=0.0)
    return {"mechanisms": items, "total_rate": total, "total_gamma_t": total * t,
            "coherence_factor": float(np.exp(-total * t)), "dominant": dominant,
            "environmental_total_rate": env_total, "includes_hypothetical": env_total != total,
            "suggested_display_window_s": float(min(t, 5.0 / fastest)) if fastest > 0 else t}


def max_pressure_for(R: float, T_gas: float, rate_target: float, m_gas: float = M_N2) -> float:
    """Pressure [Pa] at which the collisional rate equals rate_target (inverse of gas_collision_rate)."""
    v = mean_speed(T_gas, m_gas)
    return float(rate_target * k_B * T_gas / (np.pi * R**2 * v))


def max_temperature_for(R: float, dx: float, cm: complex, rate_target: float, which: str = "emission") -> float:
    """Highest temperature [K] at which a given black-body channel stays below rate_target (bisection)."""
    lo, hi = 1e-4, 1e4
    for _ in range(200):
        mid = np.sqrt(lo * hi)
        r = blackbody_rates(R, dx, mid, mid, cm)[which]["rate"]
        if r > rate_target:
            hi = mid
        else:
            lo = mid
    return float(lo)


# ----------------------------------------------------------------------------- CSL collapse
CSL_DEFAULTS = {"lambda_s": 1e-16, "r_C_m": 1e-7}  # GRW/Ghirardi–Pearle–Rimini values; Adler proposes λ ~ 1e-8 s⁻¹


def _sphere_form_factor(q: float) -> float:
    """Normalised Fourier transform of a uniform ball: f(q) = 3 (sin q − q cos q)/q³, f(0) = 1."""
    if q < 1e-4:
        return 1.0 - q * q / 10.0
    return 3.0 * (np.sin(q) - q * np.cos(q)) / q**3


@lru_cache(maxsize=2048)
def csl_rate(m: float, R: float, dx: float, lambda_s: float = CSL_DEFAULTS["lambda_s"],
             r_C: float = CSL_DEFAULTS["r_C_m"], m0: float = amu) -> dict:
    """Mass-proportional CSL decoherence rate of a uniform sphere superposed over Δx:

        Γ = λ (4π r_C²)^{3/2}/m0² ∫ d³k/(2π)³ e^{−k² r_C²} |ρ̃(k)|² (1 − cos k·Δx)
          = λ (m/m0)² (4π r_C²)^{3/2} (4π/(2π)³) ∫₀^∞ k² e^{−k² r_C²} f(kR)² (1 − sin(kΔx)/(kΔx)) dk

    (Bassi, Lochan, Satin, Singh & Ulbricht, Rev. Mod. Phys. 85, 471 (2013)). For R ≪ r_C it reduces to
    Γ = λ (m/m0)² (1 − e^{−Δx²/4r_C²}) (verified in qgdevs.vv). λ and r_C are phenomenological parameters,
    constrained but not fixed by experiment.
    """
    from scipy.integrate import quad
    pref = lambda_s * (m / m0) ** 2 * (4 * np.pi * r_C**2) ** 1.5 * 4 * np.pi / (2 * np.pi) ** 3

    def g(k):
        kx = k * dx
        sinc = 1.0 - kx * kx / 6.0 if kx < 1e-4 else np.sin(kx) / kx
        return k * k * np.exp(-(k * r_C) ** 2) * _sphere_form_factor(k * R) ** 2 * (1.0 - sinc)

    kmax = 8.0 / r_C
    n_osc = max(1, int(kmax * max(R, dx) / np.pi))
    edges = np.linspace(0, kmax, min(n_osc, 4000) + 1)
    val = sum(quad(g, a, b, limit=200, epsabs=0, epsrel=1e-10)[0] for a, b in zip(edges[:-1], edges[1:]))
    return {"rate": float(pref * val), "lambda_s": lambda_s, "r_C_m": r_C,
            "regime": "point-like (R ≪ r_C)" if R < 0.1 * r_C else "extended body (form factor included)"}
