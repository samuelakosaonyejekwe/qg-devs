#include "qgdevs/capi.h"

#include <algorithm>
#include <exception>
#include <string>

#ifdef _OPENMP
#include <omp.h>
#endif

#include "qgdevs/bmv.hpp"
#include "qgdevs/constants.hpp"
#include "qgdevs/lindblad.hpp"
#include "qgdevs/linalg.hpp"
#include "qgdevs/nbody.hpp"

using namespace qgdevs;

namespace {

thread_local std::string g_last_error;

const cplx* as_cplx(const double* p) { return reinterpret_cast<const cplx*>(p); }
cplx* as_cplx(double* p) { return reinterpret_cast<cplx*>(p); }

template <class F>
int guarded(F&& f) {
    try {
        if (!g_last_error.empty()) g_last_error.clear();
        f();
        return 0;
    } catch (const std::exception& e) {
        g_last_error = e.what();
        return 1;
    } catch (...) {
        g_last_error = "unknown C++ exception";
        return 2;
    }
}

void require(bool ok, const char* msg) {
    if (!ok) throw std::invalid_argument(msg);
}

std::vector<CMat> unpack_ops(int nL, int d, const double* Ls) {
    std::vector<CMat> ops;
    for (int k = 0; k < nL; ++k) ops.push_back(CMat::from_data(d, d, as_cplx(Ls) + static_cast<std::size_t>(k) * d * d));
    return ops;
}

}  // namespace

extern "C" {

int qgdevs_abi_version(void) { return QGDEVS_ABI_VERSION; }
const char* qgdevs_last_error(void) { return g_last_error.c_str(); }

int qgdevs_max_threads(void) {
#ifdef _OPENMP
    return omp_get_max_threads();
#else
    return 1;
#endif
}

void qgdevs_constants(double* out5) {
    out5[0] = constants::G;
    out5[1] = constants::hbar;
    out5[2] = constants::h;
    out5[3] = constants::c;
    out5[4] = constants::k_B;
}

int qgdevs_eigvalsh(int n, const double* A, double* w) {
    return guarded([&] {
        require(n > 0 && A && w, "eigvalsh: invalid arguments");
        const auto ev = eigvalsh(CMat::from_data(n, n, as_cplx(A)));
        std::copy(ev.begin(), ev.end(), w);
    });
}

int qgdevs_negativity(const double* rho4, double* out) {
    return guarded([&] {
        require(rho4 && out, "negativity: null pointer");
        *out = bmv::negativity(CMat::from_data(4, 4, as_cplx(rho4)));
    });
}

int qgdevs_concurrence(const double* rho4, double* out) {
    return guarded([&] {
        require(rho4 && out, "concurrence: null pointer");
        *out = bmv::concurrence(CMat::from_data(4, 4, as_cplx(rho4)));
    });
}

int qgdevs_purity(int n, const double* rho, double* out) {
    return guarded([&] {
        require(n > 0 && rho && out, "purity: invalid arguments");
        *out = bmv::purity(CMat::from_data(n, n, as_cplx(rho)));
    });
}

int qgdevs_cpk_witness_best_sign(const double* rho4, double* out) {
    return guarded([&] {
        require(rho4 && out, "cpk_witness_best_sign: null pointer");
        *out = bmv::cpk_witness_best_sign(CMat::from_data(4, 4, as_cplx(rho4)));
    });
}

int qgdevs_lindblad_dopri(int d, const double* rho0, const double* H, int nL, const double* Ls, int nt,
                          const double* times, double rtol, double atol, long max_steps, double* out,
                          long* stats) {
    return guarded([&] {
        require(d > 0 && nt >= 0 && nL >= 0 && rho0 && H && out && (nL == 0 || Ls) && (nt == 0 || times),
                "lindblad_dopri: invalid arguments");
        const Lindbladian L(CMat::from_data(d, d, as_cplx(H)), unpack_ops(nL, d, Ls));
        SolverStats st;
        const auto res = lindblad_dopri(CMat::from_data(d, d, as_cplx(rho0)), L,
                                        std::vector<double>(times, times + nt), rtol, atol, max_steps, &st);
        for (int k = 0; k < nt; ++k)
            std::copy(res[k].data(), res[k].data() + res[k].size(), as_cplx(out) + static_cast<std::size_t>(k) * d * d);
        if (stats) {
            stats[0] = st.accepted;
            stats[1] = st.rejected;
            stats[2] = st.nfev;
        }
    });
}

int qgdevs_lindblad_rk4(int d, const double* rho0, const double* H, int nL, const double* Ls, double t_final,
                        long nsteps, double* out) {
    return guarded([&] {
        require(d > 0 && nL >= 0 && rho0 && H && out && (nL == 0 || Ls), "lindblad_rk4: invalid arguments");
        const Lindbladian L(CMat::from_data(d, d, as_cplx(H)), unpack_ops(nL, d, Ls));
        const CMat r = lindblad_rk4(CMat::from_data(d, d, as_cplx(rho0)), L, t_final, nsteps);
        std::copy(r.data(), r.data() + r.size(), as_cplx(out));
    });
}

int qgdevs_bmv_point(const double* p, int geometry, int finite_size, double* out_quads, double* out_scalars,
                     double* out_rho) {
    return guarded([&] {
        require(p != nullptr, "bmv_point: null parameter array");
        require(geometry >= 0 && geometry <= 2, "bmv_point: geometry must be 0, 1 or 2");
        bmv::Design d;
        d.mass_A = p[0]; d.mass_B = p[1]; d.density = p[2]; d.separation = p[3];
        d.dx_A = p[4]; d.dx_B = p[5]; d.angle_deg = p[6]; d.time = p[7];
        d.gamma_A = p[8]; d.gamma_B = p[9];
        d.geometry = static_cast<bmv::Geometry>(geometry);
        const auto r = bmv::evaluate(d, finite_size != 0);
        if (out_quads)
            for (int k = 0; k < 4; ++k) {
                out_quads[k] = r.distances[k];
                out_quads[4 + k] = r.energies[k];
                out_quads[8 + k] = r.phases[k];
            }
        if (out_scalars) {
            out_scalars[0] = r.delta_phi;
            out_scalars[1] = r.negativity;
            out_scalars[2] = r.concurrence;
            out_scalars[3] = r.witness;
            out_scalars[4] = r.purity;
        }
        if (out_rho) std::copy(r.rho.data(), r.rho.data() + 16, as_cplx(out_rho));
    });
}

int qgdevs_bmv_sweep(int nm, const double* mass, int ns, const double* sep, int nd, const double* dx, int nt,
                     const double* time, int ng, const double* gamma, int geometry, double angle_deg,
                     double density, int finite_size, int nthreads, double* delta_phi, double* negativity,
                     double* concurrence, double* witness, double* purity) {
    return guarded([&] {
        require(nm > 0 && ns > 0 && nd > 0 && nt > 0 && ng > 0, "bmv_sweep: every axis needs at least one value");
        require(mass && sep && dx && time && gamma && delta_phi && negativity && concurrence && witness,
                "bmv_sweep: null pointer");
        require(geometry >= 0 && geometry <= 2, "bmv_sweep: geometry must be 0, 1 or 2");
        bmv::SweepAxes ax{{mass, mass + nm}, {sep, sep + ns}, {dx, dx + nd}, {time, time + nt}, {gamma, gamma + ng}};
        const auto o = bmv::sweep(ax, static_cast<bmv::Geometry>(geometry), angle_deg, density, finite_size != 0,
                                  nthreads);
        std::copy(o.delta_phi.begin(), o.delta_phi.end(), delta_phi);
        std::copy(o.negativity.begin(), o.negativity.end(), negativity);
        std::copy(o.concurrence.begin(), o.concurrence.end(), concurrence);
        std::copy(o.witness.begin(), o.witness.end(), witness);
        if (purity) std::copy(o.purity.begin(), o.purity.end(), purity);
    });
}

int qgdevs_nbody_verlet(int n, int dim, const double* pos0, const double* vel0, const double* masses, double dt,
                        long nsteps, long save_every, double* t, double* pos, double* vel) {
    return guarded([&] {
        require(pos0 && vel0 && masses && t && pos && vel, "nbody_verlet: null pointer");
        const auto tr = nbody::verlet(n, dim, pos0, vel0, masses, dt, nsteps, save_every);
        std::copy(tr.t.begin(), tr.t.end(), t);
        std::copy(tr.pos.begin(), tr.pos.end(), pos);
        std::copy(tr.vel.begin(), tr.vel.end(), vel);
    });
}

int qgdevs_nbody_energy(int n, int dim, const double* pos, const double* vel, const double* masses, double* out) {
    return guarded([&] {
        require(n > 0 && dim > 0 && pos && vel && masses && out, "nbody_energy: invalid arguments");
        *out = nbody::energy(n, dim, pos, vel, masses);
    });
}

}  // extern "C"
