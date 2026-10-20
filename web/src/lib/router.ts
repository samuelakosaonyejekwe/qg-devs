/**
 * Tiny History-API router with real browser back/forward support.
 *
 * Each history entry carries its position (`qgIdx`) so the header can enable/disable the Back and
 * Forward buttons correctly; the furthest position reached is kept in sessionStorage so it survives
 * reloads within the tab.
 */
import { createStore, useStore } from './store';
import { toApp, toUrl } from './base';

interface RouteState { path: string; search: string; idx: number; max: number }

function readMax(fallback: number): number {
  try { const v = Number(sessionStorage.getItem('qg.maxIdx')); return Number.isFinite(v) && v >= fallback ? v : fallback; } catch { return fallback; }
}
function writeMax(v: number) {
  try { sessionStorage.setItem('qg.maxIdx', String(v)); } catch { /* ignore */ }
}

const initialIdx = typeof history !== 'undefined' && history.state && typeof history.state.qgIdx === 'number' ? history.state.qgIdx : 0;
if (typeof history !== 'undefined' && (!history.state || typeof history.state.qgIdx !== 'number')) {
  history.replaceState({ ...(history.state || {}), qgIdx: initialIdx }, '');
}

export const route = createStore<RouteState>({
  path: typeof location !== 'undefined' ? toApp(location.pathname) : '/',
  search: typeof location !== 'undefined' ? location.search : '',
  idx: initialIdx,
  max: readMax(initialIdx),
});

/** Scroll to an in-page anchor once the (possibly lazily loaded) page has rendered it. */
export function scrollToHash(hash: string) {
  if (!hash || hash === '#') return;
  const id = decodeURIComponent(hash.slice(1));
  let tries = 0;
  const attempt = () => {
    const el = document.getElementById(id);
    if (el) { el.scrollIntoView({ block: 'start' }); return; }
    if (++tries < 40) setTimeout(attempt, 100);
  };
  attempt();
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  // `to` is an app path ("/suite/lab?x#y") or a full URL; history entries carry the real URL under the base
  const url = new URL(to.startsWith('/') && !to.startsWith('//') ? toUrl(to) : to, location.href);
  if (url.origin !== location.origin) { location.href = to; return; }
  const appPath = toApp(url.pathname);
  const real = url.pathname + url.search + url.hash;
  const cur = route.get();
  if (appPath === cur.path && url.search === cur.search && !opts.replace) {
    // same page: only the anchor changes
    if (url.hash && url.hash !== location.hash) { history.replaceState(history.state, '', real); }
    scrollToHash(url.hash);
    return;
  }
  if (opts.replace) {
    history.replaceState({ qgIdx: cur.idx }, '', real);
    route.set({ path: appPath, search: url.search });
  } else {
    const idx = cur.idx + 1;
    history.pushState({ qgIdx: idx }, '', real);
    writeMax(idx);
    route.set({ path: appPath, search: url.search, idx, max: idx });
  }
  if (url.hash) scrollToHash(url.hash); else window.scrollTo({ top: 0 });
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    const idx = e.state && typeof e.state.qgIdx === 'number' ? e.state.qgIdx : 0;
    route.set((r) => ({ ...r, path: toApp(location.pathname), search: location.search, idx, max: Math.max(r.max, idx) }));
  });
  // Delegate same-origin <a href> clicks to the router (keeps deep links as real anchors).
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a || a.target || a.hasAttribute('download') || a.getAttribute('rel') === 'external') return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href)) return;
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || toApp(url.pathname).startsWith('/api/') || /\.[a-z0-9]{2,5}$/i.test(url.pathname)) return; // API and static files load normally
    e.preventDefault();
    navigate(toApp(url.pathname) + url.search + url.hash);
  });
}

export const canGoBack = (r: RouteState) => r.idx > 0;
export const canGoForward = (r: RouteState) => r.idx < r.max;
export function goBack() { if (canGoBack(route.get())) history.back(); }
export function goForward() { if (canGoForward(route.get())) history.forward(); }

export function useRoute() {
  return useStore(route);
}

export function queryParam(name: string): string | null {
  return new URLSearchParams(route.get().search).get(name);
}
