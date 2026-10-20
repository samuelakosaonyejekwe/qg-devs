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

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const APP = (process.argv[2] || 'https://samuelakosaonyejekwe.github.io/qg-devs/').replace(/\/?$/, '/');
const OUT = process.argv[3] || 'gpu-perf-out';
fs.mkdirSync(OUT, { recursive: true });
const base = new URL(APP).pathname;

// Each browser is measured with the automatically chosen quality tier and with the full-quality tier forced
// (Settings value qg.gfx = 'high'), so the cost of the high-fidelity rendering itself is measured on the GPU.
const CHROME = { channel: 'chrome', headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] };
const CHROMIUM = { headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal'] };
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

const results = [];
for (const cfg of CONFIGS) {
  let browser;
  try { browser = await chromium.launch(cfg.launch); } catch (e) { results.push({ config: cfg.name, error: `launch failed: ${String(e.message).split('\n')[0]}` }); continue; }
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((gfx) => { try { localStorage.setItem('qg.lastSeenVersion', '999.0.0'); if (gfx) localStorage.setItem('qg.gfx', gfx); } catch { /* */ } }, cfg.gfx);
  const page = await ctx.newPage();
  const row = { config: cfg.name, pages: {}, pageErrors: [] };
  page.on('pageerror', (e) => row.pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) row.pageErrors.push(m.text()); });
  try {
    await page.goto(APP, { waitUntil: 'networkidle', timeout: 120000 });
    row.userAgent = await page.evaluate(() => navigator.userAgent);
    row.renderer = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); if (!c) return 'no WebGL2'; const e = c.getExtension('WEBGL_debug_renderer_info'); return String(e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER)); });
    // 1. the in-app graphics test (System health)
    await page.click(`nav.sidenav a[href="${base}health"]`);
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
      row.pages[slug] = { ...m, views3d: await page.locator('.view3d canvas').count(), tierPref: tier };
      await page.screenshot({ path: path.join(OUT, `${cfg.name.replace(/\W+/g, '-')}-${slug}.png`) });
    }
  } catch (e) { row.error = String(e.message).split('\n')[0].slice(0, 300); }
  results.push(row);
  await browser.close();
}

fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const md = ['## QG-DEVS graphics performance on real GPU hardware', '', `App: ${APP}`, ''];
for (const r of results) {
  md.push(`### ${r.config}`, '');
  if (r.error && !r.renderer) { md.push(`Error: ${r.error}`, ''); continue; }
  md.push(`- Renderer (GPU): **${r.renderer}**`, `- User agent: ${r.userAgent}`);
  const gt = (r.graphicsTest || '').split('\n');
  const pick = (label) => { const i = gt.findIndex((l) => l.startsWith(label)); return i >= 0 ? gt[i + 1] : '—'; };
  md.push(`- In-app graphics test: median **${pick('Median frame rate')}**, p95 frame ${pick('95th-percentile frame time')}, slowest ${pick('Slowest frame')}, tier ${pick('Quality tier')}, ${pick('Device pixel ratio · canvas')}`);
  md.push('', '| Page (playing) | Median fps | p95 frame (ms) | Slowest (ms) | 3-D views |', '|---|---|---|---|---|');
  for (const [k, v] of Object.entries(r.pages)) md.push(`| ${k} | ${v.fps.toFixed(1)} | ${v.p95.toFixed(1)} | ${v.worst.toFixed(0)} | ${v.views3d} |`);
  md.push('', `- Page errors: ${r.pageErrors?.length ? r.pageErrors.slice(0, 5).join(' | ') : 'none'}`);
  if (r.error) md.push('', `Error: ${r.error}`);
  md.push('');
}
const text = md.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
process.exit(results.some((r) => r.renderer && !r.error) && !results.some((r) => r.pageErrors?.length) ? 0 : 1);
