"""Suite 15 — independent-implementation comparison: C++ kernel (qgdevs.native) vs Python reference.

Skipped entirely if the native library is not built (`make -C cpp`).
"""
import numpy as np
import pytest

from qgdevs import bmv, constants, gravity, native
from qgdevs import quantum as qm

pytestmark = pytest.mark.skipif(not native.available(), reason=f"native library unavailable: "
                                                                f"{native.unavailable_reason()}")

SEED = 20261019


def random_designs(n, seed=SEED):
    rng = np.random.default_rng(seed)
    out = []
    for _ in range(n):
        sep = rng.uniform(200e-6, 1e-3)
        out.append(bmv.BMVDesign(
            mass_A=10 ** rng.uniform(-15, -13), mass_B=10 ** rng.uniform(-15, -13),
            separation=sep, dx_A=rng.uniform(0.1, 1.0) * sep, dx_B=rng.uniform(0.1, 1.0) * sep,
            geometry=str(rng.choice(["parallel", "linear", "angled"])), angle_deg=rng.uniform(0, 180),
            time=rng.uniform(0.1, 5.0), gamma_A=rng.choice([0.0, rng.uniform(0, 0.5)]),
            gamma_B=rng.choice([0.0, rng.uniform(0, 0.5)])))
    return [d for d in out if not bmv.check_geometry(d)]


def python_reference(d):
    E = bmv.gravitational_branch_energies(d, finite_size=True)
    ph = bmv.phases_from_energies(E, d.time)
    rho = bmv.joint_state(ph, d.gamma_A * d.time, d.gamma_B * d.time)
    U = bmv.local_phase_correction(ph)
    return {"distances": bmv.branch_distances(d), "energies": E, "phases": ph,
            "delta_phi": bmv.entangling_phase(ph), "rho": rho, "negativity": qm.negativity(rho),
            "concurrence": qm.concurrence(rho), "purity": qm.purity(rho),
            "witness": bmv.cpk_witness_best_sign(U @ rho @ U.conj().T)}


def concurrence_reference(rho):
    """Wootters concurrence with λ_i as singular values of sqrt(ρ)(Y⊗Y)sqrt(ρ)* (numpy LAPACK SVD).

    qm.concurrence takes sqrt|eig(ρρ̃)|, which turns round-off-level zero eigenvalues (~1e-16) into
    ~1e-8 errors for rank-deficient ρ (up to ~6e-7 observed on pure BMV states). It is therefore
    compared directly only on full-rank states; elsewhere this conditioning-safe form is used.
    """
    w, v = np.linalg.eigh(rho)
    w = np.where(w > 16 * np.finfo(float).eps * np.abs(w).max(), w, 0.0)
    sr = (v * np.sqrt(w)) @ v.conj().T
    s = np.linalg.svd(sr @ np.kron(qm.Y, qm.Y) @ sr.conj(), compute_uv=False)
    return max(0.0, s[0] - s[1] - s[2] - s[3])


def assert_concurrence(c_native, rho):
    assert c_native == pytest.approx(concurrence_reference(rho), abs=1e-8)
    if np.linalg.eigvalsh(rho).min() > 1e-6:
        assert c_native == pytest.approx(qm.concurrence(rho), abs=1e-8)


def random_density_matrix(d, rng, rank=None):
    rank = rank or d
    A = rng.normal(size=(d, rank)) + 1j * rng.normal(size=(d, rank))
    rho = A @ A.conj().T
    return rho / np.trace(rho).real


def random_hermitian(d, rng):
    A = rng.normal(size=(d, d)) + 1j * rng.normal(size=(d, d))
    return 0.5 * (A + A.conj().T)


def test_constants_identical():
    c = native.constants()
    for k in ("G", "hbar", "h", "c", "k_B"):
        assert c[k] == getattr(constants, k)


def test_eigvalsh_vs_numpy():
    rng = np.random.default_rng(SEED)
    for n in range(1, 17):
        A = random_hermitian(n, rng)
        np.testing.assert_allclose(native.eigvalsh(A), np.linalg.eigvalsh(A), rtol=0, atol=1e-13 * np.abs(A).max() * n)


def test_bmv_point_matches_reference():
    designs = random_designs(300)
    assert len(designs) > 100
    for d in designs:
        ref, nat = python_reference(d), native.bmv_point(d)
        for k in bmv.BRANCH_LABELS:
            assert nat["branch_distances_m"][k] == pytest.approx(ref["distances"][k], rel=1e-13)
            assert nat["energies_J"][k] == pytest.approx(ref["energies"][k], rel=1e-13)
            assert nat["phases_rad"][k] == pytest.approx(ref["phases"][k], rel=1e-13)
        assert nat["delta_phi"] == pytest.approx(ref["delta_phi"], rel=1e-9, abs=1e-15)
        np.testing.assert_allclose(nat["rho"], ref["rho"], rtol=1e-9, atol=1e-15)
        for k in ("negativity", "witness", "purity"):
            key = "witness_cpk_local_corrected" if k == "witness" else k
            assert nat[key] == pytest.approx(ref[k], abs=1e-8), (k, d)
        assert_concurrence(nat["concurrence"], ref["rho"])
        if d.gamma_A == 0 and d.gamma_B == 0:
            assert nat["concurrence"] == pytest.approx(abs(np.sin(ref["delta_phi"] / 2)), abs=1e-12)


def test_parallel_closed_form():
    d = bmv.BMVDesign()
    expect = bmv.parallel_geometry_delta_phi_analytic(d.mass_A, d.mass_B, d.separation, d.dx_A, d.time)
    assert native.bmv_point(d)["delta_phi"] == pytest.approx(expect, rel=1e-12)


def test_overlap_is_refused_not_approximated():
    d = bmv.BMVDesign(separation=1e-7, dx_A=1e-8, dx_B=1e-8, mass_A=1e-14, mass_B=1e-14)
    with pytest.raises(native.NativeError, match="overlap"):
        native.bmv_point(d)
    out = native.bmv_sweep([1e-14], [1e-7], [1e-8], [1.0], [0.0])
    assert np.isnan(out["delta_phi"]).all()


def test_measures_on_random_states():
    rng = np.random.default_rng(SEED + 1)
    for k in range(400):
        rho = random_density_matrix(4, rng, rank=1 + k % 4)
        assert native.negativity(rho) == pytest.approx(qm.negativity(rho), abs=1e-8)
        assert_concurrence(native.concurrence(rho), rho)
        assert native.purity(rho) == pytest.approx(qm.purity(rho), rel=1e-12)
        assert native.cpk_witness_best_sign(rho) == pytest.approx(bmv.cpk_witness_best_sign(rho), abs=1e-12)


def test_sweep_matches_reference():
    rng = np.random.default_rng(SEED + 2)
    mass = 10 ** rng.uniform(-15, -13, 3)
    sep = rng.uniform(300e-6, 1e-3, 3)
    dx = rng.uniform(100e-6, 300e-6, 2)
    time = rng.uniform(0.1, 5, 3)
    gamma = np.array([0.0, 0.05, 0.4])
    for geom in ("parallel", "linear", "angled"):
        out = native.bmv_sweep(mass, sep, dx, time, gamma, geometry=geom, angle_deg=37.0, nthreads=4)
        assert out["delta_phi"].shape == (3, 3, 2, 3, 3)
        for idx in np.ndindex(out["delta_phi"].shape):
            im, is_, id_, it, ig = idx
            d = bmv.BMVDesign(mass_A=mass[im], mass_B=mass[im], separation=sep[is_], dx_A=dx[id_], dx_B=dx[id_],
                              geometry=geom, angle_deg=37.0, time=time[it], gamma_A=gamma[ig], gamma_B=gamma[ig])
            if bmv.check_geometry(d):
                continue
            ref = python_reference(d)
            assert out["delta_phi"][idx] == pytest.approx(ref["delta_phi"], rel=1e-9, abs=1e-15)
            for k in ("negativity", "witness", "purity"):
                assert out[k][idx] == pytest.approx(ref[k], abs=1e-8), (k, geom, idx)
            assert_concurrence(out["concurrence"][idx], ref["rho"])


def test_sweep_thread_count_invariant():
    ax = (np.geomspace(1e-15, 1e-13, 5), np.linspace(3e-4, 1e-3, 5), [2.5e-4], np.linspace(0.1, 5, 5), [0, 0.1])
    a = native.bmv_sweep(*ax, nthreads=1)
    b = native.bmv_sweep(*ax, nthreads=4)
    for k in a:
        np.testing.assert_array_equal(a[k], b[k])


@pytest.mark.parametrize("d", [2, 3, 4, 6, 8])
def test_lindblad_dopri_vs_expm(d):
    rng = np.random.default_rng(SEED + d)
    H = random_hermitian(d, rng)
    Ls = [0.3 * (rng.normal(size=(d, d)) + 1j * rng.normal(size=(d, d))) for _ in range(2)]
    rho0 = random_density_matrix(d, rng)
    times = np.linspace(0.0, 3.0, 13)
    ref = qm.evolve_lindblad(rho0, H, Ls, times, method="expm")
    nat = native.lindblad_dopri(rho0, H, Ls, times, rtol=1e-11, atol=1e-13)
    assert np.max(np.abs(nat - ref)) <= 1e-7
    for r in nat:
        assert abs(np.trace(r) - 1) < 1e-10
        assert np.max(np.abs(r - r.conj().T)) < 1e-10


def test_lindblad_bmv_dephasing_vs_analytic():
    d = bmv.BMVDesign(gamma_A=0.2, gamma_B=0.6)
    E = bmv.gravitational_branch_energies(d)
    H = bmv.interaction_hamiltonian(E)
    Ls = bmv.dephasing_operators(d.gamma_A, d.gamma_B)
    rho0 = np.full((4, 4), 0.25, complex)
    times = np.linspace(0, d.time, 6)
    nat = native.lindblad_dopri(rho0, H, Ls, times, rtol=1e-11, atol=1e-13)
    for t, r in zip(times, nat):
        ph = bmv.phases_from_energies(E, t)
        np.testing.assert_allclose(r, bmv.joint_state(ph, d.gamma_A * t, d.gamma_B * t), atol=1e-9, rtol=0)


def test_lindblad_nonuniform_times():
    rng = np.random.default_rng(SEED + 9)
    H, rho0 = random_hermitian(3, rng), random_density_matrix(3, rng)
    Ls = [0.5 * random_hermitian(3, rng)]
    times = np.array([0.0, 0.01, 0.7, 0.71, 2.5])
    ref = qm.evolve_lindblad(rho0, H, Ls, times, method="expm")
    assert np.max(np.abs(native.lindblad_dopri(rho0, H, Ls, times) - ref)) <= 1e-7


def test_lindblad_rk4_matches_python_rk4():
    rng = np.random.default_rng(SEED + 5)
    d = 4
    H, rho0 = random_hermitian(d, rng), random_density_matrix(d, rng)
    Ls = [0.4 * (rng.normal(size=(d, d)) + 1j * rng.normal(size=(d, d)))]
    ref = qm.evolve_lindblad_rk4_fixed(rho0, H, Ls, 1.5, 300)
    np.testing.assert_allclose(native.lindblad_rk4(rho0, H, Ls, 1.5, 300), ref, rtol=0, atol=1e-12)


def test_lindblad_errors_are_raised():
    with pytest.raises(native.NativeError, match="non-decreasing"):
        native.lindblad_dopri(np.eye(2) / 2, np.diag([1.0, -1.0]), [], [1.0, 0.0])


def test_nbody_verlet_matches_python():
    rng = np.random.default_rng(SEED + 7)
    M = np.array([1e24, 3e23, 5e22])
    pos = rng.normal(size=(3, 3)) * 1e7
    vel = rng.normal(size=(3, 3)) * 1e2
    ts_p, P_p, V_p = gravity.nbody_verlet(pos, vel, M, 10.0, 500, save_every=7)
    ts_n, P_n, V_n = native.nbody_verlet(pos, vel, M, 10.0, 500, save_every=7)
    np.testing.assert_array_equal(ts_n, ts_p)
    np.testing.assert_allclose(P_n, P_p, rtol=1e-9, atol=1e-9 * np.abs(P_p).max())
    np.testing.assert_allclose(V_n, V_p, rtol=1e-9, atol=1e-9 * np.abs(V_p).max())
    assert native.nbody_energy(P_n[-1], V_n[-1], M) == pytest.approx(gravity.nbody_energy(P_p[-1], V_p[-1], M),
                                                                     rel=1e-9)
