#include "qgdevs/bmv.hpp"

#include <cmath>
#include <limits>
#include <stdexcept>

#ifdef _OPENMP
#include <omp.h>
#endif

#include "qgdevs/constants.hpp"
#include "qgdevs/linalg.hpp"

namespace qgdevs::bmv {

using constants::G;
using constants::hbar;
using constants::pi;

double sphere_radius(double mass, double density) { return std::cbrt(3.0 * mass / (4.0 * pi * density)); }

Vec3 split_axis(Geometry g, double angle_deg) {
    switch (g) {
        case Geometry::Linear: return {1.0, 0.0, 0.0};
        case Geometry::Parallel: return {0.0, 1.0, 0.0};
        case Geometry::Angled: {
            const double a = angle_deg * pi / 180.0;
            return {std::cos(a), std::sin(a), 0.0};
        }
    }
    throw std::invalid_argument("unknown geometry");
}

std::array<Vec3, 4> branch_positions(const Design& d) {
    // A centred at the origin, B at (separation, 0, 0); branches at ±dx/2 along the split axis n.
    const Vec3 n = split_axis(d.geometry, d.angle_deg);
    const double ha = 0.5 * d.dx_A, hb = 0.5 * d.dx_B;
    return {Vec3{ha * n.x, ha * n.y, ha * n.z}, Vec3{-ha * n.x, -ha * n.y, -ha * n.z},
            Vec3{d.separation + hb * n.x, hb * n.y, hb * n.z}, Vec3{d.separation - hb * n.x, -hb * n.y, -hb * n.z}};
}

Quad branch_distances(const Design& d) {
    const auto p = branch_positions(d);
    auto dist = [](const Vec3& a, const Vec3& b) {
        const double x = a.x - b.x, y = a.y - b.y, z = a.z - b.z;
        return std::sqrt(x * x + y * y + z * z);
    };
    return {dist(p[0], p[2]), dist(p[0], p[3]), dist(p[1], p[2]), dist(p[1], p[3])};
}

bool spheres_overlap(const Design& d) {
    const double rsum = sphere_radius(d.mass_A, d.density) + sphere_radius(d.mass_B, d.density);
    for (double r : branch_distances(d))
        if (r < rsum) return true;
    return false;
}

Quad point_mass_energies(const Design& d) {
    const auto r = branch_distances(d);
    const double gm = G * d.mass_A * d.mass_B;
    return {-gm / r[0], -gm / r[1], -gm / r[2], -gm / r[3]};
}

Quad phases(const Quad& U, double t) { return {-U[0] * t / hbar, -U[1] * t / hbar, -U[2] * t / hbar, -U[3] * t / hbar}; }

double entangling_phase(const Quad& p) { return p[0] + p[3] - p[1] - p[2]; }

PhaseDecomposition decompose_phases(const Quad& p) {
    // φ_ij = α + β z_i + γ z_j + (Δφ/4) z_i z_j with z_L = +1, z_R = -1.
    return {(p[0] + p[1] + p[2] + p[3]) / 4, (p[0] + p[1] - p[2] - p[3]) / 4, (p[0] - p[1] + p[2] - p[3]) / 4,
            entangling_phase(p)};
}

CMat joint_state(const Quad& ph, double decay_A, double decay_B) {
    // Basis index k = 2 a + b with a, b ∈ {0 = L, 1 = R}.
    CMat rho(4, 4);
    const double fA = std::exp(-decay_A), fB = std::exp(-decay_B);
    for (int i = 0; i < 4; ++i)
        for (int k = 0; k < 4; ++k) {
            double mag = 0.25;
            if ((i >> 1) != (k >> 1)) mag *= fA;
            if ((i & 1) != (k & 1)) mag *= fB;
            rho(i, k) = std::polar(mag, ph[i] - ph[k]);
        }
    return rho;
}

CMat local_phase_corrected(const CMat& rho, const Quad& ph) {
    const auto dec = decompose_phases(ph);
    cplx u[4];
    for (int k = 0; k < 4; ++k) {
        const double za = (k >> 1) ? -1.0 : 1.0, zb = (k & 1) ? -1.0 : 1.0;
        u[k] = std::polar(1.0, -dec.beta * za - dec.gamma * zb);
    }
    CMat out(4, 4);
    for (int i = 0; i < 4; ++i)
        for (int j = 0; j < 4; ++j) out(i, j) = u[i] * rho(i, j) * std::conj(u[j]);
    return out;
}

CMat partial_transpose_B(const CMat& rho, int dA, int dB) {
    // (ρ^{T_B})_{(a b),(a' b')} = ρ_{(a b'),(a' b)}
    CMat out(dA * dB, dA * dB);
    for (int a = 0; a < dA; ++a)
        for (int b = 0; b < dB; ++b)
            for (int ap = 0; ap < dA; ++ap)
                for (int bp = 0; bp < dB; ++bp) out(a * dB + b, ap * dB + bp) = rho(a * dB + bp, ap * dB + b);
    return out;
}

double negativity(const CMat& rho) {
    double s = 0.0;
    for (double w : eigvalsh(partial_transpose_B(rho, 2, 2)))
        if (w < 0) s -= w;
    return s;
}

double concurrence(const CMat& rho) {
    // ρ̃ = (Y⊗Y) ρ* (Y⊗Y). Y⊗Y = antidiag(-1, 1, 1, -1), so ρ̃_{ij} = s_i s_j conj(ρ_{3-i,3-j}).
    static const double s[4] = {-1.0, 1.0, 1.0, -1.0};
    CMat rt(4, 4);
    for (int i = 0; i < 4; ++i)
        for (int j = 0; j < 4; ++j) rt(i, j) = s[i] * s[j] * std::conj(rho(3 - i, 3 - j));
    // Eigenvalues of ρρ̃ equal those of the Hermitian PSD matrix sqrt(ρ) ρ̃ sqrt(ρ); C uses their square roots.
    const CMat sr = sqrtm_psd(rho);
    const CMat M = sr * rt * sr;
    auto w = eigvalsh(M);
    double l[4];
    for (int k = 0; k < 4; ++k) l[k] = std::sqrt(std::max(w[3 - k], 0.0));  // descending
    return std::max(0.0, l[0] - l[1] - l[2] - l[3]);
}

double purity(const CMat& rho) {
    double s = 0.0;
    for (std::size_t k = 0; k < rho.size(); ++k) s += std::norm(rho.data()[k]);
    return s;
}

namespace {
CMat pauli(char a) {
    CMat P(2, 2);
    switch (a) {
        case 'I': P(0, 0) = 1.0; P(1, 1) = 1.0; break;
        case 'X': P(0, 1) = 1.0; P(1, 0) = 1.0; break;
        case 'Y': P(0, 1) = cplx(0, -1); P(1, 0) = cplx(0, 1); break;
        case 'Z': P(0, 0) = 1.0; P(1, 1) = -1.0; break;
        default: throw std::invalid_argument("unknown Pauli label");
    }
    return P;
}
}  // namespace

double pauli_expectation(const CMat& rho, char a, char b) {
    const CMat P = kron(pauli(a), pauli(b));
    cplx s = 0.0;  // tr(ρ P) = Σ_ij ρ_ij P_ji
    for (int i = 0; i < 4; ++i)
        for (int j = 0; j < 4; ++j) s += rho(i, j) * P(j, i);
    return s.real();
}

double cpk_witness_best_sign(const CMat& rho) {
    const double xx = pauli_expectation(rho, 'X', 'X');
    const double yz = pauli_expectation(rho, 'Y', 'Z'), zy = pauli_expectation(rho, 'Z', 'Y');
    return std::min(1.0 - xx - yz - zy, 1.0 - xx + yz + zy);
}

Result evaluate(const Design& d, bool finite_size) {
    if (finite_size && spheres_overlap(d))
        throw std::domain_error("spheres overlap: finite-size energies need gravity.sphere_mutual_energy");
    Result r;
    r.distances = branch_distances(d);
    r.energies = point_mass_energies(d);
    r.phases = phases(r.energies, d.time);
    r.delta_phi = entangling_phase(r.phases);
    r.rho = joint_state(r.phases, d.gamma_A * d.time, d.gamma_B * d.time);
    r.negativity = negativity(r.rho);
    r.concurrence = concurrence(r.rho);
    r.purity = purity(r.rho);
    r.witness = cpk_witness_best_sign(local_phase_corrected(r.rho, r.phases));
    return r;
}

SweepOutput sweep(const SweepAxes& ax, Geometry g, double angle_deg, double density, bool finite_size,
                  int nthreads) {
    const long nm = ax.mass.size(), ns = ax.separation.size(), nd = ax.dx.size(), nt = ax.time.size(),
               ng = ax.gamma.size();
    const long total = nm * ns * nd * nt * ng;
    SweepOutput out;
    out.delta_phi.assign(total, 0.0);
    out.negativity.assign(total, 0.0);
    out.concurrence.assign(total, 0.0);
    out.witness.assign(total, 0.0);
    out.purity.assign(total, 0.0);
    const double nan = std::numeric_limits<double>::quiet_NaN();
#ifdef _OPENMP
    const int nth = nthreads > 0 ? nthreads : omp_get_max_threads();
#pragma omp parallel for schedule(dynamic, 64) num_threads(nth)
#else
    (void)nthreads;
#endif
    for (long idx = 0; idx < total; ++idx) {
        long r = idx;
        const long ig = r % ng; r /= ng;
        const long it = r % nt; r /= nt;
        const long id = r % nd; r /= nd;
        const long is = r % ns; r /= ns;
        const long im = r;
        Design d;
        d.mass_A = d.mass_B = ax.mass[im];
        d.density = density;
        d.separation = ax.separation[is];
        d.dx_A = d.dx_B = ax.dx[id];
        d.geometry = g;
        d.angle_deg = angle_deg;
        d.time = ax.time[it];
        d.gamma_A = d.gamma_B = ax.gamma[ig];
        if (finite_size && spheres_overlap(d)) {
            out.delta_phi[idx] = out.negativity[idx] = out.concurrence[idx] = out.witness[idx] =
                out.purity[idx] = nan;
            continue;
        }
        const Result res = evaluate(d, false);
        out.delta_phi[idx] = res.delta_phi;
        out.negativity[idx] = res.negativity;
        out.concurrence[idx] = res.concurrence;
        out.witness[idx] = res.witness;
        out.purity[idx] = res.purity;
    }
    return out;
}

}  // namespace qgdevs::bmv
