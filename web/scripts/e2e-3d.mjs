#!/usr/bin/env node
/**
 * Drives every suite to its animated 3-D view(s) with real computations and captures them, plus the
 * synchronised 2-D counterpart, at 2× device scale in light and dark themes (full-quality tier).
 *
 *   PLAYWRIGHT_MODULE=…/playwright/index.mjs node scripts/e2e-3d.mjs [baseUrl] [screenshotDir] [filter]
 */
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8777').replace(/\/$/, '');
const OUT = process.argv[3] || path.resolve('../docs/screenshots');
const FILTER = process.argv[4] ? new RegExp(process.argv[4]) : null;
fs.mkdirSync(OUT, { recursive: true });

const run = (label) => async (p) => { await p.locator('main [data-run]', { hasText: label }).first().click(); };
const tab = (name) => async (p) => { await p.getByRole('tab', { name }).click(); await p.waitForTimeout(400); };
const radio = (name) => async (p) => { const r = p.getByRole('radio', { name }); if (await r.count()) { await r.first().click(); await p.waitForTimeout(400); } };
const wait = (ms) => async (p) => p.waitForTimeout(ms);
const waitFor = (sel, t = 120000) => async (p) => p.waitForSelector(sel, { timeout: t });

// name, route, steps to reach the 3-D view(s), optional steps for the 2-D counterpart
const RECIPES = [
  ['flagship', '/suite/entanglement', [waitFor('.view3d canvas')], [radio(/2-D top view/)]],
  ['quantum-bloch', '/suite/quantum', [run('Run Lindblad'), waitFor('figure.chart', 60000), run('Bloch path'), waitFor('.view3d canvas', 180000)], [radio(/2-D/)]],
  ['gravity-nbody', '/suite/gravity', [run('Integrate'), waitFor('.view3d canvas', 120000)], [radio(/2-D|x–y/)]],
  ['interferometry-wavepacket', '/suite/interferometry', [run('Simulate'), waitFor('figure.chart', 180000), radio(/3-D surface/), waitFor('.view3d canvas')], [radio(/2-D|heat/i)]],
  ['optomech-phase-space', '/suite/optomechanics', [run('Evolve'), waitFor('.view3d canvas', 60000)], [radio(/^2-D$/)]],
  ['decoherence-bloch', '/suite/decoherence', [waitFor('.view3d canvas', 60000)], [radio(/2-D/)]],
  ['environment-energy', '/suite/environment', [waitFor('.view3d canvas', 60000)], [radio(/2-D/)]],
  ['lab-apparatus', '/suite/lab', [waitFor('.view3d canvas', 60000)], [radio(/2-D/)]],
  ['signal-counts', '/suite/signal', [run('Generate record ladder'), waitFor('.view3d canvas', 180000)], [radio(/2-D/)]],
  ['inference-mcmc', '/suite/inference', [run('Generate counts'), wait(3000), async (p) => { await p.locator('main [data-run]', { hasText: /inference/i }).first().click(); }, waitFor('.view3d canvas', 600000)], [radio(/2-D/)]],
  ['models-predictions', '/suite/falsification', [tab('Predictions'), run('Compute predictions'), waitFor('.view3d canvas', 60000)], []],
  ['models-discrimination', '/suite/falsification', [tab('Discrimination matrix'), async (p) => { await p.locator('main [data-run]', { hasText: /discrimination/i }).first().click(); }, waitFor('.view3d canvas', 600000)], []],
  ['design-sweep', '/suite/design', [tab('2-D sweep'), async (p) => { await p.locator('main [data-run]').first().click(); }, waitFor('.view3d canvas', 300000)], [radio(/2-D/)]],
  ['discovery-law', '/suite/discovery', [run('Discover law'), waitFor('.view3d canvas', 120000)], [radio(/2-D/)]],
  ['hpc-local-sweep', '/suite/hpc', [async (p) => { const sw = p.getByRole('switch').first(); if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click(); }, run('Start local sweep'), waitFor('.view3d canvas', 180000)], []],
  ['verification-bars', '/suite/verification', [waitFor('.view3d canvas', 60000)], []],
  ['evidence-ladder', '/suite/evidence', [tab('Gates & ladder'), run('Evaluate gates'), waitFor('.view3d canvas', 120000)], []],
];

const browser = await chromium.launch();
const log = [];
let fails = 0;
const errors = [];
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('qg.lastSeenVersion', '999.0.0'); localStorage.setItem('qg.gfx', 'high'); } catch { /* */ } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${p.url()}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`${p.url()}: pageerror ${e.message}`));
  for (const [name, route, steps, steps2d] of RECIPES) {
    if (FILTER && !FILTER.test(name)) continue;
    const t0 = Date.now();
    try {
      await p.goto(BASE + route, { waitUntil: 'networkidle', timeout: 120000 });
      await p.waitForTimeout(800);
      for (const s of steps) await s(p);
      await p.addStyleTag({ content: '.app-header{position:static!important}' }); // keep the sticky header out of element captures
      await p.waitForTimeout(1500);
      const boxes = await p.locator('main .view3d-box').all();
      let k = 0;
      for (const b of boxes) { await b.scrollIntoViewIfNeeded(); await p.waitForTimeout(900); await b.screenshot({ path: path.join(OUT, `3d-${name}-${++k}-${scheme}.png`), timeout: 90000 }); }
      if (!k) throw new Error('no 3-D view found');
      let n2 = 0;
      if (steps2d.length) {
        for (const s of steps2d) await s(p);
        await p.waitForTimeout(800);
        const figs = await p.locator('main figure.chart, main svg[role="img"]').all();
        for (const f of figs.slice(0, 2)) { await f.scrollIntoViewIfNeeded(); await f.screenshot({ path: path.join(OUT, `2d-${name}-${++n2}-${scheme}.png`) }); }
      }
      log.push(`PASS ${name} (${scheme}): ${k} 3-D view(s), ${n2} 2-D capture(s) (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    } catch (e) {
      fails++;
      log.push(`FAIL ${name} (${scheme}): ${String(e.message).split('\n')[0].slice(0, 200)}`);
      try { await p.screenshot({ path: path.join(OUT, `fail-${name}-${scheme}.png`) }); } catch { /* */ }
    }
  }
  await ctx.close();
}
await browser.close();
console.log(log.join('\n'));
console.log(`\nConsole errors (${errors.length}):\n${[...new Set(errors)].slice(0, 30).join('\n')}`);
console.log(`\n${log.length - fails}/${log.length} captures passed`);
process.exit(fails ? 1 : 0);
