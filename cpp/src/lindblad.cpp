#include "qgdevs/lindblad.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>

namespace qgdevs {

Lindbladian::Lindbladian(const CMat& H, const std::vector<CMat>& Ls)
    : d_(H.rows()), Heff_(H), Ls_(Ls), t1_(H.rows(), H.rows()), t2_(H.rows(), H.rows()) {
    if (H.cols() != d_) throw std::invalid_argument("Lindbladian: H must be square");
    const cplx half_i(0.0, 0.5);
    for (const auto& L : Ls_) {
        if (L.rows() != d_ || L.cols() != d_) throw std::invalid_argument("Lindbladian: L shape mismatch");
        CMat LdL = L.adjoint() * L;
        LdL *= half_i;
        Heff_ -= LdL;  // H_eff = H - (i/2) L†L
    }
}

void Lindbladian::apply(const CMat& rho, CMat& out) const {
    matmul(Heff_, rho, t1_);       // H_eff ρ
    matmul_adj(rho, Heff_, t2_);   // ρ H_eff†
    const cplx mi(0.0, -1.0);
    for (std::size_t k = 0; k < out.size(); ++k) out.data()[k] = mi * (t1_.data()[k] - t2_.data()[k]);
    for (const auto& L : Ls_) {
        matmul(L, rho, t1_);
        matmul_adj(t1_, L, t2_);   // L ρ L†
        for (std::size_t k = 0; k < out.size(); ++k) out.data()[k] += t2_.data()[k];
    }
}

namespace {

// Dormand–Prince 5(4) tableau (Hairer, Nørsett & Wanner, Table II.5.2).
// The system is autonomous, so the nodes c_i are not needed.
constexpr double a21 = 1.0 / 5;
constexpr double a31 = 3.0 / 40, a32 = 9.0 / 40;
constexpr double a41 = 44.0 / 45, a42 = -56.0 / 15, a43 = 32.0 / 9;
constexpr double a51 = 19372.0 / 6561, a52 = -25360.0 / 2187, a53 = 64448.0 / 6561, a54 = -212.0 / 729;
constexpr double a61 = 9017.0 / 3168, a62 = -355.0 / 33, a63 = 46732.0 / 5247, a64 = 49.0 / 176,
                 a65 = -5103.0 / 18656;
constexpr double b1 = 35.0 / 384, b3 = 500.0 / 1113, b4 = 125.0 / 192, b5 = -2187.0 / 6784, b6 = 11.0 / 84;
// e_i = b_i - b̂_i (fifth minus embedded fourth order weights)
constexpr double e1 = 71.0 / 57600, e3 = -71.0 / 16695, e4 = 71.0 / 1920, e5 = -17253.0 / 339200,
                 e6 = 22.0 / 525, e7 = -1.0 / 40;

double scaled_rms(const CMat& v, const CMat& y0, const CMat* y1, double rtol, double atol) {
    double acc = 0.0;
    const std::size_t n = v.size();
    for (std::size_t k = 0; k < n; ++k) {
        const cplx a = y0.data()[k];
        const cplx b = y1 ? y1->data()[k] : a;
        const double sr = atol + rtol * std::max(std::abs(a.real()), std::abs(b.real()));
        const double si = atol + rtol * std::max(std::abs(a.imag()), std::abs(b.imag()));
        const double er = v.data()[k].real() / sr, ei = v.data()[k].imag() / si;
        acc += er * er + ei * ei;
    }
    return std::sqrt(acc / (2.0 * static_cast<double>(n)));
}

}  // namespace

std::vector<CMat> lindblad_dopri(const CMat& rho0, const Lindbladian& L, const std::vector<double>& times,
                                 double rtol, double atol, long max_steps, SolverStats* stats) {
    const int d = L.dim();
    if (rho0.rows() != d || rho0.cols() != d) throw std::invalid_argument("lindblad_dopri: rho0 shape mismatch");
    if (times.empty()) return {};
    for (std::size_t k = 1; k < times.size(); ++k)
        if (!(times[k] >= times[k - 1])) throw std::invalid_argument("lindblad_dopri: times must be non-decreasing");
    if (!(rtol > 0) || !(atol > 0)) throw std::invalid_argument("lindblad_dopri: rtol and atol must be positive");

    SolverStats st;
    std::vector<CMat> out;
    out.reserve(times.size());
    CMat y = rho0, ynew(d, d), ytmp(d, d), err(d, d);
    CMat k1(d, d), k2(d, d), k3(d, d), k4(d, d), k5(d, d), k6(d, d), k7(d, d);
    const std::size_t n = y.size();
    auto comb = [n](CMat& dst, const CMat& base, double h, std::initializer_list<std::pair<double, const CMat*>> terms) {
        for (std::size_t k = 0; k < n; ++k) {
            cplx s = 0.0;
            for (const auto& t : terms) s += t.first * t.second->data()[k];
            dst.data()[k] = base.data()[k] + h * s;
        }
    };

    double t = times.front();
    out.push_back(y);
    L.apply(y, k1);
    st.nfev++;

    // Initial step size (Hairer, Nørsett & Wanner, §II.4 "Starting step size").
    double h;
    {
        const double d0 = scaled_rms(y, y, nullptr, rtol, atol), d1 = scaled_rms(k1, y, nullptr, rtol, atol);
        double h0 = (d0 < 1e-5 || d1 < 1e-5) ? 1e-6 : 0.01 * d0 / d1;
        const double span = times.back() - times.front();
        if (span > 0) h0 = std::min(h0, span);
        comb(ytmp, y, h0, {{1.0, &k1}});
        L.apply(ytmp, k2);
        st.nfev++;
        CMat diff = k2;
        diff -= k1;
        const double d2 = scaled_rms(diff, y, nullptr, rtol, atol) / h0;
        const double h1 = (std::max(d1, d2) <= 1e-15) ? std::max(1e-6, h0 * 1e-3)
                                                       : std::pow(0.01 / std::max(d1, d2), 1.0 / 5.0);
        h = std::min(100.0 * h0, h1);
    }

    const double safety = 0.9, facmin = 0.2, facmax = 10.0;
    bool last_rejected = false;
    long steps = 0;
    for (std::size_t iout = 1; iout < times.size(); ++iout) {
        const double tend = times[iout];
        while (t < tend) {
            if (++steps > max_steps)
                throw std::runtime_error("lindblad_dopri: max_steps exceeded at t = " + std::to_string(t));
            const double remaining = tend - t;
            bool hits_end = false;
            double hs = h;
            if (hs >= remaining * (1.0 - 1e-12)) {
                hs = remaining;
                hits_end = true;
            }
            if (hs <= std::abs(t) * 1e-15 || hs <= 0.0)
                throw std::runtime_error("lindblad_dopri: step size underflow at t = " + std::to_string(t));

            comb(ytmp, y, hs, {{a21, &k1}});
            L.apply(ytmp, k2);
            comb(ytmp, y, hs, {{a31, &k1}, {a32, &k2}});
            L.apply(ytmp, k3);
            comb(ytmp, y, hs, {{a41, &k1}, {a42, &k2}, {a43, &k3}});
            L.apply(ytmp, k4);
            comb(ytmp, y, hs, {{a51, &k1}, {a52, &k2}, {a53, &k3}, {a54, &k4}});
            L.apply(ytmp, k5);
            comb(ytmp, y, hs, {{a61, &k1}, {a62, &k2}, {a63, &k3}, {a64, &k4}, {a65, &k5}});
            L.apply(ytmp, k6);
            comb(ynew, y, hs, {{b1, &k1}, {b3, &k3}, {b4, &k4}, {b5, &k5}, {b6, &k6}});
            L.apply(ynew, k7);  // FSAL: k7 = f(t + h, y_new)
            st.nfev += 6;
            for (std::size_t k = 0; k < n; ++k)
                err.data()[k] = hs * (e1 * k1.data()[k] + e3 * k3.data()[k] + e4 * k4.data()[k] +
                                      e5 * k5.data()[k] + e6 * k6.data()[k] + e7 * k7.data()[k]);
            const double en = scaled_rms(err, y, &ynew, rtol, atol);

            if (en <= 1.0) {
                st.accepted++;
                t = hits_end ? tend : t + hs;
                std::swap(y, ynew);
                std::swap(k1, k7);
                double fac = en > 0 ? safety * std::pow(en, -0.2) : facmax;
                fac = std::min(last_rejected ? 1.0 : facmax, std::max(facmin, fac));
                // A step shortened to land on an output time does not shrink the proposal.
                h = hits_end ? std::max(h, hs * fac) : hs * fac;
                last_rejected = false;
            } else {
                st.rejected++;
                h = hs * std::max(facmin, safety * std::pow(en, -0.2));
                last_rejected = true;
            }
        }
        out.push_back(y);
    }
    if (stats) *stats = st;
    return out;
}

CMat lindblad_rk4(const CMat& rho0, const Lindbladian& L, double t_final, long nsteps) {
    if (nsteps <= 0) throw std::invalid_argument("lindblad_rk4: nsteps must be positive");
    const int d = L.dim();
    const double dt = t_final / static_cast<double>(nsteps);
    CMat r = rho0, tmp(d, d), k1(d, d), k2(d, d), k3(d, d), k4(d, d);
    const std::size_t n = r.size();
    for (long s = 0; s < nsteps; ++s) {
        L.apply(r, k1);
        for (std::size_t k = 0; k < n; ++k) tmp.data()[k] = r.data()[k] + 0.5 * dt * k1.data()[k];
        L.apply(tmp, k2);
        for (std::size_t k = 0; k < n; ++k) tmp.data()[k] = r.data()[k] + 0.5 * dt * k2.data()[k];
        L.apply(tmp, k3);
        for (std::size_t k = 0; k < n; ++k) tmp.data()[k] = r.data()[k] + dt * k3.data()[k];
        L.apply(tmp, k4);
        for (std::size_t k = 0; k < n; ++k)
            r.data()[k] += dt / 6.0 * (k1.data()[k] + 2.0 * k2.data()[k] + 2.0 * k3.data()[k] + k4.data()[k]);
    }
    return r;
}

}  // namespace qgdevs
