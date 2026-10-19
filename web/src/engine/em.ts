/**
 * Non-gravitational branch interactions (mirror of qgdevs/em.py). These can create branch-dependent
 * phases — and therefore entanglement — without gravity, so they are added to every hypothesis.
 *
 * Retarded Casimir–Polder (R << r):  U = −(23ħc/4π) R_A³ R_B³ cm_A cm_B / r⁷  (Casimir & Polder 1948;
 * van de Kamp et al., PRA 102, 062807 (2020)); Coulomb q_A q_B/(4πε₀ r); charge–induced dipole
 * −q² R³ cm/(8πε₀ r⁴).
 */
import type { BranchKey, Design } from '../lib/types';
import { G, c, eps0, hbar, mu0, mu_B, g_e } from './constants';
import { branchPositions, radiusOf } from './bmv';

export function casimirPolderEnergy(RA: number, RB: number, cmA: number, cmB: number, r: number): number {
  return ((-23 * hbar * c) / (4 * Math.PI)) * RA ** 3 * RB ** 3 * cmA * cmB / r ** 7;
}

export function coulombEnergy(qA: number, qB: number, r: number): number {
  return (qA * qB) / (4 * Math.PI * eps0 * r);
}

export function chargeInducedDipoleEnergy(q: number, Rother: number, cmOther: number, r: number): number {
  return (-(q * q) * Rother ** 3 * cmOther) / (8 * Math.PI * eps0 * r ** 4);
}

export type Channel = 'casimir' | 'coulomb' | 'induced';

/** Non-gravitational branch energies [J] by channel (dipole–dipole omitted: no permanent dipoles in the scenario). */
export function branchEnergies(d: Design, cmA: number, cmB: number, qA: number, qB: number, include: Channel[]) {
  const pos = branchPositions(d);
  const RA = radiusOf(d.mass_A, d.density), RB = radiusOf(d.mass_B, d.density);
  const out = {} as Record<BranchKey, Record<string, number>>;
  for (const i of 'LR') for (const j of 'LR') {
    const a = pos[`A_${i}` as 'A_L'], b = pos[`B_${j}` as 'B_L'];
    const r = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ch: Record<string, number> = {};
    if (include.includes('casimir')) ch.casimir = casimirPolderEnergy(RA, RB, cmA, cmB, r);
    if (include.includes('coulomb')) ch.coulomb = coulombEnergy(qA, qB, r);
    if (include.includes('induced'))
      ch.induced = chargeInducedDipoleEnergy(qA, RB, cmB, r) + chargeInducedDipoleEnergy(qB, RA, cmA, r);
    out[(i + j) as BranchKey] = ch;
  }
  return out;
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Magnetic dipole–dipole energy U = μ0/(4π r³) [m_A·m_B − 3 (m_A·n)(m_B·n)] (qgdevs.em.magnetic_dipole_energy). */
export function magneticDipoleEnergy(mA: V3, mB: V3, rv: V3): number {
  const r = Math.hypot(rv[0], rv[1], rv[2]);
  const n: V3 = [rv[0] / r, rv[1] / r, rv[2] / r];
  return (mu0 / (4 * Math.PI * r ** 3)) * (dot(mA, mB) - 3 * dot(mA, n) * dot(mB, n));
}

/**
 * Direct dipole–dipole coupling of the two embedded electron spins that label the branches
 * (L ↔ m_s = +½, R ↔ m_s = −½ along the quantisation axis), secular part:
 * U_ij = (μ0/4π r_ij³)(g μ_B/2)² s_i s_j (1 − 3 cos²θ_ij). It is itself entangling (qgdevs.em.spin_dipolar_branch_energies).
 */
export function spinDipolarBranchEnergies(d: Design, quantAxis: V3 = [0, 0, 1]): Record<BranchKey, number> {
  const pos = branchPositions(d);
  const zn = Math.hypot(...quantAxis);
  const z: V3 = [quantAxis[0] / zn, quantAxis[1] / zn, quantAxis[2] / zn];
  const mu = (g_e * mu_B) / 2;
  const s = { L: 1, R: -1 } as const;
  const out = {} as Record<BranchKey, number>;
  for (const i of 'LR') for (const j of 'LR') {
    const rv = sub(pos[`B_${j}` as 'B_L'] as V3, pos[`A_${i}` as 'A_L'] as V3);
    const r = Math.hypot(rv[0], rv[1], rv[2]);
    const cth = dot([rv[0] / r, rv[1] / r, rv[2] / r], z);
    out[(i + j) as BranchKey] = (mu0 / (4 * Math.PI * r ** 3)) * mu * mu * s[i as 'L'] * s[j as 'L'] * (1 - 3 * cth * cth);
  }
  return out;
}

/** Induced diamagnetic moment of a sphere in a uniform field: m = χ (4/3 π R³) B / μ0. */
export function diamagneticMoment(chi: number, R: number, B: V3): V3 {
  const k = (chi * ((4 / 3) * Math.PI * R ** 3)) / mu0;
  return [k * B[0], k * B[1], k * B[2]];
}

/** Dipole–dipole energy of the field-induced diamagnetic moments for every branch pair (qgdevs.em.diamagnetic_branch_energies). */
export function diamagneticBranchEnergies(d: Design, chi: number, B: V3): Record<BranchKey, number> {
  const pos = branchPositions(d);
  const mA = diamagneticMoment(chi, radiusOf(d.mass_A, d.density), B);
  const mB = diamagneticMoment(chi, radiusOf(d.mass_B, d.density), B);
  const out = {} as Record<BranchKey, number>;
  for (const i of 'LR') for (const j of 'LR') out[(i + j) as BranchKey] = magneticDipoleEnergy(mA, mB, sub(pos[`B_${j}` as 'B_L'] as V3, pos[`A_${i}` as 'A_L'] as V3));
  return out;
}

export function totalByBranch(ch: Record<BranchKey, Record<string, number>>): Record<BranchKey, number> {
  const out = {} as Record<BranchKey, number>;
  for (const k of Object.keys(ch) as BranchKey[]) out[k] = Object.values(ch[k]).reduce((s, v) => s + v, 0);
  return out;
}

/** Smallest distance with |U_CP|/|U_grav| ≤ ratio: r⁶ = 23ħc R⁶ cm² / (4π G m² ratio). */
export function minDistanceForGravityDominance(m: number, R: number, cm: number, ratio = 0.1): number {
  return ((23 * hbar * c * R ** 6 * cm * cm) / (4 * Math.PI * G * m * m * ratio)) ** (1 / 6);
}

export function casimirToGravityRatio(m: number, R: number, cm: number, r: number): number {
  return Math.abs(casimirPolderEnergy(R, R, cm, cm, r)) / ((G * m * m) / r);
}
