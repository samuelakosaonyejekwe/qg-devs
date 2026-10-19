/** Offline queue for state-changing API requests (jobs, preregistrations), persisted in IndexedDB. */
import { idbAll, idbDelete, idbGet, idbPut, newId } from './idb';

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
}

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
    status: 'pending', attempts: 0,
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

/** Replays pending and failed requests in creation order. Sent items stay listed (status 'sent') until removed. */
export function replayQueue(send: (q: QueuedRequest) => Promise<unknown>): Promise<{ sent: number; failed: number }> {
  if (replaying) return replaying;
  replaying = (async () => {
    let sent = 0;
    let failed = 0;
    const items = (await listQueue()).filter((q) => q.status === 'pending' || q.status === 'failed');
    for (const q of items) {
      const cur = (await idbGet<QueuedRequest>('queue', q.id)) ?? q;
      cur.status = 'sending';
      cur.attempts += 1;
      await idbPut('queue', cur);
      notify();
      try {
        cur.response = await send(cur);
        cur.status = 'sent';
        cur.error = undefined;
        cur.sentAt = new Date().toISOString();
        sent++;
      } catch (e) {
        cur.status = 'failed';
        cur.error = e instanceof Error ? e.message : String(e);
        failed++;
      }
      await idbPut('queue', cur);
      notify();
    }
    return { sent, failed };
  })().finally(() => { replaying = null; });
  return replaying;
}
