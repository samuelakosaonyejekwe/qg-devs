/** Bias-field physics: diamagnetic coupling scales as B² and its help text typesets under KaTeX strict mode. */
import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { readFileSync } from 'node:fs';
import { diamagneticBranchEnergies, getMaterial, scenarioFor } from './index';
import { DEFAULT_DESIGN, DEFAULT_ENV } from '../lib/types';

describe('bias field', () => {
  it('diamagnetic branch energies scale as B² and vanish at B = 0', () => {
    const chi = getMaterial('diamond').magnetic_susceptibility;
    const e1 = diamagneticBranchEnergies(DEFAULT_DESIGN, chi, [0, 0, 1]);
    const e2 = diamagneticBranchEnergies(DEFAULT_DESIGN, chi, [0, 0, 2]);
    for (const k of ['LL', 'LR', 'RL', 'RR'] as const) expect(e2[k] / e1[k]).toBeCloseTo(4, 12);
    expect(scenarioFor(DEFAULT_DESIGN, DEFAULT_ENV).nongrav_channels.LL.diamagnetic).toBeUndefined();
    expect(scenarioFor(DEFAULT_DESIGN, { ...DEFAULT_ENV, bias_field_T: 1 }).nongrav_channels.LL.diamagnetic).toBeCloseTo(e1.LL, 50);
  });
  it('the bias-field tooltip typesets under KaTeX strict mode', () => {
    const src = readFileSync(new URL('../components/ScenarioForm.tsx', import.meta.url), 'utf8');
    const text = /BIAS_FIELD_HELP = String\.raw`([^`]*)`/.exec(src)![1];
    const maths = text.match(/\$[^$]+\$/g)!;
    expect(maths.length).toBeGreaterThanOrEqual(4);
    for (const m of maths) expect(() => katex.renderToString(m.slice(1, -1), { throwOnError: true, strict: 'error' })).not.toThrow();
  });
});
