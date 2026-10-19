// Standalone analytic checks of libqgdevs_native (no framework; exit status = number of failures).
#include <cmath>
#include <cstdio>
#include <random>
#include <vector>

#include "qgdevs/bmv.hpp"
#include "qgdevs/constants.hpp"
#include "qgdevs/lindblad.hpp"
#include "qgdevs/linalg.hpp"
#include "qgdevs/nbody.hpp"

using namespace qgdevs;

static int failures = 0;

static void check(bool ok, const char* name, double value, double tol) {
    std::printf("[%s] %-62s value=%.3e tol=%.1e\n", ok ? "PASS" : "FAIL", name, value, tol);
    if (!ok) ++failures;
}

static CMat random_hermitian(int n, std::mt19937_64& rng) {
    std::normal_distribution<double> g;
    CMat A(n, n);
    for (int i = 0; i < n; ++i)
        for (int j = 0; j < n; ++j) A(i, j) = cplx(g(rng), g(rng));
    return 0.5 * (A + A.adjoint());
}

static void test_jacobi() {
    std::mt19937_64 rng(7);
    double worst_res = 0.0, worst_orth = 0.0, worst_trace = 0.0;
    for (int n = 1; n <= 16; ++n)
        for (int rep = 0; rep < 20; ++rep) {
            const CMat A = random_hermitian(n, rng);
            std::vector<double> w;
            CMat V;
            eigh(A, w, &V);
            CMat D(n, n);
            for (int k = 0; k < n; ++k) D(k, k) = w[k];
            const CMat R = V * D * V.adjoint();
            const CMat I = V.adjoint() * V;
            double tr = 0.0;
            for (double x : w) tr += x;
            double scale = 0.0;
            for (std::size_t k = 0; k < A.size(); ++k) scale = std::max(scale, std::abs(A.data()[k]));
            worst_res = std::max(worst_res, max_abs_diff(R, A) / scale);
            worst_orth = std::max(worst_orth, max_abs_diff(I, CMat::identity(n)));
            worst_trace = std::max(worst_trace, std::abs(tr - A.trace().real()) / (n * scale));
        }
    check(worst_res < 1e-13, "Jacobi: max |V diag(w) V^+ - A| / max|A|, n <= 16", worst_res, 1e-13);
    check(worst_orth < 1e-13, "Jacobi: max |V^+ V - I|, n <= 16", worst_orth, 1e-13);
    check(worst_trace < 1e-13, "Jacobi: |sum w - tr A| / (n max|A|)", worst_trace, 1e-13);
}

static void test_unitary_limit() {
    // No dissipators: trace and Hermiticity are preserved, and ρ(t) = U ρ0 U† with U from the eigenbasis.
    std::mt19937_64 rng(11);
    const int d = 6;
    const CMat H = random_hermitian(d, rng);
    std::normal_distribution<double> g;
    std::vector<cplx> psi(d);
    double nrm = 0.0;
    for (auto& v : psi) { v = cplx(g(rng), g(rng)); nrm += std::norm(v); }
    CMat rho0(d, d);
    for (int i = 0; i < d; ++i)
        for (int j = 0; j < d; ++j) rho0(i, j) = psi[i] * std::conj(psi[j]) / nrm;
    std::vector<double> times;
    for (int k = 0; k <= 10; ++k) times.push_back(0.5 * k);
    const auto out = lindblad_dopri(rho0, Lindbladian(H, {}), times, 1e-11, 1e-13);
    std::vector<double> w;
    CMat V;
    eigh(H, w, &V);
    double terr = 0.0, herr = 0.0, uerr = 0.0, perr = 0.0;
    for (std::size_t k = 0; k < times.size(); ++k) {
        CMat E(d, d);
        for (int i = 0; i < d; ++i) E(i, i) = std::polar(1.0, -w[i] * times[k]);
        const CMat U = V * E * V.adjoint();
        terr = std::max(terr, std::abs(out[k].trace() - 1.0));
        herr = std::max(herr, hermiticity_error(out[k]));
        uerr = std::max(uerr, max_abs_diff(out[k], U * rho0 * U.adjoint()));
        perr = std::max(perr, std::abs(bmv::purity(out[k]) - 1.0));
    }
    check(terr < 1e-10, "Unitary limit (DOPRI5): |tr rho - 1|", terr, 1e-10);
    check(herr < 1e-10, "Unitary limit (DOPRI5): max |rho - rho^+|", herr, 1e-10);
    check(perr < 1e-9, "Unitary limit (DOPRI5): |tr rho^2 - 1|", perr, 1e-9);
    check(uerr < 1e-9, "Unitary limit (DOPRI5): max |rho - U rho0 U^+|", uerr, 1e-9);

    const CMat r4 = lindblad_rk4(rho0, Lindbladian(H, {}), 5.0, 4000);
    CMat E(d, d);
    for (int i = 0; i < d; ++i) E(i, i) = std::polar(1.0, -w[i] * 5.0);
    const CMat U = V * E * V.adjoint();
    const double e4 = max_abs_diff(r4, U * rho0 * U.adjoint());
    check(e4 < 1e-9, "Unitary limit (RK4, 4000 steps): max |rho - U rho0 U^+|", e4, 1e-9);
    // Global order 4: halving dt reduces the error by ~16.
    const CMat ra = lindblad_rk4(rho0, Lindbladian(H, {}), 5.0, 200), rb = lindblad_rk4(rho0, Lindbladian(H, {}), 5.0, 400);
    const double order = std::log2(max_abs_diff(ra, U * rho0 * U.adjoint()) / max_abs_diff(rb, U * rho0 * U.adjoint()));
    check(std::abs(order - 4.0) < 0.15, "RK4 observed convergence order (expect 4)", order, 0.15);
}

static void test_bmv_pure_state() {
    // Pure-state concurrence of the BMV state is |sin(Δφ/2)|; negativity = |sin(Δφ/2)|/2.
    double ce = 0.0, ne = 0.0, pe = 0.0, ae = 0.0;
    for (int k = 0; k < 200; ++k) {
        bmv::Design d;
        d.mass_A = 1e-14 * (1 + 0.01 * k);
        d.mass_B = 0.8e-14;
        d.time = 0.05 + 0.04 * k;
        d.geometry = static_cast<bmv::Geometry>(k % 3);
        d.angle_deg = 30.0 + k;
        const auto r = bmv::evaluate(d, true);
        const double s = std::abs(std::sin(r.delta_phi / 2));
        ce = std::max(ce, std::abs(r.concurrence - s));
        ne = std::max(ne, std::abs(r.negativity - s / 2));
        pe = std::max(pe, std::abs(r.purity - 1.0));
        if (d.geometry == bmv::Geometry::Parallel) {
            const double dp = 2 * constants::G * d.mass_A * d.mass_B * d.time / constants::hbar *
                              (1 / d.separation - 1 / std::hypot(d.separation, d.dx_A));
            ae = std::max(ae, std::abs(r.delta_phi - dp) / std::abs(dp));
        }
    }
    check(ce < 1e-12, "BMV pure state: |C - |sin(dphi/2)||", ce, 1e-12);
    check(ne < 1e-12, "BMV pure state: |N - |sin(dphi/2)|/2|", ne, 1e-12);
    check(pe < 1e-13, "BMV pure state: |tr rho^2 - 1|", pe, 1e-13);
    check(ae < 1e-12, "BMV parallel: rel. err vs closed-form dphi", ae, 1e-12);
}

static void test_bmv_lindblad_vs_analytic() {
    // Diagonal branch Hamiltonian + D[sqrt(Γ/2) Z] dephasing reproduces the analytic dephased state.
    bmv::Design d;
    d.gamma_A = 0.3;
    d.gamma_B = 0.7;
    const auto U = bmv::point_mass_energies(d);
    CMat H(4, 4), ZA(4, 4), ZB(4, 4), rho0(4, 4);
    for (int k = 0; k < 4; ++k) {
        H(k, k) = U[k] / constants::hbar;
        ZA(k, k) = std::sqrt(d.gamma_A / 2) * ((k >> 1) ? -1.0 : 1.0);
        ZB(k, k) = std::sqrt(d.gamma_B / 2) * ((k & 1) ? -1.0 : 1.0);
        for (int j = 0; j < 4; ++j) rho0(k, j) = 0.25;
    }
    const auto out = lindblad_dopri(rho0, Lindbladian(H, {ZA, ZB}), {0.0, d.time}, 1e-11, 1e-13);
    const auto ph = bmv::phases(U, d.time);
    const double err = max_abs_diff(out[1], bmv::joint_state(ph, d.gamma_A * d.time, d.gamma_B * d.time));
    check(err < 1e-9, "BMV: Lindblad DOPRI5 vs analytic dephased joint state", err, 1e-9);
}

static void test_kepler() {
    // Two-body eccentric orbit (e = 0.5) over 10 periods: Verlet energy error stays bounded and small.
    const double M = 1.989e30, m = 5.972e24, a = 1.496e11, e = 0.5;
    const double mu = constants::G * (M + m);
    const double rp = a * (1 - e), vp = std::sqrt(mu * (1 + e) / rp);
    const double pos[6] = {-m / (M + m) * rp, 0, 0, M / (M + m) * rp, 0, 0};
    const double vel[6] = {0, -m / (M + m) * vp, 0, 0, M / (M + m) * vp, 0};
    const double masses[2] = {M, m};
    const double T = 2 * constants::pi * std::sqrt(a * a * a / mu);
    const long per = 20000, n = 10 * per;
    const auto tr = nbody::verlet(2, 3, pos, vel, masses, T / per, n, 100);
    const double E0 = nbody::energy(2, 3, pos, vel, masses);
    double drift = 0.0;
    for (long k = 0; k < tr.nsave; ++k)
        drift = std::max(drift, std::abs(nbody::energy(2, 3, &tr.pos[k * 6], &tr.vel[k * 6], masses) / E0 - 1));
    check(drift < 1e-5, "Kepler (e=0.5, 10 orbits, Verlet): max |E/E0 - 1|", drift, 1e-5);
    // After exactly 10 periods the planet returns to perihelion (up to O(dt^2) phase error).
    const double* p = &tr.pos[(tr.nsave - 1) * 6];
    const double ret = std::hypot(p[3] - p[0] - rp, p[4] - p[1]) / rp;
    check(ret < 1e-3, "Kepler: |r(10T) - r(0)| / r_p", ret, 1e-3);
}

int main() {
    test_jacobi();
    test_unitary_limit();
    test_bmv_pure_state();
    test_bmv_lindblad_vs_analytic();
    test_kepler();
    std::printf("%s: %d failure(s)\n", failures ? "FAILED" : "ALL PASSED", failures);
    return failures;
}
