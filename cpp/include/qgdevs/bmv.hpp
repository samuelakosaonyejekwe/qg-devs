// Bose–Marletto–Vedral two-mass gravity-mediated entanglement (mirrors qgdevs/bmv.py).
//
// Branch pair (i, j) ∈ {LL, LR, RL, RR} accumulates φ_ij = -U_ij t / ħ, Δφ = φ_LL + φ_RR - φ_LR - φ_RL.
// With single-mass dephasing rates Γ_A, Γ_B the joint state from |+>|+> is
//     ρ_{ij,kl} = ¼ exp[i(φ_ij - φ_kl)] exp[-Γ_A t (1-δ_ik)] exp[-Γ_B t (1-δ_jl)].
#pragma once

#include <array>
#include <vector>

#include "qgdevs/matrix.hpp"

namespace qgdevs::bmv {

enum class Geometry : int { Parallel = 0, Linear = 1, Angled = 2 };

struct Design {
    double mass_A = 1e-14, mass_B = 1e-14;  // kg
    double density = 3510.0;                 // kg m^-3
    double separation = 450e-6;              // m
    double dx_A = 250e-6, dx_B = 250e-6;     // m
    Geometry geometry = Geometry::Parallel;
    double angle_deg = 90.0;
    double time = 2.5;                       // s
    double gamma_A = 0.0, gamma_B = 0.0;     // s^-1
};

struct Vec3 {
    double x, y, z;
};

using Quad = std::array<double, 4>;  // ordered LL, LR, RL, RR

double sphere_radius(double mass, double density);  // (3m / 4πρ)^{1/3}
Vec3 split_axis(Geometry g, double angle_deg);
std::array<Vec3, 4> branch_positions(const Design& d);  // A_L, A_R, B_L, B_R
Quad branch_distances(const Design& d);
// True if any branch pair has centre distance < R_A + R_B (point-mass energies then not exact).
bool spheres_overlap(const Design& d);
Quad point_mass_energies(const Design& d);       // U_ij = -G m_A m_B / r_ij
Quad phases(const Quad& energies, double t);     // φ_ij = -U_ij t / ħ
double entangling_phase(const Quad& ph);

struct PhaseDecomposition {
    double alpha, beta, gamma, delta_phi;
};
PhaseDecomposition decompose_phases(const Quad& ph);

CMat joint_state(const Quad& ph, double decay_A, double decay_B);
// U ρ U† with U = R_z(β) ⊗ R_z(γ) = diag(e^{-iβ z_i - iγ z_j}), removing the local phases.
CMat local_phase_corrected(const CMat& rho, const Quad& ph);

CMat partial_transpose_B(const CMat& rho, int dA, int dB);
double negativity(const CMat& rho);    // Σ|negative eigenvalues of ρ^{T_B}| (Vidal & Werner 2002)
double concurrence(const CMat& rho);   // Wootters 1998, via R = sqrt(sqrt(ρ) ρ̃ sqrt(ρ))
double purity(const CMat& rho);        // tr ρ² = Σ |ρ_ij|² for Hermitian ρ
double pauli_expectation(const CMat& rho, char a, char b);
// min(1 - <XX> - <YZ> - <ZY>, 1 - <XX> + <YZ> + <ZY>) (Chevalier, Paige & Kim, PRA 102, 022428 (2020)).
double cpk_witness_best_sign(const CMat& rho);

struct Result {
    Quad distances, energies, phases;
    double delta_phi, negativity, concurrence, witness, purity;
    CMat rho;
};

// Full point prediction with point-mass energies. If finite_size and the spheres overlap, throws
// (overlapping-sphere energies require the numerical shell integral of gravity.sphere_mutual_energy).
Result evaluate(const Design& d, bool finite_size = true);

struct SweepAxes {
    std::vector<double> mass, separation, dx, time, gamma;
};
struct SweepOutput {
    std::vector<double> delta_phi, negativity, concurrence, witness, purity;
};

// Cartesian sweep with m_A = m_B = mass, dx_A = dx_B = dx, Γ_A = Γ_B = gamma. Output index is
// C-ordered over (mass, separation, dx, time, gamma). Overlapping designs (finite_size) give NaN.
SweepOutput sweep(const SweepAxes& ax, Geometry g, double angle_deg, double density, bool finite_size,
                  int nthreads = 0);

}  // namespace qgdevs::bmv
