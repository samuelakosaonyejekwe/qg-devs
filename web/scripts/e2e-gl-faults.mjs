#!/usr/bin/env node
/**
 * WebGL fault injection: the 3-D stage must recover from shader programs whose link fails without any
 * diagnostic (seen on real GPUs, ANGLE/Metal, right after a page load) and must not create stray WebGL
 * contexts.
 *
 *   PLAYWRIGHT_MODULE=…/playwright/index.mjs node scripts/e2e-gl-faults.mjs [baseUrl]
 *
 * 1. The first N program links on the page report LINK_STATUS false with an empty log: every failed program
 *    must be linked again (rebuilt), the view must report the rebuild (data-gl-relink) and the page must log
 *    no errors.
 * 2. Every link failing permanently: the stage gives up after its bounded retries with one clear error per
 *    program (no endless rebuild loop) and the page stays responsive.
 * 3. A full graphics test on System health creates at most two WebGL contexts (probe + 3-D view).
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8777').replace(/\/$/, '');
let fails = 0;
const out = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); };

const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
async function page(failLinks, skip = 0, onlyType = '', gfx = '') {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(([n, skip, onlyType, gfx]) => {
    try { localStorage.setItem('qg.lastSeenVersion', '999.0.0'); if (gfx) localStorage.setItem('qg.gfx', gfx); } catch { /* */ }
    window.__gl = { contexts: 0, links: 0, failed: 0, relinkedFailed: 0 };
    const failedSrc = new Set(); const bad = new WeakSet();
    const og = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...a) { const c = og.call(this, t, ...a); if (c && /webgl/.test(t) && !this.__n) { this.__n = 1; window.__gl.contexts++; } return c; };
    for (const P of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
      const link = P.linkProgram, gpp = P.getProgramParameter, gil = P.getProgramInfoLog;
      P.linkProgram = function (p) {
        window.__gl.links++;
        const key = this.getAttachedShaders(p).map((s) => this.getShaderSource(s)).join('\u0000');
        p.__key = key;
        if (failedSrc.has(key)) window.__gl.relinkedFailed++;
        const typed = !onlyType || key.includes(`#define SHADER_TYPE ${onlyType}\n`);
        if (typed && (n < 0 || (window.__gl.links > skip && window.__gl.failed < n))) { bad.add(p); window.__gl.failed++; failedSrc.add(key); }
        return link.call(this, p);
      };
      P.getProgramParameter = function (p, pn) { if (pn === this.LINK_STATUS && bad.has(p)) return false; return gpp.call(this, p, pn); };
      P.getProgramInfoLog = function (p) { return bad.has(p) ? '' : gil.call(this, p); };
    }
  }, [failLinks, skip, onlyType, gfx]);
  const pg = await ctx.newPage();
  const errors = [], warns = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); if (m.type() === 'warning' && /QG-DEVS 3-D/.test(m.text())) warns.push(m.text()); });
  return { ctx, pg, errors, warns };
}

// 3-D views render only while on screen: bring each into view in turn (several rounds, for the retries)
async function visitViews(pg, rounds = 2) {
  for (let r = 0; r < rounds; r++) {
    const n = await pg.locator('.view3d').count();
    for (let i = 0; i < n; i++) { await pg.locator('.view3d').nth(i).scrollIntoViewIfNeeded(); await pg.waitForTimeout(600); }
  }
}

// 1. transient link failures are rebuilt: environment-map generator programs (first links) and scene
//    material programs (later links)
for (const [skip, what, type, gfx] of [[0, 'environment map', '', ''], [6, 'scene materials', '', ''], [0, 'shadow-map depth material', 'MeshDepthMaterial', 'high']]) {
  const { ctx, pg, errors, warns } = await page(type ? 1 : 4, skip, type, gfx);
  await pg.goto(`${BASE}/suite/entanglement`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('.view3d canvas', { timeout: 60000 });
  await visitViews(pg);
  const gl = await pg.evaluate(() => window.__gl);
  const relink = await pg.evaluate(() => [...document.querySelectorAll('[data-gl-relink]')].map((e) => e.dataset.glRelink));
  out(gl.failed === (type ? 1 : 4) && gl.relinkedFailed >= gl.failed, `${what}: transient link failures rebuilt — ${gl.failed} injected failures, ${gl.relinkedFailed} failed programs linked again, ${gl.links} links in total`);
  out(relink.length > 0, `${what}: view reports the rebuild (data-gl-relink = ${relink.join(',') || 'none'}); ${warns.length} warning(s)`);
  out(errors.length === 0, `${what}: no page errors after recovery${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
// 2. permanent failures: bounded retries, then one clear error
{
  const { ctx, pg, errors } = await page(-1);
  await pg.goto(`${BASE}/suite/entanglement`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('.view3d canvas', { timeout: 60000 });
  await visitViews(pg, 5);
  const a = await pg.evaluate(() => window.__gl.links);
  await visitViews(pg, 2);
  const b = await pg.evaluate(() => window.__gl.links);
  const relink = await pg.evaluate(() => Math.max(0, ...[...document.querySelectorAll('[data-gl-relink]')].map((e) => Number(e.dataset.glRelink))));
  out(relink === 3 && b === a, `permanent failures stop after bounded retries — attempts ${relink}, links stable (${a} → ${b})`);
  out(errors.some((e) => /QG-DEVS 3-D: shader program failed to link/.test(e)) && !errors.some((e) => /trim|isReady/.test(e)), `permanent failure reported clearly (${errors.length} error lines)`);
  const ok = await pg.evaluate(() => document.querySelector('main h1') != null);
  out(ok, 'page stays responsive');
  await ctx.close();
}
// 3. graphics test context budget
{
  const { ctx, pg, errors } = await page(0);
  await pg.goto(`${BASE}/health`, { waitUntil: 'networkidle' });
  await pg.locator('#graphics [data-run]').click();
  await pg.waitForSelector('#graphics >> text=Median frame rate', { timeout: 90000 });
  const n = await pg.evaluate(() => window.__gl.contexts);
  out(n <= 2, `graphics test created ${n} WebGL context(s) (budget 2)`);
  out(errors.length === 0, `no page errors during graphics test${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all WebGL fault checks passed');
process.exit(fails ? 1 : 0);
