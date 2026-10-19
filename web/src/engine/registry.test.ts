/** The local engine must implement every hypothesis in the backend registry (bundled from qgdevs/equations.py). */
import { describe, expect, it } from 'vitest';
import eqs from '../generated/equations.json';
import { IMPLEMENTED_IDS, SERVER_ONLY_IDS, predictionsTable } from './index';
import { IMPLEMENTED_IDS as UI_IDS, HYP } from '../lib/hyp';
import { DEFAULT_DESIGN } from '../lib/types';

const backendIds = Object.keys((eqs as any).models as Record<string, unknown>);

describe('hypothesis registry consistency', () => {
  it('engine ids + documented server-only ids = backend registry', () => {
    expect([...IMPLEMENTED_IDS, ...SERVER_ONLY_IDS].sort()).toEqual([...backendIds].sort());
  });
  it('the UI hypothesis list matches the engine (same order) and every id has a distinct style', () => {
    expect(UI_IDS).toEqual([...IMPLEMENTED_IDS]);
    const colors = UI_IDS.map((id) => HYP[id]?.color);
    expect(colors.every(Boolean)).toBe(true);
    expect(new Set(colors).size).toBe(colors.length);
  });
  it('every engine hypothesis yields a valid prediction for the reference design', () => {
    const rows = predictionsTable({ design: { ...DEFAULT_DESIGN }, gamma_env_A: 0.0125, gamma_env_B: 0.0125, nongrav: { LL: 0, LR: 0, RL: 0, RR: 0 } });
    expect(rows.map((r) => r.id)).toEqual([...IMPLEMENTED_IDS]);
    for (const r of rows) {
      expect(Number.isFinite(r.negativity) && r.negativity >= 0, r.id).toBe(true);
      expect(Math.abs(r.purity - 1) < 1 && r.purity > 0, r.id).toBe(true);
    }
  });
});
