import { RunBar } from '../../components/Reset';
/** Suite 1 — Lindblad playground (POST /api/quantum/lindblad) with populations, purity, state checks and a Bloch sphere. */
import { useMemo, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, Out, EvidenceBanner, ErrorBox, DataTable, Json, Level, Seg, InfoBanner, ProvBadge, StatusBadge } from '../../components/ui';
import { NumberField, SelectField, useValidity } from '../../components/fields';
import { LinePlot } from '../../plot/Chart';
import { View3D } from '../../components/View3D';
import { usePlayer, PlayerControls, interp, type PlayerState } from '../../components/Player';
import { apiPost, isOfflineError } from '../../lib/api';
import { fmtNum, fmtTime } from '../../lib/format';
import { checkDensityMatrix } from '../../engine/index';
import { fromArrays } from '../../engine/linalg';
import { useRun, pool, SERIES_COLORS } from './f1-shared';

type M = number[][];
interface Op { name: string; rate: number; re: M; im: M }
interface Model { dim: number; H_re: M; H_im: M; ops: Op[]; basis: string[] }
interface LindbladOut { t: number[]; populations: number[][]; purity: number[]; checks: { trace: number; hermiticity_error: number; min_eigenvalue: number; purity: number; tolerance: number; passed: boolean }[]; final_re: M; final_im: M }

const Z2 = (): M => [[0, 0], [0, 0]];
const X: M = [[0, 1], [1, 0]], Zm: M = [[1, 0], [0, -1]], SM: M = [[0, 1], [0, 0]]; // σ− = |0⟩⟨1|
const scale = (a: M, s: number): M => a.map((r) => r.map((v) => v * s));
const kron = (a: M, b: M): M => { const n = a.length, m = b.length; const o: M = Array.from({ length: n * m }, () => new Array(n * m).fill(0)); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < m; k++) for (let l = 0; l < m; l++) o[i * m + k][j * m + l] = a[i][j] * b[k][l]; return o; };
const I2: M = [[1, 0], [0, 1]];
const zerosN = (n: number): M => Array.from({ length: n }, () => new Array(n).fill(0));

type PresetId = 'rabi' | 'damping' | 'dephasing' | 'driven' | 'twoqubit';
interface Params { omega: number; gamma: number; J: number }
const PRESETS: { v: PresetId; label: string; desc: string }[] = [
  { v: 'rabi', label: 'Rabi drive', desc: 'H/ħ = (Ω/2)σx — coherent population oscillation P₁(t) = sin²(Ωt/2); no dissipation, purity stays 1.' },
  { v: 'damping', label: 'Amplitude damping', desc: 'H = 0, L = √γ σ− — spontaneous decay |1⟩ → |0⟩ with P₁(t) = e^{−γt}.' },
  { v: 'dephasing', label: 'Pure dephasing', desc: 'H/ħ = (Ω/2)σz, L = √(γ/2) σz — coherences decay as e^{−γt} while populations stay fixed (the Bloch vector spirals onto the z axis).' },
  { v: 'driven', label: 'Driven–damped qubit', desc: 'H/ħ = (Ω/2)σx, L = √γ σ− — damped Rabi oscillation relaxing to a mixed steady state.' },
  { v: 'twoqubit', label: 'Two qubits, ZZ coupling + dephasing', desc: 'H/ħ = J σz⊗σz, L = √(γ/2) σz⊗1 — the gravity-like entangling interaction of the BMV protocol with dephasing on qubit A.' },
];

function build(id: PresetId, p: Params): Model {
  switch (id) {
    case 'rabi': return { dim: 2, H_re: scale(X, p.omega / 2), H_im: Z2(), ops: [], basis: ['|0⟩', '|1⟩'] };
    case 'damping': return { dim: 2, H_re: Z2(), H_im: Z2(), ops: [{ name: 'σ−', rate: p.gamma, re: SM, im: Z2() }], basis: ['|0⟩', '|1⟩'] };
    case 'dephasing': return { dim: 2, H_re: scale(Zm, p.omega / 2), H_im: Z2(), ops: [{ name: 'σz (rate γ/2)', rate: p.gamma / 2, re: Zm, im: Z2() }], basis: ['|0⟩', '|1⟩'] };
    case 'driven': return { dim: 2, H_re: scale(X, p.omega / 2), H_im: Z2(), ops: [{ name: 'σ−', rate: p.gamma, re: SM, im: Z2() }], basis: ['|0⟩', '|1⟩'] };
    case 'twoqubit': return { dim: 4, H_re: scale(kron(Zm, Zm), p.J), H_im: zerosN(4), ops: [{ name: 'σz⊗1 (rate γ/2)', rate: p.gamma / 2, re: kron(Zm, I2), im: zerosN(4) }], basis: ['|00⟩', '|01⟩', '|10⟩', '|11⟩'] };
  }
}

type RhoId = 'zero' | 'one' | 'plus' | 'mixed';
function rho0(id: RhoId, dim: number): { re: M; im: M } {
  const one = (v: number[]) => v.map((a) => v.map((b) => a * b));
  const single: Record<RhoId, M> = { zero: [[1, 0], [0, 0]], one: [[0, 0], [0, 1]], plus: [[0.5, 0.5], [0.5, 0.5]], mixed: [[0.5, 0], [0, 0.5]] };
  if (dim === 2) return { re: single[id], im: Z2() };
  // two qubits: product of the same single-qubit state on each qubit
  const s = single[id];
  void one;
  return { re: kron(s, s), im: zerosN(4) };
}

function hermitianError(re: M, im: M): number {
  let e = 0;
  for (let i = 0; i < re.length; i++) for (let j = 0; j < re.length; j++) e = Math.max(e, Math.abs(re[i][j] - re[j][i]), Math.abs(im[i][j] + im[j][i]));
  return e;
}

/** Bloch vector of a single-qubit ρ = (1 + x σx + y σy + z σz)/2. */
function bloch(re: M, im: M): [number, number, number] {
  return [2 * re[0][1], -2 * im[0][1], re[0][0] - re[1][1]];
}

function MatrixEditor({ label, m, onChange, disabled }: { label: string; m: M; onChange: (m: M) => void; disabled?: boolean }) {
  return (
    <fieldset class="fieldset">
      <legend>{label}</legend>
      <table class="matrix" role="grid" aria-label={label}>
        <tbody>{m.map((row, i) => <tr>{row.map((v, j) => (
          <td><input class="input" style={{ width: '6.5em', padding: '3px 5px' }} aria-label={`${label} row ${i + 1} column ${j + 1}`} value={String(v)} disabled={disabled}
            onChange={(e: any) => { const x = Number(e.currentTarget.value); const n = m.map((r) => r.slice()); n[i][j] = Number.isFinite(x) ? x : NaN; onChange(n); }} /></td>
        ))}</tr>)}</tbody>
      </table>
    </fieldset>
  );
}

export default function Page(_props: { suite?: number }) {
  const v = useValidity();
  const [preset, setPreset] = useState<PresetId>('driven');
  const [par, setPar] = useState<Params>({ omega: 2 * Math.PI, gamma: 0.5, J: Math.PI / 4 });
  const [rid, setRid] = useState<RhoId>('zero');
  const [tFinal, setTFinal] = useState(5);
  const [nTimes, setNTimes] = useState(100);
  const [custom, setCustom] = useState<Model | null>(null);
  const model = custom ?? build(preset, par);
  const r0 = rho0(rid, model.dim);

  const herr = hermitianError(model.H_re, model.H_im);
  const hOk = Number.isFinite(herr) && herr <= 1e-12 && model.H_re.every((r) => r.every(Number.isFinite));
  const rhoCheck = useMemo(() => checkDensityMatrix(fromArrays(r0.re, r0.im), 1e-8), [rid, model.dim]);

  const main = useRun<LindbladOut>();
  const blochRun = useRun<{ t: number[]; path: [number, number, number][] }>();
  const [bprog, setBprog] = useState(0);
  const player = usePlayer(blochRun.data?.path.length ?? 0, 8);

  const body = (t_final: number, n: number) => ({
    H_re: model.H_re, H_im: model.H_im,
    L_re: model.ops.map((o) => scale(o.re, Math.sqrt(o.rate))), L_im: model.ops.map((o) => scale(o.im, Math.sqrt(o.rate))),
    rho0_re: r0.re, rho0_im: r0.im, t_final, n_times: n,
  });
  const canRun = v.ok && hOk && rhoCheck.passed && model.ops.every((o) => o.rate >= 0 && Number.isFinite(o.rate));

  const run = () => {
    main.run(() => apiPost<LindbladOut>('/api/quantum/lindblad', body(tFinal, nTimes)));
    blochRun.setData(null);
  };
  const runBloch = () => {
    const N = 24;
    const ts = Array.from({ length: N }, (_, k) => (tFinal * (k + 1)) / N);
    setBprog(0);
    blochRun.run(async () => {
      const outs = await pool(ts.map((t) => () => apiPost<LindbladOut>('/api/quantum/lindblad', body(t, 2))), 4, setBprog);
      // t = 0 point is the (validated) initial state itself; all later points are server-computed ρ(t_k).
      return { t: [0, ...ts], path: [bloch(r0.re, r0.im), ...outs.map((o) => bloch(o.final_re, o.final_im))] };
    });
  };

  const d = main.data;
  const single = model.dim === 2;
  const presetDesc = custom ? 'Custom model edited in Expert mode.' : PRESETS.find((p) => p.v === preset)!.desc;
  const path = blochRun.data?.path;
  const fr = Math.min(player.frame, (path?.length ?? 1) - 1);

  return (
    <div>
      <SuiteHeader n={1} intro="Open-system quantum dynamics: the server integrates the Lindblad master equation dρ/dt = −i[H,ρ] + Σ_k (L_k ρ L_k† − ½{L_k†L_k, ρ}) with a sparse Krylov propagator (H in units of ħ, i.e. rad/s). Use it to build intuition for the dephasing that competes with gravitational entanglement." />
      <div class="split">
        <div class="card sticky-side">
          <h2>Model</h2>
          <SelectField label="Preset" value={preset} onChange={(p) => { setPreset(p as PresetId); setCustom(null); blochRun.setData(null); }}
            options={PRESETS.map((p) => ({ v: p.v, label: p.label }))} help="Exactly solvable reference systems. Each preset builds H and the Lindblad operators from the parameters below." />
          <p class="small muted">{presetDesc}</p>
          {!custom && (preset === 'rabi' || preset === 'dephasing' || preset === 'driven') && (
            <NumberField name="omega" label={preset === 'dephasing' ? 'Level splitting Ω' : 'Rabi frequency Ω'} unit="rad/s" value={par.omega} min={0} max={1e6} report={v.report}
              onChange={(x) => setPar({ ...par, omega: x })} help="Angular frequency in H/ħ. A Rabi drive of strength Ω flips the qubit in time π/Ω; a splitting Ω makes the Bloch vector precess about z at rate Ω." />
          )}
          {!custom && preset !== 'rabi' && (
            <NumberField name="gamma" label="Rate γ" unit="s⁻¹" value={par.gamma} min={0} max={1e6} report={v.report} onChange={(x) => setPar({ ...par, gamma: x })}
              help="Dissipation rate. For amplitude damping, P₁ decays as e^{−γt}; for pure dephasing, coherences decay as e^{−γt} (operator √(γ/2) σz)." />
          )}
          {!custom && preset === 'twoqubit' && (
            <NumberField name="J" label="Coupling J" unit="rad/s" value={par.J} min={0} max={1e6} report={v.report} onChange={(x) => setPar({ ...par, J: x })}
              help="ZZ coupling H/ħ = J σz⊗σz: the same diagonal, branch-dependent energy structure as the gravitational BMV interaction. Entangling phase Δφ = 4Jt." />
          )}
          <SelectField label="Initial state ρ₀" value={rid} onChange={(x) => { setRid(x as RhoId); blochRun.setData(null); }}
            options={[{ v: 'zero', label: model.dim === 2 ? '|0⟩' : '|00⟩' }, { v: 'one', label: model.dim === 2 ? '|1⟩' : '|11⟩' }, { v: 'plus', label: model.dim === 2 ? '|+⟩' : '|++⟩' }, { v: 'mixed', label: 'maximally mixed' }]}
            help="Initial density matrix (product state for two qubits). It is validated (unit trace, Hermitian, positive semidefinite) before sending." />
          <NumberField name="tf" label="Final time" unit="s" value={tFinal} min={0} max={1e6} minExclusive report={v.report} onChange={setTFinal} help="Integration end time (server limit 0 < t ≤ 10⁶ s)." />
          <NumberField name="nt" label="Output samples" unit="1" value={nTimes} min={2} max={500} integer report={v.report} onChange={setNTimes} help="Number of equally spaced output times (server limit 2–500)." />
          <Level min="expert">
            <details>
              <summary>Edit matrices (H/ħ and Lindblad operators)</summary>
              <p class="small muted">Entries in rad/s (H) and dimensionless operators (L = √rate · op). H must be Hermitian.</p>
              {!custom && <button type="button" class="btn-sm" onClick={() => setCustom(JSON.parse(JSON.stringify(model)))}>Start editing from this preset</button>}
              {custom && (<>
                <MatrixEditor label="Re H/ħ" m={custom.H_re} onChange={(m) => setCustom({ ...custom, H_re: m })} />
                <MatrixEditor label="Im H/ħ" m={custom.H_im} onChange={(m) => setCustom({ ...custom, H_im: m })} />
                {custom.ops.map((o, k) => (
                  <div key={k}>
                    <NumberField name={`rate${k}`} label={`Rate of L${k + 1} (${o.name})`} unit="s⁻¹" value={o.rate} min={0} max={1e9} report={v.report}
                      onChange={(x) => { const ops = custom.ops.slice(); ops[k] = { ...o, rate: x }; setCustom({ ...custom, ops }); }} help="L_k = √rate · operator." />
                    <MatrixEditor label={`Re op ${k + 1}`} m={o.re} onChange={(m) => { const ops = custom.ops.slice(); ops[k] = { ...o, re: m }; setCustom({ ...custom, ops }); }} />
                  </div>
                ))}
                <button type="button" class="btn-sm" onClick={() => setCustom(null)}>Discard edits</button>
              </>)}
            </details>
          </Level>
          {!hOk && <div class="field-error" role="alert">H is not Hermitian (max |H − H†| = {fmtNum(herr)}); fix it before running.</div>}
          {!rhoCheck.passed && <div class="field-error" role="alert">ρ₀ is not a valid density matrix.</div>}
          <div class="row" style={{ marginTop: '8px' }}>
            <RunBar label="Run Lindblad evolution" busy={main.busy} disabled={!canRun} onRun={run} />
          </div>
        </div>

        <div class="stack">
          <EvidenceBanner />
          <ErrorBox error={main.err} what="running the Lindblad solver" />
          {main.err && isOfflineError(main.err) ? <p class="small muted">No fresh data was fetched; this suite requires the server.</p> : null}
          {!d && !main.busy && <InfoBanner>Choose a preset and press <b>Run Lindblad evolution</b>. All curves are computed by the server.</InfoBanner>}
          {d && (<>
            <Card title="Results" actions={<><ProvBadge kind="COMPUTED" /><span class="small muted">{fmtTime(main.at)}</span></>}>
              <div class="outs">
                <Out label="Final purity tr ρ²" value={d.purity[d.purity.length - 1]} prov="COMPUTED" interp="1 = pure state; 1/d = maximally mixed. Dissipation lowers purity." />
                {d.populations[0].map((_, k) => <Out label={`Final population ${model.basis[k]}`} value={d.populations[d.populations.length - 1][k]} prov="COMPUTED" interp="Diagonal element ρ_kk at the final time." />)}
                <Out label="All state checks" value={d.checks.every((c) => c.passed) ? 'passed' : 'FAILED'} tone={d.checks.every((c) => c.passed) ? 'good' : 'bad'} prov="COMPUTED" interp="Unit trace, Hermiticity and positivity of ρ(t) at sampled times, within the server tolerance." />
              </div>
            </Card>
            <Card title="Populations and purity">
              <div class="grid-2">
                <LinePlot name="lindblad-populations" title="Populations ρ_kk(t)" desc="Diagonal elements of the density matrix versus time" xLabel="Time" xUnit="s" yLabel="Population" yUnit="1"
                  series={d.populations[0].map((_, k) => ({ name: model.basis[k], x: d.t, y: d.populations.map((p) => p[k]), color: SERIES_COLORS[k] }))} />
                <LinePlot name="lindblad-purity" title="Purity tr ρ²(t)" desc="Purity of the state versus time" xLabel="Time" xUnit="s" yLabel="Purity" yUnit="1"
                  series={[{ name: 'tr ρ²', x: d.t, y: d.purity, color: SERIES_COLORS[0] }]} />
              </div>
            </Card>
            <Card title="Density-matrix checks (sampled)">
              <DataTable head={['#', 'trace', '|H − H†| max', 'min eigenvalue', 'purity', 'status']} numeric={[1, 2, 3, 4]}
                rows={d.checks.map((c, i) => [i + 1, fmtNum(c.trace, 12), fmtNum(c.hermiticity_error), fmtNum(c.min_eigenvalue), fmtNum(c.purity, 6), <StatusBadge status={c.passed ? 'PASSED' : 'FAILED'} />])} />
            </Card>
            <Card title="Bloch sphere">
              {!single ? <p class="muted">The Bloch sphere represents a single qubit; this preset has two qubits.</p> : (<>
                <p class="small muted">The path is assembled from {24} separate server evaluations of ρ(t_k) (t_k = k·t_final/24). During playback the display interpolates between neighbouring samples; the controls state which samples are shown. The arrow length is |r| (1 = pure).</p>
                <div class="row">
                  <RunBar label={path ? 'Recompute Bloch path' : 'Compute Bloch path (24 server calls)'} busy={blochRun.busy} disabled={!canRun} onRun={runBloch} />
                  {blochRun.busy && <span class="small muted" aria-live="polite">{bprog}/24 evaluations…</span>}
                </div>
                <ErrorBox error={blochRun.err} what="computing the Bloch path" />
                {path && (<>
                  <PlayerControls p={player} n={path.length} t={blochRun.data!.t} label="Bloch vector" />
                  <BlochViews path={path} frame={fr} t={blochRun.data!.t} p={player} />
                </>)}
              </>)}
            </Card>
            <Level min="expert"><Card title="Raw response"><Json data={d} /></Card></Level>
          </>)}
        </div>
      </div>
    </div>
  );
}

function BlochViews({ path, frame, t, p }: { path: [number, number, number][]; frame: number; t: number[]; p: PlayerState }) {
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const xs = path.map((p) => p[0]), ys = path.map((p) => p[1]), zs = path.map((p) => p[2]);
  const r = path[frame];
  const pos = Math.min(p.pos, path.length - 1);
  const cur = [interp(xs, pos), interp(ys, pos), interp(zs, pos)];
  const fallback = (
    <div class="grid-2">
      <LinePlot name="bloch-xz" title="x–z projection" desc="Bloch vector path projected on the x–z plane" xLabel="x = ⟨σx⟩" yLabel="z = ⟨σz⟩" xDomain={[-1.05, 1.05]} yDomain={[-1.05, 1.05]} aspect={1}
        series={[{ name: 'solver samples', x: xs.slice(0, frame + 1), y: zs.slice(0, frame + 1), color: SERIES_COLORS[0], markers: true }, { name: 'displayed state', x: [cur[0]], y: [cur[2]], color: SERIES_COLORS[4], markers: true }]} />
      <LinePlot name="bloch-xy" title="x–y projection" desc="Bloch vector path projected on the x–y plane" xLabel="x = ⟨σx⟩" yLabel="y = ⟨σy⟩" xDomain={[-1.05, 1.05]} yDomain={[-1.05, 1.05]} aspect={1}
        series={[{ name: 'solver samples', x: xs.slice(0, frame + 1), y: ys.slice(0, frame + 1), color: SERIES_COLORS[1], markers: true }, { name: 'displayed state', x: [cur[0]], y: [cur[1]], color: SERIES_COLORS[4], markers: true }]} />
    </div>
  );
  return (
    <div class="stack">
      <Seg label="Bloch view" value={view} onChange={setView} options={[{ v: '3d', label: '3-D sphere' }, { v: '2d', label: '2-D projections' }]} />
      {view === '3d' ? <View3D kind="bloch" label="Bloch sphere with the computed state trajectory" opts={{ path, index: pos, labels: true }} frame={pos} fallback={fallback}
        title="Bloch vector r(t) = (⟨σx⟩, ⟨σy⟩, ⟨σz⟩)" badge="COMPUTED" name="bloch" legend={[{ label: 'path through server samples', color: 'var(--accent)' }]}
        onRecordStart={() => { p.setPos(0); p.setPlaying(true); }} playing={p.playing}
        frameData={() => ({ nearest_sample: frame, t_s: t[frame], bloch_vector: path[frame], displayed_interpolated: cur, source: 'COMPUTED (server, POST /api/quantum/lindblad)' })} /> : fallback}
      <div class="outs">
        <Out label={`⟨σx⟩ at nearest solver sample t = ${fmtNum(t[frame])} s`} value={r[0]} prov="COMPUTED" />
        <Out label="⟨σy⟩" value={r[1]} prov="COMPUTED" />
        <Out label="⟨σz⟩" value={r[2]} prov="COMPUTED" />
        <Out label="|r|" value={Math.hypot(...r)} prov="COMPUTED" interp="1 for pure states, < 1 for mixed states (purity = (1 + |r|²)/2)." />
      </div>
    </div>
  );
}
