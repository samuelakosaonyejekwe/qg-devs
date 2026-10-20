#!/usr/bin/env node
/**
 * Browser checks of the "What's new" and "Update available" dialogs (Playwright + Chromium).
 *
 *   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/e2e-update.mjs [baseUrl] [screenshotDir]
 *
 * (a) first-ever visit: no dialog, the running version is stored silently;
 * (b) older last-seen version: What's new appears (light + dark + 360 px screenshots), Esc closes it, and it
 *     does not reappear on reload;
 * (c) a waiting service worker (simulated 'qg-sw-update' event): Update-available dialog (light + dark
 *     screenshots); "Later" closes it and leaves the "Update ready" header chip.
 */
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:8777').replace(/\/$/, '');
const OUT = process.argv[3] || path.resolve('../docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
const lines = [];
const step = async (name, fn) => {
  try { const n = await fn(); lines.push(`PASS ${name}${n ? ` — ${n}` : ''}`); }
  catch (e) { fails++; lines.push(`FAIL ${name} — ${String(e?.message ?? e).split('\n')[0]}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const DIALOG = '[data-update-dialog]';

const browser = await chromium.launch();
const errors = [];
async function ctxFor(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, colorScheme: 'light', serviceWorkers: 'block', ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${e.message} @ ${(e.stack || '').split('\n').slice(1, 6).join(' <- ')}`));
  return { ctx, page };
}
const lastSeen = (page) => page.evaluate(() => localStorage.getItem('qg.lastSeenVersion'));

await step('(a) first-ever visit: no dialog, version stored silently', async () => {
  const { ctx, page } = await ctxFor();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  assert(await page.locator(DIALOG).count() === 0, 'dialog shown on first visit');
  const v = await lastSeen(page);
  assert(v && /^\d+\.\d+/.test(v), `lastSeen not stored (${v})`);
  await ctx.close();
  return `stored ${v}`;
});

async function whatsNew(colorScheme, file, viewport) {
  const { ctx, page } = await ctxFor({ colorScheme, ...(viewport ? { viewport } : {}) });
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('qg.lastSeenVersion', '0.1.0'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(DIALOG, { timeout: 10000 });
  const title = await page.locator(`${DIALOG} h2`).innerText();
  assert(/What's new in/.test(title), `unexpected title ${title}`);
  await page.waitForSelector(`${DIALOG} .upd-list li`, { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, file) });
  const n = await page.locator(`${DIALOG} .upd-list li`).count();
  return { ctx, page, title, n };
}

await step("(b) older last-seen version → What's new (light), Esc closes, no reappearance", async () => {
  const { ctx, page, title, n } = await whatsNew('light', 'whats-new-light.png');
  const focusedInside = await page.evaluate(() => !!document.activeElement?.closest('[data-update-dialog]'));
  assert(focusedInside, 'focus not moved into the dialog');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert(await page.locator(DIALOG).count() === 0, 'Esc did not close');
  const v = await lastSeen(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  assert(await page.locator(DIALOG).count() === 0, 'dialog reappeared after reload');
  await ctx.close();
  return `${title}; ${n} list items; lastSeen → ${v}`;
});
await step("(b) What's new (dark)", async () => { const { ctx } = await whatsNew('dark', 'whats-new-dark.png'); await ctx.close(); });
await step("(b) What's new at 360 px", async () => {
  const { ctx, page } = await whatsNew('light', 'whats-new-360.png', { width: 360, height: 760 });
  const overflow = await page.evaluate(() => { const c = document.querySelector('.upd-card'); return c ? c.getBoundingClientRect().right - window.innerWidth : 0; });
  await ctx.close();
  assert(overflow <= 0.5, `dialog overflows viewport by ${overflow}px`);
});

async function updateAvailable(colorScheme, file) {
  const { ctx, page } = await ctxFor({ colorScheme });
  await page.goto(BASE + '/suite/entanglement', { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__skipMsgs = []; window.dispatchEvent(new CustomEvent('qg-sw-update', { detail: { postMessage(m) { window.__skipMsgs.push(m); } } })); });
  await page.waitForSelector(DIALOG, { timeout: 10000 });
  await page.waitForSelector(`${DIALOG} .upd-chip`, { timeout: 10000 });
  await page.waitForSelector(`${DIALOG} .upd-list li`, { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, file) });
  return { ctx, page };
}

await step('(c) Update available (light) → Later → "Update ready" chip', async () => {
  const { ctx, page } = await updateAvailable('light', 'update-available-light.png');
  const chip = await page.locator(`${DIALOG} .upd-chip`).innerText();
  assert(/→/.test(chip), `version chip missing arrow: ${chip}`);
  await page.locator(`${DIALOG} button`, { hasText: 'Later' }).click();
  await page.waitForTimeout(300);
  assert(await page.locator(DIALOG).count() === 0, 'Later did not close');
  assert(await page.locator('[data-update-ready]').isVisible(), '"Update ready" chip not visible');
  await page.locator('[data-update-ready]').click();
  await page.waitForSelector(DIALOG, { timeout: 5000 });
  await page.keyboard.press('Escape');
  assert(page.url().endsWith('/suite/entanglement'), 'route changed');
  await ctx.close();
  return `chip "${chip.replace(/\s+/g, ' ')}"`;
});
await step('(c) Update available (dark)', async () => { const { ctx } = await updateAvailable('dark', 'update-available-dark.png'); await ctx.close(); });

await browser.close();
console.log(lines.join('\n'));
if (errors.length) console.log(`page errors:\n${errors.join('\n')}`);
console.log(`\n${lines.length - fails}/${lines.length} update-dialog checks passed; screenshots in ${OUT}`);
process.exit(fails || errors.length ? 1 : 0);
