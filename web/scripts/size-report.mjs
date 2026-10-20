// Post-build bundle size report: raw and gzip sizes of every asset and the initial-load budget check.
import { gzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET_KB = 120;
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('size-report: dist/index.html not found — run vite build first');
  process.exit(1);
}

const kb = (n) => n / 1024;
const fmt = (n) => kb(n).toFixed(1).padStart(8);

function walk(dir, prefix = '') {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p, prefix + f + '/'));
    else out.push(prefix + f);
  }
  return out;
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const initial = new Set();
// strip the deployment base ("/" or e.g. "/qg-devs/" on GitHub Pages) so paths match files under dist/
const BASE = (process.env.VITE_BASE || '/').replace(/\/?$/, '/');
const rel = (u) => (u.startsWith(BASE) ? u.slice(BASE.length) : u.replace(/^\//, ''));
for (const m of html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)) initial.add(rel(m[1]));
for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) initial.add(rel(m[1]));
for (const m of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) initial.add(rel(m[1]));

const files = walk(join(dist, 'assets'), 'assets/').filter((f) => /\.(js|css|json|wasm)$/.test(f));
const rows = files.map((f) => {
  const buf = readFileSync(join(dist, f));
  return { file: f, raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length, initial: initial.has(f) };
}).sort((a, b) => Number(b.initial) - Number(a.initial) || b.gzip - a.gzip);

const sum = (arr, k) => arr.reduce((s, r) => s + r[k], 0);
const initJs = rows.filter((r) => r.initial && r.file.endsWith('.js'));
const initCss = rows.filter((r) => r.initial && r.file.endsWith('.css'));
const htmlGz = gzipSync(Buffer.from(html), { level: 9 }).length;

console.log('\nchunk'.padEnd(62) + 'raw kB'.padStart(9) + 'gzip kB'.padStart(9) + '  initial');
for (const r of rows) console.log(r.file.padEnd(61) + fmt(r.raw) + ' ' + fmt(r.gzip) + (r.initial ? '  *' : ''));
console.log('');
console.log(`index.html (gzip): ${kb(htmlGz).toFixed(1)} kB`);
console.log(`Initial JS (gzip): ${kb(sum(initJs, 'gzip')).toFixed(1)} kB  (budget ${BUDGET_KB} kB, ${initJs.length} file(s))`);
console.log(`Initial CSS (gzip): ${kb(sum(initCss, 'gzip')).toFixed(1)} kB`);
console.log(`All assets (gzip): ${kb(sum(rows, 'gzip')).toFixed(1)} kB in ${rows.length} files`);

const report = {
  generated: new Date().toISOString(),
  budget_kb: BUDGET_KB,
  initial_js_gzip_kb: +kb(sum(initJs, 'gzip')).toFixed(2),
  initial_css_gzip_kb: +kb(sum(initCss, 'gzip')).toFixed(2),
  index_html_gzip_kb: +kb(htmlGz).toFixed(2),
  total_gzip_kb: +kb(sum(rows, 'gzip')).toFixed(2),
  chunks: rows.map((r) => ({ ...r, raw_kb: +kb(r.raw).toFixed(2), gzip_kb: +kb(r.gzip).toFixed(2) })),
};
writeFileSync(join(dist, 'size-report.json'), JSON.stringify(report, null, 2));

if (kb(sum(initJs, 'gzip')) > BUDGET_KB) {
  console.error(`size-report: initial JS exceeds the ${BUDGET_KB} kB gzip budget`);
  process.exit(1);
}
