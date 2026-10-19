/** Scenario assembly (decoherence budget + non-gravitational channels), mirroring qgdevs.design.scenario_for. */
import type { Design, Environment } from '../lib/types';
import { BRANCHES } from '../lib/types';
import { radiusOf } from './bmv';
import { e as eCharge } from './constants';
import { decoherenceBudget } from './decoherence';
import { Channel, branchEnergies, diamagneticBranchEnergies, spinDipolarBranchEnergies, totalByBranch } from './em';
import { clausiusMossotti, getMaterial } from './materials';
import type { ModelScenario } from './models';

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
  // always-present NV spin–spin dipolar coupling; diamagnetic coupling when a bias field is applied (along z)
  const sd = spinDipolarBranchEnergies(design);
  for (const k of BRANCHES) ch[k].spin_dipolar = sd[k];
  if (env.bias_field_T) {
    const dm = diamagneticBranchEnergies(design, mat.magnetic_susceptibility, [0, 0, env.bias_field_T]);
    for (const k of BRANCHES) ch[k].diamagnetic = dm[k];
  }
  const sc: ModelScenario = { design, gamma_env_A: budA.total_rate, gamma_env_B: budB.total_rate, nongrav: totalByBranch(ch) };
  return { scenario: sc, decoherence_A: budA, decoherence_B: budB, nongrav_channels: ch };
}

