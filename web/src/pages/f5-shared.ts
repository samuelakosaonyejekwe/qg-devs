/** Helpers shared by the Dashboard, Jobs, Health, Settings and Help pages. */
import { apiUrl } from '../lib/api';
import { settings } from '../lib/store';
import type { QueuedRequest } from '../lib/queue';

/** Replay one queued POST against the configured API (bearer token from Settings, if any). */
export async function sendQueuedRequest(q: QueuedRequest): Promise<unknown> {
  const h: Record<string, string> = {};
  if (q.contentType) h['Content-Type'] = q.contentType;
  const tok = settings.get().apiToken.trim();
  if (tok) h.Authorization = `Bearer ${tok}`;
  const res = await fetch(apiUrl(q.path), { method: 'POST', headers: h, body: q.body ?? undefined });
  const text = await res.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

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
