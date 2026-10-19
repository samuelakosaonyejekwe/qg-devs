/** Suite 13 — Experimental design and optimisation. */
import { useMemo, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, ProvBadge, EvidenceBanner, ErrorBox, DataTable, Btn, Tabs, TabPanel, InfoBanner, Switch, Tip, Level } from '../../components/ui';
import { NumberField, SelectField, useValidity } from '../../components/fields';
import { ScenarioForm } from '../../components/ScenarioForm';
import { JobRunner } from '../../components/JobRunner';
import { HeatMap, LinePlot } from '../../plot/Chart';
import { apiPost, num } from '../../lib/api';
import { useStore, scenario } from '../../lib/store';
import { fmtNum, fmtQ, fmtDuration } from '../../lib/format';
import { hypStyle, IMPLEMENTED_IDS } from '../../lib/hyp';
import type { Design, Geometry } from '../../lib/types';
import { SWEEP_PARAMS, paramInfo, linspace, logspace, nullableMatrix } from './f3-shared';

type SweepParam = 'separation' | 'dx_A' | 'mass_A' | 'time';

// ----------------------------------------------------------------------------- optimiser
interface Candidate {
  design: Design & { radius_A: number; radius_B: number }; log10_total_time_s: number; total_time_s: number; witness_shots_per_setting: number | string;
  predicted_witness: number; delta_phi_grav: number; delta_phi_nongrav: number; decoherence_rate_A: number; dominant_decoherence: string;
  constraints: Record<string, { ok: boolean; [k: string]: unknown }>; robust_discrimination?: { alternative: string; D_per_shot: number; shots_per_setting: number | string; verdict: string }[];
}
interface OptResult { optimiser: string; seed: number; converged: boolean; n_evaluations: number; candidates: Candidate[]; objective: string }

function applyCandidate(c: Candidate) {
  const { radius_A: _a, radius_B: _b, ...d } = c.design;
  scenario.set((s) => ({ ...s, design: { ...s.design, ...d, gamma_A: 0, gamma_B: 0 } }));
}

function Optimiser() {
  const sc = useStore(scenario);
  const v = useValidity();
  const [b, setB] = useState({ m0: 1e-16, m1: 1e-13, d0: 50e-6, d1: 1e-3, x0: 1e-6, x1: 250e-6, t0: 0.1, t1: 5, gap: 10e-6, frac: 0.1, geometry: 'linear' as Geometry });
  const [o, setO] = useState({ seed: 0, maxiter: 30, popsize: 10, top_k: 3, robust: true });
  const [used, setUsed] = useState<number | null>(null);
  const ordered = b.m0 < b.m1 && b.d0 < b.d1 && b.x0 < b.x1 && b.t0 < b.t1;
  const f = (k: keyof typeof b) => (x: number) => setB({ ...b, [k]: x });
  return (
    <div class="split">
      <div class="card sticky-side">
        <h2>Search space &amp; constraints</h2>
        <fieldset class="fieldset"><legend>Bounds</legend><div class="form-grid">
          <NumberField name="m0" label="Mass min" unit="kg" value={b.m0} min={1e-27} max={1e3} minExclusive report={v.report} onChange={f('m0')} help="Lower bound of the mass search (searched on a log scale; both masses equal)." />
          <NumberField name="m1" label="Mass max" unit="kg" value={b.m1} min={1e-27} max={1e3} minExclusive report={v.report} onChange={f('m1')} help="Upper bound of the mass search." />
          <NumberField name="d0" label="Separation min" unit="m" value={b.d0} min={1e-9} max={10} minExclusive report={v.report} onChange={f('d0')} help="Lower bound of the centre-to-centre separation." />
          <NumberField name="d1" label="Separation max" unit="m" value={b.d1} min={1e-9} max={10} minExclusive report={v.report} onChange={f('d1')} help="Upper bound of the separation." />
          <NumberField name="x0" label="Δx min" unit="m" value={b.x0} min={0} max={10} report={v.report} onChange={f('x0')} help="Lower bound of the branch separation (both masses)." />
          <NumberField name="x1" label="Δx max" unit="m" value={b.x1} min={0} max={10} report={v.report} onChange={f('x1')} help="Upper bound of the branch separation; the default 250 µm is an assumed technological limit." />
          <NumberField name="t0" label="Time min" unit="s" value={b.t0} min={0} max={1e4} minExclusive report={v.report} onChange={f('t0')} help="Lower bound of the interaction time." />
          <NumberField name="t1" label="Time max" unit="s" value={b.t1} min={0} max={1e4} minExclusive report={v.report} onChange={f('t1')} help="Upper bound of the interaction time." />
          <NumberField name="gap" label="Min surface gap" unit="m" value={b.gap} min={0} max={1} report={v.report} onChange={f('gap')} help="Closest allowed approach between any two branch surfaces (traps, shielding)." />
          <NumberField name="frac" label="Max non-grav. phase fraction" unit="1" value={b.frac} min={0} max={10} minExclusive report={v.report} onChange={f('frac')} help="Allowed |Δφ_non-grav| / |Δφ_grav| (Casimir–Polder, Coulomb). Designs above it are rejected as confounded." />
          <SelectField label="Geometry" value={b.geometry} onChange={(g: Geometry) => setB({ ...b, geometry: g })} options={[{ v: 'linear', label: 'Linear' }, { v: 'parallel', label: 'Parallel' }]} help="Split-axis orientation used for all candidates." />
        </div>
        {!ordered && <p class="field-error">Each minimum must be smaller than its maximum.</p>}
        </fieldset>
        <fieldset class="fieldset"><legend>Optimiser</legend><div class="form-grid">
          <NumberField name="seed" label="Seed" unit="1" integer value={o.seed} min={0} max={2 ** 31} report={v.report} onChange={(x) => setO({ ...o, seed: x })} help="Random seed of differential evolution (results are reproducible for a fixed seed)." />
          <NumberField name="maxiter" label="Max iterations" unit="1" integer value={o.maxiter} min={1} max={500} report={v.report} onChange={(x) => setO({ ...o, maxiter: x })} help="Differential-evolution generations. More iterations: better convergence, longer job." />
          <NumberField name="popsize" label="Population size" unit="1" integer value={o.popsize} min={2} max={100} report={v.report} onChange={(x) => setO({ ...o, popsize: x })} help="Population multiplier (scipy popsize)." />
          <NumberField name="topk" label="Candidates returned" unit="1" integer value={o.top_k} min={1} max={10} report={v.report} onChange={(x) => setO({ ...o, top_k: x })} help="Number of distinct best designs re-ranked by the robust discrimination engine." />
        </div>
          <Switch checked={o.robust} onChange={(x) => setO({ ...o, robust: x })} label="Re-rank with robust discrimination (slower)" />
        </fieldset>
        <details><summary class="small">Environment used by the optimiser</summary><ScenarioForm value={sc} onChange={(x) => scenario.set(x)} report={v.report} showDesign={false} /></details>
      </div>
      <div class="stack">
        <EvidenceBanner />
        <Card title="Constrained design search">
          <p class="small muted">Objective: minimise log₁₀(3 settings × shots for a 5σ witness violation × (t + 1 s overhead)) under QG-COH with all decoherence and readout effects; constraint violations are reported, never silently dropped.</p>
          <JobRunner type="design_optimise" label="Run optimisation job" disabled={!v.ok || !ordered}
            params={() => ({ environment: sc.environment, bounds: { mass: [b.m0, b.m1], separation: [b.d0, b.d1], dx: [b.x0, b.x1], time: [b.t0, b.t1], min_surface_gap: b.gap, max_casimir_fraction: b.frac, geometry: b.geometry }, seed: o.seed, maxiter: o.maxiter, popsize: o.popsize, top_k: o.top_k, robust_check: o.robust })}>
            {(r: OptResult) => (
              <div class="stack">
                <p class="small"><ProvBadge kind="COMPUTED" /> {r.optimiser}, seed {r.seed}, {r.n_evaluations} evaluations, converged: <b>{String(r.converged)}</b>.</p>
                {r.candidates.length === 0 && <InfoBanner kind="danger">No feasible design was found within these bounds and constraints.</InfoBanner>}
                {r.candidates.map((c, i) => (
                  <div class="card">
                    <div class="row-between"><h3 style={{ margin: 0 }}>Candidate {i + 1}</h3><Btn onClick={() => { applyCandidate(c); setUsed(i); }}>{used === i ? '✓ In use' : 'Use this design'}</Btn></div>
                    <DataTable head={['Mass', 'Separation', 'Δx', 'Time', 'Geometry', 'Total time', 'Shots / setting', 'Predicted ⟨W⟩', 'Δφ grav', 'Δφ non-grav', 'Γ_env (A)', 'Dominant decoherence']}
                      numeric={[0, 1, 2, 3, 5, 6, 7, 8, 9, 10]}
                      rows={[[fmtQ(c.design.mass_A, 'kg'), fmtQ(c.design.separation, 'm'), fmtQ(c.design.dx_A, 'm'), fmtQ(c.design.time, 's'), c.design.geometry, fmtDuration(c.total_time_s),
                        fmtNum(num(c.witness_shots_per_setting), 4), fmtNum(c.predicted_witness, 4), `${fmtNum(c.delta_phi_grav, 4)} rad`, `${fmtNum(c.delta_phi_nongrav, 4)} rad`, fmtQ(c.decoherence_rate_A, 's⁻¹'), c.dominant_decoherence.replace(/_/g, ' ')]]} />
                    <p class="small" style={{ marginTop: '6px' }}>Constraints: {Object.entries(c.constraints).map(([k, x]) => <span class={`badge ${x.ok ? 'b-ok' : 'b-bad'}`} style={{ marginRight: '4px' }}>{k.replace(/_/g, ' ')}: {x.ok ? 'ok' : 'violated'}</span>)}</p>
                    {c.robust_discrimination && (
                      <DataTable head={['QG-COH vs', 'D per shot', 'Shots / setting', 'Verdict']} numeric={[1, 2]}
                        rows={c.robust_discrimination.map((p) => [<span><span class="swatch" style={{ background: hypStyle(p.alternative).color }} /> {p.alternative}</span>, fmtNum(p.D_per_shot, 4), fmtNum(num(p.shots_per_setting), 4), p.verdict])} />
                    )}
                  </div>
                ))}
                <p class="small muted">Shots are statistical only (systematic errors excluded). “Use this design” copies the candidate into the shared working scenario used by the flagship page and the other suites.</p>
              </div>
            )}
          </JobRunner>
        </Card>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- axis inputs
interface Axis { p: SweepParam; a: number; b: number; n: number; log: boolean }
function axisValues(x: Axis): number[] { return x.log ? logspace(x.a, x.b, x.n) : linspace(x.a, x.b, x.n); }
function axisErr(x: Axis): string | null {
  if (!(x.a < x.b)) return 'start must be below stop';
  if (x.log && !(x.a > 0)) return 'log spacing needs a positive start';
  return null;
}
function AxisInputs({ name, x, set, report, others, maxN }: { name: string; x: Axis; set: (a: Axis) => void; report: (n: string, e: string | null) => void; others?: SweepParam; maxN: number }) {
  const info = paramInfo(x.p);
  return (
    <fieldset class="fieldset"><legend>{name}</legend>
      <SelectField label="Parameter" value={x.p} onChange={(p: SweepParam) => { const def: Record<string, [number, number]> = { separation: [2e-4, 1e-3], dx_A: [1e-5, 2.5e-4], mass_A: [1e-16, 1e-13], time: [0.1, 5] }; set({ ...x, p, a: def[p][0], b: def[p][1], log: p === 'mass_A' }); }}
        options={SWEEP_PARAMS.filter((s) => s.v !== others).map((s) => ({ v: s.v, label: s.label }))} help="Design parameter varied along this axis (mass and Δx are applied to both particles)." />
      <div class="form-grid">
        <NumberField name={`${name}a`} label="Start" unit={info.unit} value={x.a} min={info.min} max={info.max} report={report} onChange={(a) => set({ ...x, a })} help={`First value of ${info.label}.`} />
        <NumberField name={`${name}b`} label="Stop" unit={info.unit} value={x.b} min={info.min} max={info.max} report={report} onChange={(b) => set({ ...x, b })} help={`Last value of ${info.label}.`} />
        <NumberField name={`${name}n`} label="Points" unit="1" integer value={x.n} min={2} max={maxN} report={report} onChange={(n) => set({ ...x, n })} help="Number of grid points along this axis." />
      </div>
      <Switch checked={x.log} onChange={(log) => set({ ...x, log })} label="Logarithmic spacing" />
      {axisErr(x) && <p class="field-error">{axisErr(x)}</p>}
    </fieldset>
  );
}

// ----------------------------------------------------------------------------- 2-D sweep
interface Sweep2D { x: { name: string; values: number[] }; y: { name: string; values: number[] }; negativity: (number | null)[][]; witness: (number | null)[][]; hypothesis: string }

function Sweep2DView() {
  const sc = useStore(scenario);
  const v = useValidity();
  const [ax, setAx] = useState<Axis>({ p: 'separation', a: 2e-4, b: 1e-3, n: 20, log: false });
  const [ay, setAy] = useState<Axis>({ p: 'dx_A', a: 1e-5, b: 2.5e-4, n: 20, log: false });
  const [hyp, setHyp] = useState('QG-COH');
  const [res, setRes] = useState<Sweep2D | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const cells = ax.n * ay.n;
  const ok = v.ok && !axisErr(ax) && !axisErr(ay) && cells <= 2500 && ax.p !== ay.p;
  const run = async () => {
    setBusy(true); setErr(null);
    try { setRes(await apiPost<Sweep2D>('/api/bmv/sweep2d', { ...sc, px: ax.p, xs: axisValues(ax), py: ay.p, ys: axisValues(ay), hypothesis: hyp })); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const xi = res ? paramInfo(res.x.name) : null, yi = res ? paramInfo(res.y.name) : null;
  const neg = useMemo(() => (res ? nullableMatrix(res.negativity) : null), [res]);
  const wit = useMemo(() => (res ? nullableMatrix(res.witness) : null), [res]);
  const nNull = neg ? neg.flat().filter((x) => x == null).length : 0;
  const nCert = wit ? wit.flat().filter((x) => x != null && x < 0).length : 0;
  return (
    <div class="split">
      <div class="card sticky-side">
        <h2>2-D sweep</h2>
        <AxisInputs name="x axis" x={ax} set={setAx} report={v.report} others={ay.p} maxN={50} />
        <AxisInputs name="y axis" x={ay} set={setAy} report={v.report} others={ax.p} maxN={50} />
        <SelectField label="Hypothesis" value={hyp} onChange={setHyp} options={IMPLEMENTED_IDS.map((i) => ({ v: i, label: `${i} — ${hypStyle(i).short}` }))} help="Model whose negativity and witness are mapped." />
        <p class={cells > 2500 ? 'field-error' : 'small muted'}>{cells} grid cells (interactive limit 2500 = 50 × 50; larger grids must be run as jobs).</p>
        <details><summary class="small">Base scenario (other parameters)</summary><ScenarioForm value={sc} onChange={(x) => scenario.set(x)} report={v.report} /></details>
        <Btn kind="primary" busy={busy} disabled={!ok} onClick={run}>Run 2-D sweep</Btn>
      </div>
      <div class="stack">
        <EvidenceBanner />
        <ErrorBox error={err} what="running POST /api/bmv/sweep2d" />
        {res && neg && wit && xi && yi && (<>
          <InfoBanner>Hatched cells are <b>inadmissible geometry</b>: there the branches overlap or touch, or Δx does not exceed the particle diameter (qgdevs.bmv.check_geometry) — no prediction is made. {nNull} of {neg.length * (neg[0]?.length ?? 0)} cells are inadmissible; {nCert} cells predict a certifiable witness (⟨W⟩ &lt; 0).</InfoBanner>
          <Card title={`Negativity — ${res.hypothesis}`} actions={<ProvBadge kind="COMPUTED" />}>
            <HeatMap name="sweep2d-negativity" desc={`negativity of ${res.hypothesis} over ${xi.label} and ${yi.label}`} z={neg} x={res.x.values} y={res.y.values}
              xLabel={xi.label} xUnit={xi.unit} yLabel={yi.label} yUnit={yi.unit} zLabel="negativity" palette="viridis" nullLabel="inadmissible geometry" />
            <p class="small muted">Negativity &gt; 0 ⇔ the predicted two-qubit state is entangled (PPT criterion; maximum 0.5).</p>
          </Card>
          <Card title={`CPK witness ⟨W⟩ — ${res.hypothesis}`} actions={<ProvBadge kind="COMPUTED" />}>
            <HeatMap name="sweep2d-witness" desc={`witness of ${res.hypothesis}; the black outline marks W = 0`} z={wit} x={res.x.values} y={res.y.values}
              xLabel={xi.label} xUnit={xi.unit} yLabel={yi.label} yUnit={yi.unit} zLabel="⟨W⟩" palette="diverging" symmetric contour0 nullLabel="inadmissible geometry" />
            <p class="small muted">Blue (⟨W⟩ &lt; 0) certifies entanglement with three local settings in the preregistered protocol frame; the outline is the W = 0 boundary. Axis ticks are cell centres{ax.log || ay.log ? ' (log-spaced grid)' : ''}.</p>
          </Card>
        </>)}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- 1-D sweep
interface Row1D { value: number; admissible: boolean; delta_phi?: number; gamma_env?: number; models?: Record<string, { negativity: number; witness: number; coherence: number }> }

function Sweep1DView() {
  const sc = useStore(scenario);
  const v = useValidity();
  const [ax, setAx] = useState<Axis>({ p: 'separation', a: 2e-4, b: 1e-3, n: 30, log: false });
  const [res, setRes] = useState<{ parameter: string; rows: Row1D[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setRes(await apiPost('/api/bmv/sweep1d', sc, { param: ax.p, start: ax.a, stop: ax.b, n: ax.n })); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const info = res ? paramInfo(res.parameter) : null;
  const xs = res?.rows.map((r) => r.value) ?? [];
  const ids = res ? Object.keys(res.rows.find((r) => r.models)?.models ?? {}) : [];
  const series = (k: 'negativity' | 'witness') => ids.map((id) => ({ name: id, color: hypStyle(id).color, dash: hypStyle(id).dash, x: xs, y: res!.rows.map((r) => (r.admissible && r.models ? r.models[id][k] : NaN)) }));
  const bad = res?.rows.filter((r) => !r.admissible) ?? [];
  return (
    <div class="split">
      <div class="card sticky-side">
        <h2>1-D sweep</h2>
        <fieldset class="fieldset"><legend>Parameter</legend>
          <SelectField label="Parameter" value={ax.p} onChange={(p: SweepParam) => { const def: Record<string, [number, number]> = { separation: [2e-4, 1e-3], dx_A: [1e-5, 2.5e-4], mass_A: [1e-16, 1e-13], time: [0.1, 5] }; setAx({ ...ax, p, a: def[p][0], b: def[p][1] }); }}
            options={SWEEP_PARAMS.map((s) => ({ v: s.v, label: s.label }))} help="Design parameter varied (mass and Δx apply to both particles)." />
          <div class="form-grid">
            <NumberField name="a" label="Start" unit={paramInfo(ax.p).unit} value={ax.a} min={paramInfo(ax.p).min} max={paramInfo(ax.p).max} report={v.report} onChange={(a) => setAx({ ...ax, a })} help="First value (the server uses linear spacing)." />
            <NumberField name="b" label="Stop" unit={paramInfo(ax.p).unit} value={ax.b} min={paramInfo(ax.p).min} max={paramInfo(ax.p).max} report={v.report} onChange={(b) => setAx({ ...ax, b })} help="Last value." />
            <NumberField name="n" label="Points" unit="1" integer value={ax.n} min={2} max={120} report={v.report} onChange={(n) => setAx({ ...ax, n })} help="Number of points (server limit 120)." />
          </div>
          {!(ax.a < ax.b) && <p class="field-error">Start must be below stop.</p>}
        </fieldset>
        <details><summary class="small">Base scenario (other parameters)</summary><ScenarioForm value={sc} onChange={(x) => scenario.set(x)} report={v.report} /></details>
        <Btn kind="primary" busy={busy} disabled={!v.ok || !(ax.a < ax.b)} onClick={run}>Run 1-D sweep</Btn>
      </div>
      <div class="stack">
        <EvidenceBanner />
        <ErrorBox error={err} what="running POST /api/bmv/sweep1d" />
        {res && info && (<>
          <Card title="Negativity of every hypothesis" actions={<ProvBadge kind="COMPUTED" />}>
            <LinePlot name="sweep1d-negativity" desc="negativity versus the swept parameter" series={series('negativity')} xLabel={info.label} xUnit={info.unit} yLabel="Negativity" logX={res.parameter === 'mass_A' && xs[0] > 0} />
          </Card>
          <Card title="CPK witness of every hypothesis" actions={<ProvBadge kind="COMPUTED" />}>
            <LinePlot name="sweep1d-witness" desc="witness versus the swept parameter; below zero certifies entanglement" series={series('witness')} xLabel={info.label} xUnit={info.unit} yLabel="⟨W⟩"
              hlines={[{ y: 0, label: 'W = 0' }]} shadeBelow={{ y: 0, label: 'entanglement certified', color: 'rgba(0,114,178,0.08)' }} logX={res.parameter === 'mass_A' && xs[0] > 0} />
            <p class="small muted">Curves for models with identical predictions overlap (dash patterns distinguish them). Gaps mark inadmissible geometries.</p>
          </Card>
          <Level min="advanced">
            <Card title="Δφ (gravity) and environmental decoherence">
              <LinePlot name="sweep1d-dphi" desc="gravitational entangling phase versus the swept parameter" series={[{ name: 'Δφ_grav', color: hypStyle('QG-COH').color, x: xs, y: res.rows.map((r) => (r.admissible ? r.delta_phi ?? NaN : NaN)) }]} xLabel={info.label} xUnit={info.unit} yLabel="Δφ_grav" yUnit="rad" />
              <LinePlot name="sweep1d-gamma" desc="environmental decoherence rate versus the swept parameter" logY series={[{ name: 'Γ_env (A)', color: '#D55E00', x: xs, y: res.rows.map((r) => (r.admissible ? r.gamma_env ?? NaN : NaN)) }]} xLabel={info.label} xUnit={info.unit} yLabel="Γ_env" yUnit="s⁻¹" />
            </Card>
          </Level>
          {bad.length > 0 && <InfoBanner kind="danger">{bad.length} inadmissible point(s) (geometry check failed, no prediction): {bad.map((r) => fmtQ(r.value, info.unit)).join(', ')}.</InfoBanner>}
        </>)}
      </div>
    </div>
  );
}

export default function Page(_props: { suite?: number }) {
  const [tab, setTab] = useState('opt');
  return (
    <div>
      <SuiteHeader n={13} intro="Constrained design search (differential evolution with multi-fidelity re-ranking by robust model discrimination) and 1-D/2-D parameter sweeps of every hypothesis' predicted entanglement and witness. Infeasible regions are explained, never silently dropped." />
      <div class="tabs">
        <Tabs label="Suite 13 sections" active={tab} onChange={setTab} tabs={[{ id: 'opt', label: 'Design optimisation' }, { id: 's2', label: '2-D sweep' }, { id: 's1', label: '1-D sweep' }]} />
        <TabPanel id="opt" active={tab}><Optimiser /></TabPanel>
        <TabPanel id="s2" active={tab}><Sweep2DView /></TabPanel>
        <TabPanel id="s1" active={tab}><Sweep1DView /></TabPanel>
      </div>
      <p class="small muted">Tip <Tip text="All sweeps use the shared working scenario for every parameter not being swept; edit it here or on the flagship page." /></p>
    </div>
  );
}
