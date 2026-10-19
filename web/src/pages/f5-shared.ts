/** Helpers shared by the Dashboard, Jobs, Health, Settings and Help pages. */

export { sendQueuedRequest } from '../lib/queue';

export function downloadJSON(obj: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = filename; a.rel = 'external';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

/** Ask the active service worker a question over a MessageChannel; resolves null when no SW controls the page. */
export function askServiceWorker<T>(msg: unknown, timeoutMs = 3000): Promise<T | null> {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve(null);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => resolve(null), timeoutMs);
    ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data as T); };
    sw.postMessage(msg, [ch.port2]);
  });
}

export function isHttpUrl(s: string): boolean {
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}
