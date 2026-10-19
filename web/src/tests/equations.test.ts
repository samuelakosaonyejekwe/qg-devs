/** Every equation served by GET /api/equations (bundled build-time copy) must typeset under KaTeX strict mode. */
import { describe, expect, it } from 'vitest';
import katex from 'katex';
import eqs from '../generated/equations.json';
import { splitMath } from '../components/Tex';

const all: { where: string; tex: string }[] = [
  ...Object.entries((eqs as any).suites as Record<string, { label: string; tex: string }[]>).flatMap(([n, l]) => l.map((e) => ({ where: `suite ${n}: ${e.label}`, tex: e.tex }))),
  ...Object.entries((eqs as any).models as Record<string, Record<string, string[]>>).flatMap(([h, m]) => Object.entries(m).flatMap(([k, l]) => l.map((t, i) => ({ where: `${h}.${k}[${i}]`, tex: t })))),
  ...Object.entries((eqs as any).protocol as Record<string, string>).map(([k, t]) => ({ where: `protocol.${k}`, tex: t })),
];

describe('KaTeX strict rendering of every backend equation', () => {
  it('bundles a non-trivial equation set', () => { expect(all.length).toBeGreaterThanOrEqual(60); });
  it.each(all.map((e) => [e.where, e.tex]))('%s', (_w, tex) => {
    const html = katex.renderToString(tex as string, { displayMode: true, throwOnError: true, strict: 'error', output: 'htmlAndMathml' });
    expect(html).toContain('<math'); // MathML present for screen readers
  });
});

describe('splitMath', () => {
  it('splits inline and display maths', () => {
    expect(splitMath('a $x^2$ b $$y$$ c')).toEqual([
      { kind: 'text', s: 'a ' }, { kind: 'inline', s: 'x^2' }, { kind: 'text', s: ' b ' }, { kind: 'display', s: 'y' }, { kind: 'text', s: ' c' }]);
  });
  it('keeps escaped dollars literal', () => { expect(splitMath('costs \\$5')).toEqual([{ kind: 'text', s: 'costs $5' }]); });
  it('leaves plain text alone', () => { expect(splitMath('no maths')).toEqual([{ kind: 'text', s: 'no maths' }]); });
});
