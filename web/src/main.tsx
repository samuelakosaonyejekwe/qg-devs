import { render } from 'preact';
import './styles.css';
import { App } from './App';
import { applyTheme, settings } from './lib/store';
import './components/Install';

applyTheme(settings.get().theme);
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(settings.get().theme));
} catch { /* old browsers */ }

render(<App />, document.getElementById('app')!);

// Service worker: only in production builds (sw.js is emitted by the build).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
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
