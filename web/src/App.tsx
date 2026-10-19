import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useRoute, goBack, goForward, canGoBack, canGoForward } from './lib/router';
import { resolve } from './routes';
import { GROUPS, SUITES, TOOLS, suiteByN } from './lib/nav';
import { useStore, settings, net, applyTheme, type Mode, type Theme } from './lib/store';
import { listQueue, onQueueChange, replayQueue, type QueuedRequest } from './lib/queue';
import { apiUrl } from './lib/api';
import { InstallButton } from './components/Install';
import { ErrorBox } from './components/ui';
import { ResetScope } from './components/Reset';

const Arrow = ({ dir }: { dir: 'l' | 'r' }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {dir === 'l' ? <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></> : <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>}
  </svg>
);

function ThemeToggle() {
  const s = useStore(settings);
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const label = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' }[s.theme];
  return (
    <button type="button" class="hdr-btn" onClick={() => { const t = next[s.theme]; settings.set({ theme: t }); applyTheme(t); }} aria-label={`${label}. Activate to change.`} title={label}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">{s.theme === 'dark' ? <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" /> : s.theme === 'light' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></> : <><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></>}</svg>
      <span class="lbl">{s.theme === 'system' ? 'Auto' : s.theme === 'light' ? 'Light' : 'Dark'}</span>
    </button>
  );
}

function ModeSelect() {
  const s = useStore(settings);
  return (
    <label class="hide-sm" title="Detail level: changes how many inputs and how much detail are shown — never the accuracy of calculations.">
      <span class="sr-only">Detail level</span>
      <select class="mode-select" value={s.mode} onChange={(e: any) => settings.set({ mode: e.currentTarget.value as Mode })} aria-label="Detail level (Beginner, Advanced, Expert)">
        <option value="beginner">Beginner</option><option value="advanced">Advanced</option><option value="expert">Expert</option>
      </select>
    </label>
  );
}

function NetIndicator({ queue }: { queue: number }) {
  const n = useStore(net);
  return (
    <a class="hdr-btn" href="/jobs#queue" aria-label={`${n.online ? 'Online' : 'Offline'}${queue ? `, ${queue} queued request(s)` : ''}`} title={n.online ? 'Online' : 'Offline: showing cached data only'}>
      <span class={`net-dot ${n.online ? '' : 'off'}`} aria-hidden="true" />
      <span class="lbl">{n.online ? 'Online' : 'Offline'}</span>
      {queue > 0 && <span class="badge b-warn" style={{ background: '#fff3', color: '#fff' }}>{queue} queued</span>}
    </a>
  );
}

function SideNav({ path, open, close }: { path: string; open: boolean; close: () => void }) {
  return (
    <>
      {open && <div class="scrim" onClick={close} aria-hidden="true" />}
      <nav class={`sidenav ${open ? 'open' : ''}`} id="sidenav" aria-label="Main navigation" onClick={(e) => { if ((e.target as Element).closest('a')) close(); }}>
        <ul>{TOOLS.slice(0, 3).map((t) => <li><a href={t.path} aria-current={path === t.path ? 'page' : undefined}>{t.title}</a></li>)}</ul>
        {GROUPS.map((g) => (
          <div key={g.title}>
            <h2>{g.title}</h2>
            <ul>{g.suites.map((n) => { const s = suiteByN(n); const href = `/suite/${s.slug}`; return <li><a href={href} aria-current={path === href ? 'page' : undefined}><span class="num">{n}</span>{s.short}</a></li>; })}</ul>
          </div>
        ))}
        <h2>System</h2>
        <ul>{TOOLS.slice(3).map((t) => <li><a href={t.path} aria-current={path === t.path ? 'page' : undefined}>{t.title}</a></li>)}</ul>
      </nav>
    </>
  );
}

function Crumbs({ crumbs }: { crumbs: [string, string | null][] }) {
  return (
    <nav class="crumbs" aria-label="Breadcrumb">
      <ol>{crumbs.map(([t, h]) => <li>{h ? <a href={h}>{t}</a> : <span aria-current="page">{t}</span>}</li>)}</ol>
    </nav>
  );
}

const cache = new Map<string, ComponentType<any>>();

export function App() {
  const r = useRoute();
  const def = resolve(r.path);
  const [Comp, setComp] = useState<ComponentType<any> | null>(() => (def ? cache.get(r.path) ?? null : null));
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [queueN, setQueueN] = useState(0);
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  const n = useStore(net);

  useEffect(() => {
    setLoadErr(null);
    if (!def) { setComp(null); return; }
    document.title = `${def.title} — QG-DEVS`;
    const hit = cache.get(r.path);
    if (hit) { setComp(() => hit); return; }
    let alive = true;
    setComp(null);
    def.load().then((m) => { cache.set(r.path, m.default); if (alive) setComp(() => m.default); }).catch((e) => alive && setLoadErr(e));
    return () => { alive = false; };
  }, [r.path]);

  // move focus to the main heading after navigation (screen readers announce the new page)
  useEffect(() => { const h = document.querySelector('main h1') as HTMLElement | null; if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } }, [Comp]);

  // Alt+← / Alt+→ drive real browser history
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  // offline POST queue: badge + automatic replay when back online
  useEffect(() => {
    const refresh = () => listQueue().then((q) => setQueueN(q.filter((x: QueuedRequest) => x.status !== 'sent').length)).catch(() => setQueueN(0));
    refresh();
    const unsub = onQueueChange(refresh);
    const replay = () => replayQueue(sendQueued).then(refresh).catch(() => undefined);
    const unNet = net.subscribe((s) => { if (s.online) replay(); });
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'SYNC_QUEUE') replay(); };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    if (navigator.onLine) replay();
    return () => { unsub(); unNet(); navigator.serviceWorker?.removeEventListener('message', onMsg); };
  }, []);

  // service-worker update prompt
  useEffect(() => {
    const onUpd = (e: Event) => setUpdate((e as CustomEvent).detail as ServiceWorker);
    window.addEventListener('qg-sw-update', onUpd);
    return () => window.removeEventListener('qg-sw-update', onUpd);
  }, []);

  return (
    <>
      <a class="skip-link" href="#main">Skip to content</a>
      <header class="app-header">
        <button type="button" class="hist-btn menu-btn" aria-label="Open navigation" aria-expanded={navOpen} aria-controls="sidenav" onClick={() => setNavOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <a class="brand" href="/" aria-label="QG-DEVS dashboard"><img src="/icons/icon.svg" alt="" width="28" height="28" /><span>QG-DEVS</span></a>
        <div class="hist-nav">
          <button type="button" class="hist-btn" onClick={goBack} disabled={!canGoBack(r)} aria-label="Back (Alt+Left)" title="Back (Alt+←)"><Arrow dir="l" /></button>
          <button type="button" class="hist-btn" onClick={goForward} disabled={!canGoForward(r)} aria-label="Forward (Alt+Right)" title="Forward (Alt+→)"><Arrow dir="r" /></button>
        </div>
        <div class="header-spacer" />
        <div class="header-tools">
          <ModeSelect />
          <NetIndicator queue={queueN} />
          <InstallButton />
          <ThemeToggle />
        </div>
      </header>
      {!n.online && <div class="offline-bar" role="status">Offline — no fresh data can be fetched. Cached responses are labelled “cached at …”; the BMV prediction falls back to the local engine; job submissions and preregistrations are queued on this device.</div>}
      {update && <div class="update-bar" role="status">A new version of QG-DEVS is available. <button type="button" class="btn-sm" onClick={() => { update.postMessage({ type: 'SKIP_WAITING' }); }}>Reload to update</button></div>}
      <div class="layout">
        <SideNav path={r.path} open={navOpen} close={() => setNavOpen(false)} />
        <main id="main">
          {def && <Crumbs crumbs={def.crumbs} />}
          {!def && <NotFound path={r.path} />}
          {loadErr ? <ErrorBox error={loadErr} what="loading this page (if you are offline, the page may not have been cached yet)" /> : null}
          {def && !Comp && !loadErr && <div class="row muted" role="status"><span class="spinner" /> Loading…</div>}
          {def && Comp && <ResetScope key={r.path}><Comp {...(def.props ?? {})} /></ResetScope>}
        </main>
      </div>
    </>
  );
}

function NotFound({ path }: { path: string }) {
  return (
    <div class="card">
      <h1>Page not found</h1>
      <p>No page exists at <code>{path}</code>.</p>
      <p>Go to the <a href="/">dashboard</a> or one of the suites:</p>
      <ul class="tight">{SUITES.map((s) => <li><a href={`/suite/${s.slug}`}>{s.n}. {s.name}</a></li>)}</ul>
    </div>
  );
}

/** Replay one queued POST against the configured API (auth header from settings). */
async function sendQueued(q: QueuedRequest): Promise<unknown> {
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
