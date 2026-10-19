#include "qgdevs/nbody.hpp"

#include <cmath>
#include <stdexcept>

#include "qgdevs/constants.hpp"

namespace qgdevs::nbody {

using constants::G;

void accelerations(int n, int dim, const double* pos, const double* m, double* acc) {
    for (int k = 0; k < n * dim; ++k) acc[k] = 0.0;
    for (int i = 0; i < n; ++i)
        for (int j = 0; j < n; ++j) {
            if (i == j) continue;
            double r2 = 0.0;
            for (int k = 0; k < dim; ++k) {
                const double dx = pos[j * dim + k] - pos[i * dim + k];
                r2 += dx * dx;
            }
            const double s = G * m[j] / (r2 * std::sqrt(r2));
            for (int k = 0; k < dim; ++k) acc[i * dim + k] += s * (pos[j * dim + k] - pos[i * dim + k]);
        }
}

double energy(int n, int dim, const double* pos, const double* vel, const double* m) {
    double ke = 0.0, pe = 0.0;
    for (int i = 0; i < n; ++i) {
        double v2 = 0.0;
        for (int k = 0; k < dim; ++k) v2 += vel[i * dim + k] * vel[i * dim + k];
        ke += 0.5 * m[i] * v2;
        for (int j = i + 1; j < n; ++j) {
            double r2 = 0.0;
            for (int k = 0; k < dim; ++k) {
                const double dx = pos[j * dim + k] - pos[i * dim + k];
                r2 += dx * dx;
            }
            pe -= G * m[i] * m[j] / std::sqrt(r2);
        }
    }
    return ke + pe;
}

Trajectory verlet(int n, int dim, const double* pos0, const double* vel0, const double* m, double dt, long nsteps,
                  long save_every) {
    if (n <= 0 || dim <= 0 || nsteps < 0 || save_every <= 0)
        throw std::invalid_argument("nbody::verlet: invalid sizes");
    const int nd = n * dim;
    std::vector<double> x(pos0, pos0 + nd), v(vel0, vel0 + nd), a(nd);
    Trajectory tr;
    tr.nsave = nsteps / save_every + 1;
    tr.t.reserve(tr.nsave);
    tr.pos.reserve(tr.nsave * nd);
    tr.vel.reserve(tr.nsave * nd);
    auto save = [&](double t) {
        tr.t.push_back(t);
        tr.pos.insert(tr.pos.end(), x.begin(), x.end());
        tr.vel.insert(tr.vel.end(), v.begin(), v.end());
    };
    accelerations(n, dim, x.data(), m, a.data());
    save(0.0);
    for (long s = 1; s <= nsteps; ++s) {  // kick–drift–kick
        for (int k = 0; k < nd; ++k) v[k] += 0.5 * dt * a[k];
        for (int k = 0; k < nd; ++k) x[k] += dt * v[k];
        accelerations(n, dim, x.data(), m, a.data());
        for (int k = 0; k < nd; ++k) v[k] += 0.5 * dt * a[k];
        if (s % save_every == 0) save(static_cast<double>(s) * dt);
    }
    return tr;
}

}  // namespace qgdevs::nbody
