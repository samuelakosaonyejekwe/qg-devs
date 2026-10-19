"""Tests for the CG-QFT-AH model (Aziz & Howl, Nature 646, 813 (2025); arXiv:2510.19714).

Equation labels refer to the LaTeX labels of the arXiv source.
"""
import numpy as np
import pytest

from qgdevs import bmv, model_ah as ah, models, quantum as qm
from qgdevs.constants import G, hbar


def _hyp():
    """Local (unregistered) Hypothesis wrapper so the tests do not depend on models.py integration."""
    return models.Hypothesis("CG-QFT-AH", "Aziz–Howl", "hybrid", ah.META, ah.EXTRA_NUISANCE, True, ah.ah_state)


def _sizable_design(**kw):
    """Planck-scale design inside the paper's stated domain except perturbativity (used for structure tests)."""
    base = dict(geometry="linear", mass_A=1e-9, mass_B=1e-9, separation=4e-3, dx_A=2e-3, dx_B=2e-3, time=1e-4)
    base.update(kw)
    return bmv.BMVDesign(**base)


# ----------------------------------------------------------------------------- closed form vs paper
def test_closed_form_equals_eq_vartheta_for_identical_spheres():
    M, R, d, t, m = 1e-8, 1e-4, 1e-3, 1.0, ah.YTTERBIUM_MASS
    expected = 6 / 25 * G**2 * m**2 * M**3 * R * t / (hbar**3 * d)          # eq:vartheta
    assert ah.ah_amplitude_root(M, R, M, R, d, t, m) == pytest.approx(expected, rel=1e-14)
    assert ah.vartheta(M, R, d, t, m) == pytest.approx(expected**2, rel=1e-14)


def test_six_over_twenty_five_from_numerical_eq_beta4ijFull():
    """Direct MC evaluation of eq:beta4ijFull with the semiclassical Φ (eq:semiclassicalPhi) converges to
    eq:betaCG as R/Δx, R/d → 0 (the approximations under which the paper states the 6/25 result)."""
    d = bmv.BMVDesign(geometry="parallel", mass_A=1e-8, mass_B=1e-8, separation=5.0, dx_A=2.0, dx_B=2.0, time=1e-3)
    mc = ah.beta4_integral_mc(d, n=100_000, seed=1)
    for k, r in bmv.branch_distances(d).items():
        cf = ah.ah_amplitude_root(d.mass_A, d.radius_A, d.mass_B, d.radius_B, r, d.time)
        assert mc[k]["X"] == pytest.approx(cf, rel=2e-3), k


def test_finite_size_corrections_are_order_R_over_distance():
    near = bmv.BMVDesign(geometry="parallel", mass_A=1e-8, mass_B=1e-8, separation=5e-2, dx_A=2e-2, dx_B=2e-2, time=1e-3)
    mc = ah.beta4_integral_mc(near, n=50_000, seed=2)
    r = bmv.branch_distances(near)["LL"]
    ratio = mc["LL"]["X"] / ah.ah_amplitude_root(near.mass_A, near.radius_A, near.mass_B, near.radius_B, r, near.time)
    eps = near.radius_A / near.dx_A
    assert 1.0 < ratio < 1.0 + 10 * eps


def test_unequal_mass_extension_matches_numerical_integral():
    d = bmv.BMVDesign(geometry="parallel", mass_A=1e-8, mass_B=8e-8, separation=5.0, dx_A=2.0, dx_B=2.0, time=1e-3)
    mc = ah.beta4_integral_mc(d, n=100_000, seed=3)
    r = bmv.branch_distances(d)["LR"]
    cf = ah.ah_amplitude_root(d.mass_A, d.radius_A, d.mass_B, d.radius_B, r, d.time)
    assert mc["LR"]["X"] == pytest.approx(cf, rel=2e-3)


def test_reproduces_fig4_red_line():
    """Fig. 4: ϑ = 0.1 line for ytterbium, d_RL = 10R. Digitised from the published figure (arXiv source
    Figure4Nature.pdf): M ≈ 2.9e-11 kg at t = 1 s and M ≈ 2.9e-6 kg at t = 1e-15 s; slope dlogM/dlogt = −1/3."""
    m = ah.YTTERBIUM_MASS
    rho = 6900.0

    def M_line(t):
        from scipy.optimize import brentq
        f = lambda lx: np.log(ah.vartheta(np.exp(lx), (3 * np.exp(lx) / (4 * np.pi * rho)) ** (1 / 3),
                                          10 * (3 * np.exp(lx) / (4 * np.pi * rho)) ** (1 / 3), t, m) / 0.1)
        return np.exp(brentq(f, np.log(1e-20), np.log(1e3)))

    for t, M_fig in ((1.0, 2.9e-11), (1e-15, 2.9e-6)):
        assert abs(np.log10(M_line(t) / M_fig)) < 0.15
    slope = np.log10(M_line(1e-15) / M_line(1.0)) / -15
    assert slope == pytest.approx(-1 / 3, rel=1e-6)


def test_vartheta_density_independent_at_d_equals_10R():
    """Fig. 4 caption: with d_RL = 10R, ϑ is independent of the density."""
    M, t, m = 1e-9, 1.0, ah.YTTERBIUM_MASS
    vals = []
    for rho in (1000.0, 3510.0, 6900.0, 19300.0):
        R = (3 * M / (4 * np.pi * rho)) ** (1 / 3)
        vals.append(ah.vartheta(M, R, 10 * R, t, m))
    assert np.ptp(vals) / np.mean(vals) < 1e-12


def test_bose_regime_vartheta_much_smaller_than_phi():
    """Paper: for M ≈ 1e-14 kg, t ≈ 2 s (Bose et al.), ϑ is 'substantially smaller' than φ."""
    r = ah.benchmark_comparison()
    assert r["ah_vartheta_closest_pair"] < 1e-25 * r["qg_phi_closest_pair_rad"]


def test_operator_potential_factor_16():
    """App. 'Virtual matter in quantum gravity': κ⁽⁴⁾ = ((24/25)…)² = 16 β⁽⁴⁾."""
    k = ah.ah_amplitude_root(1e-8, 1e-4, 1e-8, 1e-4, 1e-3, 1.0, coefficient=ah.COEFF_OPERATOR_POTENTIAL) ** 2
    b = ah.ah_amplitude_root(1e-8, 1e-4, 1e-8, 1e-4, 1e-3, 1.0) ** 2
    assert k / b == pytest.approx(16.0, rel=1e-14)
    d = _sizable_design()
    assert ah.ah_entangling_strength(d, sourcing_factor=16.0) == pytest.approx(16 * ah.ah_entangling_strength(d))


# ----------------------------------------------------------------------------- scaling exponents
@pytest.mark.parametrize("name,exponent", [("M", 6.0), ("t", 2.0), ("d", -2.0), ("m", 4.0), ("R", 2.0)])
def test_scaling_exponents(name, exponent):
    base = dict(M=1e-9, R=1e-4, d=1e-3, t=1e-3, m=ah.CARBON12_MASS)

    def v(**kw):
        p = {**base, **kw}
        return ah.vartheta(p["M"], p["R"], p["d"], p["t"], p["m"])

    k = 1.7
    assert np.log(v(**{name: base[name] * k}) / v()) / np.log(k) == pytest.approx(exponent, rel=1e-10)


def test_hbar_and_G_exponents():
    """ϑ ∝ G⁴ ħ⁻⁶ (vs QG-COH φ ∝ G ħ⁻¹): check by dimensional rescaling of the closed form."""
    M, R, d, t, m = 1e-9, 1e-4, 1e-3, 1e-3, ah.CARBON12_MASS
    th = ah.vartheta(M, R, d, t, m)
    th_hand = (6 / 25) ** 2 * G**4 * m**4 * M**6 * R**2 * t**2 / (hbar**6 * d**2)
    assert th == pytest.approx(th_hand, rel=1e-12)
    phi = ah.qg_phase(M, d, t)
    assert phi == pytest.approx(G * M**2 * t / (hbar * d))


def test_small_superposition_geometry_factor():
    """For Δx ≪ d the paper states ϑ̄/φ̄ = ϑ/φ with ϑ̄ = ϑΔx²/d². Applying eq:betaCG branch-wise gives the same
    Δx²/d² scaling but an O(1) geometric factor: 3 (linear) and 2 (parallel), because 1/d² vs 1/d."""
    for geom, factor in (("linear", 3.0), ("parallel", 2.0)):
        d = bmv.BMVDesign(geometry=geom, mass_A=1e-9, mass_B=1e-9, separation=1.0, dx_A=1e-3, dx_B=1e-3, time=1e-4)
        eps = ah.ah_entangling_strength(d)
        dphi = abs(bmv.entangling_phase(bmv.phases_from_energies(bmv.gravitational_branch_energies(d, False), d.time)))
        th = ah.vartheta(d.mass_A, d.radius_A, d.separation, d.time, ah.CARBON12_MASS)
        ph = ah.qg_phase(d.mass_A, d.separation, d.time)
        assert (eps / dphi) / (th / ph) == pytest.approx(factor, rel=1e-3)


# ----------------------------------------------------------------------------- limits / state
def test_vanishing_coupling_reduces_to_semiclassical_mean_field():
    sc = models.Scenario(_sizable_design(), gamma_env_A=0.3, gamma_env_B=0.1)
    h = _hyp()
    eta = {"ah_sourcing_factor": 1.0, "ah_constituent_mass_kg": 0.0}
    rho0 = h.state(sc, eta)
    rho_mf = models.get("SC-MF").state(sc)
    assert np.allclose(rho0, rho_mf, atol=1e-13)
    # and the entangling strength vanishes with m → 0 or t → 0
    assert ah.ah_entangling_strength(_sizable_design(), constituent_mass=0.0) == 0.0


def test_benchmark_state_indistinguishable_from_sc_mf():
    sc = models.Scenario(bmv.BMVDesign(geometry="linear"))
    rho = _hyp().state(sc)
    assert np.allclose(rho, models.get("SC-MF").state(sc), atol=1e-15)
    assert qm.concurrence(rho) < 1e-12


@pytest.mark.parametrize("rep", ["amplitude", "phase"])
def test_state_is_physical_and_entangled_when_effect_is_large(rep):
    d = _sizable_design(time=2e-2)
    sc = models.Scenario(d, gamma_env_A=0.0, gamma_env_B=0.0)
    eta = {**_hyp().nominal_eta()}
    rho = ah.ah_state(sc, eta, representation=rep)
    chk = qm.check_density_matrix(rho)
    assert chk.as_dict()["passed"], chk.as_dict()
    eps = ah.ah_entangling_strength(d)
    assert 1e-4 < eps < 0.05                      # perturbative and resolvable
    assert qm.concurrence(rho) == pytest.approx(eps / 2, rel=0.05)


def test_state_physical_with_decoherence_and_nuisance_extremes():
    d = _sizable_design(time=2e-2)
    sc = models.Scenario(d, gamma_env_A=1e4, gamma_env_B=5e3,
                         nongrav_energies={"LL": 1e-30, "LR": -2e-30, "RL": 0.0, "RR": 3e-30})
    h = _hyp()
    for n in h.nuisance:
        for v in (n.low, n.high):
            rho = h.state(sc, {n.name: v})
            assert qm.check_density_matrix(rho).as_dict()["passed"]


def test_meta_and_nuisance_complete():
    for k in ("dynamics", "assumptions", "approximations", "admissible_domain", "known_limits",
              "entangling_by_gravity", "references", "assurance", "status_note"):
        assert k in ah.META
    assert ah.META["assurance"] == "PARTIALLY VERIFIED"
    assert any("2511.07348" in r for r in ah.META["references"])
    assert any("10.1038/s41586-025-09595-7" in r for r in ah.META["references"])
    assert [n.name for n in ah.EXTRA_NUISANCE] == ["ah_sourcing_factor"]


def test_validity_flags_bose_benchmark_outside_paper_domain():
    v = ah.ah_validity(bmv.BMVDesign(geometry="linear"))
    assert "no_wavepacket_spreading_t_le_2mR2_over_hbar" in v["violated"]
    lim = v["checks"]["no_wavepacket_spreading_t_le_2mR2_over_hbar"]["t_limit_s"]
    assert 1e-4 < lim < 1e-3


def test_branch_phases_keys_and_sign():
    ph = ah.ah_branch_phases(_sizable_design())
    assert set(ph) == set(bmv.BRANCH_LABELS)
    assert all(v > 0 for v in ph.values())
    assert ph["LR"] == max(ph.values())          # closest pair in the linear geometry


def test_planck_regime_design_satisfies_all_paper_conditions():
    v = ah.ah_validity(_sizable_design(time=2e-2))
    assert v["all_satisfied"], v["violated"]
