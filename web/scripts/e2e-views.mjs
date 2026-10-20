#!/usr/bin/env node
/**
 * Browser checks for reset controls, suite ordering and every animated 3-D / 2-D view.
 *
 *   PLAYWRIGHT_MODULE=…/playwright/index.mjs node scripts/e2e-views.mjs [baseUrl] [screenshotDir]
 *
 * 1. Every route: each Run button ([data-run]) sits in a run bar with a Reset control ([data-reset]);
 *    no stray primary action buttons outside run bars (documented exceptions only).
 * 2. Reset behaviour: confirmation only when results are shown; page reset restores page inputs and clears
 *    results; "Reset shared scenario" restores the shared design.
 * 3. Sidebar and dashboard list suites strictly 1…18 (light + dark sidebar screenshots, 2×).
 * 4. For each suite: run its interactive computations, then capture every 3-D view and animated chart at
 *    2× device scale in light and dark themes, measure playback frame rate while playing, and check the
 *    3-D renderer's geometry/texture counts stay bounded across repeated mounts (no leaks).
 */
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8777').replace(/\/$/, '');
const OUT = process.argv[3] || path.resolve('../docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

const log = [];
let fails = 0;
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const note = await fn(); log.push(`PASS ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0} ms)`); }
  catch (e) { fails++; log.push(`FAIL ${name} — ${String(e?.message ?? e).split('\n')[0].slice(0, 400)}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const ROUTES = ['/', '/thought-lab', '/builder', '/jobs', '/health', '/settings', '/help',
  ...['quantum', 'gravity', 'qg-eft', 'entanglement', 'interferometry', 'optomechanics', 'decoherence', 'environment', 'lab', 'signal', 'inference', 'falsification', 'design', 'discovery', 'hpc', 'verification', 'data', 'evidence'].map((s) => `/suite/${s}`)];
// Run actions that write to the ledger / start long studies are not clicked automatically.
const NO_CLICK = /preregistration|sign-off|ingest|unblinding|package|optimisation|discovery cycle|calibration|verification run|vv|fetch|record|start local sweep|reviewed these assumptions|interpret/i;

const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const consoleErrors = [];
const newPage = async (opts = {}, gfx = 'auto') => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, serviceWorkers: 'block', ...opts });
  // no "What's new" dialog during these checks; graphics tier forced for full-quality stills when requested
  await ctx.addInitScript((g) => { try { localStorage.setItem('qg.lastSeenVersion', '999.0.0'); localStorage.setItem('qg.gfx', g); } catch { /* ignore */ } }, gfx);
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(`${p.url()}: ${m.text()}`); });
  p.on('pageerror', (e) => consoleErrors.push(`${p.url()}: pageerror ${e.message} @ ${(e.stack || '').split('\n').slice(1, 6).join(' <- ')}`));
  return { ctx, p };
};

// ------------------------------------------------------------------------------------------- 1. coverage
await step('every Run button has a Reset control beside it (all routes)', async () => {
  const { ctx, p } = await newPage();
  const report = [];
  const bad = [];
  for (const r of ROUTES) {
    await p.goto(BASE + r, { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    // reveal tab panels so every run bar is counted
    const tabs = await p.locator('[role="tab"]').all();
    let runs = 0, resets = 0;
    const visit = async () => {
      const res = await p.evaluate(() => {
        const out = { runs: 0, withReset: 0, stray: [] };
        document.querySelectorAll('main [data-run]').forEach((b) => { out.runs++; if (b.closest('.runbar')?.querySelector('[data-reset]')) out.withReset++; });
        document.querySelectorAll('main button.btn.primary:not([data-run])').forEach((b) => out.stray.push(b.textContent.trim().slice(0, 40)));
        return out;
      });
      runs = Math.max(runs, res.runs); resets = Math.max(resets, res.withReset);
      for (const s of res.stray) if (!/Virtual Laboratory|Save|Model discrimination|Preregistration|Update now|Close|Got it/.test(s)) bad.push(`${r}: stray primary "${s}"`);
      if (res.runs !== res.withReset) bad.push(`${r}: ${res.runs - res.withReset} run button(s) without reset`);
    };
    await visit();
    for (const t of tabs.slice(0, 8)) { try { await t.click({ timeout: 2000 }); await p.waitForTimeout(300); await visit(); } catch { /* hidden tab */ } }
    report.push(`${r}:${runs}`);
  }
  await ctx.close();
  assert(!bad.length, [...new Set(bad)].join(' | '));
  return report.filter((x) => !x.endsWith(':0')).join(' ');
});

// ------------------------------------------------------------------------------------------- 2. behaviour
await step('reset behaviour (flagship: page vs shared scenario; confirmation only with results)', async () => {
  const { ctx, p } = await newPage();
  await p.goto(BASE + '/suite/entanglement', { waitUntil: 'networkidle' });
  await p.waitForSelector('text=Key predictions', { timeout: 30000 });
  const mass = p.locator('input[aria-describedby]').first();
  await mass.fill('20');
  await p.waitForTimeout(2500);
  // page reset: results present → confirmation dialog
  await p.click('[data-reset]');
  await p.click('[data-reset-page]');
  await p.waitForSelector('dialog.confirm-dialog', { timeout: 5000 });
  await p.screenshot({ path: path.join(OUT, 'reset-confirm-dialog.png') });
  await p.click('[data-reset-confirm]');
  await p.waitForSelector('text=Key predictions', { timeout: 30000 }); // the page's default computation, as on first visit
  const v1 = await p.locator('input[aria-describedby]').first().inputValue();
  assert(v1 === '10', `page reset must restore this suite's default design (mass shows ${v1})`);
  // leaving and returning: other pages still see the user's shared scenario (mass 20)
  await p.click('nav.sidenav a[href="/suite/decoherence"]');
  await p.waitForTimeout(800);
  const shared = await p.evaluate(() => JSON.parse(localStorage.getItem('qg.scenario') || '{}').design?.mass_A);
  assert(Math.abs(shared - 2e-14) < 1e-20, `shared scenario must be untouched by a page reset (got ${shared})`);
  await p.goBack();
  await p.waitForTimeout(800);
  // shared-scenario reset
  await p.click('[data-reset]');
  await p.click('[data-reset-scenario]');
  if (await p.locator('dialog.confirm-dialog').count()) await p.click('[data-reset-confirm]');
  await p.waitForTimeout(600);
  const shared2 = await p.evaluate(() => JSON.parse(localStorage.getItem('qg.scenario') || '{}').design?.mass_A);
  assert(Math.abs(shared2 - 1e-14) < 1e-20, `shared scenario not restored (${shared2})`);
  await p.screenshot({ path: path.join(OUT, 'reset-after.png') });
  await ctx.close();
  return 'page reset → first-visit state with default design and default result; shared scenario untouched; shared reset restores 10 pg';
});

await step('reset behaviour (Suite 1: page inputs restored, results cleared)', async () => {
  const { ctx, p } = await newPage();
  await p.goto(BASE + '/suite/quantum', { waitUntil: 'networkidle' });
  const field = p.locator('main input[aria-describedby]').first();
  const def = await field.inputValue();
  await field.fill(String(Number(def) * 2 || 2));
  await p.click('main [data-run]');
  await p.waitForSelector('main figure.chart', { timeout: 30000 });
  await p.click('main [data-reset]');
  await p.waitForSelector('dialog.confirm-dialog');
  await p.click('[data-reset-confirm]');
  await p.waitForTimeout(500);
  const after = await p.locator('main input[aria-describedby]').first().inputValue();
  assert(after === def, `input not restored (${after} vs default ${def})`);
  assert(await p.locator('main figure.chart').count() === 0, 'plots not cleared');
  await ctx.close();
  return `input restored to ${def}; plots cleared`;
});

await step('Settings: reset all saved inputs', async () => {
  const { ctx, p } = await newPage();
  await p.goto(BASE + '/settings', { waitUntil: 'networkidle' });
  await p.evaluate(() => { localStorage.setItem('qg.lastJob.test', 'abc'); });
  p.once('dialog', (d) => d.accept());
  await p.click('[data-reset-all]');
  await p.waitForTimeout(300);
  const left = await p.evaluate(() => localStorage.getItem('qg.lastJob.test'));
  assert(left === null, 'remembered job binding not cleared');
  await ctx.close();
});

// ------------------------------------------------------------------------------------------- 3. ordering
for (const scheme of ['light', 'dark']) {
  await step(`sidebar suites strictly 1…18 (${scheme})`, async () => {
    const { ctx, p } = await newPage({ colorScheme: scheme });
    await p.goto(BASE + '/suite/optomechanics', { waitUntil: 'networkidle' });
    const nums = await p.$$eval('[data-nav-suites] a[data-suite-n]', (as) => as.map((a) => Number(a.dataset.suiteN)));
    assert(JSON.stringify(nums) === JSON.stringify([...Array(18)].map((_, i) => i + 1)), `nav order ${nums}`);
    await p.locator('nav.sidenav').screenshot({ path: path.join(OUT, `sidebar-${scheme}.png`) });
    if (scheme === 'light') {
      await p.goto(BASE + '/', { waitUntil: 'networkidle' });
      const d = await p.$$eval('[data-dashboard-suites] [data-suite-n]', (as) => as.map((a) => Number(a.dataset.suiteN)));
      assert(JSON.stringify(d) === JSON.stringify([...Array(18)].map((_, i) => i + 1)), `dashboard order ${d}`);
    }
    await ctx.close();
    return nums.join(',');
  });
}

// ------------------------------------------------------------------------------------------- 4. views
const VIEW_ROUTES = ['entanglement', 'builder', 'quantum', 'gravity', 'interferometry', 'optomechanics', 'decoherence', 'environment', 'lab', 'signal', 'inference', 'falsification', 'design', 'discovery', 'hpc', 'evidence', 'verification'];
const fpsReport = [];
async function measureFps(p) {
  return p.evaluate(() => new Promise((res) => {
    let n = 0, worst = 0, last = performance.now();
    const t0 = last;
    const f = (now) => { n++; worst = Math.max(worst, now - last); last = now; if (now - t0 < 2000) requestAnimationFrame(f); else res({ fps: n / ((now - t0) / 1000), worstMs: worst }); };
    requestAnimationFrame(f);
  }));
}
for (const scheme of ['light', 'dark']) {
  await step(`3-D and animated 2-D views render (${scheme}, 2×, full-quality tier)`, async () => {
    const { ctx, p } = await newPage({ colorScheme: scheme }, 'high');
    const notes = [];
    for (const s of VIEW_ROUTES) {
      const url = s === 'builder' ? '/builder' : `/suite/${s}`;
      await p.goto(BASE + url, { waitUntil: 'networkidle' });
      await p.waitForTimeout(800);
      // run the page's interactive computations (skip ledger writes and long studies)
      const runs = await p.locator('main [data-run]').all();
      for (const b of runs) {
        const t = (await b.innerText()).trim();
        if (NO_CLICK.test(t) || !(await b.isEnabled())) continue;
        try { await b.click({ timeout: 3000 }); await p.waitForLoadState('networkidle', { timeout: 90000 }); await p.waitForTimeout(1200); } catch { /* keep going */ }
      }
      // switch every 2-D/3-D toggle to 3-D so both representations are captured
      for (const t of await p.locator('main [role="radio"]', { hasText: /^3-?D$/ }).all()) { try { await t.click({ timeout: 1000 }); } catch { /* */ } }
      await p.waitForTimeout(1500);
      const boxes = await p.locator('main .view3d-box').all();
      let k = 0;
      for (const b of boxes) {
        try {
          await b.scrollIntoViewIfNeeded();
          await b.locator('canvas').first().waitFor({ timeout: 15000 });
          await p.waitForTimeout(700);
          await b.screenshot({ path: path.join(OUT, `3d-${s}-${++k}-${scheme}.png`) });
        } catch (e) { notes.push(`${s} view ${k}: ${String(e.message).slice(0, 80)}`); }
      }
      // animated 2-D charts (first two per page)
      const charts = await p.locator('main figure.chart').all();
      for (const [i, c] of charts.slice(0, 2).entries()) { try { await c.scrollIntoViewIfNeeded(); await c.screenshot({ path: path.join(OUT, `2d-${s}-${i + 1}-${scheme}.png`) }); } catch { /* */ } }
      notes.push(`${s}:${boxes.length}×3D`);
    }
    await ctx.close();
    return notes.join(' ');
  });
}

await step('playback frame rate per page (automatic quality tier)', async () => {
  const { ctx, p } = await newPage({}, 'auto');
  const tiers = new Set();
  for (const s of VIEW_ROUTES) {
    await p.goto(BASE + (s === 'builder' ? '/builder' : `/suite/${s}`), { waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    for (const b of await p.locator('main [data-run]').all()) {
      const t = (await b.innerText()).trim();
      if (NO_CLICK.test(t) || /job|ladder|time sweep|inference/i.test(t) || !(await b.isEnabled())) continue;
      try { await b.click({ timeout: 3000 }); await p.waitForLoadState('networkidle', { timeout: 30000 }); await p.waitForTimeout(800); } catch { /* */ }
    }
    for (const t of await p.locator('main [role="radio"]', { hasText: /^3-?D$/ }).all()) { try { await t.click({ timeout: 1000 }); } catch { /* */ } }
    await p.waitForTimeout(800);
    const play = p.locator('main [data-play]:not([disabled])').first();
    if (!(await play.count())) continue;
    await play.scrollIntoViewIfNeeded();
    await play.click();
    const m = await measureFps(p);
    fpsReport.push(`${s}: ${m.fps.toFixed(1)} fps while playing (worst frame ${m.worstMs.toFixed(0)} ms; ${await p.locator('.view3d canvas').count()} 3-D view(s) on page)`);
    if (await p.locator('main [data-play][aria-pressed="true"]').count()) await p.locator('main [data-play][aria-pressed="true"]').first().click();
    tiers.add(await p.evaluate(() => { try { const c = document.createElement('canvas').getContext('webgl'); const e = c?.getExtension('WEBGL_debug_renderer_info'); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; } catch { return 'n/a'; } }));
  }
  await ctx.close();
  return `renderer: ${[...tiers].join(', ')}`;
});

await step('3-D views release GPU resources on unmount (flagship, 5 remounts)', async () => {
  const { ctx, p } = await newPage();
  const mem = [];
  for (let i = 0; i < 5; i++) {
    await p.goto(BASE + '/suite/entanglement', { waitUntil: 'networkidle' });
    await p.waitForSelector('.view3d canvas', { timeout: 30000 });
    // wait until every 3-D view on the page has mounted its renderer before reading GPU memory
    await p.waitForFunction(() => [...document.querySelectorAll('.view3d')].every((e) => e.__qgHandle?.memory), null, { timeout: 60000 });
    // off-screen views upload nothing until they are first visible: render each one before reading memory
    for (const v of await p.locator('.view3d').all()) { await v.scrollIntoViewIfNeeded(); await p.waitForTimeout(300); }
    await p.waitForTimeout(500);
    mem.push(await p.evaluate(() => [...document.querySelectorAll('.view3d')].map((e) => e.__qgHandle?.memory?.() ?? null)));
    await p.click('nav.sidenav a[href="/suite/quantum"]');
    await p.waitForTimeout(400);
    await p.goBack();
  }
  // within one mount: playing the animation (hundreds of updates) must not accumulate GPU objects
  await p.goto(BASE + '/suite/entanglement', { waitUntil: 'networkidle' });
  await p.waitForSelector('.view3d canvas', { timeout: 30000 });
  await p.waitForFunction(() => [...document.querySelectorAll('.view3d')].every((e) => e.__qgHandle?.memory), null, { timeout: 60000 });
  await p.waitForTimeout(800);
  // render every view once (offscreen views upload nothing until visible), then play
  for (const v of await p.locator('.view3d').all()) { await v.scrollIntoViewIfNeeded(); await p.waitForTimeout(500); }
  const play = p.locator('main [data-play]').first();
  await play.scrollIntoViewIfNeeded();
  if ((await play.getAttribute('aria-pressed')) !== 'true') await play.click();
  await p.waitForTimeout(1500);
  const before = await p.evaluate(() => [...document.querySelectorAll('.view3d')].map((e) => e.__qgHandle?.memory?.() ?? null));
  await p.waitForTimeout(3000);
  const after = await p.evaluate(() => [...document.querySelectorAll('.view3d')].map((e) => e.__qgHandle?.memory?.() ?? null));
  await ctx.close();
  const grew = before.some((b, i) => b && after[i] && (after[i].geometries > b.geometries || after[i].textures > b.textures));
  assert(!grew, `memory grew during playback: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  const first = JSON.stringify(mem[0]), last = JSON.stringify(mem[mem.length - 1]);
  assert(first === last, `renderer memory differs across remounts: ${first} → ${last}`);
  return `per-view {geometries, textures} identical across 5 remounts: ${first}; during 3 s playback: ${JSON.stringify(before)} → ${JSON.stringify(after)}`;
});

await browser.close();
console.log(log.join('\n'));
console.log(`\nPlayback frame rate (headless Chromium; automatic tier):\n${fpsReport.join('\n')}`);
console.log(`\nConsole errors (${consoleErrors.length}):\n${[...new Set(consoleErrors)].slice(0, 40).join('\n')}`);
console.log(`\n${log.length - fails}/${log.length} checks passed; screenshots in ${OUT}`);
process.exit(fails ? 1 : 0);
