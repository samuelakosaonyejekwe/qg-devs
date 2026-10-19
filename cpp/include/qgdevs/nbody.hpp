// Newtonian N-body: velocity-Verlet (kick-drift-kick), mirrors qgdevs.gravity.nbody_verlet.
#pragma once

#include <vector>

namespace qgdevs::nbody {

// pos, acc are n×dim row-major. a_i = G Σ_{j≠i} m_j (x_j - x_i) / |x_j - x_i|³.
void accelerations(int n, int dim, const double* pos, const double* masses, double* acc);
double energy(int n, int dim, const double* pos, const double* vel, const double* masses);

struct Trajectory {
    std::vector<double> t, pos, vel;  // pos/vel: nsave × n × dim
    long nsave = 0;
};

Trajectory verlet(int n, int dim, const double* pos0, const double* vel0, const double* masses, double dt,
                  long nsteps, long save_every = 1);

}  // namespace qgdevs::nbody
