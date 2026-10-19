// Lindblad master equation  dρ/dt = -i[H, ρ] + Σ_k (L_k ρ L_k† - ½{L_k†L_k, ρ}),
// with H = H/ħ in rad/s and L_k in s^-1/2 (same convention as qgdevs.quantum).
#pragma once

#include <vector>

#include "qgdevs/matrix.hpp"

namespace qgdevs {

class Lindbladian {
public:
    Lindbladian(const CMat& H, const std::vector<CMat>& Ls);
    int dim() const { return d_; }
    // out = L[ρ], written as -i(H_eff ρ - ρ H_eff†) + Σ L ρ L†,  H_eff = H - (i/2) Σ L†L.
    void apply(const CMat& rho, CMat& out) const;

private:
    int d_;
    CMat Heff_;
    std::vector<CMat> Ls_;
    mutable CMat t1_, t2_;
};

struct SolverStats {
    long accepted = 0;
    long rejected = 0;
    long nfev = 0;
};

// Adaptive Dormand–Prince 5(4) (Dormand & Prince 1980; Hairer, Nørsett & Wanner, Solving ODEs I, §II.4).
// ρ0 is the state at times[0]; times must be non-decreasing. Steps land exactly on each output time.
// Error norm: RMS over real and imaginary parts of err_i / (atol + rtol max(|y_i|, |y_new_i|)).
std::vector<CMat> lindblad_dopri(const CMat& rho0, const Lindbladian& L, const std::vector<double>& times,
                                 double rtol, double atol, long max_steps = 10000000,
                                 SolverStats* stats = nullptr);

// Classical fixed-step RK4 from t = 0 to t_final in nsteps equal steps (global order 4).
CMat lindblad_rk4(const CMat& rho0, const Lindbladian& L, double t_final, long nsteps);

}  // namespace qgdevs
