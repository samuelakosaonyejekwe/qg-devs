/**
 * Offline physics engine. Independent TypeScript implementation of the BMV prediction chain of the
 * QG-DEVS reference (POST /api/bmv/predict), checked against golden vectors generated from the Python
 * reference (tools/golden_vectors.py → golden.json; see engine.test.ts).
 */
import type { BranchKey, DecoBudget, Design, Environment, PredictResult } from '../lib/types';
import { BRANCHES } from '../lib/types';
import {
  applyLocalCorrection, branchDistances, branchPositions, checkGeometry, cpkWitnessBestSign, decomposePhases,
  entanglingPhase, gravitationalBranchEnergies, jointState, phasesFromEnergies, radiusOf,
} from './bmv';
import { e as eCharge } from './constants';
import { decoherenceBudget } from './decoherence';
import { Channel, branchEnergies, totalByBranch } from './em';
import { clausiusMossotti, getMaterial } from './materials';
import { ModelScenario, predictionsTable } from './models';
import { checkDensityMatrix, concurrence, logNegativity, negativity, pptWitness, purity } from './quantum';
import { toArrays } from './linalg';

export { CONSTANTS } from './constants';
export { MATERIALS, clausiusMossotti, getMaterial } from './materials';
export { checkGeometry, radiusOf, branchPositions, branchDistances, parallelDeltaPhiAnalytic, fmtE3 } from './bmv';
export { decoherenceBudget, diosiPenroseRate } from './decoherence';
export { minDistanceForGravityDominance, casimirPolderEnergy, casimirToGravityRatio } from './em';
export { eftPotentialTerms, predictionsTable, modelState, IMPLEMENTED_IDS } from './models';
export type { ModelScenario } from './models';

export const LOCAL_EVIDENCE_STATUS = 'COMPUTED LOCALLY (offline engine) — computational prediction, not physical evidence';

/** qgdevs.design.scenario_for: decoherence budgets of A and B and non-gravitational branch energies. */
export function scenarioFor(design: Design, env: Environment) {
  const mat = getMaterial(env.material);
  const cm = clausiusMossotti(mat);
  const RA = radiusOf(design.mass_A, design.density), RB = radiusOf(design.mass_B, design.density);
  const common = { pressure: env.pressure, T_gas: env.T_gas, T_env: env.T_env, T_int: env.T_int, cm, t: design.time };
  const budA = decoherenceBudget(design.mass_A, RA, design.dx_A, common);
  const budB = decoherenceBudget(design.mass_B, RB, design.dx_B, common);
  const include: Channel[] = env.include_casimir ? ['casimir', 'coulomb', 'induced'] : ['coulomb', 'induced'];
  const q = env.residual_charge_e * eCharge;
  const ch = branchEnergies(design, cm.re, cm.re, q, q, include);
  const sc: ModelScenario = { design, gamma_env_A: budA.total_rate, gamma_env_B: budB.total_rate, nongrav: totalByBranch(ch) };
  return { scenario: sc, decoherence_A: budA, decoherence_B: budB, nongrav_channels: ch };
}

function linspace(a: number, b: number, n: number): number[] {
  if (n === 1) return [a];
  const step = (b - a) / (n - 1);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? b : a + i * step));
}

/** Full prediction for a design + environment, same shape as POST /api/bmv/predict. */
export function predictScenario(design0: Design, env: Environment, nTimes = 120): PredictResult | { admissibility_issues: string[] } {
  const design: Design = { ...design0 };
  const issues = checkGeometry(design);
  if (issues.length) return { admissibility_issues: issues };
  const { scenario, decoherence_A, nongrav_channels } = scenarioFor(design, env);
  design.gamma_A = scenario.gamma_env_A;
  design.gamma_B = scenario.gamma_env_B;
  const t = design.time;
  const Eg = gravitationalBranchEnergies(design);
  const E = {} as Record<BranchKey, number>;
  for (const k of BRANCHES) E[k] = Eg[k] + (scenario.nongrav[k] ?? 0);
  const ph = phasesFromEnergies(E, t);
  const phG = phasesFromEnergies(Eg, t);
  const rho = jointState(ph, design.gamma_A * t, design.gamma_B * t);
  const rc = applyLocalCorrection(rho, ph);
  const dm = toArrays(rho);
  const times = linspace(0, t, Math.min(Math.max(nTimes, 10), 400));
  const ts = { t: [] as number[], delta_phi: [] as number[], concurrence: [] as number[], negativity: [] as number[], witness_cpk: [] as number[], purity: [] as number[] };
  for (const tt of times) {
    const p = phasesFromEnergies(E, tt);
    const r = jointState(p, design.gamma_A * tt, design.gamma_B * tt);
    ts.t.push(tt);
    ts.delta_phi.push(entanglingPhase(p));
    ts.concurrence.push(concurrence(r));
    ts.negativity.push(negativity(r));
    ts.witness_cpk.push(cpkWitnessBestSign(applyLocalCorrection(r, p)));
    ts.purity.push(purity(r));
  }
  const RA = radiusOf(design.mass_A, design.density), RB = radiusOf(design.mass_B, design.density);
  const pos = branchPositions(design);
  return {
    design: { ...design, radius_A: RA, radius_B: RB },
    admissibility_issues: [],
    branch_distances_m: branchDistances(design),
    gravitational_energies_J: Eg,
    total_energies_J: E,
    phases_rad: ph,
    phase_decomposition: decomposePhases(ph),
    delta_phi_gravity_rad: entanglingPhase(phG),
    delta_phi_total_rad: entanglingPhase(ph),
    concurrence: concurrence(rho),
    negativity: negativity(rho),
    log_negativity: logNegativity(rho),
    purity: purity(rho),
    pure_state_concurrence_bound: Math.abs(Math.sin(entanglingPhase(ph) / 2)),
    witness_cpk_local_corrected: cpkWitnessBestSign(rc),
    witness_ppt: pptWitness(rho),
    state_check: checkDensityMatrix(rho),
    density_matrix_real: dm.re,
    density_matrix_imag: dm.im,
    time_series: ts,
    models: predictionsTable(scenario),
    decoherence: decoherence_A as DecoBudget,
    nongrav_channels,
    branch_positions: pos,
    evidence_status: LOCAL_EVIDENCE_STATUS,
  };
}

/**
 * Negativity, CPK witness (after the protocol frame) and concurrence of each hypothesis as functions of
 * the interaction time: at each t the scenario (incl. decoherence budgets) is recomputed with design.time = t,
 * exactly as predictions_table would be for that design. t = 0 is evaluated directly (product state).
 */
export function modelCurves(design: Design, env: Environment, ids: string[], times: number[]) {
  const out: Record<string, { negativity: number[]; witness: number[]; concurrence: number[] }> = {};
  for (const id of ids) out[id] = { negativity: [], witness: [], concurrence: [] };
  // all rates are time independent, so the scenario only needs the design at a positive time
  for (const t of times) {
    const dt: Design = { ...design, time: t > 0 ? t : design.time };
    const { scenario } = scenarioFor(dt, env);
    const rows = predictionsTable(scenario, ids, t);
    rows.forEach((r) => {
      out[r.id].negativity.push(r.negativity);
      out[r.id].witness.push(r.witness_cpk);
      out[r.id].concurrence.push(r.concurrence);
    });
  }
  return out;
}

export { checkDensityMatrix };
