#!/usr/bin/env node
/**
 * Browser end-to-end check of the built app served by the FastAPI server (Playwright + Chromium).
 *
 *   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs node scripts/e2e.mjs [baseUrl] [screenshotDir]
 *
 * Flows: dashboard → suites via the side navigation, header Back/Forward and Alt+←/→, flagship prediction
 * (3-D view, animation), thought experiment end-to-end (interpret → review → approve → execute), dark theme,
 * phone viewport (no horizontal scroll), offline mode (service-worker shell, local engine fallback, cached
 * GETs labelled, POST queued and replayed when back online). Screenshots go to screenshotDir.
 *
 * Chromium's offline emulation does not cover service-worker fetches, so for a genuine offline test set
 * QG_SERVER_DOWN / QG_SERVER_UP to shell commands that stop / restart the API server; the offline step
 * runs them around the emulated-offline period.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const pwPath = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(pwPath);
const BASE = (process.argv[2] || 'http://127.0.0.1:8777').replace(/\/$/, '');
const OUT = process.argv[3] || path.resolve('../docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

const log = [];
let fails = 0;
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const note = await fn(); log.push(`PASS ${name}${note ? ` — ${note}` : ''} (${Date.now() - t0} ms)`); }
  catch (e) { fails++; log.push(`FAIL ${name} — ${String(e?.message ?? e).split('\n')[0].slice(0, 300)}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
const shot = (name, p = page, full = false) => p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
const idbQueue = () => page.evaluate(() => new Promise((r) => { const o = indexedDB.open('qg-devs'); o.onsuccess = () => { const t = o.result.transaction('queue').objectStore('queue').getAll(); t.onsuccess = () => r(t.result.map((x) => ({ label: x.label, status: x.status, error: x.error }))); }; o.onerror = () => r([]); }));
const serverJobCount = async () => { try { const r = await fetch(BASE + '/api/jobs?limit=500'); return (await r.json()).jobs.filter((j) => j.type === 'discrimination_matrix').length; } catch { return -1; } };
const h1 = (p = page) => p.locator('main h1').first().innerText();

await step('dashboard loads', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('main h1');
  await page.waitForTimeout(1500);
  await shot('01-dashboard');
  return await h1();
});

await step('navigate suites via side nav; Back/Forward buttons and Alt+arrows', async () => {
  await page.click('nav.sidenav a[href="/suite/entanglement"]');
  await page.waitForURL('**/suite/entanglement');
  await page.click('nav.sidenav a[href="/suite/lab"]');
  await page.waitForURL('**/suite/lab');
  await page.click('nav.sidenav a[href="/suite/falsification"]');
  await page.waitForURL('**/suite/falsification');
  await page.click('button[aria-label^="Back"]');
  await page.waitForURL('**/suite/lab');
  await page.click('button[aria-label^="Back"]');
  await page.waitForURL('**/suite/entanglement');
  const fwdEnabled = await page.isEnabled('button[aria-label^="Forward"]');
  assert(fwdEnabled, 'Forward should be enabled after going back');
  await page.click('button[aria-label^="Forward"]');
  await page.waitForURL('**/suite/lab');
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForURL('**/suite/entanglement');
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForURL('**/suite/lab');
  await page.goto(BASE + '/suite/lab', { waitUntil: 'networkidle' }); // deep link
  return `deep link h1: ${await h1()}`;
});

await step('virtual laboratory dossier renders', async () => {
  await page.waitForSelector('text=Scientific Laboratory Protocol', { timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot('03-virtual-lab');
  await page.click('role=tab[name=/Engineering Apparatus Specification/]');
  await page.waitForTimeout(800);
  await shot('04-virtual-lab-engineering', page, true);
});

await step('flagship prediction (Suite 4)', async () => {
  await page.goto(BASE + '/suite/entanglement', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Key predictions', { timeout: 30000 });
  const v = await page.locator('.out').first().locator('.out-value').innerText();
  assert(/\d/.test(v), `Δφ value not shown (${v})`);
  await page.waitForSelector('.view3d canvas', { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot('02-flagship');
  await page.locator('main [data-play]').first().click();
  await page.waitForTimeout(1200);
  await page.locator('.view3d').first().screenshot({ path: path.join(OUT, '05-apparatus-3d.png') });
  await page.locator('section[aria-label="Competing hypotheses — side by side"]').screenshot({ path: path.join(OUT, '06-hypotheses.png') });
  return `Δφ shown as ${v}`;
});

await step('edit input with validation, rerun', async () => {
  const inp = page.locator('input[aria-describedby]').first();
  await inp.fill('-5');
  await page.waitForSelector('.field-error');
  const disabled = await page.isDisabled('button:has-text("Run prediction")');
  assert(disabled, 'Run should be disabled while invalid');
  await inp.fill('20');
  await page.waitForTimeout(1500);
  return 'invalid input blocked; valid input accepted';
});

await step('thought experiment end-to-end', async () => {
  await page.goto(BASE + '/thought-lab', { waitUntil: 'networkidle' });
  await page.fill('textarea', 'Two 10 fg diamond spheres 450 um apart, each in a 250 um spatial superposition, interact for 2.5 s. Do they become entangled?');
  await page.locator('button', { hasText: /Interpret/i }).first().click();
  await page.waitForSelector('text=USER STATED', { timeout: 30000 });
  await shot('07-thought-review', page, true);
  const approve = page.locator('input[type="checkbox"]').filter({ hasNot: page.locator('[disabled]') });
  if (await approve.count()) await approve.last().check();
  await page.locator('button', { hasText: /reviewed these assumptions/i }).first().click();
  await page.waitForSelector('text=/not physical evidence/i', { timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot('08-thought-results', page, true);
});

await step('dark theme', async () => {
  const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const p = await dark.newPage();
  await p.goto(BASE + '/suite/entanglement', { waitUntil: 'networkidle' });
  await p.waitForSelector('text=Key predictions', { timeout: 30000 });
  await p.waitForTimeout(2000);
  await shot('09-flagship-dark', p);
  await p.goto(BASE + '/suite/design', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await shot('10-design-dark', p);
  await dark.close();
});

await step('phone viewport (390 px): no horizontal scroll', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await m.newPage();
  const widths = {};
  for (const r of ['/', '/suite/entanglement', '/thought-lab', '/suite/evidence', '/help']) {
    await p.goto(BASE + r, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1500);
    widths[r] = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  }
  await p.goto(BASE + '/suite/entanglement', { waitUntil: 'networkidle' });
  await p.waitForSelector('text=Key predictions', { timeout: 30000 });
  await shot('11-phone-flagship', p);
  await p.click('button[aria-label="Open navigation"]');
  await p.waitForTimeout(400);
  await shot('12-phone-nav', p);
  await m.close();
  const bad = Object.entries(widths).filter(([, w]) => w > 1);
  assert(!bad.length, `horizontal overflow: ${JSON.stringify(bad)}`);
  return JSON.stringify(widths);
});

await step('service worker controls the page and precaches chunks', async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle' });
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  assert(controlled, 'page not controlled by SW');
  // wait until lazy chunks are cached
  let info = null;
  for (let i = 0; i < 30; i++) {
    info = await page.evaluate(() => new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = (e) => res(e.data); navigator.serviceWorker.controller.postMessage({ type: 'GET_CACHE_INFO' }, [ch.port2]); setTimeout(() => res(null), 2000); }));
    if (info && info.lazy >= info.lazyTotal) break;
    await page.waitForTimeout(1000);
  }
  // visit pages once online so their GET data is cached
  for (const r of ['/suite/data', '/suite/falsification', '/suite/entanglement']) { await page.goto(BASE + r, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200); }
  return JSON.stringify(info);
});

await step('offline: shell loads, flagship computes locally, GETs labelled cached, jobs queued', async () => {
  const jobsBefore = await serverJobCount();
  if (process.env.QG_SERVER_DOWN) execSync(process.env.QG_SERVER_DOWN, { stdio: 'inherit' });
  await ctx.setOffline(true);
  await page.goto(BASE + '/suite/entanglement', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Key predictions', { timeout: 30000 });
  // the result itself must carry the local-engine provenance badge, never a server badge
  await page.waitForSelector('section[aria-label="Key predictions"] .badge.b-local', { timeout: 15000 });
  const serverBadges = await page.locator('section[aria-label="Key predictions"] .badge.b-computed').count();
  assert(serverBadges === 0, `offline result shows ${serverBadges} server COMPUTED badges`);
  await page.waitForTimeout(1500);
  await shot('13-offline-flagship-local-engine');
  await page.click('nav.sidenav a[href="/suite/data"]');
  await page.waitForSelector('.cached-chip:has-text("cached at")', { timeout: 15000 });
  await shot('14-offline-cached-data');
  // queue a job while offline (discrimination matrix on Suite 12)
  await page.click('nav.sidenav a[href="/suite/falsification"]');
  await page.waitForTimeout(1500);
  await page.click('role=tab[name=/Discrimination/]');
  await page.locator('button', { hasText: 'Run discrimination job' }).click();
  await page.waitForSelector('.banner.info >> text=/queued on this device/i', { timeout: 15000 });
  const queued = await idbQueue();
  assert(queued.length === 1 && queued[0].status === 'pending', `IndexedDB queue: ${JSON.stringify(queued)}`);
  await page.goto(BASE + '/jobs#queue', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await shot('15-offline-queue', page, true);
  if (process.env.QG_SERVER_UP) execSync(process.env.QG_SERVER_UP, { stdio: 'inherit' });
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(6000);
  await page.goto(BASE + '/jobs#queue', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot('16-queue-after-reconnect', page, true);
  const after = await idbQueue();
  assert(after.length === 1 && after[0].status === 'sent', `queue not replayed: ${JSON.stringify(after)}`);
  const jobsAfter = await serverJobCount();
  assert(jobsAfter === jobsBefore + 1, `server discrimination jobs ${jobsBefore} → ${jobsAfter}`);
  const header = await page.locator('header').innerText();
  return `queued offline, replayed after reconnect (server discrimination jobs ${jobsBefore} → ${jobsAfter}); header: ${header.replace(/\s+/g, ' ').slice(0, 60)}`;
});

await step('remaining suites render without error boxes', async () => {
  const routes = ['quantum', 'gravity', 'qg-eft', 'interferometry', 'optomechanics', 'decoherence', 'environment', 'signal', 'inference', 'design', 'discovery', 'hpc', 'verification', 'data', 'evidence'];
  const bad = [];
  for (const s of routes) {
    await page.goto(`${BASE}/suite/${s}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    const n = await page.locator('.error-box').count();
    if (n) bad.push(`${s}: ${(await page.locator('.error-box').first().innerText()).slice(0, 120)}`);
    await shot(`suite-${s}`, page);
  }
  for (const r of ['jobs', 'health', 'settings', 'help', 'builder']) {
    await page.goto(`${BASE}/${r}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const n = await page.locator('.error-box').count();
    if (n) bad.push(`${r}: ${(await page.locator('.error-box').first().innerText()).slice(0, 120)}`);
    await shot(`page-${r}`, page);
  }
  assert(!bad.length, bad.join(' | '));
});

await browser.close();
console.log(log.join('\n'));
console.log(`\nConsole errors (${consoleErrors.length}):\n${[...new Set(consoleErrors)].slice(0, 30).join('\n')}`);
console.log(`\n${log.length - fails}/${log.length} browser checks passed; screenshots in ${OUT}`);
process.exit(fails ? 1 : 0);
