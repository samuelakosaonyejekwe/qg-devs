#!/usr/bin/env node
/**
 * Whole-app audit in Chromium:
 *   • accessibility: axe-core (WCAG 2.0/2.1 A+AA rules) on every route at 1440 and 360 px, light and dark;
 *   • layout: no horizontal page scroll and no clipped controls at 360 / 390 / 768 px (fixed layout viewport);
 *   • links: crawl every internal link found on every route; each must resolve to a real page;
 *   • console errors/warnings and unhandled promise rejections on every route;
 *   • leaks: window/document listeners and live intervals after repeatedly navigating all routes;
 *   • CSP: securitypolicyviolation events (run it against scripts/csp-proxy.mjs to enforce the policy).
 *
 *   PLAYWRIGHT_MODULE=… node scripts/web-audit.mjs [baseUrl] [outJson]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8777').replace(/\/$/, '');
const OUT = process.argv[3] || '/tmp/qg-web-audit.json';
const here = path.dirname(fileURLToPath(import.meta.url));
const AXE = fs.readFileSync(path.resolve(here, '../node_modules/axe-core/axe.min.js'), 'utf8');
const SLUGS = ['quantum', 'gravity', 'qg-eft', 'entanglement', 'interferometry', 'optomechanics', 'decoherence', 'environment', 'lab', 'signal', 'inference', 'falsification', 'design', 'discovery', 'hpc', 'verification', 'data', 'evidence'];
const ROUTES = ['/', '/thought-lab', '/builder', '/jobs', '/health', '/settings', '/help', ...SLUGS.map((s) => `/suite/${s}`)];
const ONLY = process.env.ROUTES ? process.env.ROUTES.split(',') : null;
const routes = ONLY ? ROUTES.filter((r) => ONLY.includes(r)) : ROUTES;

const INIT = () => {
  try { localStorage.setItem('qg.lastSeenVersion', '999.0.0'); } catch { /* */ }
  const w = window;
  w.__csp = []; w.__rej = []; w.__lst = { window: 0, document: 0 }; w.__iv = new Set();
  document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile ?? ''}:${e.lineNumber ?? ''}`));
  window.addEventListener('unhandledrejection', (e) => w.__rej.push(String(e.reason?.message ?? e.reason)));
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  const key = (t) => (t === window ? 'window' : t === document ? 'document' : null);
  EventTarget.prototype.addEventListener = function (...a) { const k = key(this); if (k) w.__lst[k]++; return add.apply(this, a); };
  EventTarget.prototype.removeEventListener = function (...a) { const k = key(this); if (k) w.__lst[k]--; return rem.apply(this, a); };
  const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function (...a) { const id = si.apply(this, a); w.__iv.add(id); return id; };
  window.clearInterval = function (id) { w.__iv.delete(id); return ci.call(this, id); };
};

const browser = await chromium.launch();
const findings = { axe: [], layout: [], links: [], console: [], rejections: [], csp: [], leaks: null };
const seenLinks = new Set();

async function ctxFor(width, scheme) {
  const ctx = await browser.newContext({ viewport: { width, height: 860 }, deviceScaleFactor: 1, colorScheme: scheme, serviceWorkers: 'block' });
  await ctx.addInitScript(INIT);
  return ctx;
}
async function settle(p) { try { await p.waitForLoadState('networkidle', { timeout: 15000 }); } catch { /* polling pages */ } await p.waitForTimeout(900); }

async function axe(p) {
  await p.evaluate(AXE);
  return p.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(' '), summary: (n.failureSummary || '').split('\n').slice(0, 2).join(' ') })) }));
  });
}

// ------------------------------------------------------------------ accessibility, console, links
for (const [width, scheme] of [[1440, 'light'], [1440, 'dark'], [360, 'light'], [360, 'dark']]) {
  const ctx = await ctxFor(width, scheme);
  const p = await ctx.newPage();
  const cons = [];
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource/.test(m.text())) cons.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  for (const r of routes) {
    cons.length = 0;
    await p.goto(BASE + r, { waitUntil: 'domcontentloaded' });
    await settle(p);
    for (const v of await axe(p)) findings.axe.push({ route: r, width, scheme, ...v });
    if (width === 1440 && scheme === 'light') {
      for (const href of await p.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')))) if (href && href.startsWith('/') && !href.startsWith('/api/')) seenLinks.add(href.split('#')[0] || '/');
      for (const c of cons) findings.console.push({ route: r, msg: c });
    }
    const st = await p.evaluate(() => ({ csp: window.__csp, rej: window.__rej }));
    for (const c of st.csp) findings.csp.push({ route: r, width, scheme, violation: c });
    for (const c of st.rej) findings.rejections.push({ route: r, reason: c });
  }
  await ctx.close();
}

// ------------------------------------------------------------------ layout at phone/tablet widths
for (const width of [360, 390, 768]) {
  const ctx = await ctxFor(width, 'light');
  const p = await ctx.newPage();
  for (const r of routes) {
    await p.goto(BASE + r, { waitUntil: 'domcontentloaded' });
    await settle(p);
    const res = await p.evaluate((vw) => {
      const over = document.documentElement.scrollWidth - vw;
      const clipped = [];
      for (const el of document.querySelectorAll('main button, main select, main .badge, main [role="tab"], main label, main h1, main h2, main .out-value')) {
        const e = el; const cs = getComputedStyle(e);
        if (!e.offsetParent || cs.visibility === 'hidden') continue;
        const r = e.getBoundingClientRect();
        if (r.right > vw + 1 && !e.closest('.table-wrap, .tex-display, pre, [role="tablist"], .chart-canvas-wrap')) clipped.push(`${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]} "${(e.textContent || '').trim().slice(0, 40)}" right=${Math.round(r.right)}`);
        else if (e.scrollWidth > e.clientWidth + 2 && cs.overflow !== 'visible' && e.tagName !== 'SELECT' && !e.closest('[role="tablist"]')) clipped.push(`${e.tagName.toLowerCase()} truncated "${(e.textContent || '').trim().slice(0, 40)}"`);
      }
      return { over, clipped: clipped.slice(0, 8) };
    }, width);
    if (res.over > 1 || res.clipped.length) findings.layout.push({ route: r, width, pageOverflowPx: Math.max(0, res.over), clipped: res.clipped });
  }
  await ctx.close();
}

// ------------------------------------------------------------------ link crawl
{
  const ctx = await ctxFor(1280, 'light');
  const p = await ctx.newPage();
  for (const href of [...seenLinks].sort()) {
    const r = await p.goto(BASE + href, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(500);
    const nf = await p.locator('main h1', { hasText: 'Page not found' }).count();
    if (!r || r.status() >= 400 || nf) findings.links.push({ href, status: r?.status(), notFound: !!nf });
  }
  await ctx.close();
}

// ------------------------------------------------------------------ leaks across repeated navigation
{
  const ctx = await ctxFor(1280, 'light');
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await settle(p);
  const rounds = [];
  for (let k = 0; k < 3; k++) {
    for (const r of routes) {
      await p.evaluate((h) => { const a = document.createElement('a'); a.href = h; document.body.appendChild(a); a.click(); a.remove(); }, r);
      await p.waitForTimeout(450);
    }
    await p.evaluate((h) => { const a = document.createElement('a'); a.href = h; document.body.appendChild(a); a.click(); a.remove(); }, '/help');
    await p.waitForTimeout(1500);
    rounds.push(await p.evaluate(() => ({ window: window.__lst.window, document: window.__lst.document, intervals: window.__iv.size, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null })));
  }
  findings.leaks = rounds;
  await ctx.close();
}
await browser.close();

fs.writeFileSync(OUT, JSON.stringify(findings, null, 2));
const axeIds = {};
for (const a of findings.axe) { const k = `${a.id} (${a.impact})`; axeIds[k] = axeIds[k] ?? new Set(); axeIds[k].add(`${a.route}@${a.width}/${a.scheme}`); }
console.log(`axe violations: ${findings.axe.length}`);
for (const [k, v] of Object.entries(axeIds)) console.log(`  ${k}: ${[...v].slice(0, 6).join(', ')}${v.size > 6 ? ` … (+${v.size - 6})` : ''}`);
console.log(`layout issues: ${findings.layout.length}`);
for (const l of findings.layout.slice(0, 30)) console.log(`  ${l.route}@${l.width}: overflow ${l.pageOverflowPx}px ${l.clipped.join(' | ')}`);
console.log(`broken links: ${findings.links.length} of ${seenLinks.size}`, findings.links.slice(0, 10));
console.log(`console errors/warnings: ${findings.console.length}`); for (const c of findings.console.slice(0, 15)) console.log(`  ${c.route}: ${c.msg}`);
console.log(`unhandled rejections: ${findings.rejections.length}`, findings.rejections.slice(0, 5));
console.log(`CSP violations: ${findings.csp.length}`, findings.csp.slice(0, 10));
console.log('listeners/intervals after each navigation round (should not grow):', JSON.stringify(findings.leaks));
console.log(`full report: ${OUT}`);
