/** Suite 15 — High-performance numerical simulation: job queue, native kernel, opt-in browser compute. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, ProvBadge, ErrorBox, Loading, DataTable, Btn, InfoBanner, Switch, Progress, StatusBadge, KV, SourceChip, EvidenceBanner } from '../../components/ui';
import { NumberField, SelectField, useValidity } from '../../components/fields';
import { HeatMap } from '../../plot/Chart';
import { apiGet, apiPost, cancelJob, useApiGet, type Job } from '../../lib/api';
import { useStore, scenario, settings } from '../../lib/store';
import { fmtNum, fmtTime, fmtQ } from '../../lib/format';
import { hypStyle, IMPLEMENTED_IDS } from '../../lib/hyp';
import { runLocalSweep, type SweepState } from '../../workers/compute-client';
import { linspace, relDiff } from './f3-shared';

interface Health { status: string; version: string; uptime_s: number; jobs: Record<string, number>; schedule_last_run: Record<string, string>; native_kernel: { available: boolean; reason?: string } }

function JobsTable() {
  const [data, setData] = useState<{ jobs: Job[]; types: string[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [at, setAt] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      apiGet<{ jobs: Job[]; types: string[] }>('/api/jobs', { limit: 50 }, { noCache: true })
        .then((r) => { if (alive) { setData(r.data); setErr(null); setAt(r.receivedAt); } })
        .catch((e) => alive && setErr(e));
    };
    load();
    const id = setInterval(load, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [tick]);
  const cancel = async (id: string) => { try { await cancelJob(id); setTick((t) => t + 1); } catch (e) { setErr(e); } };
  return (
    <Card title="Server job queue" actions={<span class="small muted">auto-refresh 3 s{at ? ` · last ${fmtTime(at)}` : ''}</span>}>
      <ErrorBox error={err} what="loading GET /api/jobs (the list is not refreshed while unreachable)" />
      {!data && !err && <Loading label="Loading jobs" />}
      {data && (<>
        <p class="small muted">Job types accepted by this server: {data.types.map((t) => <code>{t} </code>)}. Jobs run in the server's worker process, survive browser closure and are recovered after worker loss.</p>
        <DataTable head={['Id', 'Type', 'Status', 'Progress', 'Message', 'Created', 'Started', 'Finished', 'Attempts', '']}
          rows={data.jobs.map((j) => [
            <a href={`/jobs?id=${j.id}`}><code>{j.id}</code></a>, j.type, <StatusBadge status={j.status} />,
            <div style={{ minWidth: '90px' }}><Progress value={j.status === 'succeeded' ? 1 : j.progress} label={`job ${j.id} progress`} /><span class="small muted">{j.progress != null ? `${Math.round(j.progress * 100)} %` : '—'}</span></div>,
            <span class="small">{j.error ? <span class="field-error">{j.error.split('\n').slice(-2).join(' ')}</span> : j.message}</span>,
            <span class="small">{fmtTime(j.created)}</span>, <span class="small">{fmtTime(j.started)}</span>, <span class="small">{fmtTime(j.finished)}</span>, j.attempts,
            j.status === 'queued' || j.status === 'running' ? <button type="button" class="btn-sm" onClick={() => cancel(j.id)}>Cancel</button> : null,
          ])} />
      </>)}
    </Card>
  );
}

function HealthCard() {
  const h = useApiGet<Health>('/api/health');
  return (
    <Card title="Compute back-ends" actions={<SourceChip source={h.source} cachedAt={h.cachedAt} />}>
      {h.error && !h.data && <ErrorBox error={h.error} what="loading GET /api/health" />}
      {h.data && <KV rows={[
        ['Native C++ kernel', h.data.native_kernel.available ? <span class="badge b-ok">available</span> : <span class="badge b-bad">unavailable{h.data.native_kernel.reason ? ` — ${h.data.native_kernel.reason}` : ''}</span>],
        ['GPU kernels', <span class="badge b-neutral">not implemented (declared gap)</span>],
        ['Job counts', Object.entries(h.data.jobs).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'none'],
        ['Scheduled tasks (last run)', <span class="small">{Object.entries(h.data.schedule_last_run).map(([k, v]) => `${k} ${fmtTime(v)}`).join(' · ') || '—'}</span>],
        ['Server', `v${h.data.version}, up ${fmtQ(h.data.uptime_s, 's', 3)}`],
      ]} />}
    </Card>
  );
}

interface Check { x: number; y: number; local: [number | null, number | null]; server: [number | null, number | null] }

function BrowserCompute() {
  const s = useStore(settings);
  const sc = useStore(scenario);
  const v = useValidity();
  const maxW = Math.max(1, (navigator.hardwareConcurrency || 2) - 1);
  const [g, setG] = useState({ x0: 2e-4, x1: 1e-3, nx: 20, y0: 1e-5, y1: 2.5e-4, ny: 20, workers: 1, hyp: 'QG-COH' });
  const [st, setSt] = useState<SweepState | null>(null);
  const [axes, setAxes] = useState<{ xs: number[]; ys: number[]; hyp: string } | null>(null);
  const ctl = useRef<{ stop: () => void } | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [checkErr, setCheckErr] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => () => ctl.current?.stop(), []);
  const cells = g.nx * g.ny;
  const ok = s.browserCompute && v.ok && g.x0 < g.x1 && g.y0 < g.y1 && cells <= s.computeMaxCells;
  const running = st && !st.finished;
  const start = () => {
    const xs = linspace(g.x0, g.x1, g.nx), ys = linspace(g.y0, g.y1, g.ny);
    setAxes({ xs, ys, hyp: g.hyp }); setChecks(null);
    ctl.current = runLocalSweep({ design: sc.design, environment: sc.environment, px: 'separation', xs, py: 'dx_A', ys, hypothesis: g.hyp, workers: Math.min(g.workers, maxW), timeLimitS: s.computeTimeLimitS }, setSt);
  };
  const crossCheck = async () => {
    if (!st || !axes) return;
    setChecking(true); setCheckErr(null);
    const cand: [number, number][] = [];
    st.negativity.forEach((r, i) => r.forEach((val, j) => { if (val !== undefined) cand.push([i, j]); }));
    const pick: [number, number][] = [];
    while (pick.length < Math.min(5, cand.length)) { const c = cand[Math.floor(Math.random() * cand.length)]; if (!pick.includes(c)) pick.push(c); }
    try {
      const out: Check[] = [];
      for (const [i, j] of pick) {
        const r = await apiPost<{ negativity: (number | null)[][]; witness: (number | null)[][] }>('/api/bmv/sweep2d', { ...sc, px: 'separation', xs: [axes.xs[j]], py: 'dx_A', ys: [axes.ys[i]], hypothesis: axes.hyp });
        out.push({ x: axes.xs[j], y: axes.ys[i], local: [st.negativity[i][j] ?? null, st.witness[i][j] ?? null], server: [r.negativity[0][0], r.witness[0][0]] });
      }
      setChecks(out);
    } catch (e) { setCheckErr(e); } finally { setChecking(false); }
  };
  const asNull = (m: (number | null | undefined)[][]) => m.map((r) => r.map((x) => (x === undefined ? null : x)));
  const maxRel = checks ? Math.max(0, ...checks.flatMap((c) => [0, 1].map((k) => (c.local[k] == null || c.server[k] == null ? (c.local[k] === c.server[k] ? 0 : Infinity) : relDiff(c.local[k]!, c.server[k]!))))) : null;
  return (
    <Card title="Browser compute (opt-in)">
      <InfoBanner>When enabled, this page runs a 2-D sweep of the working scenario on <b>this device</b> using the local engine in Web Workers. Nothing is uploaded; the server is contacted only if you press “cross-check”. It is off by default and limited by the time and size limits below.</InfoBanner>
      <Switch checked={s.browserCompute} onChange={(x) => { if (!x) ctl.current?.stop(); settings.set({ browserCompute: x }); }} label="I consent to running computations in this browser (uses CPU and battery)" />
      {s.browserCompute && (<>
        <div class="form-grid" style={{ marginTop: '10px' }}>
          <NumberField name="tl" label="Time limit" unit="s" value={s.computeTimeLimitS} min={1} max={600} report={v.report} onChange={(x) => settings.set({ computeTimeLimitS: x })} help="The sweep stops automatically after this wall-clock time; partial results are kept and unfinished cells stay blank." />
          <NumberField name="mc" label="Max grid cells" unit="1" integer value={s.computeMaxCells} min={4} max={10000} report={v.report} onChange={(x) => settings.set({ computeMaxCells: x })} help="Upper bound on n_x × n_y for a local sweep." />
          <NumberField name="nw" label="Workers" unit="1" integer value={g.workers} min={1} max={maxW} report={v.report} onChange={(x) => setG({ ...g, workers: x })} help={`Parallel Web Workers (at most hardware threads − 1 = ${maxW}).`} />
          <NumberField name="x0" label="Separation start" unit="m" value={g.x0} min={1e-9} max={10} minExclusive report={v.report} onChange={(x) => setG({ ...g, x0: x })} help="First centre separation of the grid." />
          <NumberField name="x1" label="Separation stop" unit="m" value={g.x1} min={1e-9} max={10} minExclusive report={v.report} onChange={(x) => setG({ ...g, x1: x })} help="Last centre separation." />
          <NumberField name="nx" label="Separation points" unit="1" integer value={g.nx} min={2} max={200} report={v.report} onChange={(x) => setG({ ...g, nx: x })} help="Grid points along the separation axis." />
          <NumberField name="y0" label="Δx start" unit="m" value={g.y0} min={0} max={10} report={v.report} onChange={(x) => setG({ ...g, y0: x })} help="First branch separation (both masses)." />
          <NumberField name="y1" label="Δx stop" unit="m" value={g.y1} min={0} max={10} report={v.report} onChange={(x) => setG({ ...g, y1: x })} help="Last branch separation." />
          <NumberField name="ny" label="Δx points" unit="1" integer value={g.ny} min={2} max={200} report={v.report} onChange={(x) => setG({ ...g, ny: x })} help="Grid points along the Δx axis." />
          <SelectField label="Hypothesis" value={g.hyp} onChange={(hyp) => setG({ ...g, hyp })} options={IMPLEMENTED_IDS.map((i) => ({ v: i, label: `${i} — ${hypStyle(i).short}` }))} help="Model evaluated in every cell." />
        </div>
        <p class={cells > s.computeMaxCells ? 'field-error' : 'small muted'}>{cells} cells (limit {s.computeMaxCells}). Other design and environment parameters come from the working scenario.</p>
        <div class="row">
          <Btn kind="primary" disabled={!ok || !!running} onClick={start}>Start local sweep</Btn>
          <Btn kind="danger" disabled={!running} onClick={() => ctl.current?.stop()}>Stop</Btn>
        </div>
      </>)}
      {st && (
        <div class="stack" style={{ marginTop: '10px' }}>
          <Progress value={st.total ? st.done / st.total : 0} label="local sweep progress" />
          <p class="small" aria-live="polite">{st.done} / {st.total} cells{st.finished ? ` — ${st.reason}${st.elapsedMs != null ? ` after ${fmtNum(st.elapsedMs / 1000, 3)} s` : ''}` : ' — running'}{st.error ? ` — error: ${st.error}` : ''}</p>
          {axes && st.done > 0 && (<>
            <EvidenceBanner />
            <div class="grid-2">
              <div><p class="small"><ProvBadge kind="COMPUTED_LOCAL" /> negativity · {axes.hyp}</p>
                <HeatMap name="local-sweep-negativity" desc="locally computed negativity over separation and branch separation" z={asNull(st.negativity)} x={axes.xs} y={axes.ys} xLabel="Separation d" xUnit="m" yLabel="Δx" yUnit="m" zLabel="negativity" palette="viridis" nullLabel="inadmissible geometry or not computed" /></div>
              <div><p class="small"><ProvBadge kind="COMPUTED_LOCAL" /> CPK witness · {axes.hyp}</p>
                <HeatMap name="local-sweep-witness" desc="locally computed witness; outline marks W = 0" z={asNull(st.witness)} x={axes.xs} y={axes.ys} xLabel="Separation d" xUnit="m" yLabel="Δx" yUnit="m" zLabel="⟨W⟩" palette="diverging" symmetric contour0 nullLabel="inadmissible geometry or not computed" /></div>
            </div>
            <p class="small muted">Hatched cells are inadmissible geometries (branches overlap/touch) or cells not reached before the limit/stop.</p>
            {st.finished && <div class="row"><Btn busy={checking} onClick={crossCheck}>Cross-check 5 random cells against the server</Btn><span class="small muted">(5 × POST /api/bmv/sweep2d, 1 × 1 grids)</span></div>}
            <ErrorBox error={checkErr} what="cross-checking with POST /api/bmv/sweep2d" />
            {checks && (<>
              <DataTable head={['d', 'Δx', 'Negativity (local)', 'Negativity (server)', '⟨W⟩ (local)', '⟨W⟩ (server)']} numeric={[2, 3, 4, 5]}
                rows={checks.map((c) => [fmtQ(c.x, 'm'), fmtQ(c.y, 'm'), fmtNum(c.local[0], 10), fmtNum(c.server[0], 10), fmtNum(c.local[1], 10), fmtNum(c.server[1], 10)])} />
              <p class="small">Maximum relative difference local vs server: <b>{maxRel == null ? '—' : fmtNum(maxRel, 3)}</b> {maxRel != null && maxRel < 1e-8 ? <span class="badge b-ok">agree to &lt; 1e-8</span> : <span class="badge b-warn">check</span>}</p>
            </>)}
          </>)}
        </div>
      )}
    </Card>
  );
}

export default function Page(_props: { suite?: number }) {
  return (
    <div>
      <SuiteHeader n={15} intro="Durable server-side job queue with progress, checkpoints and recovery; a native C++ kernel; and an opt-in browser compute panel that runs the independently implemented local engine in Web Workers." />
      <div class="stack">
        <div class="grid-2"><HealthCard /><div class="card"><h2>About the compute paths</h2><p class="small">Heavy computations (discrimination matrices, design optimisation, verification, inference) run as server jobs. Interactive endpoints are bounded. Browser compute duplicates the BMV prediction chain in TypeScript; it is tested against golden vectors generated from the Python reference (relative agreement ≤ 1e-8).</p></div></div>
        <JobsTable />
        <BrowserCompute />
      </div>
    </div>
  );
}
