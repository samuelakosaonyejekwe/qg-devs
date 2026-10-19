/** One cell of the local 2-D sweep, mirroring qgdevs.design.sweep_2d (see compute.worker.ts). */
import { checkGeometry, predictionsTable, scenarioFor } from '../engine';
import type { Design, Environment } from '../lib/types';

export function cell(design: Design, env: Environment, px: keyof Design, x: number, py: keyof Design, y: number, hyp: string): [number | null, number | null] {
  const d: Design = { ...design, [px]: x, [py]: y } as Design;
  if (px === 'mass_A' || py === 'mass_A') d.mass_B = d.mass_A;
  if (px === 'dx_A' || py === 'dx_A') d.dx_B = d.dx_A;
  if (checkGeometry(d).length) return [null, null];
  const { scenario } = scenarioFor(d, env);
  const r = predictionsTable(scenario, [hyp])[0];
  return [r.negativity, r.witness_cpk];
}
