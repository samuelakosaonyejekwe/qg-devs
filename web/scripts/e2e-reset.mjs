#!/usr/bin/env node
/**
 * Reset = first visit. For every route:
 *   1. fresh browser profile → normalised snapshot of <main> (text with volatile timestamps/ids removed,
 *      every input/select/checkbox value, counts of result elements and 3-D/2-D views, player position);
 *   2. change inputs (first editable numeric field; switch a tab/toggle) and run the page's safe actions;
 *   3. Reset this page (confirm when asked);
 *   4. snapshot must equal the fresh one; after a reload it must still equal it (no stale results).
 *
 *   PLAYWRIGHT_MODULE=…/playwright/index.mjs node scripts/e2e-reset.mjs [baseUrl] [screenshotDir]
 */
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8777').replace(/\/$/, '');
const OUT = process.argv[3] || path.resolve('../docs/screenshots');
fs.mkdirSync(path.join(OUT, 'reset'), { recursive: true });

const ROUTES = ['/thought-lab', '/builder', ...['quantum', 'gravity', 'qg-eft', 'entanglement', 'interferometry', 'optomechanics', 'decoherence', 'environment', 'lab', 'signal', 'inference', 'falsification', 'design', 'discovery', 'hpc', 'verification', 'data', 'evidence'].map((s) => `/suite/${s}`)];
// actions that write evidence or start long studies are not clicked
const NO_CLICK = /preregistration|sign-off|ingest|unblinding|package|optimisation|discovery cycle|calibration|vv|verification run|fetch|record|start local sweep|reviewed these assumptions|bloch path|ladder|time sweep|discrimination|inference/i;

async function snap1(p) {
  return p.evaluate(() => {
    const main = document.querySelector('main').cloneNode(true);
    // not page state: the screen-reader reset announcement and the 3-D label overlay (rendering artefact)
    main.querySelectorAll('[data-reset-announce], .qg3d-labels, .view3d-overlay').forEach((e) => e.remove());
    document.body.appendChild(main); main.style.position = 'absolute'; main.style.left = '-99999px'; main.style.width = '1200px';
    const norm = (s) => s
      .replace(/\b\d{1,2} [A-Z][a-z]{2} \d{4},? \d{2}:\d{2}(:\d{2})?\b/g, '<time>')
      .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})?\b/g, '<iso>')
      .replace(/\b[0-9a-f]{12,64}\b/g, '<hash>')
      .replace(/\b\d+(\.\d+)? ?ms\b/g, '<ms>')
      .replace(/live · [^\n]*/g, 'live · <time>')
      .replace(/cached at [^\n]*/g, 'cached at <time>')
      .replace(/[ \t]+/g, ' ');
    const inputs = [...main.querySelectorAll('input, select, textarea')].map((e) => (e.type === 'checkbox' || e.type === 'radio') ? `${e.type}:${e.checked}` : `${e.tagName}:${e.type === 'file' ? '' : e.value}`);
    const pressed = [...main.querySelectorAll('[aria-pressed],[aria-checked],[aria-selected]')].map((e) => `${e.getAttribute('aria-pressed') ?? ''}${e.getAttribute('aria-checked') ?? ''}${e.getAttribute('aria-selected') ?? ''}`);
    const counts = ['figure.chart', '.view3d', '.out', 'table.data tbody tr', '.notice', '.error-box', '[data-result]'].map((s) => `${s}=${main.querySelectorAll(s).length}`);
    const ranges = [...main.querySelectorAll('.player input[type=range]')].map((r) => `${r.value}/${r.max}`);
    const out = { text: norm(main.innerText), inputs, pressed, counts, ranges };
    main.remove();
    return out;
  });
}
/** Snapshot once the page has settled: network idle and two consecutive identical snapshots. */
async function snapshot(p) {
  await p.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => undefined);
  let prev = null;
  for (let k = 0; k < 20; k++) {
    await p.waitForTimeout(1000);
    const cur = await snap1(p);
    if (prev && JSON.stringify(prev) === JSON.stringify(cur)) return cur;
    prev = cur;
  }
  return prev;
}

function diff(a, b) {
  const out = [];
  for (const k of ['inputs', 'pressed', 'counts', 'ranges']) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(`${k}: ${JSON.stringify(a[k]).slice(0, 160)} ≠ ${JSON.stringify(b[k]).slice(0, 160)}`);
  if (a.text !== b.text) {
    const al = a.text.split('\n'), bl = b.text.split('\n');
    let i = al.findIndex((l, k) => l !== bl[k]);
    if (i < 0) i = Math.min(al.length, bl.length);
    out.push(`text differs at line ${i}: "${(al[i] ?? '<end>').slice(0, 100)}" vs "${(bl[i] ?? '<end>').slice(0, 100)}"`);
  }
  return out;
}

const browser = await chromium.launch();
const rows = [];
let fails = 0;
for (const route of ROUTES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('qg.e2eInit')) { localStorage.setItem('qg.lastSeenVersion', '999.0.0'); localStorage.setItem('qg.gfx', 'low'); localStorage.setItem('qg.settings', JSON.stringify({ reducedMotion: 'on' })); sessionStorage.setItem('qg.e2eInit', '1'); } } catch { /* */ } });
  const p = await ctx.newPage();
  const t0 = Date.now();
  let status = 'PASS', note = '';
  try {
    await p.goto(BASE + route, { waitUntil: 'networkidle', timeout: 120000 });
    const fresh = await snapshot(p);
    // 2. change inputs and run
    const num = p.locator('main input[aria-describedby]:visible').first();
    if (await num.count()) {
      const v = await num.inputValue();
      const nv = String(Number(v) * 1.5 || 1.5);
      await num.fill(nv);
      await p.waitForTimeout(300);
      if (await p.locator('main .field.invalid').count()) await num.fill(v); // keep inputs valid
    }
    const tabs = await p.locator('main [role="tab"]').all();
    if (tabs.length > 1) { try { await tabs[1].click({ timeout: 2000 }); } catch { /* */ } }
    for (const b of await p.locator('main [data-run]').all()) {
      const t = (await b.innerText()).trim();
      if (NO_CLICK.test(t) || !(await b.isVisible()) || !(await b.isEnabled())) continue;
      try { await b.click({ timeout: 3000 }); await p.waitForLoadState('networkidle', { timeout: 60000 }); await p.waitForTimeout(800); } catch { /* */ }
    }
    const changed = await snapshot(p);
    const didChange = diff(fresh, changed).length > 0;
    // 3. reset this page (confirm when asked)
    const reset = p.locator('main [data-reset]').first();
    if (!(await reset.count())) { status = 'SKIP'; note = 'no Reset control (no run action on this page)'; }
    else {
      await reset.click();
      if (await p.locator('[data-reset-page]').count() && await p.locator('[role="menu"]').count()) await p.locator('[role="menu"] [data-reset-page]').click();
      if (await p.locator('dialog.confirm-dialog').count()) await p.click('[data-reset-confirm]');
      const after = await snapshot(p);
      const focusTop = await p.evaluate(() => window.scrollY === 0);
      const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
      await ctx2.addInitScript(() => { try { localStorage.setItem('qg.lastSeenVersion', '999.0.0'); localStorage.setItem('qg.gfx', 'low'); localStorage.setItem('qg.settings', JSON.stringify({ reducedMotion: 'on' })); } catch { /* */ } });
      const p2 = await ctx2.newPage();
      await p2.goto(BASE + route, { waitUntil: 'networkidle', timeout: 120000 });
      const fresh2 = await snapshot(p2);
      await ctx2.close();
      const d1 = diff(fresh2, after);
      await p.reload({ waitUntil: 'networkidle' });
      const reloaded = await snapshot(p);
      const d2 = diff(fresh2, reloaded);
      const focusOk = focusTop;
      if (d1.length || d2.length || !focusOk) { status = 'FAIL'; fails++; note = [...d1.map((x) => `after reset: ${x}`), ...d2.map((x) => `after reload: ${x}`), focusOk ? '' : 'not scrolled to top'].filter(Boolean).join(' | '); await p.screenshot({ path: path.join(OUT, 'reset', `fail${route.replace(/\//g, '-')}.png`), fullPage: true }); }
      else note = didChange ? 'changed → reset → identical to first visit (and after reload)' : 'identical (inputs/outputs unchanged by the run on this page)';
    }
  } catch (e) { status = 'FAIL'; fails++; note = String(e.message).split('\n')[0].slice(0, 200); }
  rows.push(`| ${route} | ${status} | ${((Date.now() - t0) / 1000).toFixed(0)} s | ${note.replace(/\|/g, '/')} |`);
  console.error(`${status} ${route}`);
  await ctx.close();
}
await browser.close();
console.log('| Route | Result | Time | Detail |\n|---|---|---|---|\n' + rows.join('\n'));
console.log(`\n${rows.length - fails}/${rows.length} routes: reset returns the page to its first-visit state`);
process.exit(fails ? 1 : 0);
