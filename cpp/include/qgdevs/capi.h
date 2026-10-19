/* Plain C ABI of libqgdevs_native. Complex arrays are interleaved (re, im) doubles, row-major,
 * i.e. the memory layout of a C-contiguous numpy complex128 array. Every function returns 0 on
 * success and a nonzero code on failure; qgdevs_last_error() then describes the failure. */
#ifndef QGDEVS_CAPI_H
#define QGDEVS_CAPI_H

#ifdef __cplusplus
extern "C" {
#endif

#define QGDEVS_ABI_VERSION 1

int qgdevs_abi_version(void);
const char* qgdevs_last_error(void);
int qgdevs_max_threads(void);
/* Writes {G, hbar, h, c, k_B} (CODATA 2022). */
void qgdevs_constants(double* out5);

int qgdevs_eigvalsh(int n, const double* A, double* w);
int qgdevs_negativity(const double* rho4, double* out);
int qgdevs_concurrence(const double* rho4, double* out);
int qgdevs_purity(int n, const double* rho, double* out);
int qgdevs_cpk_witness_best_sign(const double* rho4, double* out);

/* rho0, H: d×d; Ls: nL×d×d; out: nt×d×d. stats (may be NULL): {accepted, rejected, nfev}. */
int qgdevs_lindblad_dopri(int d, const double* rho0, const double* H, int nL, const double* Ls, int nt,
                          const double* times, double rtol, double atol, long max_steps, double* out,
                          long* stats);
int qgdevs_lindblad_rk4(int d, const double* rho0, const double* H, int nL, const double* Ls, double t_final,
                        long nsteps, double* out);

/* params: {mass_A, mass_B, density, separation, dx_A, dx_B, angle_deg, time, gamma_A, gamma_B};
 * geometry: 0 parallel, 1 linear, 2 angled.
 * out_quads (12): distances[4], energies[4], phases[4] (LL, LR, RL, RR);
 * out_scalars (5): delta_phi, negativity, concurrence, witness, purity; out_rho: 4×4 complex. */
int qgdevs_bmv_point(const double* params, int geometry, int finite_size, double* out_quads,
                     double* out_scalars, double* out_rho);

/* Cartesian sweep; each output has nm·ns·nd·nt·ng entries, C-ordered over (mass, sep, dx, time, gamma). */
int qgdevs_bmv_sweep(int nm, const double* mass, int ns, const double* sep, int nd, const double* dx, int nt,
                     const double* time, int ng, const double* gamma, int geometry, double angle_deg,
                     double density, int finite_size, int nthreads, double* delta_phi, double* negativity,
                     double* concurrence, double* witness, double* purity);

/* pos0, vel0: n×dim. Outputs sized nsave = nsteps/save_every + 1: t[nsave], pos/vel[nsave×n×dim]. */
int qgdevs_nbody_verlet(int n, int dim, const double* pos0, const double* vel0, const double* masses, double dt,
                        long nsteps, long save_every, double* t, double* pos, double* vel);
int qgdevs_nbody_energy(int n, int dim, const double* pos, const double* vel, const double* masses, double* out);

#ifdef __cplusplus
}
#endif
#endif
