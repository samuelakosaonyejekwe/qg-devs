#!/usr/bin/env node
/**
 * GitHub Pages deployment check: the app served under a sub-path on one origin, calling the API on another
 * origin (CORS), with its CSP delivered as a <meta> tag.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/e2e-pages.mjs <pagesUrl e.g. http://127.0.0.1:8790/qg-devs/> <apiOrigin> [screenshotDir]
 *   env QG_API_DOWN / QG_API_UP: shell commands that stop / start the API (for the offline step)
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const APP = process.argv[2] || 'http://127.0.0.1:8790/qg-devs/';
const API = (process.argv[3] || 'http://127.0.0.1:8781').replace(/\/$/, '');
const OUT = process.argv[4] || path.resolve('../docs/screenshots/pages');
fs.mkdirSync(OUT, { recursive: true });
const base = new URL(APP).pathname;

const log = [];
let fails = 0;
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const note = await fn(); log.push(`PASS ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0} ms)`); }
  catch (e) { fails++; log.push(`FAIL ${name} — ${String(e?.message ?? e).split('\n')[0].slice(0, 300)}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.addInitScript(() => {
  try { if (!localStorage.getItem('qg.lastSeenVersion')) localStorage.setItem('qg.lastSeenVersion', '999.0.0'); } catch { /* */ }
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); if (/Refused to/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
const csp = async () => page.evaluate(() => window.__csp ?? []);
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });

await step('loads under the sub-path with a meta CSP', async () => {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForSelector('main h1');
  const meta = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', 'content');
  assert(meta && meta.includes(`connect-src 'self' ${API}`), `meta CSP missing or wrong: ${meta}`);
  assert(!/frame-ancestors/.test(meta), 'frame-ancestors must not be in a meta CSP');
  await shot('01-dashboard');
  return `CSP meta: connect-src 'self' ${API}`;
});

await step('internal links stay under the base; back/forward', async () => {
  const hrefs = await page.$$eval('nav.sidenav a', (as) => as.map((a) => a.getAttribute('href')));
  const outside = hrefs.filter((h) => h && h.startsWith('/') && !h.startsWith(base));
  assert(!outside.length, `links outside the base: ${outside.slice(0, 3)}`);
  await page.click(`nav.sidenav a[href="${base}suite/entanglement"]`);
  await page.waitForURL(`**${base}suite/entanglement`);
  await page.click(`nav.sidenav a[href="${base}suite/lab"]`);
  await page.waitForURL(`**${base}suite/lab`);
  await page.click('button[aria-label^="Back"]');
  await page.waitForURL(`**${base}suite/entanglement`);
  await page.click('button[aria-label^="Forward"]');
  await page.waitForURL(`**${base}suite/lab`);
  return `${hrefs.length} sidebar links under ${base}`;
});

await step('deep-link reload (served via 404.html) renders the route', async () => {
  const r = await page.goto(`${APP}suite/decoherence`, { waitUntil: 'networkidle' });
  const h1 = await page.locator('main h1').first().innerText();
  assert(/Suite 7/.test(h1), `h1 = ${h1}`);
  return `HTTP ${r.status()} from the static host, app route rendered: ${h1}`;
});

await step('flagship prediction from the cross-origin API; KaTeX; 3-D', async () => {
  await page.goto(`${APP}suite/entanglement`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Key predictions', { timeout: 60000 });
  const server = await page.locator('section[aria-label="Key predictions"] .badge.b-computed').count();
  assert(server > 0, 'result not from the server (no COMPUTED badges)');
  await page.waitForSelector('.katex', { timeout: 30000 });
  await page.waitForSelector('.view3d canvas', { timeout: 60000 });
  const fontsOk = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some((f) => /KaTeX/.test(f.family) && f.status === 'loaded'); });
  assert(fontsOk, 'KaTeX fonts not loaded under the base path');
  await shot('02-flagship');
  return 'server result, KaTeX fonts loaded, 3-D canvas present';
});

await step('a computation job round-trips through the cross-origin API', async () => {
  if (process.env.SKIP_JOB) return 'skipped (read-only run against production)';
  await page.goto(`${APP}suite/falsification`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Discrimination/ }).click();
  await page.locator('main [data-run]', { hasText: /discrimination/i }).first().click();
  await page.waitForSelector('text=/indistinguishable|distinguishable/i', { timeout: 300000 });
  return 'discrimination_matrix job finished';
});

await step('Suite 18: whoami and anchors from the API', async () => {
  await page.goto(`${APP}suite/evidence#signoff`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const txt = await page.locator('main').innerText();
  await page.screenshot({ path: path.join(OUT, '04-signoff-identity.png') });
  await page.goto(`${APP}suite/evidence#anchors`, { waitUntil: 'networkidle' });
  assert(/Signing as|Acting as|Researcher access required/i.test(txt), 'identity line (whoami) missing');
  await page.waitForSelector('#anchors', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const a = await page.locator('#anchors').innerText();
  await page.locator('#anchors').screenshot({ path: path.join(OUT, '05-anchors.png') });
  assert(/VALID|problem/i.test(a), 'anchor verification badge missing');
  return `identity line shown; anchors card: ${a.split('\n').find((l) => /VALID|problem/i.test(l))}`;
});

await step('installable: manifest under the base, service worker scoped to the base', async () => {
  const href = await page.getAttribute('link[rel="manifest"]', 'href');
  const m = await page.evaluate(async (h) => { const r = await fetch(h); return { ok: r.ok, j: await r.json(), url: r.url }; }, href);
  assert(m.ok, 'manifest not served');
  const start = new URL(m.j.start_url, m.url).pathname, scope = new URL(m.j.scope, m.url).pathname;
  assert(start === base && scope === base, `start_url ${start}, scope ${scope}`);
  for (const ic of m.j.icons) { const ok = await page.evaluate(async (u) => (await fetch(u)).ok, new URL(ic.src, m.url).href); assert(ok, `icon ${ic.src} missing`); }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' });
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { scope: r?.scope, controlled: !!navigator.serviceWorker.controller }; });
  assert(sw.controlled && new URL(sw.scope).pathname === base, `SW ${JSON.stringify(sw)}`);
  // wait for lazy precache
  for (let i = 0; i < 40; i++) {
    const info = await page.evaluate(() => new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = (e) => res(e.data); navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHE_INFO' }, [ch.port2]); setTimeout(() => res(null), 2000); }));
    if (info && info.lazy >= info.lazyTotal) return `start_url/scope ${base}; SW scope ${sw.scope}; precached ${info.shell}+${info.lazy}`;
    await page.waitForTimeout(1000);
  }
  throw new Error('lazy chunks not precached');
});

await step('offline: shell and deep link from cache, flagship computes locally', async () => {
  if (process.env.SKIP_OFFLINE) return 'skipped (would require taking the production API offline; verified locally)';
  if (process.env.QG_API_DOWN) execSync(process.env.QG_API_DOWN, { stdio: 'inherit' });
  await ctx.setOffline(true);
  await page.goto(`${APP}suite/entanglement`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('section[aria-label="Key predictions"] .badge.b-local', { timeout: 60000 });
  await shot('03-offline-local-engine');
  await page.click(`nav.sidenav a[href="${base}suite/quantum"]`);
  await page.waitForSelector('main h1');
  await ctx.setOffline(false);
  if (process.env.QG_API_UP) execSync(process.env.QG_API_UP, { stdio: 'inherit' });
  return 'offline flagship result badged COMPUTED LOCALLY; lazy page loaded from cache';
});

await step('no CSP violations, no console errors', async () => {
  const v = await csp();
  assert(!v.length, v.join(' | '));
  const e = [...new Set(errors)].filter((x) => !/net::ERR_INTERNET_DISCONNECTED|offline/i.test(x));
  assert(!e.length, e.slice(0, 5).join(' | '));
  return 'CSP (meta) enforced: 0 violations';
});

await browser.close();
console.log(log.join('\n'));
console.log(`\n${log.length - fails}/${log.length} GitHub Pages checks passed (${APP} → API ${API})`);
process.exit(fails ? 1 : 0);
