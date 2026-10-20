import { render } from 'preact';
import './styles.css';
import { App } from './App';
import { BASE, installBaseRewriter } from './lib/base';
installBaseRewriter();
import { applyTheme, settings } from './lib/store';
import './components/Install';

applyTheme(settings.get().theme);
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(settings.get().theme));
} catch { /* old browsers */ }

render(<App />, document.getElementById('app')!);

/**
 * After a deploy, a page still running the previous index.html may request lazy chunks that no longer
 * exist. Reload once (fresh index.html, new chunk names); the session flag prevents reload loops.
 */
export function recoverFromStaleChunk(): boolean {
  try {
    if (!navigator.onLine || sessionStorage.getItem('qg.chunkReload')) return false;
    sessionStorage.setItem('qg.chunkReload', String(Date.now()));
  } catch { return false; }
  location.reload();
  return true;
}
window.addEventListener('vite:preloadError', (e) => { if (recoverFromStaleChunk()) e.preventDefault(); });
// a successful session start clears the guard after a short grace period
setTimeout(() => { try { sessionStorage.removeItem('qg.chunkReload'); } catch { /* ignore */ } }, 15000);
/**
 * Keyboard access to scrolling regions (WCAG 2.1.1): any table wrapper, display formula or code block that
 * actually overflows becomes focusable (tabindex 0, labelled region) so it can be scrolled with the keyboard;
 * the attribute is removed again when the content fits. Covers content rendered by every page and by KaTeX.
 */
function syncScrollableRegions() {
  for (const el of document.querySelectorAll<HTMLElement>('.table-wrap, .tex-display, pre.code, .eq-list')) {
    const scrolls = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    if (scrolls && !el.hasAttribute('tabindex')) {
      el.setAttribute('tabindex', '0'); el.dataset.qgScrollFocus = '1';
      if (!el.getAttribute('role')) el.setAttribute('role', 'region');
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.classList.contains('tex-display') ? `Formula: ${el.getAttribute('title') ?? 'scrollable'}` : 'Scrollable content');
    } else if (!scrolls && el.dataset.qgScrollFocus) {
      el.removeAttribute('tabindex'); delete el.dataset.qgScrollFocus;
    }
  }
}
// throttled: animations mutate the DOM every frame, so layout is read at most twice per second
let scrollSyncTimer: ReturnType<typeof setTimeout> | undefined;
const scheduleScrollSync = () => { if (scrollSyncTimer) return; scrollSyncTimer = setTimeout(() => { scrollSyncTimer = undefined; syncScrollableRegions(); }, 500); };
new MutationObserver(scheduleScrollSync).observe(document.getElementById('app')!, { childList: true, subtree: true });
window.addEventListener('resize', scheduleScrollSync);

// surface unhandled promise rejections in the console with context instead of failing silently
window.addEventListener('unhandledrejection', (e) => { console.warn('QG-DEVS: unhandled promise rejection', e.reason); });

// Service worker: only in production builds (sw.js is emitted by the build).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE }).then((reg) => {
      const announce = (w: ServiceWorker | null) => { if (w) window.dispatchEvent(new CustomEvent('qg-sw-update', { detail: w })); };
      if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) announce(w); });
      });
      // Reload only when an *existing* controller is replaced (user accepted an update), not on first install.
      const hadController = !!navigator.serviceWorker.controller;
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
    }).catch(() => { /* SW unavailable (e.g. private mode); app still works online */ });
  });
}
