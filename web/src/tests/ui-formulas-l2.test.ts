/**
 * Every hand-written formula in the Suite 7–18 pages must typeset under KaTeX strict mode.
 * Formulas are extracted from the sources: JSX `text="…$…$…"` (MathText) and `tex="…"` (Tex) attributes,
 * which JSX passes through verbatim, plus the TeX string tables in Suites 11 and 14.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import katex from 'katex';
import { splitMath } from '../components/Tex';

const DIR = path.resolve(__dirname, '../pages/suites');
const FILES = fs.readdirSync(DIR).filter((f) => /^S(0[7-9]|1[0-8])\w*\.tsx$/.test(f));

const formulas: { where: string; tex: string }[] = [];
for (const f of FILES) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  for (const m of src.matchAll(/\btext="([^"]*)"/g)) {
    for (const p of splitMath(m[1])) if (p.kind !== 'text') formulas.push({ where: `${f} MathText`, tex: p.s });
  }
  for (const m of src.matchAll(/<Tex\b[^>]*?\btex="([^"]*)"/g)) formulas.push({ where: `${f} Tex`, tex: m[1] });
}
// TS single-quoted string tables (escapes: \\ → \)
const unq = (s: string) => s.replace(/\\\\/g, '\\');
{
  const s11 = fs.readFileSync(path.join(DIR, 'S11Inference.tsx'), 'utf8');
  const block = s11.slice(s11.indexOf('const PARAM_INFO'), s11.indexOf('};', s11.indexOf('const PARAM_INFO')));
  for (const m of block.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)) for (const p of splitMath(unq(m[1]))) if (p.kind !== 'text') formulas.push({ where: 'S11 PARAM_INFO', tex: p.s });
  const s14 = fs.readFileSync(path.join(DIR, 'S14Discovery.tsx'), 'utf8');
  for (const name of ['REF_SERIES_TEX', 'REL_TEX']) {
    const b = s14.slice(s14.indexOf(`const ${name}`), s14.indexOf('};', s14.indexOf(`const ${name}`)));
    for (const m of b.matchAll(/'(?:[^'\\]|\\.)*':\s*'((?:[^'\\]|\\.)*)'/g)) formulas.push({ where: `S14 ${name}`, tex: unq(m[1]) });
  }
}
// S14 lawTex output for the server's far-field expression (mirrors the page's mapping)
const TEXSYM: Record<string, string> = { hbar: '\\hbar', G: 'G', mass: 'm', separation: 'd', branch_separation: '\\Delta x', time: 't' };
const law = 'G^1 · hbar^-1 · mass^2 · separation^-3 · branch_separation^2 · time^1'.split('·').map((x) => x.trim()).map((f) => { const [n, e] = f.split('^'); return `${TEXSYM[n]}${e === '1' ? '' : `^{${e}}`}`; }).join('\\,');
formulas.push({ where: 'S14 law', tex: `\\Delta\\varphi \\;=\\; C\\,${law}` });
formulas.push({ where: 'S14 plane', tex: 'x = 2\\log_{10} m + 2\\log_{10}\\Delta x + 1\\log_{10} t' });
formulas.push({ where: 'S14 plane', tex: '\\log_{10}\\Delta\\varphi = 23.8 + x - 3\\,\\log_{10} d' });

describe('KaTeX strict rendering of Suite 7–18 UI formulas', () => {
  it('finds the formulas', () => { expect(formulas.length).toBeGreaterThan(40); });
  it.each(formulas.map((f, i) => [`${i} ${f.where}`, f.tex]))('%s: %s', (_w, tex) => {
    expect(() => katex.renderToString(tex as string, { throwOnError: true, strict: 'error' })).not.toThrow();
  });
});
