/** Every formula written into the shared and suite 1–6 pages must typeset under KaTeX strict mode. */
import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { T, F, NOTATION_L1 } from '../pages/formulas-l1';
import { splitMath } from '../components/Tex';

const render = (tex: string, display = false) => katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'error', output: 'htmlAndMathml' });

const prose: [string, string][] = [...Object.entries(T), ...NOTATION_L1.map(([s, m], i) => [`notation[${i}]`, m] as [string, string])];
const bare: [string, string][] = [...Object.entries(F), ...NOTATION_L1.map(([s], i) => [`notation-symbol[${i}]`, s] as [string, string])];

describe('inline maths in prose (T, notation)', () => {
  it.each(prose)('%s', (_k, text) => {
    const parts = splitMath(text).filter((p) => p.kind !== 'text');
    expect(parts.length).toBeGreaterThan(0); // every entry really contains maths
    for (const p of parts) expect(render(p.s, p.kind === 'display')).toContain('<math');
  });
});

describe('bare formulas (F)', () => {
  it.each(bare)('%s', (_k, tex) => { expect(render(tex, true)).toContain('<math'); });
});

describe('no plain-text formula remnants in converted prose', () => {
  it.each(prose)('%s keeps maths inside $…$', (_k, text) => {
    const outside = splitMath(text).filter((p) => p.kind === 'text').map((p) => p.s).join(' ');
    expect(outside).not.toMatch(/[φρħ√Σ∫∝]|_\{|\^\{|e\^/);
  });
});
