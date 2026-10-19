import { RunBar } from '../../components/Reset';
/** Suite 14 — Physical-law and hypothesis discovery (dimensionally constrained regression, hypothesis ledger). */
import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { View3D } from '../../components/View3D';
import { usePlayer, PlayerControls } from '../../components/Player';
import { Seg, Out } from '../../components/ui';
import { sobol, pointMassDeltaPhi } from '../../engine/index';
import { DEFAULT_DESIGN, type Geometry } from '../../lib/types';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, ProvBadge, EvidenceBanner, ErrorBox, Loading, SourceChip, DataTable, Btn, Tabs, TabPanel, InfoBanner, KV, Json, Level, StatusBadge } from '../../components/ui';
import { NumberField, SelectField, useValidity } from '../../components/fields';
import { JobRunner } from '../../components/JobRunner';
import { LinePlot } from '../../plot/Chart';
import { apiPost, useApiGet } from '../../lib/api';
import { fmtNum, fmtQ, fmtTime, shortHash, sup } from '../../lib/format';
import { CONSTANTS } from '../../engine';

interface Law {
  raw_exponents: Record<string, number>; rational_exponents: Record<string, string | null>; constant_exponents: Record<string, string>;
  dimensionally_consistent: boolean; expression: string | null; log_prefactor: number; r2_log: number; max_rel_residual: number;
}
interface Scaling { study: string; regime: string; geometry: string; n: number; seed: number; law: Law; data_sha256: string; correction_series?: { variable: string; normalisation: string; coefficients: Record<string, number>; reference_series: string; max_abs_error: number } }

const SYM: Record<string, string> = { hbar: 'ħ', G: 'G', c: 'c', k_B: 'k_B', mass: 'm', separation: 'd', branch_separation: 'Δx', time: 't' };

/** Render "G^1 · hbar^-1 · mass^2 …" as G ħ⁻¹ m² … (exponent 1 omitted). */
function LawExpr({ expr }: { expr: string }) {
  const parts = expr.split('·').map((s) => s.trim()).filter(Boolean).map((f) => { const [n, e] = f.split('^'); return [n, e ?? '1'] as [string, string]; });
  return <span class="mono" style={{ fontSize: '1.15rem' }}>Δφ ∝ {parts.map(([n, e]) => <span style={{ marginRight: '0.35em' }}>{SYM[n] ?? n}{e === '1' ? '' : sup(e.replace('/', 'ᐟ'))}</span>)}</span>;
}

/** Dimensionless coefficient implied by the fitted intercept: C = exp(ln prefactor) / Π constant^exponent. */
function impliedCoefficient(law: Law): number | null {
  if (!law.dimensionally_consistent) return null;
  const vals: Record<string, number> = { G: CONSTANTS.G, hbar: CONSTANTS.hbar, c: CONSTANTS.c, k_B: CONSTANTS.k_B };
  let lc = law.log_prefactor;
  for (const [k, e] of Object.entries(law.constant_exponents)) {
    if (!(k in vals)) return null;
    const [a, b] = e.split('/').map(Number);
    lc -= (b ? a / b : a) * Math.log(vals[k]);
  }
  return Math.exp(lc);
}

function binomialRef(k: number): number {
  // coefficient of u^k in 1 − (1+u)^(−1/2) = −C(−1/2, k)
  let c = 1;
  for (let i = 0; i < k; i++) c *= (-0.5 - i) / (i + 1);
  return -c;
}

function ScalingView() {
  const v = useValidity();
  const [p, setP] = useState({ regime: 'far', geometry: 'parallel', n: 128, seed: 0 });
  const [res, setRes] = useState<Scaling | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setRes(await apiPost<Scaling>('/api/discovery/scaling', undefined, p)); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const law = res?.law;
  const C = law ? impliedCoefficient(law) : null;
  return (
    <div class="split">
      <div class="card sticky-side">
        <h2>Scaling-law discovery</h2>
        <p class="small muted">Sobol-sampled BMV simulations → fit ln Δφ = c + Σ eᵢ ln xᵢ → rationalise exponents → solve for constants (G, ħ, c, k_B) making the law dimensionally consistent; laws without a consistent completion are rejected.</p>
        <SelectField label="Regime" value={p.regime} onChange={(regime) => setP({ ...p, regime })} options={[{ v: 'far', label: 'Far field (Δx ≪ d)' }, { v: 'near', label: 'Near field (Δx ~ d)' }]} help="Far field: a pure power law is expected. Near field: no single power law exists; the engine then fits a correction series in u = (Δx/d)²." />
        <SelectField label="Geometry" value={p.geometry} onChange={(geometry) => setP({ ...p, geometry })} options={[{ v: 'parallel', label: 'Parallel' }, { v: 'linear', label: 'Linear' }]} help="Split-axis orientation of the sampled designs." />
        <NumberField name="n" label="Samples" unit="1" integer value={p.n} min={8} max={512} report={v.report} onChange={(n) => setP({ ...p, n })} help="Number of Sobol samples (server limit 512)." />
        <NumberField name="seed" label="Seed" unit="1" integer value={p.seed} min={0} max={2 ** 31} report={v.report} onChange={(seed) => setP({ ...p, seed })} help="Seed of the scrambled Sobol sequence." />
        <RunBar label="Discover law" busy={busy} disabled={!v.ok} onRun={run} />
      </div>
      <div class="stack">
        <EvidenceBanner />
        <ErrorBox error={err} what="running POST /api/discovery/scaling" />
        {res && law && (<>
          <Card title="Discovered law" actions={<ProvBadge kind="COMPUTED" />}>
            {law.expression ? <LawExpr expr={law.expression} /> : <InfoBanner kind="danger">No dimensionally consistent power law was found for this regime — the candidate is rejected (expected in the near field, where Δφ is not a monomial).</InfoBanner>}
            <div class="outs" style={{ marginTop: '10px' }}>
              <div class="out"><div class="out-label">Dimensional consistency</div><div class="out-value">{law.dimensionally_consistent ? 'consistent' : 'inconsistent'}</div></div>
              <div class="out"><div class="out-label">r² (log space)</div><div class="out-value">{fmtNum(law.r2_log, 10)}</div></div>
              <div class="out"><div class="out-label">Max relative residual</div><div class="out-value">{fmtNum(law.max_rel_residual, 3)}</div><div class="out-interp">Largest |Δφ_fit/Δφ_sim − 1| over the samples.</div></div>
              {C != null && <div class="out"><div class="out-label">Implied dimensionless coefficient</div><div class="out-value">{fmtNum(C, 5)}</div><div class="out-interp">exp(ln prefactor) divided by the constants' powers (computed here from the fitted intercept {fmtNum(law.log_prefactor, 6)}).</div></div>}
            </div>
            <DataTable head={['Variable', 'Raw exponent (fit)', 'Rational exponent']} numeric={[1]}
              rows={Object.keys(law.raw_exponents).map((k) => [<span>{SYM[k] ?? k} <span class="muted small">({k})</span></span>, fmtNum(law.raw_exponents[k], 8), law.rational_exponents[k] ?? <span class="badge b-bad">not rationalisable</span>])} />
            {Object.keys(law.constant_exponents).length > 0 && <p class="small">Constants solved for dimensional consistency: {Object.entries(law.constant_exponents).map(([k, e]) => <code>{SYM[k] ?? k}^{e} </code>)}</p>}
            <p class="small muted">Study: {res.study}, regime {res.regime}, geometry {res.geometry}, n = {res.n}, seed {res.seed}. Data SHA-256 <code>{shortHash(res.data_sha256, 16)}</code>. Recovering a known law blind is a check of the method, not a discovery.</p>
          </Card>
          {res.regime === 'far' && law.dimensionally_consistent && law.expression && <SobolView res={res} />}
          {res.correction_series && (
            <Card title="Near-field correction series" actions={<ProvBadge kind="COMPUTED" />}>
              <p class="small">Variable {res.correction_series.variable}; normalisation {res.correction_series.normalisation}. Reference: <code>{res.correction_series.reference_series}</code></p>
              <DataTable head={['Term', 'Sparse-regression coefficient', 'Binomial reference', 'Difference']} numeric={[1, 2, 3]}
                rows={Object.entries(res.correction_series.coefficients).map(([k, c]) => { const kk = Number(k.replace('u^', '')); const r = binomialRef(kk); return [<code>{k}</code>, fmtNum(c, 6), fmtNum(r, 6), fmtNum(c - r, 3)]; })} />
              <p class="small muted">Max absolute error of the fitted series: {fmtNum(res.correction_series.max_abs_error, 3)}. The reference coefficients are the exact binomial expansion of 1 − (1+u)^(−1/2), evaluated in this page; higher-order terms absorb truncation and differ more.</p>
            </Card>
          )}
        </>)}
      </div>
    </div>
  );
}

const CLASS_TONE: Record<string, string> = {
  ESTABLISHED_RESULT: 'b-ok', KNOWN_PHYSICS_IMPLEMENTATION: 'b-computed', NUMERICAL_ARTEFACT: 'b-bad', UNTESTED_PREDICTION: 'b-warn',
  CANDIDATE_NEW_PHENOMENON: 'b-synthetic', EXPERIMENTALLY_SUPPORTED: 'b-requirement',
};
export interface LedgerEntry { index: number; timestamp_utc: string; kind: string; actor: string; payload_sha256: string; entry_hash: string; prev_hash: string; payload: { title: string; statement: string; method: string; study_data_sha256?: string; study?: unknown; classification: string; checks: Record<string, unknown>; status: string; novelty: string } }

function Novelty({ n }: { n: string }) {
  if (n === 'KNOWN') return <span class="badge b-literature" title="Recovers an already-known result">novelty: known result</span>;
  if (n === 'NOT_ASSESSED') return <span class="badge b-neutral" title="Novelty is never asserted automatically; it requires a DOI-linked literature review by a researcher">novelty: not assessed</span>;
  return <span class="badge b-warn" title="Recorded novelty assessment (set by a researcher)">novelty: {n.replace(/_/g, ' ').toLowerCase()}</span>;
}

function HypothesisTable({ entries }: { entries: LedgerEntry[] }) {
  if (!entries.length) return <p class="muted">No hypotheses recorded yet. Run a discovery cycle to populate the ledger.</p>;
  return (
    <div class="stack">
      {entries.map((e) => (
        <article class="card">
          <div class="row-between">
            <h3 style={{ margin: 0 }}>#{e.index} {e.payload.title}</h3>
            <div class="row"><span class={`badge ${CLASS_TONE[e.payload.classification] ?? 'b-neutral'}`}>{e.payload.classification.replace(/_/g, ' ')}</span><StatusBadge status={e.payload.status} /><Novelty n={e.payload.novelty} /></div>
          </div>
          <p class="small" style={{ margin: '6px 0' }}>Statement: <code>{e.payload.statement}</code></p>
          <KV rows={[['Method', e.payload.method], ['Recorded', fmtTime(e.timestamp_utc)], ['Checks', <span class="small mono">{Object.entries(e.payload.checks ?? {}).map(([k, v]) => `${k}: ${typeof v === 'number' ? fmtNum(v, 4) : String(v)}`).join(' · ')}</span>], ['Entry hash', <code>{shortHash(e.entry_hash, 20)}</code>], ['Study data hash', <code>{shortHash(e.payload.study_data_sha256, 20)}</code>]]} />
          <Level min="expert"><details><summary class="small">Full payload</summary><Json data={e.payload} /></details></Level>
        </article>
      ))}
    </div>
  );
}

function LedgerView() {
  const r = useApiGet<LedgerEntry[]>('/api/discovery/hypotheses');
  const v = useValidity();
  const [seed, setSeed] = useState(0);
  const [n, setN] = useState(6);
  let body: ComponentChildren;
  if (r.loading && !r.data) body = <Loading label="Loading hypothesis ledger" />;
  else if (r.error && !r.data) body = <ErrorBox error={r.error} what="loading GET /api/discovery/hypotheses" />;
  else body = <HypothesisTable entries={(r.data ?? []).slice().reverse()} />;
  return (
    <div class="stack">
      <EvidenceBanner />
      <InfoBanner>Every generated hypothesis is recorded in the hash-chained ledger with its data hash, method, checks and a classification. Classifications describe the computational status only; none constitutes physical evidence, and novelty is never claimed automatically.</InfoBanner>
      <div class="grid-2">
        <Card title="Run a discovery cycle">
          <p class="small muted">Blind recovery of the far-field law, near-field correction study and calibration trade-off study; results are appended to the ledger.</p>
          <NumberField name="seed" label="Seed" unit="1" integer value={seed} min={0} max={2 ** 31} report={v.report} onChange={setSeed} help="Seed for the Sobol exploration in the cycle." />
          <JobRunner type="discovery_cycle" label="Submit discovery_cycle" disabled={!v.ok} params={() => ({ seed })}>
            {(res: { hypotheses: LedgerEntry[] }) => <><p class="small"><ProvBadge kind="COMPUTED" /> {res.hypotheses.length} entries recorded.</p><Btn onClick={r.reload}>Refresh ledger</Btn></>}
          </JobRunner>
        </Card>
        <Card title="Calibration trade-off study">
          <p class="small muted">How precisely must environmental decoherence be calibrated to tell a coherent quantum mediator from a classical channel?</p>
          <NumberField name="n" label="Designs" unit="1" integer value={n} min={1} max={50} report={v.report} onChange={setN} help="Number of sampled designs (each needs a bisection with the robust discrimination engine; cost grows linearly)." />
          <JobRunner type="calibration_tradeoff" label="Submit calibration_tradeoff" disabled={!v.ok} params={() => ({ n, seed })}>
            {(res: CalRes) => <CalView r={res} />}
          </JobRunner>
        </Card>
      </div>
      <Card title="Hypothesis ledger" actions={<><SourceChip source={r.source} cachedAt={r.cachedAt} /><Btn onClick={r.reload}>Refresh</Btn></>}>{body}</Card>
    </div>
  );
}

interface CalRes { rows: { mass: number; separation: number; dx: number; time: number; gamma_env: number; delta_phi: number; s_star_numeric: number; s_star_formula: number; rel_diff: number }[]; candidate_relationship: string; max_rel_diff: number | null; interpretation: string }
function CalView({ r }: { r: CalRes }) {
  const order = r.rows.map((_, i) => i).sort((a, b) => r.rows[a].s_star_formula - r.rows[b].s_star_formula);
  return (
    <div class="stack">
      <p><ProvBadge kind="COMPUTED" /> Candidate relationship: <code>{r.candidate_relationship}</code> — max relative difference numeric vs formula: <b>{r.max_rel_diff == null ? '—' : fmtNum(r.max_rel_diff, 3)}</b> <StatusBadge status={(r.max_rel_diff ?? 1) < 0.01 ? 'NUMERICALLY_VERIFIED' : 'UNVERIFIED'} /> <span class="small muted">(ledger classification: UNTESTED_PREDICTION; status rule: verified if max rel. diff &lt; 1 %)</span></p>
      <p class="small muted">{r.interpretation}</p>
      <LinePlot name="calibration-tradeoff" desc="critical calibration factor s* from bisection versus formula" xLabel="Design (sorted by formula s*)" yLabel="s*" logY
        series={[{ name: 's* numeric (bisection)', color: '#0072B2', markers: true, x: order.map((_, k) => k + 1), y: order.map((i) => r.rows[i].s_star_numeric) },
          { name: 's* formula', color: '#D55E00', dash: [4, 3], x: order.map((_, k) => k + 1), y: order.map((i) => r.rows[i].s_star_formula) }]} />
      <DataTable head={['Mass', 'd', 'Δx', 't', 'Γ_env', 'Δφ', 's* numeric', 's* formula', 'rel. diff']} numeric={[0, 1, 2, 3, 4, 5, 6, 7, 8]}
        rows={r.rows.map((x) => [fmtQ(x.mass, 'kg'), fmtQ(x.separation, 'm'), fmtQ(x.dx, 'm'), fmtQ(x.time, 's'), fmtQ(x.gamma_env, 's⁻¹'), `${fmtNum(x.delta_phi, 4)} rad`, fmtNum(x.s_star_numeric, 5), fmtNum(x.s_star_formula, 5), fmtNum(x.rel_diff, 3)])} />
    </div>
  );
}

export default function Page(_props: { suite?: number }) {
  const [tab, setTab] = useState('scaling');
  return (
    <div>
      <SuiteHeader n={14} intro="Automated exploration of physically admissible parameter spaces, dimensionally constrained law discovery and sparse regression, with every candidate recorded transparently in a hypothesis ledger. Recovering known laws validates the method; it is not a discovery." />
      <div class="tabs">
        <Tabs label="Suite 14 sections" active={tab} onChange={setTab} tabs={[{ id: 'scaling', label: 'Scaling-law discovery' }, { id: 'ledger', label: 'Hypothesis ledger & cycles' }]} />
        <TabPanel id="scaling" active={tab}><ScalingView /></TabPanel>
        <TabPanel id="ledger" active={tab}><LedgerView /></TabPanel>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- Sobol designs + law surface
/** Far-regime bounds of qgdevs.discovery.bmv_scaling_study (all four sampled log-uniformly). */
const FAR_BOUNDS: Record<string, [number, number]> = { mass: [1e-16, 1e-13], separation: [2e-4, 1e-3], branch_separation: [1e-6, 1e-5], time: [0.1, 5.0] };
const ORDER = ['mass', 'separation', 'branch_separation', 'time'];
const rat = (e: string | null | undefined, raw: number) => { if (!e) return raw; const [a, b] = e.split('/').map(Number); return b ? a / b : a; };

/**
 * The scaling endpoint does not return its (scrambled-Sobol) samples, so the designs are re-sampled here with
 * an unscrambled Sobol sequence over the same bounds and evaluated with the same point-mass entangling phase.
 * The discovered law (server exponents and intercept) is drawn as a plane through them.
 */
function SobolView({ res }: { res: Scaling }) {
  const law = res.law;
  const e = Object.fromEntries(ORDER.map((k) => [k, rat(law.rational_exponents[k], law.raw_exponents[k])])) as Record<string, number>;
  const c10 = law.log_prefactor / Math.LN10; // ln → log10
  const data = useMemo(() => {
    const U = sobol(res.n, 4);
    return U.map((u) => {
      const q: Record<string, number> = {};
      ORDER.forEach((k, i) => { const [lo, hi] = FAR_BOUNDS[k]; q[k] = 10 ** (Math.log10(lo) + u[i] * (Math.log10(hi) - Math.log10(lo))); });
      const dphi = Math.abs(pointMassDeltaPhi({ ...DEFAULT_DESIGN, mass_A: q.mass, mass_B: q.mass, separation: q.separation, dx_A: q.branch_separation, dx_B: q.branch_separation, time: q.time, geometry: res.geometry as Geometry }));
      const x = e.mass * Math.log10(q.mass) + e.branch_separation * Math.log10(q.branch_separation) + e.time * Math.log10(q.time);
      const y = Math.log10(q.separation), z = Math.log10(dphi);
      const zLaw = c10 + x + e.separation * y;
      return { q, dphi, x, y, z, rel: 10 ** (z - zLaw) - 1 };
    });
  }, [res]);
  const maxRel = Math.max(...data.map((d) => Math.abs(d.rel)));
  const n = data.length;
  const p = usePlayer(n, 20);
  const shown = Math.max(1, Math.min(n, Math.floor(p.pos) + 1));
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const xr: [number, number] = [Math.min(...data.map((d) => d.x)), Math.max(...data.map((d) => d.x))];
  const yr: [number, number] = [Math.log10(FAR_BOUNDS.separation[0]), Math.log10(FAR_BOUNDS.separation[1])];
  const zAll = data.map((d) => d.z);
  const zr: [number, number] = [Math.min(...zAll), Math.max(...zAll)];
  const spec = useMemo(() => {
    const NX = 24, NY = 24;
    const xs = Array.from({ length: NX }, (_, i) => xr[0] + ((xr[1] - xr[0]) * i) / (NX - 1));
    const ys = Array.from({ length: NY }, (_, j) => yr[0] + ((yr[1] - yr[0]) * j) / (NY - 1));
    const z = ys.map((y) => xs.map((x) => { const v = c10 + x + e.separation * y; return v >= zr[0] - 0.5 && v <= zr[1] + 0.5 ? v : null; }));
    return {
      x: { label: 'Σ eᵢ log₁₀ qᵢ (m, Δx, t)', unit: '1', min: xr[0], max: xr[1] }, y: { label: 'log₁₀ d', unit: '1', min: yr[0], max: yr[1] }, z: { label: 'log₁₀ Δφ', unit: '1', min: zr[0] - 0.5, max: zr[1] + 0.5 },
      surfaces: [{ name: 'discovered law', xs, ys, z, color: '#56B4E9', opacity: 0.45, wire: true }],
      points: [{ name: 'designs', pts: data.slice(0, shown).map((d) => [d.x, d.y, d.z] as [number, number, number]), color: '#D55E00', size: 0.02, highlightLast: true }],
    };
  }, [data, shown]);
  const exprX = `${fmtNum(e.mass, 3)}·log₁₀ m + ${fmtNum(e.branch_separation, 3)}·log₁₀ Δx + ${fmtNum(e.time, 3)}·log₁₀ t`;
  const collapsed = data.map((d) => ({ x: d.x + e.separation * d.y, z: d.z })).sort((a, b) => a.x - b.x);
  return (
    <Card title="Sampled designs and the discovered power-law surface" actions={<><ProvBadge kind="COMPUTED_LOCAL" title="Design points re-sampled and evaluated in the browser" /><ProvBadge kind="COMPUTED" title="Law: server fit" /></>}>
      <InfoBanner>The API does not return the server's sampled designs (they come from a scrambled Sobol sequence), so {n} designs are re-sampled here with an <b>unscrambled</b> Sobol sequence over the same far-field bounds and evaluated with the same point-mass entangling phase (local engine). The plane is the <b>server's</b> discovered law: z = {fmtNum(c10, 6)} + x + ({fmtNum(e.separation, 3)})·y with x = {exprX} (rational exponents; intercept = fitted ln-prefactor / ln 10).</InfoBanner>
      <div class="outs">
        <Out label="Max |Δφ_local / Δφ_law − 1|" value={maxRel} sig={3} prov="COMPUTED_LOCAL" interp="Residual of the locally evaluated designs against the server law; small values confirm the law on independent samples." />
        <Out label="Designs shown" value={`${shown} / ${n}`} prov="COMPUTED_LOCAL" interp="Points appear in Sobol order (low-discrepancy filling of the design space)." />
      </div>
      <div class="row-between"><Seg label="View" value={view} onChange={setView} options={[{ v: '3d', label: '3-D' }, { v: '2d', label: '2-D collapse' }]} /></div>
      {view === '3d' ? (
        <View3D kind="plot3d" opts={spec} name="sobol-law" title={`Discovered law and ${shown} sampled designs`} badge="COMPUTED LOCALLY" playing={p.playing}
          label="Three-dimensional scatter of sampled designs on the plane of the discovered power law"
          legend={[{ label: 'designs (local engine)', color: '#D55E00' }, { label: 'discovered law (server fit)', color: '#56B4E9' }]}
          onRecordStart={() => { p.setPos(0); p.setPlaying(true); }}
          frameData={() => ({ law: { log10_prefactor: c10, exponents: e }, designs: data.slice(0, shown).map((d) => ({ ...d.q, delta_phi_rad: d.dphi, rel_residual: d.rel })) })}
          fallback={<Collapse collapsed={collapsed} c10={c10} />} />
      ) : <Collapse collapsed={collapsed} c10={c10} shown={shown} />}
      <PlayerControls p={p} n={n} label="Sobol designs" />
    </Card>
  );
}

function Collapse({ collapsed, c10 }: { collapsed: { x: number; z: number }[]; c10: number; shown?: number }) {
  const xs = collapsed.map((d) => d.x);
  return (
    <LinePlot name="law-collapse" title="Collapse onto the discovered law" desc="log10 of the entangling phase versus the combined exponent sum including separation; the line is the discovered law"
      xLabel="Σ eᵢ log₁₀ qᵢ (incl. d)" yLabel="log₁₀ Δφ"
      series={[{ name: 'discovered law (server)', x: [Math.min(...xs), Math.max(...xs)], y: [c10 + Math.min(...xs), c10 + Math.max(...xs)], color: '#56B4E9', width: 2.5 },
        { name: 'sampled designs (local engine)', x: xs, y: collapsed.map((d) => d.z), color: '#D55E00', markers: true, width: 0.01 }]} />
  );
}
