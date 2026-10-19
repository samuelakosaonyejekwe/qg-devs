/** Suite 16 — Calibration, verification, validation and uncertainty: V&V registry, results, Lean proofs. */
import { useMemo, useState } from 'preact/hooks';
import { View3D } from '../../components/View3D';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, ErrorBox, Loading, SourceChip, DataTable, Btn, InfoBanner, Switch, AssuranceBadge, ASSURANCE_LIST, StatusBadge, ProvBadge, Level, Tip } from '../../components/ui';
import { JobRunner } from '../../components/JobRunner';
import { useApiGet } from '../../lib/api';
import { fmtNum, fmtTime } from '../../lib/format';
import { SUITES } from '../../lib/nav';
import { hypStyle } from '../../lib/hyp';

interface Bench { id: string; suite: number; title: string; kind: string; tolerance: number; justification: string; reference: string; compare: string; slow: boolean }
interface BenchResult { id: string; suite: number; title: string; kind: string; value: number | null; tolerance: number; compare: string; passed: boolean; justification: string; reference: string; error: string | null; seconds: number }
interface VVReport { summary: { total: number; passed: number; failed: number } | null; results?: BenchResult[]; job?: { id: string; finished: string | null; created: string }; note?: string }
interface Theorem { name: string; status: string; file?: string; statement?: string; [k: string]: unknown }

const ASSURANCE_HELP: Record<string, string> = {
  'FORMALLY VERIFIED': 'Lean 4 theorem with status “proved” (machine-checked, no sorry).',
  'NUMERICALLY VERIFIED': 'Registered benchmarks pass within pre-justified tolerances.',
  'PARTIALLY VERIFIED': 'Only part of the required checks performed or passed.',
  UNVERIFIED: 'No verification recorded.',
  SPECULATIVE: 'Outside every implemented model’s validated domain.',
  FAILED: 'A verification check failed.',
};

function Legend() {
  return (
    <Card title="Assurance statuses">
      <p class="small muted">Six statuses, distinguished by glyph, colour and border style (not colour alone). Only a Lean theorem whose recorded status is exactly “proved” is shown as FORMALLY VERIFIED.</p>
      <ul class="clean" style={{ display: 'grid', gap: '6px' }}>
        {ASSURANCE_LIST.map((a) => <li class="row"><AssuranceBadge status={a} /><span class="small">{ASSURANCE_HELP[a]}</span></li>)}
      </ul>
    </Card>
  );
}

function resultStatus(r: BenchResult) {
  if (r.error) return 'FAILED';
  return r.passed ? 'NUMERICALLY VERIFIED' : 'FAILED';
}

/** Counts of benchmarks per suite in the latest run (passed / failed / registered but not run). */
function VV3D({ results, reg }: { results: BenchResult[]; reg: Bench[] }) {
  const suites = [...new Set(reg.map((b) => b.suite))].sort((a, b) => a - b);
  const rows = ['passed', 'failed', 'not run'];
  const colors = ['#1b7f3b', '#b3261e', '#9aa0a6'];
  const opts = useMemo(() => {
    const count = (n: number, k: number) => k === 0 ? results.filter((x) => x.suite === n && x.passed).length
      : k === 1 ? results.filter((x) => x.suite === n && !x.passed).length
        : reg.filter((b) => b.suite === n && !results.some((x) => x.id === b.id)).length;
    const bars = suites.flatMap((n, i) => rows.map((_, k) => ({ xi: i, yi: k, h: count(n, k), color: colors[k] }))).filter((b) => b.h > 0);
    return { x: { label: 'Suite', cats: suites.map(String) }, y: { label: 'Outcome', cats: rows }, z: { label: 'Benchmarks (count)', min: 0, max: Math.max(1, ...bars.map((b) => b.h)) }, bars };
  }, [results, reg]);
  return (
    <View3D kind="plot3d" name="vv-by-suite-3d" title="Latest verification run by suite" badge="COMPUTED" opts={opts}
      legend={rows.map((r, k) => ({ label: r, color: colors[k] }))} frameData={() => opts.bars}
      label="Bar heights are the number of benchmarks per suite that passed, failed or were not run in the latest verification job"
      fallback={<p class="small muted">See the table above.</p>} />
  );
}

function Latest({ reg, suite }: { reg: Bench[]; suite: number | null }) {
  const r = useApiGet<VVReport>('/api/vv/latest');
  if (r.loading && !r.data) return <Loading label="Loading latest verification run" />;
  if (r.error && !r.data) return <ErrorBox error={r.error} what="loading GET /api/vv/latest" />;
  const d = r.data!;
  if (!d.summary) return <InfoBanner>{d.note ?? 'No completed verification run yet.'} Use “Run verification” below.</InfoBanner>;
  const res = (d.results ?? []).filter((x) => suite == null || x.suite === suite);
  const notRun = reg.filter((b) => (suite == null || b.suite === suite) && !(d.results ?? []).some((x) => x.id === b.id));
  return (
    <div class="stack">
      <div class="row-between">
        <div class="row">
          <span class={`badge ${d.summary.failed ? 'b-bad' : 'b-ok'}`}>{d.summary.passed}/{d.summary.total} passed</span>
          {d.summary.failed > 0 && <span class="badge b-bad">{d.summary.failed} failed</span>}
          {d.job && <span class="small muted">from job <a href={`/jobs?id=${d.job.id}`}><code>{d.job.id}</code></a>, finished {fmtTime(d.job.finished)}</span>}
        </div>
        <div class="row"><SourceChip source={r.source} cachedAt={r.cachedAt} /><Btn onClick={r.reload}>Refresh</Btn></div>
      </div>
      <DataTable head={['Benchmark', 'Suite', 'Kind', 'Value', 'Criterion', 'Result', 'Time']} numeric={[1, 3, 6]}
        hl={(i) => !res[i].passed}
        rows={res.map((x) => [
          <span><code>{x.id}</code><br /><span class="small">{x.title}</span></span>, x.suite, x.kind,
          x.value == null ? '—' : fmtNum(x.value, 4),
          <span class="small">{x.compare === 'min_value' ? `value ≥ ${fmtNum(x.tolerance, 3)}` : `|error| ≤ ${fmtNum(x.tolerance, 3)}`}</span>,
          <span><AssuranceBadge status={resultStatus(x)} raw={x.passed ? 'passed' : 'failed'} />{x.error && <details><summary class="small">error</summary><pre class="code">{x.error}</pre></details>}</span>,
          `${fmtNum(x.seconds, 3)} s`,
        ])} />
      {suite == null && <VV3D results={d.results ?? []} reg={reg} />}
      {notRun.length > 0 && <p class="small muted">Not included in this run{suite != null ? ' for this suite' : ''}: {notRun.map((b) => <code>{b.id}{b.slow ? ' (slow)' : ''} </code>)}</p>}
    </div>
  );
}

function LeanStatus() {
  const r = useApiGet<{ theorems: Theorem[]; note?: string; [k: string]: unknown }>('/api/lean/status');
  if (r.loading && !r.data) return <Loading label="Loading Lean proof status" />;
  if (r.error && !r.data) return <ErrorBox error={r.error} what="loading GET /api/lean/status" />;
  const th = r.data?.theorems ?? [];
  const proved = th.filter((t) => t.status === 'proved').length;
  return (
    <div class="stack">
      <div class="row-between"><span class="small">{th.length ? `${proved} of ${th.length} theorems proved` : 'No theorem status available'}</span><SourceChip source={r.source} cachedAt={r.cachedAt} /></div>
      {r.data?.note && <InfoBanner>{r.data.note}. No result on this server is presented as formally verified until the Lean project has been built and its proof status recorded.</InfoBanner>}
      {th.length > 0 && (
        <DataTable head={['Theorem', 'File', 'Recorded status', 'Assurance']}
          rows={th.map((t) => [<code>{t.name}</code>, t.file ? <code>{t.file}</code> : '—', <code>{t.status}</code>,
            <AssuranceBadge status={t.status === 'proved' ? 'FORMALLY VERIFIED' : /fail|error/i.test(t.status) ? 'FAILED' : /sorry|partial/i.test(t.status) ? 'PARTIALLY VERIFIED' : 'UNVERIFIED'} raw={t.status} />])} />
      )}
    </div>
  );
}

function ModelAssurance() {
  const r = useApiGet<{ id: string; name: string; implemented: boolean; assurance: string; status_note: string }[]>('/api/models');
  if (r.error && !r.data) return <ErrorBox error={r.error} what="loading GET /api/models" />;
  if (!r.data) return <Loading />;
  return (
    <DataTable head={['Hypothesis', 'Implemented', 'Assurance (registry)', 'Note']}
      rows={r.data.map((m) => [<span><span class="swatch" style={{ background: hypStyle(m.id).color }} /> <code>{m.id}</code></span>, m.implemented ? 'yes' : 'no', <AssuranceBadge status={m.assurance} raw={m.assurance} />, <span class="small">{m.status_note}</span>])} />
  );
}

export default function Page(_props: { suite?: number }) {
  const reg = useApiGet<Bench[]>('/api/vv/registry');
  const [suite, setSuite] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const list = (reg.data ?? []).filter((b) => suite == null || b.suite === suite);
  const suitesPresent = [...new Set((reg.data ?? []).map((b) => b.suite))].sort((a, b) => a - b);
  return (
    <div>
      <SuiteHeader n={16} intro="Benchmark registry with tolerances justified before running, latest verification results, the durable verification job, machine-checked Lean 4 theorems, and the assurance status of every model. Verification shows the code solves the stated equations; it is not experimental validation." />
      <div class="stack">
        <div class="grid-2">
          <Legend />
          <Card title="Run verification">
            <Switch checked={slow} onChange={setSlow} label="Include slow benchmarks (convergence studies, Monte Carlo)" />
            <div style={{ marginTop: '8px' }}>
              <JobRunner type="vv_run" label="Submit vv_run job" params={() => (suite != null ? { ids: list.map((b) => b.id), include_slow: slow } : { include_slow: slow })}
                note={suite != null ? `Runs the ${list.length} benchmark(s) of suite ${suite} only (filter below).` : 'Runs every registered benchmark (slow ones only if selected). Progress is checkpointed per benchmark.'}>
                {(res: { summary: { total: number; passed: number; failed: number } }) => <p><ProvBadge kind="COMPUTED" /> {res.summary.passed}/{res.summary.total} passed, {res.summary.failed} failed. The “Latest results” table shows the newest completed run.</p>}
              </JobRunner>
            </div>
          </Card>
        </div>
        <Card title="Filter by suite">
          <label class="row small">Suite{' '}
            <select class="input" style={{ maxWidth: '360px' }} value={suite ?? ''} onChange={(e: any) => setSuite(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}>
              <option value="">All suites</option>
              {suitesPresent.map((n) => <option value={n}>{n}. {SUITES.find((s) => s.n === n)?.short ?? ''}</option>)}
            </select>
          </label>
        </Card>
        <Card title="Latest results"><Latest reg={reg.data ?? []} suite={suite} /></Card>
        <Card title={`Benchmark registry (${list.length})`} actions={<SourceChip source={reg.source} cachedAt={reg.cachedAt} />}>
          {reg.error && !reg.data && <ErrorBox error={reg.error} what="loading GET /api/vv/registry" />}
          {!reg.data && !reg.error && <Loading />}
          {reg.data && <DataTable head={['Id', 'Suite', 'Title', 'Kind', <>Tolerance <Tip text="Fixed before the benchmark is run, with the justification shown; ‘min_value’ benchmarks require the value to reach at least the threshold." /></>, 'Justification', 'Reference']}
            numeric={[1, 4]}
            rows={list.map((b) => [<span><code>{b.id}</code>{b.slow && <> <span class="badge b-neutral">slow</span></>}</span>, b.suite, b.title, b.kind,
              <span>{b.compare === 'min_value' ? '≥ ' : '≤ '}{fmtNum(b.tolerance, 3)}</span>, <span class="small">{b.justification}</span>, <span class="small"><ProvBadge kind="LITERATURE_REFERENCE" title="Reference result or exact property" /> {b.reference}</span>])} />}
        </Card>
        <Card title="Lean 4 machine-checked theorems"><LeanStatus /></Card>
        <Level min="advanced"><Card title="Model assurance (registry)"><ModelAssurance /></Card></Level>
        <p class="small muted"><StatusBadge status="NUMERICALLY_VERIFIED" /> results establish agreement with analytic results and independent implementations within stated tolerances; experimental validation requires physical data (declared gap).</p>
      </div>
    </div>
  );
}
