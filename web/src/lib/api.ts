/**
 * HTTP client for the QG-DEVS API.
 *
 * Base URL: Settings → API base URL, else VITE_API_BASE at build time, else same origin.
 * GET responses may be served by the service worker's runtime cache; the SW marks them with
 * `x-qg-source: cache|network|offline` and `x-qg-cached-at`, which every caller receives so the UI can
 * show "cached at …" instead of pretending the data is fresh.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { settings, net } from './store';

export type Source = 'network' | 'cache' | 'offline' | 'local';

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown, public offline = false) {
    super(typeof detail === 'string' ? detail : detailText(detail) || `HTTP ${status}`);
  }
}

function detailText(d: unknown): string {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => (x && typeof x === 'object' && 'msg' in x ? `${(x as any).loc?.slice(1).join('.') ?? ''}: ${(x as any).msg}` : JSON.stringify(x))).join('; ');
  if (typeof d === 'object') {
    const o = d as Record<string, unknown>;
    if ('detail' in o) return detailText(o.detail);
    if ('admissibility_issues' in o) return (o.admissibility_issues as string[]).join('; ');
    return JSON.stringify(d);
  }
  return String(d);
}

export function apiBase(): string {
  const s = settings.get().apiBase.trim();
  const env = (import.meta as any).env?.VITE_API_BASE as string | undefined;
  return (s || env || '').replace(/\/+$/, '');
}

export function apiUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
  let u = apiBase() + path;
  if (query) {
    const q = Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    if (q) u += (u.includes('?') ? '&' : '?') + q;
  }
  return u;
}

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const tok = settings.get().apiToken.trim();
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

export interface Fetched<T> { data: T; source: Source; cachedAt: string | null; receivedAt: string }

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

async function doFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    throw new ApiError(0, `network error: ${(e as Error).message || 'unreachable'}`, true);
  }
}

function sourceOf(res: Response): Source {
  const s = res.headers.get('x-qg-source');
  return s === 'cache' || s === 'offline' ? s : 'network';
}

export async function apiGet<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined>, opts: { noCache?: boolean } = {}): Promise<Fetched<T>> {
  const h = headers(false);
  if (opts.noCache) h['x-qg-no-cache'] = '1';
  const res = await doFetch(apiUrl(path, query), { headers: h });
  const body = await parse(res);
  let src = sourceOf(res);
  const cachedAt = res.headers.get('x-qg-cached-at');
  if (!res.ok) throw new ApiError(res.status, body, src === 'offline' || res.status === 503 && !!(body as any)?.offline);
  // A copy the service worker fetched from the server within the last 10 s (background revalidation) is live data.
  if (src === 'cache' && cachedAt && navigator.onLine && Date.now() - Date.parse(cachedAt) < 10_000) src = 'network';
  return { data: body as T, source: src, cachedAt, receivedAt: new Date().toISOString() };
}

export async function apiPost<T = unknown>(path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const res = await doFetch(apiUrl(path, query), { method: 'POST', headers: headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, data, sourceOf(res) === 'offline');
  return data as T;
}

/** POST returning a binary/text payload (exports, packages). */
export async function apiPostBlob(path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>): Promise<Blob> {
  const res = await doFetch(apiUrl(path, query), { method: 'POST', headers: headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new ApiError(res.status, await parse(res), sourceOf(res) === 'offline');
  return res.blob();
}

export async function apiUpload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await doFetch(apiUrl(path), { method: 'POST', headers: headers(false), body: form });
  const data = await parse(res);
  if (!res.ok) throw new ApiError(res.status, data, sourceOf(res) === 'offline');
  return data as T;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'external';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Non-finite floats come back from the API as null / "Infinity" / "-Infinity". */
export function num(x: unknown): number {
  if (typeof x === 'number') return x;
  if (x === 'Infinity') return Infinity;
  if (x === '-Infinity') return -Infinity;
  if (x == null) return NaN;
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}

export function isOfflineError(e: unknown): boolean {
  return e instanceof ApiError && (e.offline || e.status === 0);
}

// ----------------------------------------------------------------------------- hooks
export interface ApiState<T> {
  data: T | null; error: ApiError | null; loading: boolean; source: Source | null; cachedAt: string | null; reload: () => void;
}

/** GET with loading/error state; re-fetches when the SW reports a background refresh of the same URL. */
export function useApiGet<T = unknown>(path: string | null, query?: Record<string, string | number | boolean | undefined>): ApiState<T> {
  const [st, setSt] = useState<Omit<ApiState<T>, 'reload'>>({ data: null, error: null, loading: !!path, source: null, cachedAt: null });
  const [tick, setTick] = useState(0);
  const qs = JSON.stringify(query || {});
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    apiGet<T>(path, query)
      .then((r) => alive && setSt({ data: r.data, error: null, loading: false, source: r.source, cachedAt: r.cachedAt }))
      .catch((e) => alive && setSt((s) => ({ ...s, error: e instanceof ApiError ? e : new ApiError(0, String(e)), loading: false })));
    return () => { alive = false; };
  }, [path, qs, tick]);
  // Refresh when the service worker revalidated this URL in the background, or when coming back online.
  const urlRef = useRef('');
  urlRef.current = path ? apiUrl(path, query) : '';
  useEffect(() => {
    if (!path) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'API_REFRESHED' && typeof e.data.url === 'string' && new URL(e.data.url, location.href).href === new URL(urlRef.current, location.href).href) reload();
    };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    const unsub = net.subscribe((n) => { if (n.online) reload(); });
    return () => { navigator.serviceWorker?.removeEventListener('message', onMsg); unsub(); };
  }, [path, reload]);
  return { ...st, reload };
}

// ----------------------------------------------------------------------------- jobs
export interface Job {
  id: string; type: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number | null; message: string; created: string; started: string | null; finished: string | null;
  attempts: number; error: string | null; params?: Record<string, unknown>; result?: any;
}

export async function submitJob(type: string, params: Record<string, unknown>): Promise<{ id: string }> {
  return apiPost<{ id: string }>('/api/jobs', { type, params });
}

export async function getJob(id: string): Promise<Job> {
  return (await apiGet<Job>(`/api/jobs/${encodeURIComponent(id)}`, undefined, { noCache: true })).data;
}

export async function cancelJob(id: string) {
  return apiPost(`/api/jobs/${encodeURIComponent(id)}/cancel`);
}

/** Poll a job until it reaches a terminal state; returns a stop function. */
export function pollJob(id: string, onUpdate: (j: Job) => void, onError: (e: ApiError) => void, intervalMs = 1500): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped) return;
    try {
      const j = await getJob(id);
      if (stopped) return;
      onUpdate(j);
      if (j.status === 'queued' || j.status === 'running') timer = setTimeout(tick, intervalMs);
    } catch (e) {
      if (stopped) return;
      onError(e instanceof ApiError ? e : new ApiError(0, String(e)));
      timer = setTimeout(tick, intervalMs * 3);
    }
  };
  tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
