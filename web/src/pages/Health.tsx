/** System health: server status, connectivity, service-worker caches, local storage and device capabilities. */
import { useEffect, useState } from 'preact/hooks';
import { useApiGet, apiGet, apiBase } from '../lib/api';
import type { HealthInfo } from '../lib/api';
import { useStore, net } from '../lib/store';
import { Card, ErrorBox, Loading, SourceChip, StatusBadge, KV, DataTable, PageHead, Btn } from '../components/ui';
import { fmtTime, fmtDuration, fmtQ } from '../lib/format';
import { webglAvailable } from '../three/detect';
import { askServiceWorker } from './f5-shared';
import { anchorVerdict, type AnchorsResp } from '../lib/evidence';

/** Short status of the external ledger anchors, linking to the full panel in Suite 18. */
function AnchorStatus() {
  const r = useApiGet<AnchorsResp>('/api/evidence/anchors');
  const d = r.data && typeof r.data === 'object' && Array.isArray(r.data.anchors) ? r.data : null;
  const v = anchorVerdict(d?.verification);
  const last = d?.anchors.length ? d.anchors[d.anchors.length - 1] : null;
  return (
    <Card title="Evidence ledger anchors" actions={<SourceChip source={r.source} cachedAt={r.cachedAt} />}>
      {r.loading && !d && <Loading />}
      <ErrorBox error={r.error} what="reading the ledger anchors" />
      {d && (
        <KV rows={[
          ['Verification', <span class={`badge ${v.ok ? 'b-ok' : 'b-bad'}`}>{v.text}</span>],
          ['Anchors', d.anchors.length ? `${d.anchors.length} (latest: entry #${last!.ledger_index}, ${fmtTime(last!.created_utc)})` : 'none published yet'],
          ['Object store', d.remote_available ? 'reachable' : `not reachable${d.remote_error ? ` (${d.remote_error})` : ''}`],
        ]} />
      )}
      {v.problems.length > 0 && <ul class="tight small">{v.problems.map((x) => <li>{x}</li>)}</ul>}
      <p class="small"><a href="/suite/evidence#anchors">Open the anchors panel (download, verify archived anchors) →</a></p>
    </Card>
  );
}

interface CacheInfo { version: string; shell: number; lazy: number; api: number; lazyTotal?: number; shellTotal?: number }

function Latency() {
  const [ms, setMs] = useState<number | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setErr(null);
    const t0 = performance.now();
    try { await apiGet('/api/health', undefined, { noCache: true }); setMs(performance.now() - t0); } catch (e) { setErr(e); setMs(null); } finally { setBusy(false); }
  };
  useEffect(() => { run(); }, []);
  return (
    <div>
      <div class="row"><span>Round-trip latency (GET /api/health, uncached): <b>{ms != null ? `${ms.toFixed(1)} ms` : '—'}</b></span><Btn busy={busy} onClick={run}>Measure again</Btn></div>
      <ErrorBox error={err} what="measuring latency" />
    </div>
  );
}

export default function Page(_props: any) {
  const h = useApiGet<HealthInfo>('/api/health');
  const n = useStore(net);
  const [ci, setCi] = useState<CacheInfo | null | 'none'>(null);
  const [swState, setSwState] = useState('checking');
  const [est, setEst] = useState<{ usage?: number; quota?: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const gl = webglAvailable();

  const refreshSW = async () => {
    if (!('serviceWorker' in navigator)) { setSwState('not supported by this browser'); setCi('none'); return; }
    const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
    setSwState(reg ? (navigator.serviceWorker.controller ? 'active and controlling this page' : 'registered, not yet controlling this page (reload)') : 'not registered (development server or first visit)');
    const info = await askServiceWorker<CacheInfo>({ type: 'GET_CACHE_INFO' });
    setCi(info ?? 'none');
  };
  useEffect(() => {
    refreshSW();
    navigator.storage?.estimate?.().then(setEst).catch(() => setEst(null));
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, []);

  const d = h.data;
  return (
    <div class="stack">
      <PageHead title="System health" sub="Live status of the QG-DEVS server and of this device. Nothing here is estimated: each value is read from the server or the browser.">
        <SourceChip source={h.source} cachedAt={h.cachedAt} />
        <Btn onClick={h.reload}>Refresh</Btn>
      </PageHead>
      <div class="grid-2">
        <Card title="Server">
          {h.loading && !d && <Loading />}
          <ErrorBox error={h.error} what="reading /api/health" />
          {h.source === 'cache' && <p class="small muted">This status is a cached copy, not a fresh reading.</p>}
          {d && (
            <KV rows={[
              ['Status', <StatusBadge status={d.status} />], ['Version', d.version], ['Uptime', fmtDuration(Number(d.uptime_s))],
              ['Jobs', Object.entries(d.jobs ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'none'],
              ['Native C++ kernel', d.native_kernel?.available ? <span class="badge b-ok">available</span> : <><span class="badge b-neutral">unavailable</span> {d.native_kernel?.reason && <span class="small muted">{d.native_kernel.reason}</span>}</>],
              ['Language-model providers', Object.entries(d.llm?.providers ?? {}).map(([k, v]: [string, any]) => `${k === 'anthropic' ? 'Anthropic API' : k === 'ollama' ? 'Local model (Ollama)' : k}: ${v.configured ? 'configured' : 'not configured'}`).join(' · ') || '—'],
              ['Language model default', d.llm?.default ?? '—'],
            ]} />
          )}
        </Card>
        <Card title="Connectivity">
          <KV rows={[
            ['Browser', n.online ? <span class="badge b-ok">online</span> : <span class="badge b-bad">offline</span>],
            ['API base URL', apiBase() || <span>same origin (<code>{location.origin}</code>)</span>],
          ]} />
          <div style={{ marginTop: '8px' }}><Latency /></div>
        </Card>
      </div>
      <AnchorStatus />
      {d?.schedule_last_run && (
        <Card title="Scheduled ingestion and verification (last run)">
          <DataTable head={['Schedule', 'Last run (UTC → local)']} rows={Object.entries(d.schedule_last_run).map(([k, v]) => [k, fmtTime(v as string)])} />
        </Card>
      )}
      <div class="grid-2">
        <Card title="Offline cache (service worker)" actions={<button type="button" class="btn-sm" onClick={refreshSW}>Refresh</button>}>
          <KV rows={[
            ['Service worker', swState],
            ['Cache version', ci && ci !== 'none' ? <code>{ci.version}</code> : '—'],
            ['App shell files', ci && ci !== 'none' ? `${ci.shell}${ci.shellTotal != null ? ` / ${ci.shellTotal}` : ''}` : '—'],
            ['Lazy page chunks', ci && ci !== 'none' ? `${ci.lazy}${ci.lazyTotal != null ? ` / ${ci.lazyTotal}` : ''}` : '—'],
            ['Cached API responses', ci && ci !== 'none' ? String(ci.api) : '—'],
          ]} />
          {ci === 'none' && <p class="small muted">No service worker controls this page, so cache counts are unavailable.</p>}
        </Card>
        <Card title="This device">
          <KV rows={[
            ['Storage used / quota', est?.quota ? `${fmtQ(est.usage ?? 0, 'B', 3)} / ${fmtQ(est.quota, 'B', 3)}` : 'not reported'],
            ['Persistent storage', persisted == null ? 'not reported' : persisted ? 'granted' : 'not granted (browser may evict offline data)'],
            ['WebGL (3-D views)', gl ? <span class="badge b-ok">available</span> : <span class="badge b-neutral">unavailable — 2-D fallbacks are used</span>],
            ['Logical CPU cores', String(navigator.hardwareConcurrency ?? 'not reported')],
            ['Device memory', (navigator as any).deviceMemory ? `${(navigator as any).deviceMemory} GB (approximate, browser-reported)` : 'not reported'],
            ['Pixel ratio', String(window.devicePixelRatio)],
          ]} />
          {navigator.storage?.persist && !persisted && (
            <Btn onClick={async () => { const ok = await navigator.storage.persist().catch(() => false); setPersisted(ok); }}>Request persistent storage</Btn>
          )}
        </Card>
      </div>
      <p class="small muted">Health data fetched {h.cachedAt ? fmtTime(h.cachedAt) : '—'}.</p>
    </div>
  );
}
