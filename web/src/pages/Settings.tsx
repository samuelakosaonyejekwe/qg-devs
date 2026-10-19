import { resetAllSavedInputs } from '../lib/resetAll';
/** Settings: detail level, theme, API endpoint and token, opt-in browser compute, motion and local data. */
import { useState } from 'preact/hooks';
import { useStore, settings, applyTheme, type Mode, type Theme, type Settings as S } from '../lib/store';
import { apiBase } from '../lib/api';
import { idbClear } from '../lib/idb';
import { Card, Seg, Switch, Btn, PageHead, ErrorBox, InfoBanner, Tip } from '../components/ui';
import { NumberField, useValidity } from '../components/fields';
import { askServiceWorker, downloadJSON, isHttpUrl } from './f5-shared';

function ApiSection() {
  const s = useStore(settings);
  const [draft, setDraft] = useState(s.apiBase);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const envBase = (import.meta as any).env?.VITE_API_BASE as string | undefined;
  const valid = draft.trim() === '' || isHttpUrl(draft.trim());
  const testIt = async () => {
    setBusy(true); setTest(null);
    const base = (draft.trim() || envBase || '').replace(/\/+$/, '');
    const t0 = performance.now();
    try {
      const res = await fetch(`${base}/api/health`, { headers: { 'x-qg-no-cache': '1' } });
      const ms = performance.now() - t0;
      const j = await res.json().catch(() => null);
      if (!res.ok || !j || j.status !== 'ok') setTest({ ok: false, text: `HTTP ${res.status}: ${j ? JSON.stringify(j).slice(0, 200) : 'not a QG-DEVS health response'}` });
      else setTest({ ok: true, text: `QG-DEVS API version ${j.version} reachable in ${ms.toFixed(0)} ms.` });
    } catch (e) { setTest({ ok: false, text: `unreachable: ${(e as Error).message}` }); } finally { setBusy(false); }
  };
  return (
    <Card title="API endpoint">
      <p class="small muted">Leave empty to use the same origin as this page{envBase ? <> (this build sets <code>VITE_API_BASE = {envBase}</code>, which is used when the field is empty)</> : ''}. Mirrored static copies of the app can point at a cloud API here. Currently in use: <code>{apiBase() || location.origin}</code>.</p>
      <div class={`field ${valid ? '' : 'invalid'}`}>
        <label class="field-label" for="api-base">API base URL <Tip text="Base URL of a QG-DEVS server, e.g. https://qgdevs.example.org. All requests go to <base>/api/…; the server must allow this origin (CORS)." /></label>
        <div class="field-input"><input id="api-base" value={draft} placeholder="https://… (empty = same origin)" aria-invalid={!valid} onInput={(e: any) => setDraft(e.currentTarget.value)} /></div>
        {!valid && <div class="field-error">Enter an http:// or https:// URL, or leave empty.</div>}
      </div>
      <div class="row">
        <Btn kind="primary" disabled={!valid || draft.trim() === s.apiBase} onClick={() => settings.set({ apiBase: draft.trim().replace(/\/+$/, '') })}>Save</Btn>
        <Btn busy={busy} disabled={!valid} onClick={testIt}>Test connection</Btn>
      </div>
      {test && <p role="status" class="small" style={{ color: test.ok ? 'var(--ok)' : 'var(--danger)' }}>{test.text}</p>}
      {(() => { try { const t = draft.trim() || s.apiBase; return t && new URL(t).origin !== location.origin; } catch { return false; } })() && (
        <p class="small muted" role="note">Cross-origin API: the site hosting this app must allow that origin in its Content-Security-Policy <code>connect-src</code> (the default production policy allows only <code>'self'</code>), and the API must send CORS headers for this origin. Otherwise every request is blocked by the browser.</p>
      )}
      <div class="field" style={{ marginTop: '12px' }}>
        <label class="field-label" for="api-token">API bearer token (optional) <Tip text="Only needed when the server sets QGDEVS_API_TOKENS. It is stored in this browser's local storage and sent only as an Authorization header to the configured API base URL." /></label>
        <div class="field-input"><input id="api-token" type="password" autoComplete="off" value={s.apiToken} onInput={(e: any) => settings.set({ apiToken: e.currentTarget.value })} /></div>
        <div class="field-hint">Stored locally on this device only.</div>
      </div>
    </Card>
  );
}

function DataSection() {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const clear = async (store: 'projects' | 'results' | 'queue', what: string) => {
    if (!confirm(`Permanently delete all ${what} stored on this device?`)) return;
    try { await idbClear(store); setMsg(`Cleared ${what}.`); } catch (e) { setErr(e); }
  };
  const importSettings = (file: File) => {
    file.text().then((t) => {
      const j = JSON.parse(t) as Partial<S>;
      const allowed: (keyof S)[] = ['mode', 'theme', 'apiBase', 'browserCompute', 'computeTimeLimitS', 'computeMaxCells', 'reducedMotion'];
      const next: Partial<S> = {};
      for (const k of allowed) if (k in j) (next as any)[k] = (j as any)[k];
      if (next.apiBase && !isHttpUrl(next.apiBase)) delete next.apiBase;
      settings.set(next);
      if (next.theme) applyTheme(next.theme);
      setMsg('Settings imported (the API token is never imported or exported).');
    }).catch((e) => setErr(e));
  };
  return (
    <Card title="Data on this device">
      <div class="row">
        <Btn onClick={async () => { const r = await askServiceWorker<{ ok: boolean }>({ type: 'CLEAR_API_CACHE' }); setMsg(r ? 'Cached API responses cleared.' : 'No service worker is active, so there is no API cache to clear.'); }}>Clear cached API responses</Btn>
        <Btn kind="danger" onClick={() => clear('projects', 'saved projects')}>Clear saved projects</Btn>
        <Btn kind="danger" onClick={() => clear('results', 'saved results')}>Clear saved results</Btn>
        <Btn kind="danger" onClick={() => clear('queue', 'queued offline requests')}>Clear offline queue</Btn>
      </div>
      <div class="row" style={{ marginTop: '10px' }}>
        <Btn onClick={() => { const { apiToken: _t, ...rest } = settings.get(); downloadJSON(rest, 'qgdevs-settings.json'); }}>Export settings</Btn>
        <label class="btn">Import settings<input type="file" accept="application/json,.json" class="sr-only" onChange={(e: any) => { const f = e.currentTarget.files?.[0]; if (f) importSettings(f); }} /></label>
      </div>
      <div class="row" style={{ marginTop: '10px' }}>
        <Btn kind="danger" data-reset-all onClick={() => {
          if (!confirm('Reset all saved inputs? The shared design/environment returns to the reference defaults and remembered job/preregistration/dataset bindings are forgotten. Preferences (theme, detail level, API settings) and saved projects are kept.')) return;
          const n = resetAllSavedInputs();
          setMsg(`All saved inputs reset (${n} remembered binding(s) cleared; shared scenario restored to defaults).`);
        }}>Reset all saved inputs</Btn>
      </div>
      {msg && <p class="small" role="status">{msg}</p>}
      <ErrorBox error={err} what="updating local data" />
    </Card>
  );
}

export default function Page(_props: any) {
  const s = useStore(settings);
  const v = useValidity();
  return (
    <div class="stack">
      <PageHead title="Settings" sub="Preferences are stored in this browser only." />
      <Card title="Detail level">
        <Seg<Mode> label="Detail level" value={s.mode} onChange={(m) => settings.set({ mode: m })}
          options={[{ v: 'beginner', label: 'Beginner' }, { v: 'advanced', label: 'Advanced' }, { v: 'expert', label: 'Expert' }]} />
        <p class="small muted" style={{ marginTop: '8px' }}>The detail level only changes how many inputs and how much supporting detail are shown (for example separate masses, temperatures, density overrides, raw matrices). It never changes the models, numerical methods or accuracy of any calculation; hidden inputs keep their values and are always used.</p>
      </Card>
      <Card title="Appearance">
        <div class="row">
          <Seg<Theme> label="Theme" value={s.theme} onChange={(t) => { settings.set({ theme: t }); applyTheme(t); }}
            options={[{ v: 'system', label: 'System' }, { v: 'light', label: 'Light' }, { v: 'dark', label: 'Dark' }]} />
          <Seg<'system' | 'on' | 'off'> label="Reduced motion" value={s.reducedMotion} onChange={(m) => settings.set({ reducedMotion: m })}
            options={[{ v: 'system', label: 'Motion: system' }, { v: 'on', label: 'Reduce motion' }, { v: 'off', label: 'Allow motion' }]} />
        </div>
        <p class="small muted" style={{ marginTop: '8px' }}>With reduced motion, animations never start by themselves; they advance only when you press Play or move the time slider.</p>
      </Card>
      <ApiSection />
      <Card title="Browser compute (opt-in)">
        <InfoBanner>When enabled, some parameter sweeps can run in a background Web Worker on this device using the local engine. It is off by default; nothing runs on your CPU until you enable it here and start a computation. Server jobs are unaffected.</InfoBanner>
        <Switch checked={s.browserCompute} onChange={(b) => settings.set({ browserCompute: b })} label="I consent to running computations in this browser" />
        <div class="form-grid" style={{ marginTop: '10px' }}>
          <NumberField name="limit" label="Time limit per computation" unit="s" value={s.computeTimeLimitS} min={1} max={600} integer report={v.report}
            onChange={(x) => settings.set({ computeTimeLimitS: x })} help="The worker is terminated when this wall-clock limit is reached; partial results are discarded or clearly labelled as partial." />
          <NumberField name="cells" label="Maximum grid cells" unit="1" value={s.computeMaxCells} min={100} max={10000} integer report={v.report}
            onChange={(x) => settings.set({ computeMaxCells: x })} help="Upper bound on the number of design points a browser sweep may evaluate." />
        </div>
      </Card>
      <DataSection />
    </div>
  );
}
