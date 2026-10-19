/** "Install app" button: uses beforeinstallprompt where supported, otherwise shows platform instructions. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { createStore, useStore } from '../lib/store';

interface BIPEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export const installState = createStore<{ deferred: BIPEvent | null; installed: boolean }>({
  deferred: null,
  installed: typeof window !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true),
});
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installState.set({ deferred: e as BIPEvent }); });
  window.addEventListener('appinstalled', () => installState.set({ deferred: null, installed: true }));
}

function platform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export function InstallButton() {
  const st = useStore(installState);
  const [open, setOpen] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dlg.current?.showModal?.(); else dlg.current?.close?.(); }, [open]);
  if (st.installed) return null;
  const click = async () => {
    if (st.deferred) {
      await st.deferred.prompt();
      const c = await st.deferred.userChoice.catch(() => null);
      installState.set({ deferred: null, installed: c?.outcome === 'accepted' });
    } else setOpen(true);
  };
  const p = platform();
  return (
    <>
      <button type="button" class="hdr-btn" onClick={click} title="Install QG-DEVS as an app (works offline)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
        <span class="lbl">Install app</span>
      </button>
      {open && (
        <dialog ref={dlg} class="card" style={{ maxWidth: '520px', color: 'var(--fg)' }} aria-labelledby="install-title" onClose={() => setOpen(false)}>
          <h2 id="install-title">Install QG-DEVS</h2>
          <p>Your browser has not offered an automatic install prompt{st.deferred ? '' : ' (it may not support it, or the app is already installed)'}. Install manually:</p>
          <div class={p === 'ios' ? 'card' : ''}><h3>iPhone / iPad (Safari)</h3><ol class="tight"><li>Tap the Share button.</li><li>Choose “Add to Home Screen”.</li><li>Tap “Add”.</li></ol></div>
          <div class={p === 'android' ? 'card' : ''}><h3>Android (Chrome, Edge, Samsung Internet)</h3><ol class="tight"><li>Open the browser menu (⋮).</li><li>Choose “Install app” or “Add to Home screen”.</li></ol></div>
          <div class={p === 'desktop' ? 'card' : ''}><h3>Desktop (Chrome, Edge)</h3><ol class="tight"><li>Click the install icon at the right of the address bar, or open the menu → “Install QG-DEVS…”.</li><li>Firefox and desktop Safari: use “Add to Dock” (Safari 17+) or keep a bookmark; the offline cache still works in the browser.</li></ol></div>
          <p class="small muted">Once installed, the app shell and every visited page work offline; data shown offline is always labelled with its cache time.</p>
          <form method="dialog"><button class="btn primary">Close</button></form>
        </dialog>
      )}
    </>
  );
}
