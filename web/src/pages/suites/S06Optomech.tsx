import { RunBar } from '../../components/Reset';
/** Suite 6 — Gravitationally coupled harmonic oscillators (Gaussian covariance dynamics), POST /api/optomech/evolve. */
import { useMemo, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, Out, EvidenceBanner, ErrorBox, Json, Level, InfoBanner, ProvBadge } from '../../components/ui';
import { NumberField, useValidity } from '../../components/fields';
import { LinePlot } from '../../plot/Chart';
import { apiPost } from '../../lib/api';
import { fmtNum, fmtTime } from '../../lib/format';
import { hypStyle } from '../../lib/hyp';
import { useRun } from './f1-shared';
import { Seg, DataTable } from '../../components/ui';
import { View3D } from '../../components/View3D';
import { usePlayer, PlayerControls, interp } from '../../components/Player';
import { evolveCoupledOscillators, type OptoResult } from '../../engine/index';
import { fmtQ } from '../../lib/format';

interface OptoOut { t: number[]; log_negativity: number[]; coupling_rate_rad_s: number; thermal_occupation_bath: number; omega: number; note: string }
interface Params { m: number; d: number; omega: number; T: number; gamma: number; n_init: number; t_final: number; squeeze_r: number; coupling_scale: number }

export default function Page(_props: { suite?: number }) {
  const v = useValidity();
  const [p, setP] = useState<Params>({ m: 1e-14, d: 1e-4, omega: 6.283, T: 0, gamma: 1e-4, n_init: 0, t_final: 100, squeeze_r: 0, coupling_scale: 1 });
  const set = (k: keyof Params) => (x: number) => setP({ ...p, [k]: x });
  const r = useRun<{ main: OptoOut; ref: OptoOut | null; params: Params }>();
  const [compare, setCompare] = useState(true);
  const run = () => r.run(async () => {
    const main = await apiPost<OptoOut>('/api/optomech/evolve', undefined, { ...p });
    const ref = compare ? await apiPost<OptoOut>('/api/optomech/evolve', undefined, { ...p, coupling_scale: 0 }) : null;
    return { main, ref, params: { ...p } };
  });
  const d = r.data?.main, ref = r.data?.ref;
  const maxEN = d ? Math.max(...d.log_negativity) : NaN;
  return (
    <div>
      <SuiteHeader n={6} intro="Two harmonically trapped masses coupled by Newtonian gravity, expanded to the bilinear term H_int = (2Gm_Am_B/d³) x_A x_B. The server evolves the Gaussian covariance matrix with damping and a thermal bath and reports the logarithmic negativity E_N(t)." />
      <div class="split">
        <div class="card sticky-side">
          <h2>Oscillators</h2>
          <NumberField name="m" label="Mass (each)" unit="kg" value={p.m} min={0} max={1e3} minExclusive report={v.report} onChange={set('m')}
            help="Mass of each oscillator. The coupling rate g = 2G m² x_zpf²/(ħ d³) with x_zpf = √(ħ/2mω), i.e. g ∝ m/(ω d³)." />
          <NumberField name="d" label="Separation d" unit="m" value={p.d} min={0} max={10} minExclusive report={v.report} onChange={set('d')}
            help="Equilibrium distance between the trap centres (along the oscillation axis). The bilinear coupling falls as 1/d³." />
          <NumberField name="omega" label="Trap frequency ω" unit="rad/s" value={p.omega} min={0} max={1e9} minExclusive report={v.report} onChange={set('omega')}
            help="Angular frequency of each trap (default 6.283 rad/s = 1 Hz). Low frequencies give larger zero-point motion and stronger coupling." />
          <NumberField name="T" label="Bath temperature" unit="K" value={p.T} min={0} max={2000} report={v.report} onChange={set('T')}
            help="Temperature of the mechanical bath; sets n_th = 1/(e^{ħω/k_BT} − 1). Thermal noise destroys entanglement quickly at low ω." />
          <NumberField name="gamma" label="Damping rate γ" unit="s⁻¹" value={p.gamma} min={0} max={1e6} report={v.report} onChange={set('gamma')}
            help="Mechanical energy damping rate (coupling to the bath)." />
          <NumberField name="n_init" label="Initial occupation n₀" unit="1" value={p.n_init} min={0} max={1e6} report={v.report} onChange={set('n_init')}
            help="Initial thermal phonon number of each mode (0 = ground state)." />
          <NumberField name="t_final" label="Evolution time" unit="s" value={p.t_final} min={0} max={1e6} minExclusive report={v.report} onChange={set('t_final')}
            help="Total time; 200 equally spaced outputs." />
          <NumberField name="sq" label="Initial squeezing r" unit="1" value={p.squeeze_r} min={0} max={3} report={v.report} level="advanced" onChange={set('squeeze_r')}
            help="Position squeezing parameter of each initial state (variance ∝ e^{−2r}); squeezing can enhance the generated entanglement." />
          <NumberField name="cs" label="Coupling scale" unit="1" value={p.coupling_scale} min={0} max={1e6} report={v.report} level="expert" onChange={set('coupling_scale')}
            help="Multiplier on the gravitational coupling: 1 = quantum-coherent Newtonian coupling, 0 = no coherent coupling (classical-mediator reference). Values ≠ 0, 1 are for sensitivity studies only." />
          <label class="row small"><input type="checkbox" checked={compare} onChange={(e: any) => setCompare(e.currentTarget.checked)} /> Also compute the coupling-off reference (coupling scale 0)</label>
          <RunBar label="Evolve" busy={r.busy} disabled={!v.ok} onRun={run} />
        </div>
        <div class="stack">
          <EvidenceBanner />
          <ErrorBox error={r.err} what="evolving the oscillators" />
          {!d && !r.busy && <InfoBanner>Press <b>Evolve</b>; the covariance dynamics are integrated on the server.</InfoBanner>}
          {d && (<>
            <Card title="Results" actions={<><ProvBadge kind="COMPUTED" /><span class="small muted">{fmtTime(r.at)}</span></>}>
              <div class="outs">
                <Out label="Max log-negativity E_N" value={maxEN} prov="COMPUTED" tone={maxEN > 0 ? 'good' : null} interp="E_N > 0 certifies entanglement of the two modes (Gaussian PPT criterion)." />
                <Out label="Coupling rate g" value={d.coupling_rate_rad_s} unit="rad/s" prov="COMPUTED" interp={`g/ω = ${fmtNum(d.coupling_rate_rad_s / d.omega, 3)}; entanglement builds up on time scales ~1/g unless noise wins first.`} />
                <Out label="Bath occupation n_th" value={d.thermal_occupation_bath} prov="COMPUTED" interp="Thermal phonons at the trap frequency; decoherence rate ≈ γ(n_th + ½)." />
                {ref && <Out label="Max E_N, coupling off" value={Math.max(...ref.log_negativity)} prov="COMPUTED" interp="Reference with the gravitational bilinear term removed (classical-mediator expectation E_N = 0)." />}
              </div>
              <p class="small muted">{d.note}</p>
            </Card>
            <LinePlot name="optomech-EN" title="Logarithmic negativity E_N(t)" desc="Logarithmic negativity of the two oscillators versus time" xLabel="Time" xUnit="s" yLabel="E_N" yUnit="1"
              series={[
                { name: 'gravity coupling on (QG-COH-like)', x: d.t, y: d.log_negativity, color: hypStyle('QG-COH').color },
                ...(ref ? [{ name: 'coupling off (classical mediator)', x: ref.t, y: ref.log_negativity, color: hypStyle('SC-MF').color, dash: hypStyle('SC-MF').dash }] : []),
              ]} />
            <PhaseSpace api={d} params={r.data!.params} />
            <Level min="expert"><Json data={r.data} /></Level>
          </>)}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- phase-space dynamics
const QL = ['X_A', 'P_A', 'X_B', 'P_B'];
const TRIPLES: Record<string, [number, number, number]> = { 'xa-pa-xb': [0, 1, 2], 'xa-xb-pb': [0, 2, 3] };

/** Interpolated covariance between solver samples (display only). */
function covAt(loc: OptoResult, pos: number): number[][] {
  return [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => interp(loc.V.map((V) => V[i][j]), pos)));
}
function sub3(V: number[][], idx: [number, number, number]): number[][] { return idx.map((i) => idx.map((j) => V[i][j])); }

/** 1-σ ellipse of a 2×2 covariance as an SVG path (data units scaled by k). */
function ellipsePath(c: number[][], k: number, cx: number, cy: number): string {
  const a = c[0][0], b = c[0][1], d = c[1][1];
  const tr = (a + d) / 2, disc = Math.sqrt(Math.max(((a - d) / 2) ** 2 + b * b, 0));
  const l1 = tr + disc, l2 = Math.max(tr - disc, 0);
  const th = 0.5 * Math.atan2(2 * b, a - d);
  const pts: string[] = [];
  for (let i = 0; i <= 96; i++) {
    const u = (i / 96) * 2 * Math.PI;
    const x0 = Math.sqrt(l1) * Math.cos(u), y0 = Math.sqrt(l2) * Math.sin(u);
    const x = x0 * Math.cos(th) - y0 * Math.sin(th), y = x0 * Math.sin(th) + y0 * Math.cos(th);
    pts.push(`${i ? 'L' : 'M'}${(cx + k * x).toFixed(2)} ${(cy - k * y).toFixed(2)}`);
  }
  return pts.join('') + 'Z';
}

function PhaseSpace({ api, params }: { api: OptoOut; params: Params }) {
  const loc = useMemo(() => evolveCoupledOscillators({ ...params, n_out: api.t.length }), [params, api]);
  const p = usePlayer(loc.t.length, 30);
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const [tri, setTri] = useState<'xa-pa-xb' | 'xa-xb-pb'>('xa-pa-xb');
  // cross-check the local E_N against the server trace at 12 times
  const check = useMemo(() => {
    const idx = Array.from({ length: 12 }, (_, k) => Math.round((k * (api.t.length - 1)) / 11));
    let absMax = 0, relMax = 0;
    for (const i of idx) {
      const a = api.log_negativity[i], b = loc.log_negativity[i];
      absMax = Math.max(absMax, Math.abs(a - b));
      if (a > 1e-3) relMax = Math.max(relMax, Math.abs(a - b) / a);
    }
    return { idx, absMax, relMax };
  }, [api, loc]);
  const V = covAt(loc, p.pos);
  const ids = TRIPLES[tri];
  const S = sub3(V, ids);
  // fixed axes from the largest 1-σ extent over the whole run (stable animation)
  const ext = useMemo(() => 1.3 * Math.sqrt(Math.max(...loc.V.flatMap((W) => [W[0][0], W[1][1], W[2][2], W[3][3]]))), [loc]);
  const ax = (k: number) => ({ label: QL[ids[k]], unit: '1', min: -ext, max: ext });
  const spec = {
    x: ax(0), y: ax(1), z: ax(2),
    ellipsoids: [
      { name: 'state', center: [0, 0, 0] as [number, number, number], cov: S, color: '#0072B2', nsigma: 1 },
      { name: 'vacuum', center: [0, 0, 0] as [number, number, number], cov: [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]], color: '#9aa0a6', nsigma: 1 },
    ],
  };
  const tNow = interp(loc.t, p.pos);
  const ENnow = interp(loc.log_negativity, p.pos);
  return (
    <Card title="Phase-space dynamics of the two oscillators" actions={<><ProvBadge kind="COMPUTED_LOCAL" /><Seg label="View" value={view} onChange={setView} options={[{ v: '3d', label: '3-D' }, { v: '2d', label: '2-D' }]} /></>}>
      <p class="small muted">The covariance matrix V(t) of (X_A, P_A, X_B, P_B) is computed in this browser from the same drift and diffusion as the server (dV/dt = AV + VAᵀ + D, solved exactly by the matrix exponential; verified against the Python reference in unit tests). Ellipsoids are 1-σ surfaces of the Gaussian state; the grey sphere is the vacuum (V = I/2). Between solver samples the covariance is interpolated for display only.</p>
      <PlayerControls p={p} n={loc.t.length} t={loc.t} label="Phase-space" />
      {view === '3d' ? (
        <>
          <div class="row" style={{ marginBottom: '6px' }}>
            <Seg label="Quadratures shown" value={tri} onChange={setTri} options={[{ v: 'xa-pa-xb', label: '(X_A, P_A, X_B)' }, { v: 'xa-xb-pb', label: '(X_A, X_B, P_B)' }]} />
          </div>
          <View3D kind="plot3d" name="optomech-phase-space" opts={spec} label="Covariance ellipsoid of the two-oscillator Gaussian state" title={`1-σ phase-space ellipsoid · t = ${fmtQ(tNow, 's')}`} badge="COMPUTED LOCALLY"
            legend={[{ label: 'Gaussian state (1σ)', color: '#0072B2' }, { label: 'vacuum reference', color: '#9aa0a6' }]} playing={p.playing}
            onRecordStart={() => { p.setPos(0); p.setPlaying(true); }} frameData={() => ({ t_display: tNow, interpolated: Math.abs(p.pos - Math.round(p.pos)) > 1e-3, quadratures: ids.map((i) => QL[i]), covariance: S, E_N: ENnow })}
            fallback={<Ellipses2D V={V} ext={ext} />} />
        </>
      ) : <Ellipses2D V={V} ext={ext} />}
      <LinePlot name="optomech-EN-local" title="E_N(t): server trace and local covariance" desc="Logarithmic negativity versus time from the server and from the local covariance" xLabel="Time" xUnit="s" yLabel="E_N" yUnit="1" cursorX={tNow}
        series={[{ name: 'server (COMPUTED)', x: api.t, y: api.log_negativity, color: hypStyle('QG-COH').color }, { name: 'local covariance (COMPUTED LOCALLY)', x: loc.t, y: loc.log_negativity, color: '#E69F00', dash: [5, 4] }]} />
      <div class="outs">
        <Out label="E_N at cursor (local)" value={ENnow} sig={5} prov="COMPUTED_LOCAL" interp={Math.abs(p.pos - Math.round(p.pos)) > 1e-3 ? 'interpolated between solver samples for display' : 'solver sample'} />
        <Out label="Cov(X_A, X_B) at cursor" value={V[0][2]} sig={4} prov="COMPUTED_LOCAL" interp="Gravity-induced cross-correlation between the two oscillators (0 for independent modes)." />
        <Out label="Local vs server E_N (12 times)" value={check.absMax} sig={3} prov="COMPUTED_LOCAL" tone={check.absMax < 2e-8 ? 'good' : 'bad'}
          interp={`max absolute difference${check.relMax ? `; max relative ${fmtNum(check.relMax, 2)} where E_N > 10⁻³` : ''}. Small E_N is ill-conditioned (~10⁻¹⁰ absolute in any implementation).`} />
      </div>
      <Level min="expert">
        <DataTable caption="Covariance at cursor" head={['', ...QL]} numeric={[1, 2, 3, 4]} rows={V.map((row, i) => [QL[i], ...row.map((x) => fmtNum(x, 6))])} />
      </Level>
    </Card>
  );
}

/** 2-D phase-space ellipses (X–P of each oscillator and the X_A–X_B correlation), vector-drawn so it stays crisp at any DPR. */
function Ellipses2D({ V, ext }: { V: number[][]; ext: number }) {
  const W = 300, H = 300, k = (W / 2 - 24) / ext;
  const panels: { title: string; c: number[][]; xl: string; yl: string; color: string }[] = [
    { title: 'Oscillator A', c: [[V[0][0], V[0][1]], [V[1][0], V[1][1]]], xl: 'X_A', yl: 'P_A', color: '#0072B2' },
    { title: 'Oscillator B', c: [[V[2][2], V[2][3]], [V[3][2], V[3][3]]], xl: 'X_B', yl: 'P_B', color: '#CC79A7' },
    { title: 'Correlation X_A–X_B', c: [[V[0][0], V[0][2]], [V[2][0], V[2][2]]], xl: 'X_A', yl: 'X_B', color: '#009E73' },
  ];
  return (
    <div class="grid-3">
      {panels.map((pn) => (
        <figure class="chart" style={{ margin: 0 }}>
          <figcaption class="chart-title">{pn.title} (1-σ, dimensionless quadratures)</figcaption>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${pn.title}: 1-sigma ellipse of the covariance`} style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: '8px' }}>
            <line x1={12} y1={H / 2} x2={W - 12} y2={H / 2} stroke="var(--muted)" stroke-width="0.8" />
            <line x1={W / 2} y1={12} x2={W / 2} y2={H - 12} stroke="var(--muted)" stroke-width="0.8" />
            <path d={ellipsePath([[0.5, 0], [0, 0.5]], k, W / 2, H / 2)} fill="none" stroke="var(--muted)" stroke-dasharray="4 3" stroke-width="1.2" />
            <path d={ellipsePath(pn.c, k, W / 2, H / 2)} fill={pn.color} fill-opacity="0.18" stroke={pn.color} stroke-width="2" />
            <text x={W - 14} y={H / 2 - 6} text-anchor="end" font-size="12" fill="var(--fg)">{pn.xl}</text>
            <text x={W / 2 + 6} y={20} font-size="12" fill="var(--fg)">{pn.yl}</text>
            <text x={14} y={H - 10} font-size="11" fill="var(--muted)">dashed: vacuum · axis half-width {ext.toPrecision(3)}</text>
          </svg>
        </figure>
      ))}
    </div>
  );
}
