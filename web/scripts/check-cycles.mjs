#!/usr/bin/env node
/**
 * Static import-cycle check over src/ (runtime imports only: `import type` and dynamic import() are ignored,
 * since they cannot cause initialisation-order problems). Prints every strongly connected component with
 * more than one module and exits 1 if any cycle exists (or with --report, always 0).
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) && !/\.d\.ts$/.test(f)) files.push(p); } })(root);
const resolve = (from, spec) => {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
};
const graph = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const deps = new Set();
  const re = /^\s*(import|export)\s+(?!type\b)([^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] === 'export' && !m[2]) continue;
    // skip `import { type A, type B } from` where every specifier is type-only
    if (m[2] && /^\{\s*(type\s+\w+\s*,?\s*)+\}\s*from\s+$/.test(m[2].trim() + ' ')) continue;
    const r = resolve(f, m[3]);
    if (r && !/\.(json|css)$/.test(r)) deps.add(r);
  }
  graph.set(f, deps);
}
// Tarjan SCC
let index = 0; const st = []; const on = new Set(); const idx = new Map(); const low = new Map(); const sccs = [];
function sc(v) {
  idx.set(v, index); low.set(v, index); index++; st.push(v); on.add(v);
  for (const w of graph.get(v) ?? []) {
    if (!idx.has(w)) { sc(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
  }
  if (low.get(v) === idx.get(v)) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1) sccs.push(c); }
}
for (const v of graph.keys()) if (!idx.has(v)) sc(v);
const rel = (p) => path.relative(root, p);
if (!sccs.length) console.log(`no import cycles among ${files.length} modules`);
for (const c of sccs) console.log(`cycle (${c.length} modules): ${c.map(rel).join(' ↔ ')}`);
process.exit(sccs.length && !process.argv.includes('--report') ? 1 : 0);
