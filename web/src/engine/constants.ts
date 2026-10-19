/**
 * Physical constants — CODATA 2022 recommended values (NIST SP 961, 2024;
 * https://physics.nist.gov/cuu/Constants/). Identical to qgdevs/constants.py.
 */
export const G = 6.6743e-11; // m^3 kg^-1 s^-2
export const hbar = 1.054571817e-34; // J s
export const h = 6.62607015e-34; // J s
export const c = 299792458.0; // m s^-1
export const k_B = 1.380649e-23; // J K^-1
export const e = 1.602176634e-19; // C
export const eps0 = 8.8541878188e-12; // F m^-1
export const amu = 1.66053906892e-27; // kg
export const g_n = 9.80665; // m s^-2 (conventional)
export const mu0 = 1.25663706127e-6; // N A^-2
export const mu_B = 9.2740100657e-24; // J T^-1
export const g_e = 2.00231930436092; // electron g-factor magnitude

/** Planck length (derived): sqrt(ħG/c³). */
export const l_P = Math.sqrt((hbar * G) / c ** 3);

/** Riemann ζ(9) (used by the black-body scattering rate). */
export const ZETA9 = 1.0020083928260822;

export const CONSTANTS = { G, hbar, h, c, k_B, e, eps0, amu, g_n, l_P, mu0, mu_B, g_e } as const;
