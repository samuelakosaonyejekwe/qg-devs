import { Tex, MathText } from '../components/Tex';
import { T, F } from './formulas-l1';
import { RunBar, useAfterReset } from '../components/Reset';
/**
 * Flagship workflow — Suite 4 (gravity-mediated entanglement) and the Experiment Builder.
 *
 * Edits the BMV design and environment, calls POST /api/bmv/predict (falls back to the local engine only
 * when the API is unreachable, and labels the result accordingly), and shows the entangling phase,
 * entanglement measures, witnesses, decoherence budget, non-gravitational channels, competing-model
 * predictions, time series, an animated 3-D/2-D apparatus view and a side-by-side hypothesis comparison.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useStore, scenario, settings, atLeast } from '../lib/store';
import { apiPost, isOfflineError, useApiGet, downloadBlob } from '../lib/api';
import type { PredictResult, Scenario, BranchKey } from '../lib/types';
import { BRANCHES } from '../lib/types';
import { predictScenario, modelCurves, CONSTANTS, scenarioFor, modelState } from '../engine/index';
import { ScenarioForm } from '../components/ScenarioForm';
import { useValidity } from '../components/fields';
import { Card, Out, EvidenceBanner, ErrorBox, Btn, Switch, Seg, DataTable, Json, Level, ProvBadge, SourceChip, Tip, InfoBanner } from '../components/ui';
import { SuiteHeader } from '../components/SuiteHeader';
import { LinePlot, BarChart, HeatMap } from '../plot/Chart';
import { mapCss, phaseT } from '../lib/colormaps';
import { View3D } from '../components/View3D';
import { usePlayer, PlayerControls, interp, type PlayerState } from '../components/Player';
import { fmtQ, fmtNum, fmtTime, humanKey } from '../lib/format';
import { hypStyle, IMPLEMENTED_IDS } from '../lib/hyp';
import { idbAll, idbPut, idbDelete, newId } from '../lib/idb';

interface Result { data: PredictResult; source: 'network' | 'local'; at: string; inputs: Scenario }

const same = (a: Scenario, b: Scenario) => JSON.stringify(a) === JSON.stringify(b);

function linspace(a: number, b: number, n: number) { return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1)); }

export default function Flagship({ variant = 'suite' }: { variant?: 'suite' | 'builder'; suite?: number }) {
  const sc = useStore(scenario);
  const st = useStore(settings);
  const v = useValidity();
  const [res, setRes] = useState<Result | null>(null);
  const [issues, setIssues] = useState<string[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(true);
  const [armed, setArmed] = useState(false); // after a Reset, auto-run waits for the first input change
  const seq = useRef(0);

  const run = async (s: Scenario = scenario.get()) => {
    const my = ++seq.current;
    setBusy(true); setErr(null);
    try {
      const data = await apiPost<PredictResult | { admissibility_issues: string[] }>('/api/bmv/predict', s, { n_times: 120 });
      if (my !== seq.current) return;
      if (!('models' in data)) { setIssues(data.admissibility_issues); setRes(null); }
      else { setIssues(null); setRes({ data, source: 'network', at: new Date().toISOString(), inputs: s }); }
    } catch (e) {
      if (my !== seq.current) return;
      if (isOfflineError(e)) {
        // API unreachable: compute with the offline engine (golden-vector verified) and say so.
        const loc = predictScenario(s.design, s.environment, 120);
        if (!('models' in loc)) { setIssues(loc.admissibility_issues); setRes(null); }
        else { setIssues(null); setRes({ data: loc as PredictResult, source: 'local', at: new Date().toISOString(), inputs: s }); }
        setErr(e);
      } else setErr(e);
    } finally { if (my === seq.current) setBusy(false); }
  };

  // initial run + debounced auto-run while inputs are valid
  const afterReset = useAfterReset();
  // auto-run once on arrival, but never right after a Reset (the user asked for a clean page)
  useEffect(() => { if (afterReset) return; run(); }, []);
  useEffect(() => {
    if (!auto || !v.ok) return;
    if (afterReset && !armed) { setArmed(true); return; }
    if (res && same(res.inputs, sc)) return;
    const t = setTimeout(() => run(sc), 700);
    return () => clearTimeout(t);
  }, [sc, auto, v.ok]);

  const stale = res && !same(res.inputs, sc);
  const d = res?.data;
  const prov = res?.source === 'local' ? 'COMPUTED_LOCAL' : 'COMPUTED';
  const title = variant === 'builder' ? 'Experiment Builder' : undefined;

  return (
    <div>
      {variant === 'builder' ? (
        <header class="page-head" style={{ display: 'block' }}>
          <h1>{title}</h1>
          <p class="muted" style={{ maxWidth: '90ch' }}>Design a two-mass gravity-mediated-entanglement experiment (Bose–Marletto–Vedral type), predict what every competing hypothesis expects, save the design as a project on this device and continue to the virtual laboratory, model discrimination and preregistration.</p>
        </header>
      ) : (
        <SuiteHeader n={4} intro={<MathText text={T.fl_intro} />} />
      )}

      <div class="split">
        <aside class="sticky-side" aria-label="Design inputs">
          <div class="card">
            <div class="card-head"><h2>Design &amp; environment</h2></div>
            <ScenarioForm value={sc} onChange={(s) => scenario.set(s)} report={v.report} />
            <div class="row" style={{ marginTop: '10px' }}>
              <RunBar label="Run prediction" scenario busy={busy} disabled={!v.ok} onRun={() => run(sc)} />
              <Switch checked={auto} onChange={setAuto} label="Auto-run on change" />
            </div>
            {!v.ok && <p class="field-error" role="alert">Fix {Object.keys(v.invalid).length} invalid input(s) to run.</p>}
            <p class="small muted" style={{ marginTop: '8px' }}>POST /api/bmv/predict · if the server is unreachable the in-browser engine computes the same quantities and the result is labelled “Computed locally”.</p>
          </div>
          {variant === 'builder' && <Projects res={res} />}
        </aside>

        <div class="stack" style={{ minWidth: 0 }}>
          <EvidenceBanner classification={d ? (res!.source === 'local' ? 'COMPUTED LOCALLY (offline engine) — computational prediction, not physical evidence' : d.evidence_status) : null} />
          {err && res?.source === 'local' ? <InfoBanner>The API is unreachable ({String((err as Error).message)}). Showing the <b>offline engine</b> result for these inputs — no fresh server data was fetched.</InfoBanner> : <ErrorBox error={err} what="running the prediction" />}
          {issues && (
            <div class="error-box" role="alert"><strong>Physically inadmissible design.</strong> The server refused to compute because:
              <ul class="tight">{issues.map((i) => <li>{i}</li>)}</ul>Adjust the separation, branch separation or masses.</div>
          )}
          {stale && <div class="banner info" role="status">Inputs changed — the results below are for the previous inputs. {busy ? <span class="spinner" /> : <button type="button" class="btn-sm" onClick={() => run(sc)}>Update now</button>}</div>}
          {!d && !issues && busy && <div class="card"><div class="row muted"><span class="spinner" /> Computing…</div></div>}
          {d && <Results r={res!} prov={prov} mode={st.mode} />}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- results
function Results({ r, prov, mode }: { r: Result; prov: 'COMPUTED' | 'COMPUTED_LOCAL'; mode: string }) {
  const d = r.data;
  const ts = d.time_series!;
  const n = ts.t.length;
  const p = usePlayer(n, 30);
  const consts = useApiGet<{ symbol: string; relative_uncertainty: number }[]>('/api/constants');
  const urG = consts.data?.find((c) => c.symbol === 'G')?.relative_uncertainty;
  const dphiG = d.delta_phi_gravity_rad;
  const dphi = d.delta_phi_total_rad;
  const maxPhase = Math.max(...BRANCHES.map((k) => Math.abs(d.phases_rad[k])));
  const W = d.witness_cpk_local_corrected;
  const nongravShare = dphi !== 0 ? (dphi - dphiG) / dphi : 0;
  return (
    <>
      <Card title="Key predictions" actions={<><span class="small muted">{r.source === 'local' ? 'computed in browser' : 'server'} · {fmtTime(r.at)}</span><SourceChip source={r.source === 'local' ? 'local' : null} /></>}>
        {maxPhase > 1e6 && <InfoBanner kind="danger">Branch phases reach {fmtNum(maxPhase, 3)} rad (usually from residual charge). Float64 resolves such phases only to ~{fmtNum(maxPhase * 2.2e-16, 2)} rad, so entanglement measures below are numerically unreliable in this regime.</InfoBanner>}
        <div class="outs">
          <Out label="Entangling phase Δφ (total)" value={dphi} unit="rad" prov={prov} sig={5}
            interp={<>Only <Tex tex={F.dphi} /> entangles. Maximal entanglement needs <Tex tex={F.absDphiPi} />; here <Tex tex={F.absDphiOverPi} /> = {fmtNum(Math.abs(dphi) / Math.PI, 3)}. Non-gravitational share: {fmtNum(nongravShare * 100, 3)} %.</>} />
          <Out label="Δφ from gravity alone" value={dphiG} unit="rad" prov={prov} sig={5}
            unc={urG != null ? Math.abs(dphiG) * urG : null}
            interp={urG != null ? <>Uncertainty propagated from CODATA 2022 <Tex tex={F.urG} /> = {fmtNum(urG, 3)} only (<Tex tex={F.dphiPropG} />); design values treated as exact.</> : 'Gravitational contribution (finite-size uniform spheres).'} />
          <Out label="Concurrence C" value={d.concurrence} prov={prov} sig={5} tone={d.concurrence > 0 ? 'good' : null}
            interp={<>0 = separable, 1 = maximal. Pure-state bound <Tex tex={F.sinBound} /> = {fmtNum(d.pure_state_concurrence_bound, 4)}; decoherence reduces C below it.</>} />
          <Out label="Negativity N" value={d.negativity} prov={prov} sig={5} tone={d.negativity > 0 ? 'good' : null}
            interp={<>N &gt; 0 ⇔ entangled for two qubits (PPT criterion); maximum 0.5. Log-negativity {fmtNum(d.log_negativity, 4)}.</>} />
          <Out label="CPK witness ⟨W⟩ (local Z corrected)" value={W} prov={prov} sig={5} tone={W < 0 ? 'good' : 'bad'}
            interp={W < 0 ? 'Negative: certifies entanglement with three local settings (XX, YZ, ZY).' : 'Not negative: this witness does not certify entanglement for this design.'} />
          <Out label="Optimal PPT witness" value={d.witness_ppt.value} prov={prov} sig={5} tone={d.witness_ppt.certifies_entanglement ? 'good' : null}
            interp={<>Most negative eigenvalue of <Tex tex={F.rhoTB} />{d.witness_ppt.settings_required ? `; settings needed: ${d.witness_ppt.settings_required.join(', ')}` : ''}.</>} />
          <Out label="Purity tr ρ²" value={d.purity} prov={prov} sig={5}
            interp={<>1 = pure. Environmental decoherence: <Tex tex={F.gammaT} /> = {fmtNum(d.decoherence.total_gamma_t, 3)} per mass (dominant: {humanKey(d.decoherence.dominant ?? '—')}).</>} />
          <Out label="State check" value={d.state_check.passed ? 'passed' : 'FAILED'} tone={d.state_check.passed ? 'good' : 'bad'} prov={prov}
            interp={<>trace {fmtNum(d.state_check.trace, 12)}, min eigenvalue {fmtNum(d.state_check.min_eigenvalue, 3)}, tolerance {fmtNum(d.state_check.tolerance, 2)}.</>} />
        </div>
      </Card>

      <ApparatusCard d={d} p={p} prov={prov} />

      <Card title="Time evolution (coherent-interaction model with environmental decoherence)" actions={<ProvBadge kind={prov} />}>
        <PlayerControls p={p} n={n} t={ts.t} label="Time series" />
        <div class="grid-2">
          <LinePlot name="delta-phi-t" title="Entangling phase Δφ(t)" desc="Entangling phase versus interaction time" xLabel="Time" xUnit="s" yLabel="Δφ" yUnit="rad" cursorX={interp(ts.t, p.pos)}
            series={[{ name: 'Δφ (total)', x: ts.t, y: ts.delta_phi, color: hypStyle('QG-COH').color }]} />
          <LinePlot name="entanglement-t" title="Concurrence and negativity" desc="Entanglement measures versus time" xLabel="Time" xUnit="s" yLabel="Measure" cursorX={interp(ts.t, p.pos)}
            series={[{ name: 'Concurrence', x: ts.t, y: ts.concurrence, color: '#0072B2' }, { name: 'Negativity', x: ts.t, y: ts.negativity, color: '#E69F00', dash: [6, 3] }]} />
          <LinePlot name="witness-t" title="CPK witness ⟨W⟩(t)" desc="Entanglement witness versus time; negative values certify entanglement" xLabel="Time" xUnit="s" yLabel="⟨W⟩" cursorX={interp(ts.t, p.pos)}
            shadeBelow={{ y: 0, label: 'W < 0: entanglement certified', color: 'rgba(23,112,58,0.10)' }} hlines={[{ y: 0 }]}
            series={[{ name: 'Witness (local-Z corrected)', x: ts.t, y: ts.witness_cpk, color: '#D55E00' }]} />
          <LinePlot name="purity-t" title="Purity tr ρ²(t)" desc="Purity of the joint state versus time" xLabel="Time" xUnit="s" yLabel="Purity" cursorX={interp(ts.t, p.pos)}
            series={[{ name: 'Purity', x: ts.t, y: ts.purity, color: '#009E73' }]} />
        </div>
        <p class="small muted">Values at the nearest solver sample: t = {fmtQ(ts.t[p.frame], 's')}, Δφ = {fmtNum(ts.delta_phi[p.frame], 5)} rad, C = {fmtNum(ts.concurrence[p.frame], 5)}, N = {fmtNum(ts.negativity[p.frame], 5)}, ⟨W⟩ = {fmtNum(ts.witness_cpk[p.frame], 5)}.</p>
      </Card>

      <ModelsCard r={r} frameT={interp(ts.t, p.pos)} />
      <CityCard r={r} p={p} />
      <DecoherenceCard d={d} prov={prov} />
      <NongravCard d={d} prov={prov} />

      <Card title="Branch geometry, energies and phases" level="advanced" actions={<ProvBadge kind={prov} />}>
        <DataTable caption="Branch data" head={['Branch', 'Distance r_ij', 'U_grav', 'U_total', 'Phase φ_ij']} numeric={[1, 2, 3, 4]}
          rows={BRANCHES.map((k) => [k, fmtQ(d.branch_distances_m[k], 'm', 6), fmtQ(d.gravitational_energies_J[k], 'J', 6), fmtQ(d.total_energies_J[k], 'J', 6), `${fmtNum(d.phases_rad[k], 8)} rad`])} />
        <p class="small" style={{ marginTop: '8px' }}>Decomposition <Tex tex={F.decomp} />: <Tex tex={F.alpha} /> = {fmtNum(d.phase_decomposition.alpha, 6)}, <Tex tex={F.beta} /> = {fmtNum(d.phase_decomposition.beta, 6)}, <Tex tex={F.gamma} /> = {fmtNum(d.phase_decomposition.gamma, 6)}, <Tex tex={F.dphi} /> = {fmtNum(d.phase_decomposition.delta_phi, 6)} rad. <Tex tex={F.beta} /> and <Tex tex={F.gamma} /> are local and removed by <Tex tex="Z" /> rotations before the witness is measured.</p>
        <p class="small muted">Radii: <Tex tex={F.RA} /> = {fmtQ(d.design.radius_A, 'm')}, <Tex tex={F.RB} /> = {fmtQ(d.design.radius_B, 'm')}; environmental <Tex tex={F.Gamma} /> used: <Tex tex={F.GammaA} /> = {fmtQ(d.design.gamma_A, '')} s⁻¹, <Tex tex={F.GammaB} /> = {fmtQ(d.design.gamma_B, '')} s⁻¹.</p>
      </Card>

      <Card title="Density matrix ρ (basis |LL⟩, |LR⟩, |RL⟩, |RR⟩)" level="expert" actions={<ProvBadge kind={prov} />}>
        <div class="grid-2">
          {(['real', 'imag'] as const).map((part) => (
            <div><h3 class="small">{part === 'real' ? 'Re ρ' : 'Im ρ'}</h3>
              <table class="matrix"><tbody>{(part === 'real' ? d.density_matrix_real : d.density_matrix_imag).map((row) => <tr>{row.map((x) => <td>{x.toExponential(4)}</td>)}</tr>)}</tbody></table></div>
          ))}
        </div>
      </Card>
      <Level min="expert"><details class="card"><summary>Raw response JSON</summary><Json data={d} max={500} /></details></Level>
      {mode === 'beginner' && <p class="small muted">Switch to Advanced or Expert (header) to see branch energies, the density matrix and raw data.</p>}
    </>
  );
}

// ----------------------------------------------------------------------------- apparatus (3-D + 2-D)
function ApparatusCard({ d, p, prov }: { d: PredictResult; p: PlayerState; prov: 'COMPUTED' | 'COMPUTED_LOCAL' }) {
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const [mag, setMag] = useState(false);
  const ts = d.time_series!;
  // what moves in this view is the phase dial (angle Δφ(t)) and the branch glow: relative change = span of Δφ / 2π
  const span = Math.max(...ts.delta_phi) - Math.min(...ts.delta_phi);
  const rel = span / (2 * Math.PI);
  const factor = span > 0 ? Math.max(1, (0.3 * 2 * Math.PI) / span) : 1;
  const opts = useMemo(() => ({
    positions: d.branch_positions, radiusA: d.design.radius_A, radiusB: d.design.radius_B, energies: d.total_energies_J,
    phases: { t: ts.t, deltaPhi: mag ? ts.delta_phi.map((x) => x * factor) : ts.delta_phi },
  }), [d, mag, factor]);
  return (
    <Card title="Apparatus view" actions={<Seg label="View" value={view} onChange={setView} options={[{ v: '3d', label: '3-D' }, { v: '2d', label: '2-D top view' }]} />}>
      <p class="small muted">Branch centres at the computed positions (A at the origin, B along +x; split axis {d.design.geometry === 'linear' ? 'along x' : d.design.geometry === 'parallel' ? 'along y' : `at ${d.design.angle_deg}° to x`}). Segments <Tex tex={F.AiBj} /> are coloured by <Tex tex={F.absU} /> (<span class="energy-ramp" aria-hidden="true" /> weak → strong). The phase dial and branch glow follow <Tex tex={F.dphiT} /> from the time series.</p>
      {view === '3d' ? (
        <View3D kind="apparatus" opts={opts} frame={p.pos} label="Three-dimensional view of the four superposition branches"
          title="BMV apparatus — branch layout and entangling phase" badge={prov === 'COMPUTED_LOCAL' ? 'COMPUTED LOCALLY' : 'COMPUTED'} name="bmv-apparatus"
          legend={[{ label: 'Mass A branches', color: '#0072B2' }, { label: 'Mass B branches', color: '#D55E00' }, { label: 'weak |U_ij|', color: '#2b6cb0' }, { label: 'strong |U_ij|', color: '#dd6b20' }]}
          onRecordStart={() => { p.setPos(0); p.setPlaying(true); }} playing={p.playing}
          change={{ rel, what: 'phase-dial angle Δφ over 2π' }}
          magnify={rel < 5e-3 ? { on: mag, factor, onToggle: setMag, reference: 'zero phase (dial angle = k·Δφ)' } : undefined}
          frameData={() => ({ sample_index_nearest: p.frame, t_s: ts.t[p.frame], delta_phi_rad: ts.delta_phi[p.frame], dial_magnification: mag ? factor : 1, branch_positions_m: d.branch_positions, total_energies_J: d.total_energies_J, source: prov })}
          fallback={<TopView d={d} frame={p.pos} />}
          overlay={(info) => info && (
            <>
              <span>Scale bar: {fmtQ(info.scaleBarMetres, 'm', 3)}{info.radiiEnlarged ? ` · radii enlarged ×${fmtNum(info.enlargementFactor, 3)} for visibility` : ' · radii to scale'}</span>
              <span>|U| {fmtQ(info.energyRamp?.min, 'J', 3)} <span class="energy-ramp" aria-hidden="true" /> {fmtQ(info.energyRamp?.max, 'J', 3)}</span>
              <span>t = {fmtQ(info.time ?? NaN, 's')} · Δφ = {fmtNum((info.deltaPhi ?? NaN) / (mag ? factor : 1), 4)} rad{mag ? ` (dial shows ×${fmtNum(factor, 3)})` : ''}{info.samples && info.samples.w > 1e-3 ? ` (interpolated between samples ${info.samples.i + 1} and ${info.samples.j + 1})` : ''}</span>
            </>
          )} />
      ) : <TopView d={d} frame={p.pos} />}
      <PlayerControls p={p} n={ts.t.length} t={ts.t} label="Apparatus" />
    </Card>
  );
}

function rampColor(t: number) {
  const a = [0x2b, 0x6c, 0xb0], b = [0xdd, 0x6b, 0x20];
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * Math.max(0, Math.min(1, t))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function niceLen(x: number) { const p = 10 ** Math.floor(Math.log10(x)); const m = x / p; return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p; }

/** 2-D top view (x–y plane) drawn from the same computed positions/energies; phase dial driven by Δφ(t). */
export function TopView({ d, frame }: { d: PredictResult; frame: number }) {
  const P = d.branch_positions;
  const pts = Object.values(P);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const ext = Math.max(x1 - x0, y1 - y0, 1e-30);
  const W = 640, H = 380, pad = 70;
  const s = Math.min((W - 2 * pad) / Math.max(x1 - x0, ext * 0.3), (H - 2 * pad - 40) / Math.max(y1 - y0, ext * 0.3));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const X = (x: number) => W / 2 + (x - cx) * s, Y = (y: number) => (H - 40) / 2 - (y - cy) * s;
  const rTrue = Math.max(d.design.radius_A, d.design.radius_B) * s;
  const minR = 7;
  const enlarge = rTrue < minR ? minR / rTrue : 1;
  const rA = d.design.radius_A * s * enlarge, rB = d.design.radius_B * s * enlarge;
  const U = d.total_energies_J;
  const mags = BRANCHES.map((k) => Math.abs(U[k]));
  const lo = Math.min(...mags), hi = Math.max(...mags);
  const ts = d.time_series!;
  const dphi = interp(ts.delta_phi, frame); // display interpolation between solver samples
  const tShown = interp(ts.t, frame);
  const glowMax = Math.max(...ts.delta_phi.map((v) => Math.abs(Math.sin(v / 2))), 1e-300);
  const glow = Math.abs(Math.sin(dphi / 2)) / glowMax;
  const bar = niceLen(ext / 3);
  const key = (b: BranchKey) => [P[`A_${b[0]}` as 'A_L'], P[`B_${b[1]}` as 'B_L']] as const;
  const dialR = 26, dcx = W - 50, dcy = 44;
  const ang = -dphi; // dial hand rotates by Δφ (radians)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Top view of the branch layout at t = ${fmtQ(tShown, 's')}; entangling phase ${fmtNum(dphi, 4)} rad`} style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: '10px' }}>
      {BRANCHES.map((b) => {
        const [a, c] = key(b);
        const t = hi > lo ? (Math.abs(U[b]) - lo) / (hi - lo) : 1;
        return <g><line x1={X(a[0])} y1={Y(a[1])} x2={X(c[0])} y2={Y(c[1])} stroke={rampColor(t)} stroke-width={1.5 + 3 * t} opacity={0.9} />
          <text x={(X(a[0]) + X(c[0])) / 2} y={(Y(a[1]) + Y(c[1])) / 2 - 6} font-size="11" fill="var(--muted)" text-anchor="middle">{b}</text></g>;
      })}
      {(['A_L', 'A_R', 'B_L', 'B_R'] as const).map((k) => {
        const q = P[k]; const r = k[0] === 'A' ? rA : rB;
        return <g><circle cx={X(q[0])} cy={Y(q[1])} r={r} fill={k[0] === 'A' ? '#0072B2' : '#CC79A7'} fill-opacity={0.45 + 0.5 * glow} stroke="var(--fg)" stroke-width="1" />
          <text x={X(q[0])} y={Y(q[1]) - r - 6} font-size="12" fill="var(--fg)" text-anchor="middle" font-weight="600">{k.replace('_', ' ')}</text></g>;
      })}
      <g transform={`translate(${pad}, ${H - 26})`}>
        <line x1={0} y1={0} x2={bar * s} y2={0} stroke="var(--fg)" stroke-width="2" /><line x1={0} y1={-5} x2={0} y2={5} stroke="var(--fg)" /><line x1={bar * s} y1={-5} x2={bar * s} y2={5} stroke="var(--fg)" />
        <text x={bar * s / 2} y={-8} font-size="12" fill="var(--fg)" text-anchor="middle">{fmtQ(bar, 'm', 3)}</text>
      </g>
      <text x={W - 12} y={H - 12} font-size="11" fill="var(--muted)" text-anchor="end">{enlarge > 1 ? `radii enlarged ×${fmtNum(enlarge, 3)} for visibility` : 'radii to scale'} · x: A→B, y: split axis</text>
      <g aria-hidden="true">
        <circle cx={dcx} cy={dcy} r={dialR} fill="none" stroke="var(--border)" stroke-width="2" />
        <line x1={dcx} y1={dcy} x2={dcx + dialR * Math.cos(ang - Math.PI / 2)} y2={dcy + dialR * Math.sin(ang - Math.PI / 2)} stroke="#D55E00" stroke-width="3" stroke-linecap="round" />
        <text x={dcx} y={dcy + dialR + 14} font-size="11" fill="var(--fg)" text-anchor="middle">Δφ = {fmtNum(dphi, 3)} rad</text>
        <text x={dcx} y={dcy + dialR + 28} font-size="10" fill="var(--muted)" text-anchor="middle">t = {fmtQ(tShown, 's')}</text>
      </g>
    </svg>
  );
}

// ----------------------------------------------------------------------------- competing hypotheses
function ModelsCard({ r, frameT }: { r: Result; frameT: number }) {
  const d = r.data;
  const reg = useApiGet<{ id: string; name: string; entangling_by_gravity: boolean; implemented: boolean }[]>('/api/models');
  const [sel, setSel] = useState<string[]>(['QG-COH', 'CC-KTM', 'SC-MF']);
  const T = r.inputs.design.time;
  const times = useMemo(() => linspace(0, T, 61), [T]);
  const curves = useMemo(() => modelCurves(r.inputs.design, r.inputs.environment, IMPLEMENTED_IDS, times), [r]);
  // cross-check: local curves at t = T against the predictions table returned with this result
  const check = useMemo(() => {
    let m = 0;
    for (const row of d.models) {
      const c = curves[row.id]; if (!c) continue;
      const pairs: [number, number][] = [[c.negativity[c.negativity.length - 1], row.negativity], [c.witness[c.witness.length - 1], row.witness_cpk], [c.concurrence[c.concurrence.length - 1], row.concurrence]];
      for (const [a, b] of pairs) m = Math.max(m, Math.abs(a - b) / Math.max(Math.abs(b), 1e-12));
    }
    return m;
  }, [curves, d]);
  const name = (id: string) => reg.data?.find((x) => x.id === id)?.name ?? hypStyle(id).short;
  return (
    <Card title="Competing hypotheses — side by side" actions={<ProvBadge kind={r.source === 'local' ? 'COMPUTED_LOCAL' : 'COMPUTED'} />}>
      <p class="small muted">Every hypothesis is evaluated for the same design, the same decoherence budget and the same measurement frame (local Z corrections fixed in advance from the nominal gravitational phases). Nominal nuisance parameters.</p>
      <DataTable caption="Predictions of each hypothesis" head={['Hypothesis', 'Negativity', 'Concurrence', 'CPK witness', 'Purity', 'Coherence A', 'Coherence B', 'Gravity entangles?']} numeric={[1, 2, 3, 4, 5, 6]}
        rows={d.models.map((m) => [
          <span title={name(m.id)}><span class="swatch" style={{ background: hypStyle(m.id).color }} /> <b>{m.id}</b><br /><span class="small muted">{name(m.id)}</span></span>,
          fmtNum(m.negativity, 5), fmtNum(m.concurrence, 5),
          <span style={{ color: m.witness_cpk < 0 ? 'var(--ok)' : undefined }}>{fmtNum(m.witness_cpk, 5)}{m.witness_cpk < 0 ? ' ✓' : ''}</span>,
          fmtNum(m.purity, 5), fmtNum(m.coherence_A, 5), fmtNum(m.coherence_B, 5),
          reg.data ? (reg.data.find((x) => x.id === m.id)?.entangling_by_gravity ? 'yes (model)' : 'no (model)') : '—',
        ])} />
      {reg.data && reg.data.filter((x) => !x.implemented).map((x) => <p class="small" style={{ marginTop: '6px' }}><span class="badge b-neutral">registered, not implemented</span> <b>{x.id}</b> — {x.name}: no prediction exists, so observed entanglement cannot exclude it.</p>)}
      <h3 style={{ marginTop: '14px' }}>Negativity(t) and witness(t) by hypothesis <ProvBadge kind="COMPUTED_LOCAL" /> <Tip text="These curves are computed in the browser by the offline engine at 61 times (each hypothesis' state evaluated with interaction time t, rates and frame recomputed). The engine reproduces the server reference to ≤1e-8 relative in golden-vector tests; the live cross-check against this server result is shown below." /></h3>
      <fieldset class="row" style={{ border: 'none', padding: 0, margin: '6px 0' }}>
        <legend class="sr-only">Hypotheses to plot</legend>
        {IMPLEMENTED_IDS.map((id) => (
          <label class="row small" style={{ gap: '4px' }}><input type="checkbox" checked={sel.includes(id)} onChange={(e: any) => setSel((s) => e.currentTarget.checked ? [...s, id] : s.filter((x) => x !== id))} />
            <span class="swatch" style={{ background: hypStyle(id).color }} />{id}</label>
        ))}
      </fieldset>
      <div class="grid-2">
        <LinePlot name="negativity-by-hypothesis" title="Negativity N(t)" desc="Negativity versus interaction time for each selected hypothesis" xLabel="Time" xUnit="s" yLabel="Negativity" cursorX={frameT}
          series={sel.map((id) => ({ name: id, x: times, y: curves[id].negativity, color: hypStyle(id).color, dash: hypStyle(id).dash }))} />
        <LinePlot name="witness-by-hypothesis" title="CPK witness ⟨W⟩(t)" desc="Witness versus interaction time for each selected hypothesis; negative certifies entanglement" xLabel="Time" xUnit="s" yLabel="⟨W⟩" cursorX={frameT}
          shadeBelow={{ y: 0, label: 'W < 0: entanglement certified', color: 'rgba(23,112,58,0.10)' }} hlines={[{ y: 0 }]}
          series={sel.map((id) => ({ name: id, x: times, y: curves[id].witness, color: hypStyle(id).color, dash: hypStyle(id).dash }))} />
      </div>
      <p class="small muted">Cross-check at t = {fmtQ(T, 's')}: largest relative difference between these local curves and the {r.source === 'local' ? 'local' : 'server'} predictions table = <b>{fmtNum(check, 2)}</b>{r.source === 'network' ? (check < 1e-6 ? ' (agreement)' : ' (DISAGREEMENT — please report)') : ''}.</p>
    </Card>
  );
}

// ----------------------------------------------------------------------------- decoherence & EM
function DecoherenceCard({ d, prov }: { d: PredictResult; prov: string }) {
  const b = d.decoherence;
  const items = Object.entries(b.mechanisms);
  return (
    <Card title="Decoherence budget (per mass, mass A)" actions={<ProvBadge kind={prov} />}>
      <p class="small">Total <Tex tex={F.Gamma} /> = <b>{fmtQ(b.total_rate, '')} s⁻¹</b>, <Tex tex={F.gammaT} /> = <b>{fmtNum(b.total_gamma_t, 4)}</b>, coherence factor <Tex tex={F.expGt} /> = <b>{fmtNum(b.coherence_factor, 5)}</b>. Dominant mechanism: <b>{humanKey(b.dominant ?? '—')}</b>.</p>
      <DataTable caption="Decoherence mechanisms" head={['Mechanism', 'Rate Γ (s⁻¹)', 'Γt', 'e^(−Γt)', 'Regime']} numeric={[1, 2, 3]} hl={(i) => items[i][0] === b.dominant}
        rows={items.map(([k, m]) => [humanKey(k), fmtNum(m.rate, 4), fmtNum(m.gamma_t, 4), fmtNum(m.coherence_factor, 6), <span class="small">{m.regime ?? ''}</span>])} />
      <BarChart name="decoherence-rates" title="Rates (log scale)" desc="Decoherence rate of each mechanism on a logarithmic axis" xLabel="Rate" unit="s⁻¹" logX highlight={humanKey(b.dominant ?? '')}
        items={items.map(([k, m]) => ({ label: humanKey(k), value: m.rate, color: k === b.dominant ? '#D55E00' : '#0072B2' }))} />
      <p class="small muted">Zero rates (e.g. absorption/emission for Im ε = 0, an idealisation flagged as an estimate in the material table) cannot be drawn on a log axis and are listed in the table.</p>
    </Card>
  );
}

function NongravCard({ d, prov }: { d: PredictResult; prov: string }) {
  const ch = d.nongrav_channels;
  const names = Array.from(new Set(BRANCHES.flatMap((k) => Object.keys(ch[k] ?? {}))));
  const t = d.design.time, hbar = CONSTANTS.hbar;
  const dphiOf = (name: string) => -(t / hbar) * ((ch.LL[name] ?? 0) + (ch.RR[name] ?? 0) - (ch.LR[name] ?? 0) - (ch.RL[name] ?? 0));
  return (
    <Card title="Non-gravitational channels (confounders)" actions={<ProvBadge kind={prov} />}>
      <p class="small muted"><MathText text={T.fl_nongrav} /></p>
      <DataTable caption="Non-gravitational branch energies" head={['Channel', ...BRANCHES.map((k) => `U_${k}`), 'Δφ contribution', 'vs gravity']} numeric={[1, 2, 3, 4, 5, 6]}
        rows={names.map((nm) => [humanKey(nm), ...BRANCHES.map((k) => fmtQ(ch[k]?.[nm] ?? 0, 'J', 4)), `${fmtNum(dphiOf(nm), 4)} rad`, d.delta_phi_gravity_rad ? `${fmtNum(Math.abs(dphiOf(nm) / d.delta_phi_gravity_rad) * 100, 3)} %` : '—'])} />
      <p class="small" style={{ marginTop: '6px' }}>Sum of channels: <Tex tex={F.dphiDiff} /> = {fmtNum(d.delta_phi_total_rad - d.delta_phi_gravity_rad, 4)} rad. See <a href="/suite/environment">Suite 8</a> for the gravity-dominance distance.</p>
    </Card>
  );
}

// ----------------------------------------------------------------------------- builder: projects
interface Project { id: string; name: string; created: string; updated: string; scenario: Scenario; notes: string }

function Projects({ res }: { res: Result | null }) {
  const sc = useStore(scenario);
  const [list, setList] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => idbAll<Project>('projects').then((l) => setList(l.sort((a, b) => b.updated.localeCompare(a.updated)))).catch((e) => setMsg(`Local storage unavailable: ${e?.message ?? e}`));
  useEffect(() => {
    refresh();
    // /builder?project=<id> (links from Jobs → Saved on this device) loads that project
    const pid = new URLSearchParams(location.search).get('project');
    if (pid) idbAll<Project>('projects').then((l) => { const p = l.find((x) => x.id === pid); if (p) { scenario.set(p.scenario); setName(p.name); setNotes(p.notes); setMsg(`Loaded project “${p.name}”.`); } }).catch(() => undefined);
  }, []);
  const save = async () => {
    const now = new Date().toISOString();
    const p: Project = { id: newId(), name: name.trim() || `Design ${now.slice(0, 16).replace('T', ' ')}`, created: now, updated: now, scenario: sc, notes };
    try { await idbPut('projects', p); setMsg(`Saved “${p.name}” on this device.`); refresh(); } catch (e) { setMsg(`Could not save: ${(e as Error).message}`); }
  };
  const saveResult = async () => {
    if (!res) return;
    try {
      await idbPut('results', { id: newId(), kind: 'bmv_predict', created: new Date().toISOString(), label: name.trim() || 'BMV prediction', source: res.source === 'local' ? 'COMPUTED_LOCAL' : 'COMPUTED', payload: { inputs: res.inputs, result: res.data } });
      setMsg('Result saved on this device (see Jobs & history → Saved on this device).');
    } catch (e) { setMsg(`Could not save: ${(e as Error).message}`); }
  };
  const importFile = async (f: File) => {
    try {
      const j = JSON.parse(await f.text());
      const s: Scenario = j.scenario ?? j;
      if (!s.design || !s.environment) throw new Error('file does not contain {design, environment}');
      scenario.set({ design: { ...sc.design, ...s.design }, environment: { ...sc.environment, ...s.environment } });
      setMsg(`Imported design from ${f.name}.`);
    } catch (e) { setMsg(`Import failed: ${(e as Error).message}`); }
  };
  return (
    <div class="card" style={{ marginTop: '14px' }}>
      <h2>Project</h2>
      <div class="field"><label class="field-label" for="pj-name">Project name</label><div class="field-input"><input id="pj-name" value={name} onInput={(e: any) => setName(e.currentTarget.value)} placeholder="e.g. 10 fg diamond, linear" /></div></div>
      <div class="field"><label class="field-label" for="pj-notes">Notes</label><textarea id="pj-notes" class="input" style={{ minHeight: '60px' }} value={notes} onInput={(e: any) => setNotes(e.currentTarget.value)} /></div>
      <div class="row">
        <Btn onClick={save}>Save design</Btn>
        <Btn onClick={saveResult} disabled={!res}>Save result</Btn>
        <Btn onClick={() => downloadBlob(new Blob([JSON.stringify({ format: 'qgdevs-scenario/1', scenario: sc, notes }, null, 2)], { type: 'application/json' }), 'qgdevs-design.json')}>Export JSON</Btn>
        <label class="btn">Import JSON<input type="file" accept="application/json,.json" class="sr-only" onChange={(e: any) => e.currentTarget.files?.[0] && importFile(e.currentTarget.files[0])} /></label>
      </div>
      {msg && <p class="small" role="status" style={{ marginTop: '6px' }}>{msg}</p>}
      {list.length > 0 && (
        <ul class="clean" style={{ marginTop: '10px' }}>
          {list.map((p) => (
            <li class="row-between" style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}>
              <span><b>{p.name}</b><br /><span class="small muted">{fmtTime(p.updated)} · m = {fmtQ(p.scenario.design.mass_A, 'kg', 3)}, d = {fmtQ(p.scenario.design.separation, 'm', 3)}</span></span>
              <span class="row"><button type="button" class="btn-sm" onClick={() => { scenario.set(p.scenario); setNotes(p.notes); setName(p.name); }}>Load</button>
                <button type="button" class="btn-sm" onClick={() => idbDelete('projects', p.id).then(refresh)} aria-label={`Delete ${p.name}`}>Delete</button></span>
            </li>
          ))}
        </ul>
      )}
      <h3 style={{ marginTop: '12px' }}>Continue with this design</h3>
      <div class="pipeline" aria-label="Next steps">
        <a class="stage" href="/suite/lab">Virtual laboratory →</a>
        <a class="stage" href="/suite/falsification">Model discrimination →</a>
        <a class="stage" href="/suite/design">Design sweeps →</a>
        <a class="stage" href="/suite/signal">Synthetic measurement →</a>
        <a class="stage" href="/suite/evidence">Preregistration →</a>
      </div>
      {atLeast(settings.get().mode, 'advanced') && <p class="small muted" style={{ marginTop: '6px' }}>Projects are stored in this browser’s IndexedDB only; export JSON to share or archive them.</p>}
    </div>
  );
}

// ----------------------------------------------------------------------------- density-matrix city plots
const BASIS = ['LL', 'LR', 'RL', 'RR'];
type Mat = { re: number[]; im: number[] }; // row-major 4×4

/** ρ(t) for one hypothesis at every time-series sample, computed by the local engine (golden-vector verified). */
function rhoSeries(r: Result, id: string): Mat[] {
  const ts = r.data.time_series!;
  const { scenario: sc } = scenarioFor(r.inputs.design, r.inputs.environment);
  return ts.t.map((t) => { const m = modelState(id, sc, t); return { re: Array.from(m.re), im: Array.from(m.im) }; });
}
function rhoAt(series: Mat[], pos: number): Mat {
  const x = Math.max(0, Math.min(series.length - 1, pos)), i = Math.floor(x), j = Math.min(series.length - 1, i + 1), w = x - i;
  const a = series[i], b = series[j];
  return { re: a.re.map((v, k) => v * (1 - w) + b.re[k] * w), im: a.im.map((v, k) => v * (1 - w) + b.im[k] * w) };
}
// cyclic, lightness-balanced phase map: every angle stays clearly visible on light and dark backgrounds
const phaseColor = (ph: number) => mapCss('phase', phaseT(ph));
const KET = [String.raw`|LL\rangle`, String.raw`|LR\rangle`, String.raw`|RL\rangle`, String.raw`|RR\rangle`];
const PHASE_BAR = { map: 'phase', titleTex: String.raw`\arg\rho_{ij}`, title: 'arg ρ_ij', ticks: [{ at: 0, tex: String.raw`-\pi` }, { at: 0.25, tex: String.raw`-\tfrac{\pi}{2}` }, { at: 0.5, tex: '0' }, { at: 0.75, tex: String.raw`\tfrac{\pi}{2}` }, { at: 1, tex: String.raw`\pi` }] };

function citySpec(m: Mat, zmax: number, magnified: boolean) {
  const bars = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const re = m.re[i * 4 + j], im = m.im[i * 4 + j];
    bars.push({ xi: j, yi: i, h: Math.hypot(re, im), color: phaseColor(Math.atan2(im, re)) });
  }
  return {
    x: { label: 'column (ket)', cats: BASIS, catsTex: KET }, y: { label: 'row (bra)', cats: BASIS, catsTex: KET.map((k) => k.replace('|', '\\langle ').replace('\\rangle', '|')) },
    z: magnified ? { label: 'k·|ρ_ij(t) − ρ_ij(0)|', tex: String.raw`k\,|\rho_{ij}(t)-\rho_{ij}(0)|`, min: 0, max: zmax } : { label: '|ρ_ij|', tex: String.raw`|\rho_{ij}|`, min: 0, max: zmax },
    bars, barWidth: 0.72,
  };
}

/** Relative change of what a city plot draws over the run: bar heights (vs the tallest bar) and phase colours (vs 2π, for visible bars). */
function cityChange(series: Mat[], zmax: number): number {
  const m0 = series[0];
  let dh = 0, dp = 0;
  for (const m of series) for (let k = 0; k < 16; k++) {
    const a0 = Math.hypot(m0.re[k], m0.im[k]), a = Math.hypot(m.re[k], m.im[k]);
    dh = Math.max(dh, Math.abs(a - a0));
    if (a > 0.02 * zmax && a0 > 0.02 * zmax) { let d = Math.atan2(m.im[k], m.re[k]) - Math.atan2(m0.im[k], m0.re[k]); d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); dp = Math.max(dp, d); }
  }
  return Math.max(dh / (zmax || 1), dp / (2 * Math.PI));
}
/** ρ(t) − ρ(0) magnified by k (display of the deviation from the initial product state). */
function deviation(m: Mat, m0: Mat, k: number): Mat { return { re: m.re.map((v, i) => k * (v - m0.re[i])), im: m.im.map((v, i) => k * (v - m0.im[i])) }; }

function CityCard({ r, p }: { r: Result; p: PlayerState }) {
  const [a, setA] = useState('QG-COH');
  const [b, setB] = useState('CC-KTM');
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const ts = r.data.time_series!;
  const sa = useMemo(() => rhoSeries(r, a), [r, a]);
  const sb = useMemo(() => rhoSeries(r, b), [r, b]);
  // cross-check: engine QG-COH state at t = T against the server/engine prediction's density matrix
  const check = useMemo(() => {
    const last = rhoSeries(r, 'QG-COH').slice(-1)[0];
    let m = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      m = Math.max(m, Math.abs(last.re[i * 4 + j] - r.data.density_matrix_real[i][j]), Math.abs(last.im[i * 4 + j] - r.data.density_matrix_imag[i][j]));
    }
    return m;
  }, [r]);
  const zmax = useMemo(() => Math.max(...[...sa, ...sb].flatMap((m) => m.re.map((v, k) => Math.hypot(v, m.im[k])))), [sa, sb]);
  const [mag, setMag] = useState(false);
  // magnification so the largest deviation of either hypothesis fills ~30 % of the height axis
  const maxDev = useMemo(() => Math.max(...[sa, sb].flatMap((S) => S.flatMap((m) => m.re.map((v, k) => Math.hypot(v - S[0].re[k], m.im[k] - S[0].im[k]))))), [sa, sb]);
  const factor = maxDev > 0 ? Math.max(1, (0.3 * zmax) / maxDev) : 1;
  const chA = useMemo(() => cityChange(sa, zmax), [sa, zmax]), chB = useMemo(() => cityChange(sb, zmax), [sb, zmax]);
  const ma = rhoAt(sa, p.pos), mb = rhoAt(sb, p.pos);
  const showA = mag ? deviation(ma, sa[0], factor) : ma, showB = mag ? deviation(mb, sb[0], factor) : mb;
  const specA = useMemo(() => citySpec(showA, zmax, mag), [showA.re.join(), showA.im.join(), zmax, mag]);
  const specB = useMemo(() => citySpec(showB, zmax, mag), [showB.re.join(), showB.im.join(), zmax, mag]);
  const i = Math.floor(Math.max(0, Math.min(ts.t.length - 1, p.pos))), w = p.pos - i;
  const sel = (v: string, set: (x: string) => void, lab: string) => (
    <label class="small">{lab}{' '}
      <select class="input" style={{ padding: '3px 6px' }} value={v} onChange={(e: any) => set(e.currentTarget.value)}>
        {IMPLEMENTED_IDS.map((id) => <option value={id}>{id}</option>)}
      </select></label>
  );
  const heat = (m: Mat, id: string) => (
    <div class="grid-2">
      <HeatMap name={`rho-abs-${id}`} title={`|ρ_ij| — ${id}`} desc={`Magnitude of the density matrix for ${id}`} z={[0, 1, 2, 3].map((ii) => [0, 1, 2, 3].map((jj) => Math.hypot(m.re[ii * 4 + jj], m.im[ii * 4 + jj])))}
        xCats={BASIS} yCats={BASIS} xLabel="column" yLabel="row" zLabel="|ρ_ij|" palette="cividis" zDomain={[0, zmax]} annotate={(v) => (v == null ? null : v.toFixed(3))} aspect={0.8} />
      <HeatMap name={`rho-arg-${id}`} title={`arg ρ_ij — ${id}`} desc={`Phase of the density-matrix elements for ${id}`} z={[0, 1, 2, 3].map((ii) => [0, 1, 2, 3].map((jj) => Math.atan2(m.im[ii * 4 + jj], m.re[ii * 4 + jj])))}
        xCats={BASIS} yCats={BASIS} xLabel="column" yLabel="row" zLabel="arg ρ_ij" zUnit="rad" palette="phase" zDomain={[-Math.PI, Math.PI]} annotate={(v) => (v == null ? null : v.toFixed(2))} aspect={0.8} />
    </div>
  );
  const panel = (m: Mat, spec: any, id: string) => view === '3d' ? (
    <View3D kind="plot3d" opts={spec} label={`Density-matrix city plot for ${id}: bar height |ρ_ij|, colour arg ρ_ij`} title={`ρ(t) — ${id} · t = ${fmtQ(interp(ts.t, p.pos), 's')}`} badge="COMPUTED LOCALLY" name={`city-${id}`}
      colorbar={PHASE_BAR} change={{ rel: id === a ? chA : chB, what: '|ρ| and arg ρ' }} frame={p.pos}
      magnify={{ on: mag, factor, onToggle: setMag, reference: 'the initial product state ρ(0)' }}
      onRecordStart={() => { p.setPos(0); p.setPlaying(true); }} playing={p.playing}
      frameData={() => ({ hypothesis: id, t_s: interp(ts.t, p.pos), magnified: mag ? { factor, reference: 'rho(0)' } : null, samples: { i, j: Math.min(ts.t.length - 1, i + 1), w }, rho_re: m.re, rho_im: m.im, basis: BASIS, source: 'COMPUTED_LOCALLY (engine)' })}
      fallback={heat(m, id)} />
  ) : heat(m, id);
  return (
    <Card title="Density matrix ρ(t) — city plots by hypothesis" actions={<><ProvBadge kind="COMPUTED_LOCAL" /><Seg label="City plot view" value={view} onChange={setView} options={[{ v: '3d', label: '3-D' }, { v: '2d', label: '2-D heat maps' }]} /></>}>
      <p class="small muted"><MathText text={T.fl_city} /> States are computed in this browser by the offline engine at the same times as the server time series, driven by the same playback cursor. The server additionally implements CG-QFT-AH; the local engine does not, so it cannot be shown here.</p>
      <div class="row">{sel(a, setA, 'Left')}{sel(b, setB, 'Right')}</div>
      <div class="grid-2" style={{ marginTop: '8px' }}>
        <div>{panel(ma, specA, a)}</div>
        <div>{panel(mb, specB, b)}</div>
      </div>
      <PlayerControls p={p} n={ts.t.length} t={ts.t} label="Density matrix" syncNote="both (synchronised)" />
      <p class="small muted">Cross-check at t = {fmtQ(r.inputs.design.time, 's')}: <Tex tex={F.rhoCheck} /> (QG-COH; reference: {r.source === 'local' ? 'local prediction' : 'server'}) = <b>{fmtNum(check, 2)}</b>{check < 1e-9 ? ' (agreement)' : ' (check)'}.</p>
    </Card>
  );
}
