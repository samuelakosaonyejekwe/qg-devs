#!/usr/bin/env node
/**
 * UX audit: drives every route at desktop (1440×900) and phone (360×780) sizes, runs the page's safe
 * computations, opens tabs and <details>, then flags unfriendly states: placeholder/garbage text
 * (undefined, NaN, [object Object], null, Infinity, tracebacks, raw "Error 4xx/5xx"), raw JSON in normal
 * mode, unformatted long numbers, blank charts, horizontal overflow and truncated/overlapping text at
 * 360 px, and error notices after normal operation. Also checks the access (401) and job-limit (429) flows.
 *
 *   PLAYWRIGHT_MODULE=…/playwright/index.mjs node scripts/ux-audit.mjs [baseUrl] [outDir]
 *
 * Writes screenshots, findings.json and findings.md into outDir (default ../docs/screenshots/ux-before).
 */
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8777').replace(/\/$/, '');
const OUT = process.argv[3] || path.resolve('../docs/screenshots/ux-before');
// Access/limit flows need a server with QGDEVS_API_TOKENS set (public visitors limited); default: same server.
const ABASE = (process.env.ACCESS_BASE || BASE).replace(/\/$/, '');
const ONLY_FLOWS = process.env.ONLY_FLOWS === '1';
fs.mkdirSync(OUT, { recursive: true });

const SLUGS = ['quantum', 'gravity', 'qg-eft', 'entanglement', 'interferometry', 'optomechanics', 'decoherence', 'environment', 'lab', 'signal', 'inference', 'falsification', 'design', 'discovery', 'hpc', 'verification', 'data', 'evidence'];
const ROUTES = ['/', '/thought-lab', '/builder', '/jobs', '/health', '/settings', '/help', ...SLUGS.map((s) => `/suite/${s}`)];
const NO_CLICK = /preregistration|ingest|unblinding|sign-off|package|optimisation|discovery cycle|calibration|verification|vv|backup|fetch|reviewed these assumptions|start local sweep|inference job|discrimination/i;
const VIEWPORTS = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 360, height: 780 }];

const findings = [];
let shotN = 0;
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'root';

const browser = await chromium.launch();
async function newPage(vp, scheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, colorScheme: scheme, serviceWorkers: 'block', isMobile: vp.name === 'phone', hasTouch: vp.name === 'phone' });
  await ctx.addInitScript(() => { try { localStorage.setItem('qg.lastSeenVersion', '999.0.0'); localStorage.removeItem('qg.settings'); } catch { /* */ } });
  const p = await ctx.newPage();
  return { ctx, p };
}

/** In-page detector: marks flagged elements with data-ux-flag and returns descriptions. */
async function detect(p, phone) {
  return p.evaluate((phone) => {
    const out = [];
    let n = 0;
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const flag = (el, category, text) => {
      const id = `f${++n}`;
      el.setAttribute('data-ux-flag', id);
      const sel = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
      out.push({ id, category, selector: sel, text: String(text).replace(/\s+/g, ' ').slice(0, 220) });
    };
    const main = document.querySelector('main') || document.body;
    const skip = (el) => !!el.closest('pre, code, .tex, .katex, script, style, .mono, [data-ux-ignore], textarea, .chart-tip');
    // 1. bad text tokens
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const el = node.parentElement;
      if (!el || skip(el) || !vis(el) || seen.has(el)) continue;
      const t = node.textContent.trim();
      if (!t) continue;
      const checks = [
        [/\bundefined\b/, 'text: undefined'], [/\bNaN\b/, 'text: NaN'], [/\[object Object\]/, 'text: [object Object]'],
        [/(^|[:=(\s])null($|[\s),.])/, 'text: null value'], [/(^|[^∞\w])-?Infinity\b/, 'text: Infinity'], [/Traceback|File ".*", line \d+/, 'text: stack trace'],
        [/\b(Error|HTTP)\s?[45]\d\d\b/, 'text: raw HTTP error'],
      ];
      for (const [re, cat] of checks) if (re.test(t)) { seen.add(el); flag(el, cat, t); break; }
      if (seen.has(el)) continue;
      if (/^[{[]\s*"/.test(t) && t.length > 80) { seen.add(el); flag(el, 'raw JSON in normal view', t); continue; }
      // long unformatted numbers (ignore hashes/ids and ISO times)
      if (!/[0-9a-f]{12,}/i.test(t) && !/\d{4}-\d\d-\d\dT/.test(t)) {
        const m = t.match(/[-−]?\d+\.\d{8,}(e[-+]?\d+)?|\b\d{11,}\b/);
        if (m) { seen.add(el); flag(el, 'unformatted long number', t); }
      }
    }
    // 2. charts that drew (almost) nothing besides axes
    for (const c of main.querySelectorAll('figure.chart canvas:not(.chart-overlay)')) {
      if (!vis(c)) continue;
      try {
        const ctx = c.getContext('2d'); const w = c.width, h = c.height;
        const d = ctx.getImageData(0, 0, w, h).data; let ink = 0, tot = 0;
        for (let i = 3; i < d.length; i += 4 * 17) { tot++; if (d[i] > 10) ink++; }
        if (tot && ink / tot < 0.004) flag(c.closest('figure'), 'blank chart', c.getAttribute('aria-label') || '');
      } catch { /* tainted or webgl */ }
    }
    // 3. error notices after normal operation
    for (const e of main.querySelectorAll('.error-box, .notice-error, .notice-input, .notice-busy, .notice-offline')) if (vis(e)) flag(e, 'error notice shown', e.textContent);
    // 4. layout at phone width
    if (phone) {
      const doc = document.documentElement;
      if (doc.scrollWidth > innerWidth + 1) out.push({ id: null, category: 'page horizontal overflow', selector: 'html', text: `scrollWidth ${doc.scrollWidth} > ${innerWidth}` });
      const allowed = '.table-wrap, pre, .tex-display, .katex-display, .chart-canvas-wrap, .view3d, .matrix, select, input, textarea, [role="tablist"], .eq-list, .reset-menu';
      for (const el of main.querySelectorAll('*')) {
        if (!vis(el) || el.closest(allowed) || el.matches(allowed)) continue;
        const r = el.getBoundingClientRect();
        if (r.right > innerWidth + 2 && r.width < innerWidth * 3 && !el.closest('[data-ux-flag]')) { flag(el, 'element overflows viewport', `${el.tagName} right=${Math.round(r.right)} text="${(el.textContent || '').trim().slice(0, 80)}"`); }
      }
    }
    // 5. truncated / clipped single-line text
    for (const el of main.querySelectorAll('button, .badge, label, .view3d-legend li, h1, h2, h3, .out-value, .out-label, .chart-title, .stage, th, .notice-title')) {
      if (!vis(el) || el.closest('.table-wrap') && el.tagName !== 'TH') continue;
      const cs = getComputedStyle(el);
      if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap') && el.scrollWidth > el.clientWidth + 2) flag(el, 'truncated text', el.textContent);
    }
    // 6. overlapping siblings in control rows
    for (const row of main.querySelectorAll('.row, .runbar, .chart-toolbar, .view3d-tools, .player, .card-head, .page-head, .pipeline')) {
      const kids = [...row.children].filter(vis);
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 3 && iy > 3) { flag(row, 'overlapping controls', `${kids[i].textContent.trim().slice(0, 40)} ⟂ ${kids[j].textContent.trim().slice(0, 40)}`); i = kids.length; break; }
      }
    }
    return out;
  }, phone);
}

async function record(p, route, vp, scheme, list) {
  for (const f of list) {
    const file = `${String(++shotN).padStart(3, '0')}-${vp.name}-${slug(route)}-${slug(f.category)}.png`;
    try {
      if (f.id) { const loc = p.locator(`[data-ux-flag="${f.id}"]`).first(); await loc.scrollIntoViewIfNeeded({ timeout: 3000 }); await loc.screenshot({ path: path.join(OUT, file), timeout: 5000 }); }
      else await p.screenshot({ path: path.join(OUT, file) });
    } catch { try { await p.screenshot({ path: path.join(OUT, file) }); } catch { /* */ } }
    findings.push({ route, viewport: vp.name, scheme, category: f.category, selector: f.selector, text: f.text, screenshot: file });
  }
}

async function exercise(p) {
  const runs = await p.locator('main [data-run]').all();
  for (const b of runs) {
    let t = '';
    try { t = (await b.innerText()).trim(); } catch { continue; }
    if (NO_CLICK.test(t) || !(await b.isEnabled().catch(() => false))) continue;
    try { await b.click({ timeout: 3000 }); await p.waitForLoadState('networkidle', { timeout: 40000 }); await p.waitForTimeout(800); } catch { /* keep going */ }
  }
}

for (const vp of ONLY_FLOWS ? [] : VIEWPORTS) {
  const { ctx, p } = await newPage(vp);
  for (const route of ROUTES) {
    try {
      await p.goto(BASE + route, { waitUntil: 'networkidle', timeout: 60000 });
      await p.waitForTimeout(900);
      await exercise(p);
      const tabs = await p.locator('main [role="tab"]').all();
      const all = [];
      all.push(...await detect(p, vp.name === 'phone'));
      await record(p, route, vp, 'light', all);
      for (const t of tabs.slice(1, 8)) {
        try { await t.click({ timeout: 2000 }); await p.waitForTimeout(600); await exercise(p); } catch { continue; }
        const name = (await t.innerText().catch(() => 'tab')).trim();
        for (const d of await p.locator('main details:not([open])').all()) { try { await d.locator('summary').first().click({ timeout: 1000 }); } catch { /* */ } }
        const list = await detect(p, vp.name === 'phone');
        await record(p, `${route} [${name}]`, vp, 'light', list);
      }
      if (vp.name === 'phone') await p.screenshot({ path: path.join(OUT, `page-phone-${slug(route)}.png`), fullPage: true });
    } catch (e) {
      findings.push({ route, viewport: vp.name, scheme: 'light', category: 'page failed to load', selector: '', text: String(e.message).slice(0, 200), screenshot: '' });
    }
  }
  await ctx.close();
}

// dark spot-check on a few result-heavy pages
if (!ONLY_FLOWS) {
  const vp = VIEWPORTS[0];
  const { ctx, p } = await newPage(vp, 'dark');
  for (const route of ['/suite/entanglement', '/suite/lab', '/suite/evidence', '/thought-lab']) {
    try {
      await p.goto(BASE + route, { waitUntil: 'networkidle', timeout: 60000 });
      await p.waitForTimeout(1200);
      await exercise(p);
      await record(p, route, vp, 'dark', await detect(p, false));
      await p.screenshot({ path: path.join(OUT, `page-dark-${slug(route)}.png`) });
    } catch (e) { findings.push({ route, viewport: 'desktop', scheme: 'dark', category: 'page failed to load', selector: '', text: String(e.message).slice(0, 200), screenshot: '' }); }
  }
  await ctx.close();
}

// access flow: evidence writes without a token must show the friendly access notice
const access = [];
try {
  const { ctx, p } = await newPage(VIEWPORTS[0]);
  await p.goto(ABASE + '/suite/evidence#prereg', { waitUntil: 'networkidle' });
  await p.getByRole('tab', { name: 'Preregistration' }).click();
  await p.locator('main input[placeholder^="e.g. BMV witness"]').fill('UX audit probe (should be refused without a token)');
  const plan = p.locator('main textarea').first();
  if (!(await plan.inputValue())) await plan.fill('Blind witness analysis after unblinding.');
  const runP = p.locator('main [data-run]', { hasText: 'Record preregistration' });
  if (await runP.isEnabled()) {
    await runP.click();
    await p.waitForTimeout(2500);
    const friendly = await p.locator('[data-notice="access"]').count();
    const raw = await p.locator('main').getByText(/Error 40[13]/).count();
    access.push({ flow: 'preregistration without token', friendlyNotice: friendly > 0, rawErrorText: raw > 0 });
    await p.screenshot({ path: path.join(OUT, 'access-preregistration.png'), fullPage: false });
    if (friendly) await p.locator('[data-notice="access"]').first().screenshot({ path: path.join(OUT, 'access-preregistration-notice.png') });
  } else access.push({ flow: 'preregistration without token', note: 'submit button disabled with default inputs' });
  await p.getByRole('tab', { name: 'Datasets & unblinding' }).click();
  await p.setInputFiles('#s18-ds-file', { name: 'probe.json', mimeType: 'application/json', buffer: Buffer.from(`{"probe": "${Date.now()}"}`) });
  await p.locator('main input[placeholder^="instrument"]').fill('ux-audit probe');
  const runI = p.locator('main [data-run]', { hasText: 'Ingest dataset' });
  await runI.click();
  await p.waitForTimeout(2500);
  const friendlyI = await p.locator('[data-notice="access"]').count();
  access.push({ flow: 'dataset ingest without token', friendlyNotice: friendlyI > 0, rawErrorText: (await p.locator('main').getByText(/Error 40[13]/).count()) > 0 });
  await p.screenshot({ path: path.join(OUT, 'access-ingest.png') });
  await ctx.close();
} catch (e) { access.push({ flow: 'access flows', error: String(e.message).slice(0, 200) }); }

// job-limit flow: four discrimination jobs from separate tabs (same visitor) → the 4th should be refused (429)
try {
  const pages = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  await ctx.addInitScript(() => { try { localStorage.setItem('qg.lastSeenVersion', '999.0.0'); } catch { /* */ } });
  let notice = null;
  for (let i = 0; i < 5 && !notice; i++) {
    const p = await ctx.newPage();
    pages.push(p);
    await p.goto(ABASE + '/suite/falsification', { waitUntil: 'networkidle' });
    // each tab has its own remembered job id → clear it so a new job is submitted
    await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('qg.lastJob.')) localStorage.removeItem(k); });
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByRole('tab', { name: 'Discrimination matrix' }).click();
    await p.locator('main [data-run]', { hasText: /discrimination/i }).first().click();
    await p.waitForTimeout(2500);
    if (await p.locator('[data-notice="limit"]').count()) notice = { tab: i + 1, p };
  }
  if (notice) {
    await notice.p.locator('[data-notice="limit"]').first().scrollIntoViewIfNeeded();
    await notice.p.locator('[data-notice="limit"]').first().screenshot({ path: path.join(OUT, 'limit-429-notice.png') });
    await notice.p.screenshot({ path: path.join(OUT, 'limit-429-page.png') });
    access.push({ flow: 'job limit (429)', friendlyNotice: true, refusedAtSubmission: notice.tab, rawErrorText: (await notice.p.locator('main').getByText(/Error 429/).count()) > 0 });
  } else {
    await pages[pages.length - 1].screenshot({ path: path.join(OUT, 'limit-429-not-triggered.png') });
    access.push({ flow: 'job limit (429)', friendlyNotice: false, note: 'no limit notice after 5 submissions (jobs may finish faster than they are submitted, or the limit is not per-tab)' });
  }
  await ctx.close();
} catch (e) { access.push({ flow: 'job limit (429)', error: String(e.message).slice(0, 200) }); }
await browser.close();

if (ONLY_FLOWS && fs.existsSync(path.join(OUT, 'findings.json'))) findings.push(...JSON.parse(fs.readFileSync(path.join(OUT, 'findings.json'), 'utf8')).findings);
fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify({ base: BASE, accessBase: ABASE, generated: new Date().toISOString(), access, findings }, null, 2));
const byCat = {};
for (const f of findings) (byCat[f.category] ??= []).push(f);
let md = `# UX audit findings (before fixes)\n\nBase: ${BASE} · generated ${new Date().toISOString()}\n\n## Access / limit flows\n\n${access.map((a) => `- ${a.flow}: ${JSON.stringify(a)}`).join('\n')}\n\n`;
for (const [c, l] of Object.entries(byCat)) {
  md += `## ${c} (${l.length})\n\n| route | viewport | element | text | screenshot |\n|---|---|---|---|---|\n`;
  for (const f of l) md += `| ${f.route} | ${f.viewport}${f.scheme === 'dark' ? ' (dark)' : ''} | \`${f.selector}\` | ${f.text.replace(/\|/g, '\\|').slice(0, 120)} | ${f.screenshot} |\n`;
  md += '\n';
}
fs.writeFileSync(path.join(OUT, 'findings.md'), md);
console.log(`access: ${JSON.stringify(access)}`);
console.log(Object.entries(byCat).map(([c, l]) => `${c}: ${l.length}`).join('\n'));
console.log(`\n${findings.length} findings → ${OUT}`);
