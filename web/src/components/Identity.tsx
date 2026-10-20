/**
 * Identity bound to the API token configured in Settings (GET /api/auth/whoami).
 *
 * Evidence-writing actions (preregistration, dataset ingest, unblinding, sign-off) are recorded by the server
 * under the identity of the presented token — never a free-text name — so every form shows who it will act
 * as and is disabled when the token cannot write. The token itself is never displayed; only the server's
 * fingerprint (first 12 hex of its SHA-256).
 */
import { useEffect, useState } from 'preact/hooks';
import { apiGet, ApiError, isOfflineError } from '../lib/api';
import { useStore, settings } from '../lib/store';

export interface Whoami { role: string; name: string; token_id: string | null; verified: boolean; can_write_evidence: boolean }

export type IdentityKind = 'loading' | 'verified' | 'unverified' | 'public' | 'invalid' | 'offline' | 'error';

/** Classify the whoami response (or its error) for display. Pure: unit-tested. */
export function identityKind(w: Whoami | null, err: unknown, loading: boolean): IdentityKind {
  if (loading && !w && !err) return 'loading';
  if (err) {
    if (isOfflineError(err)) return 'offline';
    if (err instanceof ApiError && (err.status === 403 || err.status === 401)) return 'invalid';
    return 'error';
  }
  if (!w) return 'loading';
  if (w.role === 'public') return 'public';
  return w.verified ? 'verified' : 'unverified';
}

/**
 * Whether the identity may perform an action restricted to `roles`. Offline the server decides later
 * (actions are queued or fail with a clear message), so the form stays usable; unknown errors likewise.
 */
export function canAct(kind: IdentityKind, w: Whoami | null, roles: string[] = ['researcher']): boolean {
  if (kind === 'offline' || kind === 'error' || kind === 'loading') return true;
  if (kind === 'public' || kind === 'invalid' || !w) return false;
  return w.role === 'admin' || roles.includes(w.role);
}

/** "…a1b2c3d4e5f6" — the server's token fingerprint, never the token. */
export const tokenTail = (id: string | null) => (id ? `…${id}` : '');

export function useWhoami() {
  const s = useStore(settings);
  const [state, setState] = useState<{ w: Whoami | null; err: unknown; loading: boolean }>({ w: null, err: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setState((st) => ({ ...st, loading: true, err: null }));
    apiGet<Whoami>('/api/auth/whoami', undefined, { noCache: true, signal: ac.signal })
      .then((r) => { if (!ac.signal.aborted) setState({ w: r.data, err: null, loading: false }); })
      .catch((e) => { if (!ac.signal.aborted) setState({ w: null, err: e, loading: false }); });
    return () => ac.abort();
  }, [s.apiToken, s.apiBase, tick]);
  const kind = identityKind(state.w, state.err, state.loading);
  return { ...state, kind, reload: () => setTick((t) => t + 1) };
}

export type WhoamiState = ReturnType<typeof useWhoami>;

/** "Acting as" line for an evidence-writing form. `roles` are the roles the endpoint accepts. */
export function ActingAs({ id, verb = 'Signing as', roles = ['researcher'], what = 'this action' }: { id: WhoamiState; verb?: string; roles?: string[]; what?: string }) {
  const { w, kind } = id;
  if (kind === 'loading') return <p class="small muted acting-as" role="status">Checking the identity bound to your access token…</p>;
  if (kind === 'offline') return <p class="small muted acting-as" role="status">Identity unknown: the server is unreachable. The server will check your access token when the request is sent.</p>;
  if (kind === 'error') return <p class="small muted acting-as" role="status">Could not check your identity right now; the server will check your access token when you submit.</p>;
  if (kind === 'public' || kind === 'invalid') {
    return (
      <div class="notice notice-access acting-as" role="note" data-notice="access">
        <div class="notice-title"><span aria-hidden="true">🔒</span> Researcher access required</div>
        <p>{kind === 'invalid' ? 'The access token in Settings was not accepted by the server.' : 'No researcher access token is configured on this device.'} {what[0].toUpperCase() + what.slice(1)} writes to the permanent evidence record under the identity bound to your token.</p>
        <p class="small muted">Viewing results and running computations are open to everyone.</p>
        <a class="btn" href="/settings#api-token">Open Settings → API token</a>
      </div>
    );
  }
  const allowed = canAct(kind, w, roles);
  return (
    <div class="acting-as row small" role="status" data-acting-as>
      <span>{verb} <strong>{w!.name}</strong>{w!.token_id ? <> (token <code title="Fingerprint of your token (first 12 hex of SHA-256); the token itself is never shown">{tokenTail(w!.token_id)}</code>)</> : null}</span>
      {kind === 'verified'
        ? <span class="badge b-ok" title="The server matched your token to this registered identity">identity verified</span>
        : <span class="badge b-warn" title="This server runs without access tokens (development mode): the name is not bound to a verified person">not verified (development server)</span>}
      {!allowed && <span class="badge b-bad">role “{w!.role}” cannot perform {what}</span>}
    </div>
  );
}
