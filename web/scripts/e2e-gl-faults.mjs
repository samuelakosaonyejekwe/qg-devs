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
 * 2. Every link failing permanently without a message: bounded retries, then one warning (no endless rebuild
 *    loop, no page error) and the page stays responsive.
 * 3. A genuine shader error (non-empty linker log) is reported as an error at once and never retried.
 * 4. A full graphics test on System health creates at most two WebGL contexts (probe + 3-D view).
 * 5. Closed 3-D views release their WebGL contexts at once (fast navigation between 3-D pages leaves only the
 *    contexts of the views on screen).
 * 6. Animation playback does not grow GPU buffers: live WebGL buffers (created − deleted) stay flat while the
 *    animated 3-D views play (lines updated every frame used to allocate a new buffer per frame).
 */
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8777').replace(/\/$/, '');
let fails = 0;
const out = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); };

const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
async function page(failLinks, skip = 0, onlyType = '', gfx = '', withLog = '') {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(([n, skip, onlyType, gfx, withLog]) => {
    try { localStorage.setItem('qg.lastSeenVersion', '999.0.0'); if (gfx) localStorage.setItem('qg.gfx', gfx); } catch { /* */ }
    window.__gl = { contexts: 0, links: 0, failed: 0, relinkedFailed: 0 };
    window.__glAll = [];
    window.__buf = { created: 0, deleted: 0 };
    const bad = new WeakSet();
    const og = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...a) { const c = og.call(this, t, ...a); if (c && /webgl/.test(t) && !this.__n) { this.__n = 1; window.__gl.contexts++; window.__glAll.push(c); } return c; };
    for (const P of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype]) {
      const link = P.linkProgram, gpp = P.getProgramParameter, gil = P.getProgramInfoLog;
      const cb = P.createBuffer, db = P.deleteBuffer;
      P.createBuffer = function () { window.__buf.created++; return cb.call(this); };
      P.deleteBuffer = function (b) { if (b) window.__buf.deleted++; return db.call(this, b); };
      P.linkProgram = function (p) {
        window.__gl.links++;
        const key = this.getAttachedShaders(p).map((s) => this.getShaderSource(s)).join('\u0000');
        p.__key = key;
        if (!this.__failed) this.__failed = new Set(); // per context: other views legitimately link the same source
        if (this.__failed.has(key)) window.__gl.relinkedFailed++;
        const typed = !onlyType || key.includes(`#define SHADER_TYPE ${onlyType}\n`);
        if (typed && (n < 0 || (window.__gl.links > skip && window.__gl.failed < n))) { bad.add(p); window.__gl.failed++; this.__failed.add(key); }
        return link.call(this, p);
      };
      P.getProgramParameter = function (p, pn) { if (pn === this.LINK_STATUS && bad.has(p)) return false; return gpp.call(this, p, pn); };
      P.getProgramInfoLog = function (p) { return bad.has(p) ? withLog : gil.call(this, p); };
    }
  }, [failLinks, skip, onlyType, gfx, withLog]);
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(120000); pg.setDefaultNavigationTimeout(120000);
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
  await pg.waitForSelector('.view3d canvas', { timeout: 120000 });
  await visitViews(pg);
  const gl = await pg.evaluate(() => window.__gl);
  const relink = await pg.evaluate(() => [...document.querySelectorAll('[data-gl-relink]')].map((e) => e.dataset.glRelink));
  out(gl.failed === (type ? 1 : 4) && gl.relinkedFailed >= gl.failed, `${what}: transient link failures rebuilt — ${gl.failed} injected failures, ${gl.relinkedFailed} failed programs linked again, ${gl.links} links in total`);
  out(relink.length > 0, `${what}: view reports the rebuild (data-gl-relink = ${relink.join(',') || 'none'}); ${warns.length} warning(s)`);
  out(errors.length === 0, `${what}: no page errors after recovery${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
// 2. permanent silent failures: bounded retries, then one warning
{
  const { ctx, pg, errors, warns } = await page(-1);
  await pg.goto(`${BASE}/suite/entanglement`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('.view3d canvas', { timeout: 120000 });
  await visitViews(pg, 5);
  const a = await pg.evaluate(() => window.__gl.links);
  await visitViews(pg, 2);
  const b = await pg.evaluate(() => window.__gl.links);
  const relink = await pg.evaluate(() => Math.max(0, ...[...document.querySelectorAll('[data-gl-relink]')].map((e) => Number(e.dataset.glRelink))));
  const fault = await pg.evaluate(() => document.querySelectorAll('[data-gl-fault]').length);
  out(relink === 3 && b === a, `permanent silent failures stop after bounded retries — attempts ${relink}, links stable (${a} → ${b})`);
  out(fault > 0 && warns.some((w) => /after 3 attempts/.test(w)) && errors.length === 0, `reported once as a GPU fault (${fault} view(s) flagged), no page errors${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''}`);
  out(await pg.evaluate(() => document.querySelector('main h1') != null), 'page stays responsive');
  await ctx.close();
}
// 3. genuine shader error: reported at once, never retried
{
  const { ctx, pg, errors, warns } = await page(1, 6, '', '', 'ERROR: 0:1: injected linker error');
  await pg.goto(`${BASE}/suite/entanglement`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('.view3d canvas', { timeout: 120000 });
  await visitViews(pg);
  const gl = await pg.evaluate(() => window.__gl);
  const relinkViews = await pg.evaluate(() => document.querySelectorAll('[data-gl-relink]').length);
  // (programs may be linked again legitimately when a view rebuilds its objects; what matters is that the
  // stage never schedules a rebuild for an error that has a compiler/linker message)
  out(gl.failed === 1 && relinkViews === 0 && !warns.some((w) => /rebuilding/.test(w)), `genuine shader error is not retried (${gl.failed} injected, ${relinkViews} view(s) rebuilding)`);
  out(errors.length >= 1 && errors.every((e) => /failed to compile or link/.test(e) && /injected linker error/.test(e)), `genuine shader error reported with its log (${errors.length} error line(s))`);
  await ctx.close();
}
// 4. graphics test context budget
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
// 5. closed views release their contexts
{
  const { ctx, pg, errors } = await page(0);
  await pg.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const base = new URL(BASE + '/').pathname;
  const pages = ['entanglement', 'decoherence', 'lab', 'gravity', 'environment'];
  for (let i = 0; i < 15; i++) { await pg.click(`nav.sidenav a[href="${base}suite/${pages[i % pages.length]}"]`); await pg.waitForTimeout(400); }
  await pg.click(`nav.sidenav a[href="${base}suite/entanglement"]`);
  await pg.waitForSelector('.view3d canvas', { timeout: 120000 });
  await pg.waitForTimeout(1500);
  const r = await pg.evaluate(() => ({ live: window.__glAll.filter((c) => !c.isContextLost()).length, created: window.__glAll.length, views: document.querySelectorAll('.view3d canvas').length }));
  out(r.live <= r.views, `after ${r.created} 3-D views were opened, ${r.live} WebGL context(s) remain for ${r.views} view(s) on screen`);
  out(errors.length === 0, `no page errors during fast navigation${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
// 6. playback does not grow GPU buffers
for (const [slug, prep] of [['entanglement', null], ['decoherence', null], ['optomechanics', 'Evolve']]) {
  const { ctx, pg, errors } = await page(0);
  await pg.goto(`${BASE}/suite/${slug}`, { waitUntil: 'networkidle' });
  if (prep) await pg.locator('main [data-run]', { hasText: prep }).first().click();
  let has3d = await pg.waitForSelector('.view3d canvas', { timeout: prep ? 120000 : 15000 }).then(() => true, () => false);
  if (!has3d) { // views that appear after the page's first computation
    await pg.locator('main [data-run]').first().click().catch(() => undefined);
    has3d = await pg.waitForSelector('.view3d canvas', { timeout: 120000 }).then(() => true, () => false);
  }
  if (!has3d) { out(false, `${slug}: no 3-D view appeared`); await ctx.close(); continue; }
  const plays = pg.locator('main [data-play]');
  const np = await plays.count();
  for (let i = 0; i < np; i++) {
    const b = plays.nth(i);
    if (!(await b.isVisible().catch(() => false))) continue;
    if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click().catch(() => undefined);
  }
  await pg.waitForTimeout(1500);
  const live = () => pg.evaluate(() => window.__buf.created - window.__buf.deleted);
  const a = await live();
  await pg.waitForTimeout(5000);
  const b = await live();
  out(b - a <= 8, `${slug}: live GPU buffers during 5 s of playback ${a} → ${b} (${np} player(s))`);
  out(errors.length === 0, `${slug}: no page errors during playback${errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all WebGL fault checks passed');
process.exit(fails ? 1 : 0);
