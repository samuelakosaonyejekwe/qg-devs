/**
 * Competing hypotheses for two-mass gravitational experiments at nominal nuisance (mirror of
 * qgdevs/models.py) and the observable prediction table of qgdevs/discrimination.predictions_table.
 * Every hypothesis is evaluated through the same measurement chain and protocol frame.
 */
import type { BranchKey, Design, ModelPrediction } from '../lib/types';
import { BRANCHES } from '../lib/types';
import {
  Phases, applyLocalCorrection, branchDistances, cpkWitnessBestSign, entanglementDephasingThreshold, entanglingPhase,
  gravitationalBranchEnergies, jointState, phasesFromEnergies, radiusOf,
} from './bmv';
import { G, amu, c, hbar } from './constants';
import { cslRate, diosiPenroseRate } from './decoherence';
import { CMat, zeros } from './linalg';
import { PAULI_SETTINGS, concurrence, correlatorFromProbs, negativity, outcomeProbabilities, purity, reducedCoherences } from './quantum';

/** Everything shared by all hypotheses for one configuration (qgdevs.models.Scenario). */
export interface ModelScenario {
  design: Design;
  gamma_env_A: number;
  gamma_env_B: number;
  nongrav: Record<BranchKey, number>;
}

/** Hypotheses implemented locally, in the backend registry order (qgdevs.models.HYPOTHESES). */
export const IMPLEMENTED_IDS = ['QG-COH', 'QG-EFT1', 'SC-MF', 'CC-KTM', 'DP-COLL', 'NULL-NG', 'CSL-COLL', 'CG-QFT-AH'] as const;
/** Backend hypotheses without a local implementation (none at present). */
export const SERVER_ONLY_IDS: readonly string[] = [];

/** Aziz–Howl virtual-matter mechanism (qgdevs.model_ah): field-quantum mass and eq:betaCG prefactor. */
export const AH_CARBON12_MASS = 12.0 * amu;
export const AH_COEFF_SEMICLASSICAL = 6.0 / 25.0;

/**
 * β⁽⁴⁾_ij = −s X_ij², X = (6/25) G² m² (M_A M_B)^{3/2} (R_A R_B)^{1/2} t/(ħ³ d_ij)
 * (Aziz & Howl, Nature 646, 813 (2025), eq:betaCG; unequal-mass extension as in qgdevs.model_ah).
 */
export function ahBeta4(d: Design, t = d.time, constituentMass = AH_CARBON12_MASS, sourcing = 1.0): Record<BranchKey, number> {
  const RA = radiusOf(d.mass_A, d.density), RB = radiusOf(d.mass_B, d.density);
  const dist = branchDistances(d);
  const out = {} as Record<BranchKey, number>;
  for (const k of BRANCHES) {
    const X = (AH_COEFF_SEMICLASSICAL * G ** 2 * constituentMass ** 2 * (d.mass_A * d.mass_B) ** 1.5 * Math.sqrt(RA * RB) * t) / (hbar ** 3 * dist[k]);
    out[k] = -sourcing * X * X;
  }
  return out;
}

/** Mean-field (Møller–Rosenfeld) branch energies: each mass sees the branch-averaged potential of the other. */
function meanFieldEnergies(Eg: Record<BranchKey, number>): Record<BranchKey, number> {
  const UA = { L: 0.5 * (Eg.LL + Eg.LR), R: 0.5 * (Eg.RL + Eg.RR) };
  const UB = { L: 0.5 * (Eg.LL + Eg.RL), R: 0.5 * (Eg.LR + Eg.RR) };
  const Emf = {} as Record<BranchKey, number>;
  for (const k of BRANCHES) Emf[k] = UA[k[0] as 'L'] + UB[k[1] as 'L'];
  return Emf;
}

const add = (...ds: Record<BranchKey, number>[]) => {
  const o = {} as Record<BranchKey, number>;
  for (const k of BRANCHES) o[k] = ds.reduce((s, d) => s + d[k], 0);
  return o;
};

/** One-loop EFT potential terms (Bjerrum-Bohr, Donoghue & Holstein, PRD 67, 084033 (2003)). */
export const BDH_QUANTUM_COEFF = 41 / (10 * Math.PI);
export function eftPotentialTerms(m1: number, m2: number, r: number) {
  const newton = (-G * m1 * m2) / r;
  const lP2 = (hbar * G) / c ** 3;
  return {
    newtonian_J: newton,
    classical_pn_correction_J: (newton * 3 * G * (m1 + m2)) / (r * c ** 2),
    quantum_one_loop_correction_J: (newton * BDH_QUANTUM_COEFF * G * hbar) / (r ** 2 * c ** 3),
    quantum_relative_size: (BDH_QUANTUM_COEFF * lP2) / r ** 2,
  };
}

function envDecay(sc: ModelScenario, t: number): [number, number] {
  return [sc.gamma_env_A * t, sc.gamma_env_B * t];
}

/** Joint branch state predicted by hypothesis `id` at interaction time t (nominal nuisance). */
export function modelState(id: string, sc: ModelScenario, t = sc.design.time): CMat {
  const d = sc.design;
  const Eg = gravitationalBranchEnergies(d);
  const [dA, dB] = envDecay(sc, t);
  switch (id) {
    case 'QG-COH':
      return jointState(phasesFromEnergies(add(Eg, sc.nongrav), t), dA, dB);
    case 'QG-EFT1': {
      const dist = branchDistances(d);
      const corr = {} as Record<BranchKey, number>;
      for (const k of BRANCHES) corr[k] = eftPotentialTerms(d.mass_A, d.mass_B, dist[k]).quantum_one_loop_correction_J;
      return jointState(phasesFromEnergies(add(Eg, sc.nongrav, corr), t), dA, dB);
    }
    case 'SC-MF':
      // gravity sourced by the expected mass density of the other body (p_L = p_R = ½): purely local phases
      return jointState(phasesFromEnergies(add(meanFieldEnergies(Eg), sc.nongrav), t), dA, dB);
    case 'CC-KTM': {
      // Kafri–Taylor–Milburn: extra dephasing Γ_cc = κ Γ*, Γ* = |dΔφ_g/dt|/2, κ = 1 (nominal).
      // dΔφ_g/dt = −(U_LL + U_RR − U_LR − U_RL)/ħ is time independent for static branches.
      const rate = -(Eg.LL + Eg.RR - Eg.LR - Eg.RL) / hbar;
      const gcc = 1.0 * entanglementDephasingThreshold(rate);
      return jointState(phasesFromEnergies(add(Eg, sc.nongrav), t), dA + gcc * t, dB + gcc * t);
    }
    case 'DP-COLL': {
      const gA = diosiPenroseRate(d.mass_A, radiusOf(d.mass_A, d.density), d.dx_A, 1.0).rate;
      const gB = diosiPenroseRate(d.mass_B, radiusOf(d.mass_B, d.density), d.dx_B, 1.0).rate;
      return jointState(phasesFromEnergies(add(Eg, sc.nongrav), t), dA + gA * t, dB + gB * t);
    }
    case 'NULL-NG':
      return jointState(phasesFromEnergies(sc.nongrav, t), dA, dB);
    case 'CSL-COLL': {
      // coherent gravity + mass-proportional CSL dephasing; Γ is linear in λ (nominal log10 λ = −16)
      const lam = 10.0 ** -16.0;
      const gA = lam * cslRate(d.mass_A, radiusOf(d.mass_A, d.density), d.dx_A, 1.0).rate;
      const gB = lam * cslRate(d.mass_B, radiusOf(d.mass_B, d.density), d.dx_B, 1.0).rate;
      return jointState(phasesFromEnergies(add(Eg, sc.nongrav), t), dA + gA * t, dB + gB * t);
    }
    case 'CG-QFT-AH': {
      // mean-field local phases × branch amplitudes (1 + β⁽⁴⁾_ij) (amplitude representation), normalised,
      // then the same environmental dephasing as every other hypothesis
      const ph = phasesFromEnergies(add(meanFieldEnergies(Eg), sc.nongrav), t);
      const beta = ahBeta4(d, t);
      const aRe = BRANCHES.map((k) => (1 + beta[k]) * Math.cos(ph[k]));
      const aIm = BRANCHES.map((k) => (1 + beta[k]) * Math.sin(ph[k]));
      const nrm = Math.sqrt(aRe.reduce((s2, v, i) => s2 + v * v + aIm[i] * aIm[i], 0));
      if (!(nrm > 0)) throw new Error('CG-QFT-AH: all branch amplitudes vanish (far outside the perturbative domain)');
      const ia = [0, 0, 1, 1], ib = [0, 1, 0, 1];
      const rho = zeros(4);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const xr = aRe[i] / nrm, xi = aIm[i] / nrm, yr = aRe[j] / nrm, yi = aIm[j] / nrm; // ψ_i ψ_j*
        const damp = Math.exp(-dA * (ia[i] !== ia[j] ? 1 : 0)) * Math.exp(-dB * (ib[i] !== ib[j] ? 1 : 0));
        rho.re[i * 4 + j] = (xr * yr + xi * yi) * damp;
        rho.im[i * 4 + j] = (xi * yr - xr * yi) * damp;
      }
      return rho;
    }
    default:
      throw new Error(`hypothesis ${id} is not implemented in the offline engine`);
  }
}

/** Protocol frame reference phases: nominal gravitational phases (identical for every hypothesis). */
export function protocolPhases(sc: ModelScenario, t = sc.design.time): Phases {
  return phasesFromEnergies(gravitationalBranchEnergies(sc.design), t);
}

/** Observable predictions of each hypothesis (qgdevs.discrimination.predictions_table). */
export function predictionsTable(sc: ModelScenario, ids: readonly string[] = IMPLEMENTED_IDS, t = sc.design.time): ModelPrediction[] {
  const ref = protocolPhases(sc, t);
  return ids.map((id) => {
    const rho = modelState(id, sc, t);
    const rc = applyLocalCorrection(rho, ref);
    const coh = reducedCoherences(rho);
    const correlators: Record<string, number> = {};
    for (const s of PAULI_SETTINGS) correlators[s] = correlatorFromProbs(outcomeProbabilities(rc, s));
    return {
      id, negativity: negativity(rho), concurrence: concurrence(rho), witness_cpk: cpkWitnessBestSign(rc),
      purity: purity(rho), coherence_A: coh.A, coherence_B: coh.B, correlators,
    };
  });
}

export { entanglingPhase };
