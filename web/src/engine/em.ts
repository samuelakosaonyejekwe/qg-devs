/**
 * Non-gravitational branch interactions (mirror of qgdevs/em.py). These can create branch-dependent
 * phases — and therefore entanglement — without gravity, so they are added to every hypothesis.
 *
 * Retarded Casimir–Polder (R << r):  U = −(23ħc/4π) R_A³ R_B³ cm_A cm_B / r⁷  (Casimir & Polder 1948;
 * van de Kamp et al., PRA 102, 062807 (2020)); Coulomb q_A q_B/(4πε₀ r); charge–induced dipole
 * −q² R³ cm/(8πε₀ r⁴).
 */
import type { BranchKey, Design } from '../lib/types';
import { G, c, eps0, hbar } from './constants';
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
