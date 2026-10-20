#!/usr/bin/env node
/**
 * Visible-dynamics check for every animated view: after load + Play for 2 s the rendered frame must differ
 * from the first frame (more than 0.1 % of its pixels change visibly) OR the view must show the "below display
 * resolution" notice. Also checks that Play at the end of the run restarts from t = 0.
 *
 *   PLAYWRIGHT_MODULE=…/playwright/index.mjs node scripts/e2e-motion.mjs [baseUrl] [screenshotDir]
 */
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8777').replace(/\/$/, '');
const OUT = process.argv[3] || path.resolve('../docs/screenshots');
fs.mkdirSync(path.join(OUT, 'motion'), { recursive: true });

const run = (label) => async (p) => { await p.locator('main [data-run]', { hasText: label }).first().click(); };
const tab = (name) => async (p) => { await p.getByRole('tab', { name }).click(); };
const waitFor = (sel, t = 180000) => async (p) => p.waitForSelector(sel, { timeout: t });
// [name, route, steps]; the first .player on the page drives the checked views
const VIEWS = [
  ['flagship', '/suite/entanglement', [waitFor('.view3d canvas')]],
  ['quantum-bloch', '/suite/quantum', [run('Run Lindblad'), waitFor('figure.chart', 60000), run('Bloch path'), waitFor('.view3d canvas')]],
  ['gravity-nbody', '/suite/gravity', [run('Integrate'), waitFor('.view3d canvas')]],
  ['interferometry', '/suite/interferometry', [run('Simulate'), waitFor('.player', 240000)]],
  ['optomech', '/suite/optomechanics', [run('Evolve'), waitFor('.view3d canvas')]],
  ['decoherence', '/suite/decoherence', [waitFor('.view3d canvas')]],
  ['environment', '/suite/environment', [waitFor('.view3d canvas')]],
  ['lab', '/suite/lab', [waitFor('.view3d canvas')]],
  ['signal', '/suite/signal', [run('Generate record ladder'), waitFor('.view3d canvas')]],
  ['inference', '/suite/inference', [run('Generate counts'), async (p) => { await p.waitForTimeout(2000); await p.locator('main [data-run]', { hasText: /inference/i }).first().click(); }, waitFor('.view3d canvas', 600000)]],
  ['design', '/suite/design', [tab('2-D sweep'), async (p) => { await p.locator('main [data-run]').first().click(); }, waitFor('.view3d canvas', 300000), waitFor('main .player', 300000)]],
];

const browser = await chromium.launch();
const rows = [];
let fails = 0;
for (const [name, route, steps] of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('qg.lastSeenVersion', '999.0.0'); } catch { /* */ } });
  const p = await ctx.newPage();
  let status = 'PASS', note = '';
  try {
    await p.goto(BASE + route, { waitUntil: 'networkidle', timeout: 120000 });
    for (const s of steps) await s(p);
    await p.addStyleTag({ content: '.app-header{position:static!important}' });
    const player = p.locator('main .player').first();
    await player.scrollIntoViewIfNeeded();
    // the view driven by this player: the 3-D view (or chart) in the same card as the player
    // the view driven by this player: nearest ancestor of the player that contains a 3-D view (else a chart)
    await player.evaluate((pl) => {
      document.querySelectorAll('[data-motion-target]').forEach((e) => e.removeAttribute('data-motion-target'));
      for (const sel of ['.view3d', 'figure.chart']) {
        for (let a = pl.parentElement; a; a = a.parentElement) { const v = a.querySelector(sel); if (v) { v.setAttribute('data-motion-target', '1'); return; } }
      }
    });
    const target = p.locator('[data-motion-target]').first();
    await target.scrollIntoViewIfNeeded();
    await p.waitForTimeout(800);
    // make sure it is playing (autoplay may already have started)
    const play = player.locator('[data-play]');
    if ((await play.getAttribute('aria-pressed')) !== 'true') await play.click();
    const a = await target.screenshot();
    await p.waitForTimeout(2000);
    const b = await target.screenshot();
    fs.writeFileSync(path.join(OUT, 'motion', `${name}-a.png`), a);
    fs.writeFileSync(path.join(OUT, 'motion', `${name}-b.png`), b);
    const frac = await p.evaluate(async ([x, y]) => {
      const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${b64}`; });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
      const g = c.getContext('2d');
      g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data;
      g.clearRect(0, 0, c.width, c.height); g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let k = 0; k < da.length; k += 4) if (Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]) > 24) n++;
      return n / (da.length / 4);
    }, [a.toString('base64'), b.toString('base64')]);
    const notice = await p.locator('main [data-below-resolution]').count();
    // Play at the end restarts from t = 0
    const range = player.locator('input[type=range]');
    if ((await play.getAttribute('aria-pressed')) === 'true') await play.click();
    const max = Number(await range.getAttribute('max'));
    await range.focus(); await p.keyboard.press('End');
    await play.click();
    await p.waitForTimeout(400);
    const v = Number(await range.inputValue());
    const restarted = v < max * 0.5;
    if (!(frac > 0.001 || notice) || !restarted) { status = 'FAIL'; fails++; }
    note = `pixels changed ${(frac * 100).toFixed(2)} %${notice ? '; below-resolution notice shown' : ''}; play-at-end ${restarted ? 'restarts from t = 0' : `did NOT restart (pos ${v}/${max})`}`;
  } catch (e) { status = 'FAIL'; fails++; note = String(e.message).split('\n')[0].slice(0, 200); }
  rows.push(`| ${name} | ${route} | ${status} | ${note} |`);
  console.error(`${status} ${name}`);
  await ctx.close();
}
await browser.close();
console.log('| View | Route | Result | Detail |\n|---|---|---|---|\n' + rows.join('\n'));
console.log(`\n${rows.length - fails}/${rows.length} animated views visibly change or declare sub-resolution change; play-at-end restarts`);
process.exit(fails ? 1 : 0);
