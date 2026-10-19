/**
 * Small derived quantities used by visualisations:
 * - Born outcome probabilities of every Pauli setting for a hypothesis, in the preregistered protocol frame
 *   and including symmetric readout error (qgdevs.discrimination.MeasurementChain / sigproc.simulate_counts:
 *   p → (M_A ⊗ M_B) p with M = [[1−ε, ε], [ε, 1−ε]]).
 * - Point-mass entangling phase as computed by qgdevs.discovery.bmv_scaling_study.
 */
import type { Design, Environment } from '../lib/types';
import { applyLocalCorrection, branchDistances, entanglingPhase, phasesFromEnergies } from './bmv';
import { modelState, protocolPhases } from './models';
import { outcomeProbabilities, PAULI_SETTINGS } from './quantum';
import { G } from './constants';
import { scenarioFor } from './index';

export function bornProbabilities(design: Design, env: Environment, model: string, readoutError: number, settings: string[] = PAULI_SETTINGS): Record<string, number[]> {
  const { scenario } = scenarioFor(design, env);
  const rc = applyLocalCorrection(modelState(model, scenario), protocolPhases(scenario));
  const e = readoutError, M = [[1 - e, e], [e, 1 - e]];
  const out: Record<string, number[]> = {};
  for (const s of settings) {
    const p = outcomeProbabilities(rc, s);
    const q = [0, 0, 0, 0];
    // outcome index = 2a + b with a, b ∈ {0 (+), 1 (−)}; (M ⊗ M)[2a+b][2c+d] = M[a][c] M[b][d]
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) for (let d = 0; d < 2; d++) q[2 * a + b] += M[a][c] * M[b][d] * p[2 * c + d];
    out[s] = q;
  }
  return out;
}

/** Entangling phase Δφ for point masses (U_ij = −G m_A m_B / r_ij), as in the discovery scaling study. */
export function pointMassDeltaPhi(design: Design): number {
  const r = branchDistances(design);
  const E = { LL: -G * design.mass_A * design.mass_B / r.LL, LR: -G * design.mass_A * design.mass_B / r.LR, RL: -G * design.mass_A * design.mass_B / r.RL, RR: -G * design.mass_A * design.mass_B / r.RR };
  return entanglingPhase(phasesFromEnergies(E, design.time));
}
