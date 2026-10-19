/** Offline queue for state-changing API requests (jobs, preregistrations), persisted in IndexedDB. */
import { idbAll, idbDelete, idbGet, idbPut, newId } from './idb';
import { apiUrl } from './api';
import { settings } from './store';

export interface QueuedRequest {
  id: string;
  created: string;
  method: 'POST';
  /** Path relative to the API base, e.g. '/api/jobs'. */
  path: string;
  body: string | null;
  contentType: string | null;
  label: string;
  status: 'pending' | 'sending' | 'failed' | 'sent';
  attempts: number;
  error?: string;
  response?: unknown;
  sentAt?: string;
  /** Idempotency key sent as `Idempotency-Key` so a replayed request can be de-duplicated server-side. */
  idem?: string;
  /** Last attempt was rejected by the server with a non-retryable 4xx; not retried automatically. */
  permanent?: boolean;
  /** When status became 'sending' (recovers items stranded by a closed tab). */
  sendingSince?: number;
}

/** Thrown by a sender for a definitive server rejection (4xx other than 408/429). */
export class PermanentQueueError extends Error {}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const cb of listeners) {
    try { cb(); } catch { /* listener errors must not break the queue */ }
  }
}

export function onQueueChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export async function enqueue(path: string, body: string | null, label: string,
  contentType: string | null = 'application/json'): Promise<QueuedRequest> {
  const item: QueuedRequest = {
    id: newId(), created: new Date().toISOString(), method: 'POST', path, body, contentType, label,
    status: 'pending', attempts: 0, idem: newId(),
  };
  await idbPut('queue', item);
  notify();
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((r) => (r as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register('qg-queue'))
        .catch(() => {});
    }
  } catch { /* Background Sync unsupported */ }
  return item;
}

export async function listQueue(): Promise<QueuedRequest[]> {
  const all = await idbAll<QueuedRequest>('queue');
  return all.sort((a, b) => a.created.localeCompare(b.created));
}

export async function removeQueued(id: string): Promise<void> {
  await idbDelete('queue', id);
  notify();
}

let replaying: Promise<{ sent: number; failed: number }> | null = null;
const STALE_SENDING_MS = 2 * 60_000;

/** Run `fn` holding a cross-tab lock (Web Locks API); falls back to a localStorage lease. */
async function withQueueLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const locks = (typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined);
  if (locks?.request) {
    return locks.request('qg-queue-replay', { ifAvailable: true }, async (lock) => (lock ? fn() : null)) as Promise<T | null>;
  }
  const KEY = 'qg.queueLease';
  try {
    const lease = Number(localStorage.getItem(KEY) || 0);
    if (Date.now() - lease < 30_000) return null; // another tab is replaying
    localStorage.setItem(KEY, String(Date.now()));
  } catch { /* storage unavailable: proceed (single tab) */ }
  try { return await fn(); } finally { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
}

/**
 * Replays queued requests in creation order: pending, failed (unless permanently rejected, or
 * `includePermanent`), and items stranded in 'sending' by a closed tab. A cross-tab lock and a re-read of
 * each item's status before sending prevent duplicate submissions when several tabs or the online event
 * and a Background-Sync message trigger a replay at the same time. Sent items stay listed until removed.
 */
export function replayQueue(send: (q: QueuedRequest) => Promise<unknown>, opts: { includePermanent?: boolean } = {}): Promise<{ sent: number; failed: number }> {
  if (replaying) return replaying;
  replaying = (async () => {
    let sent = 0;
    let failed = 0;
    const res = await withQueueLock(async () => {
      const eligible = (q: QueuedRequest) => (q.status === 'pending' || (q.status === 'failed' && (!q.permanent || opts.includePermanent)) ||
        (q.status === 'sending' && Date.now() - (q.sendingSince ?? 0) > STALE_SENDING_MS));
      const items = (await listQueue()).filter(eligible);
      for (const q of items) {
        const cur = (await idbGet<QueuedRequest>('queue', q.id)) ?? null;
        if (!cur || !eligible(cur)) continue; // removed or handled meanwhile
        cur.status = 'sending';
        cur.sendingSince = Date.now();
        cur.attempts += 1;
        cur.idem = cur.idem ?? newId();
        await idbPut('queue', cur);
        notify();
        try {
          cur.response = await send(cur);
          cur.status = 'sent';
          cur.error = undefined;
          cur.permanent = false;
          cur.sentAt = new Date().toISOString();
          sent++;
        } catch (e) {
          cur.status = 'failed';
          cur.error = e instanceof Error ? e.message : String(e);
          cur.permanent = e instanceof PermanentQueueError;
          failed++;
        }
        await idbPut('queue', cur);
        notify();
      }
      return true;
    });
    void res;
    return { sent, failed };
  })().finally(() => { replaying = null; });
  return replaying;
}

/**
 * Send one queued POST against the configured API (bearer token from Settings, if any) with an
 * `Idempotency-Key`. Definitive 4xx rejections (other than 408/429) throw PermanentQueueError so the
 * request is not retried automatically; network failures and 5xx/429 stay retryable.
 */
export async function sendQueuedRequest(q: QueuedRequest): Promise<unknown> {
  const h: Record<string, string> = {};
  if (q.contentType) h['Content-Type'] = q.contentType;
  if (q.idem) h['Idempotency-Key'] = q.idem;
  const tok = settings.get().apiToken.trim();
  if (tok) h.Authorization = `Bearer ${tok}`;
  const res = await fetch(apiUrl(q.path), { method: 'POST', headers: h, body: q.body ?? undefined });
  const text = await res.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) {
    const d = data && typeof data === 'object' && 'detail' in (data as object) ? (data as { detail: unknown }).detail : data;
    const msg = `HTTP ${res.status}: ${typeof d === 'string' ? d : JSON.stringify(d).slice(0, 300)}`;
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new PermanentQueueError(msg);
    throw new Error(msg);
  }
  return data;
}
