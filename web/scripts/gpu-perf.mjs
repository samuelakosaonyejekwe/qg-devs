#!/usr/bin/env node
/**
 * Graphics performance on real GPU hardware (run by .github/workflows/gpu-perf.yml on GitHub's macOS runners,
 * whose Chrome renders through Metal on Apple-silicon GPUs).
 *
 *   PLAYWRIGHT_MODULE=… node scripts/gpu-perf.mjs <appUrl e.g. https://…/qg-devs/> [outDir]
 *
 * For each browser configuration it records the WebGL renderer (to prove which GPU was used), runs the System
 * health "Graphics performance on this device" test, and measures the frame rate while the flagship,
 * decoherence and optomechanics animations play. Results go to stdout, results.json and (on Actions) the job
 * summary. Nothing is estimated: every number is measured in that browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const APP = (process.argv[2] || 'https://samuelakosaonyejekwe.github.io/qg-devs/').replace(/\/?$/, '/');
const OUT = process.argv[3] || 'gpu-perf-out';
fs.mkdirSync(OUT, { recursive: true });
const base = new URL(APP).pathname;

// Each browser is measured with the automatically chosen quality tier and with the full-quality tier forced
// (Settings value qg.gfx = 'high'), so the cost of the high-fidelity rendering itself is measured on the GPU.
const LOG = ['--enable-logging=stderr', '--v=0'];
const CHROME = { channel: 'chrome', headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', ...LOG] };
const CHROMIUM = { headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal', ...LOG] };
const CONFIGS = [
  { name: 'Chrome (installed), GPU, automatic tier', launch: CHROME, gfx: null },
  { name: 'Chrome (installed), GPU, full-quality tier', launch: CHROME, gfx: 'high' },
  { name: 'Chromium (Playwright), GPU, automatic tier', launch: CHROMIUM, gfx: null },
  { name: 'Chromium (Playwright), GPU, full-quality tier', launch: CHROMIUM, gfx: 'high' },
];

async function fps(page, ms = 4000) {
  return page.evaluate((dur) => new Promise((res) => {
    const d = []; let last = performance.now(); const t0 = last;
    const f = (now) => { d.push(now - last); last = now; if (now - t0 < dur) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res({ fps: 1000 / d[Math.floor(d.length / 2)], p95: d[Math.floor(d.length * 0.95)], worst: d[d.length - 1] }); } };
    requestAnimationFrame(f);
  }), ms);
}

const REPEAT = Math.max(1, Number(process.env.REPEAT || 1));
const results = [];
for (let rep = 1; rep <= REPEAT; rep++) for (const cfg0 of CONFIGS) {
  const cfg = REPEAT > 1 ? { ...cfg0, name: `${cfg0.name} (pass ${rep}/${REPEAT})` } : cfg0;
  let browser;
  // browser stderr (GPU process resets, context-loss reasons) goes to a per-configuration log file
  const logFile = path.join(OUT, `${cfg.name.replace(/\W+/g, '-')}-browser.log`);
  const logStream = fs.createWriteStream(logFile);
  const logger = { isEnabled: (n) => n === 'browser', log: (n, sev, msg) => { logStream.write(`${new Date().toISOString()} ${msg}\n`); } };
  try { browser = await chromium.launch({ ...cfg.launch, logger }); } catch (e) { results.push({ config: cfg.name, error: `launch failed: ${String(e.message).split('\n')[0]}` }); continue; }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((gfx) => { try { localStorage.setItem('qg.lastSeenVersion', '999.0.0'); if (gfx) localStorage.setItem('qg.gfx', gfx); } catch { /* */ } }, cfg.gfx);
  // timeline of WebGL context creation/loss on every canvas (to tell GPU resets apart from application errors)
  await ctx.addInitScript(() => {
    window.__qgCtx = 0; // WebGL contexts created on this page (the app shares one across all 3-D views)
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) {
      const c = orig.call(this, type, ...a);
      if (c && /webgl/.test(type) && !this.__qgLog) {
        this.__qgLog = 1;
        window.__qgCtx++;
        const canvas = this, ge = c.getExtension.bind(c);
        // releases requested by the page itself (WEBGL_lose_context) are not losses
        c.getExtension = (n) => { const x = ge(n); if (x && n === 'WEBGL_lose_context') { const lc = x.loseContext.bind(x); x.loseContext = () => { canvas.__qgReleased = 1; lc(); }; } return x; };
        this.addEventListener('webglcontextlost', (e) => console.warn(this.__qgReleased ? `[gl] context released by the page on ${location.pathname}` : `[gl] context lost on ${location.pathname} (${e.statusMessage || 'no reason'})`));
        this.addEventListener('webglcontextrestored', () => console.warn(`[gl] context restored on ${location.pathname}`));
      }
      return c;
    };
  });
  const page = await ctx.newPage();
  const row = { config: cfg.name, pages: {}, pageErrors: [], glEvents: [], freeMemMB: Math.round(os.freemem() / 1048576), totalMemMB: Math.round(os.totalmem() / 1048576) };
  const t0 = Date.now();
  page.on('console', (m) => { if (/^\[gl\]|WebGL|GPU|QG-DEVS 3-D/i.test(m.text())) row.glEvents.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${m.type()}: ${m.text().slice(0, 240)}`); });
  // full stack traces (the source location matters for intermittent errors)
  page.on('pageerror', (e) => row.pageErrors.push(`[${page.url()}] ${e.message}\n${(e.stack || '').split('\n').slice(0, 14).join('\n')}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) row.pageErrors.push(`[${page.url()}] ${m.text()}`); });
  try {
    await page.goto(APP, { waitUntil: 'networkidle', timeout: 120000 });
    row.userAgent = await page.evaluate(() => navigator.userAgent);
    // 1. the in-app graphics test (System health); the GPU name is the one the app's own context reports
    await page.click(`nav.sidenav a[href="${base}health"]`);
    row.renderer = ((await page.locator('#graphics').innerText()).match(/GPU: (.+)/) || [])[1]?.trim() || 'unknown';
    await page.locator('#graphics [data-run]').click();
    await page.waitForSelector('#graphics >> text=Median frame rate', { timeout: 90000 });
    row.graphicsTest = await page.locator('#graphics').innerText();
    await page.locator('#graphics').screenshot({ path: path.join(OUT, `${cfg.name.replace(/\W+/g, '-')}-graphics-test.png`) });
    // 2. playback frame rate on animated pages (quality tier chosen automatically)
    for (const [slug, prep] of [['entanglement', null], ['decoherence', null], ['optomechanics', 'Evolve']]) {
      await page.goto(`${APP}suite/${slug}`, { waitUntil: 'networkidle', timeout: 120000 });
      if (prep) await page.locator('main [data-run]', { hasText: prep }).first().click();
      await page.waitForSelector('.view3d canvas', { timeout: 120000 });
      const play = page.locator('main [data-play]').first();
      await play.scrollIntoViewIfNeeded();
      if ((await play.getAttribute('aria-pressed')) !== 'true') await play.click();
      await page.waitForTimeout(1500);
      const m = await fps(page);
      const tier = await page.evaluate(() => { try { return localStorage.getItem('qg.gfx') || sessionStorage.getItem('qg.gfx.auto') || 'auto'; } catch { return '?'; } });
      row.pages[slug] = { ...m, views3d: await page.locator('.view3d canvas').count(), tierPref: tier, contexts: await page.evaluate(() => window.__qgCtx) };
      await page.screenshot({ path: path.join(OUT, `${cfg.name.replace(/\W+/g, '-')}-${slug}.png`) });
    }
    // 3. stress check: 3-D scenes created and disposed in quick succession (fast navigation between 3-D pages).
    //    Any page error or lost WebGL context fails the run.
    const churn = ['entanglement', 'decoherence', 'lab', 'gravity', 'environment', 'optomechanics'];
    for (let i = 0; i < 24; i++) {
      await page.click(`nav.sidenav a[href="${base}suite/${churn[i % churn.length]}"]`);
      await page.waitForTimeout([30, 120, 400][i % 3]);
    }
    await page.click(`nav.sidenav a[href="${base}suite/entanglement"]`);
    await page.waitForSelector('.view3d canvas', { timeout: 120000 });
    await page.waitForTimeout(1500);
    row.churn = 'done';
    row.churnContexts = await page.evaluate(() => window.__qgCtx);
  } catch (e) { row.error = String(e.message).split('\n')[0].slice(0, 300); }
  results.push(row);
  await browser.close();
  logStream.end();
}

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const md = ['## QG-DEVS graphics performance on real GPU hardware', '', `App: ${APP}`, ''];
for (const r of results) {
  md.push(`### ${r.config}`, '');
  if (r.error && !r.renderer) { md.push(`Error: ${r.error}`, ''); continue; }
  md.push(`- Renderer (GPU): **${r.renderer}**`, `- User agent: ${r.userAgent}`, `- Runner memory free at start: ${r.freeMemMB} of ${r.totalMemMB} MB`);
  const gt = (r.graphicsTest || '').split('\n');
  const pick = (label) => { const i = gt.findIndex((l) => l.startsWith(label)); return i >= 0 ? gt[i + 1] : '—'; };
  md.push(`- In-app graphics test: median **${pick('Median frame rate')}**, p95 frame ${pick('95th-percentile frame time')}, slowest ${pick('Slowest frame')}, tier ${pick('Quality tier')}, ${pick('Device pixel ratio · canvas')}`);
  md.push('', '| Page (playing) | Median fps | p95 frame (ms) | Slowest (ms) | 3-D views | WebGL contexts |', '|---|---|---|---|---|---|');
  for (const [k, v] of Object.entries(r.pages)) md.push(`| ${k} | ${v.fps.toFixed(1)} | ${v.p95.toFixed(1)} | ${v.worst.toFixed(0)} | ${v.views3d} | ${v.contexts} |`);
  md.push('', `- Rapid 3-D page switching (24 switches): ${r.churn || 'not reached'}${r.churn ? ` — ${r.churnContexts} WebGL context(s) in total` : ''}`);
  md.push('', `- Page errors: ${r.pageErrors?.length ? r.pageErrors.length : 'none'}`);
  for (const e of (r.pageErrors || []).slice(0, 5)) md.push('', '```', e, '```');
  if (r.glEvents?.length) md.push('', 'WebGL context events:', '', '```', ...r.glEvents.slice(0, 20), '```');
  if (r.error) md.push('', `Error: ${r.error}`);
  md.push('');
}
const text = md.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
// Regression gate: no page errors and no lost WebGL contexts (a burst of context creation once forced the live
// 3-D view's context to be lost and made the browser reset the GPU).
const lostCtx = (r) => (r.glEvents || []).some((e) => /context lost|Too many active WebGL contexts|could not be created/i.test(e));
const extraCtx = (r) => Object.values(r.pages || {}).some((v) => v.contexts > 1) || (r.churnContexts ?? 1) > 1;
process.exit(results.some((r) => r.renderer && !r.error) && !results.some((r) => r.error || r.pageErrors?.length || lostCtx(r) || extraCtx(r)) ? 0 : 1);
