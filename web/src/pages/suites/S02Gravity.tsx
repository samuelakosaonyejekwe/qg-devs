import { RunBar } from '../../components/Reset';
/** Suite 2 — Schwarzschild perihelion precession / light deflection and symplectic N-body integration. */
import { useMemo, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, Out, EvidenceBanner, ErrorBox, Json, Level, Seg, InfoBanner, ProvBadge } from '../../components/ui';
import { NumberField, SelectField, useValidity } from '../../components/fields';
import { LinePlot } from '../../plot/Chart';
import { View3D } from '../../components/View3D';
import { usePlayer, PlayerControls, interp } from '../../components/Player';
import { apiPost } from '../../lib/api';
import { fmtNum, fmtQ, fmtTime } from '../../lib/format';
import { CONSTANTS } from '../../engine/index';
import { useRun, SERIES_COLORS } from './f1-shared';

const G = CONSTANTS.G;
const RAD_TO_ARCSEC = (180 / Math.PI) * 3600;
const JULIAN_CENTURY_S = 100 * 365.25 * 86400;

interface OrbitOut { precession_numeric_rad: number; precession_analytic_rad: number; deflection_numeric_rad: number; deflection_analytic_rad: number }
interface NBodyOut { t: number[]; positions: number[][][]; energy: number[] }
type V3 = [number, number, number];
interface Body { name: string; m: number; r: V3; v: V3 }
interface NBodySetup { bodies: Body[]; dt: number; steps: number; save: number }

/** Presets. Initial conditions are derived from G and stated orbital data; centre-of-mass momentum is removed. */
function preset(id: string): NBodySetup {
  const zeroCom = (bs: Body[]): Body[] => {
    const M = bs.reduce((s, b) => s + b.m, 0);
    const p = [0, 1, 2].map((k) => bs.reduce((s, b) => s + b.m * b.v[k], 0) / M);
    return bs.map((b) => ({ ...b, v: [b.v[0] - p[0], b.v[1] - p[1], b.v[2] - p[2]] as V3 }));
  };
  if (id === 'sun-earth') {
    // Sun 1.98847e30 kg; Earth 5.9722e24 kg at 1 AU with circular speed √(G M_sun / 1 AU)
    const au = 1.495978707e11, Ms = 1.98847e30, me = 5.9722e24;
    return { bodies: zeroCom([{ name: 'Sun', m: Ms, r: [0, 0, 0], v: [0, 0, 0] }, { name: 'Earth', m: me, r: [au, 0, 0], v: [0, Math.sqrt((G * (Ms + me)) / au), 0] }]), dt: 3600, steps: 8766, save: 24 };
  }
  if (id === 'sun-earth-moon') {
    const au = 1.495978707e11, Ms = 1.98847e30, me = 5.9722e24, mm = 7.342e22, dm = 3.844e8;
    const ve = Math.sqrt((G * Ms) / au), vm = Math.sqrt((G * (me + mm)) / dm);
    // Earth–Moon barycentre on a circular orbit; Moon on a circular orbit about Earth (relative speed vm)
    const xe = au - (mm / (me + mm)) * dm, xm = au + (me / (me + mm)) * dm;
    return { bodies: zeroCom([{ name: 'Sun', m: Ms, r: [0, 0, 0], v: [0, 0, 0] }, { name: 'Earth', m: me, r: [xe, 0, 0], v: [0, ve - (mm / (me + mm)) * vm, 0] }, { name: 'Moon', m: mm, r: [xm, 0, 0], v: [0, ve + (me / (me + mm)) * vm, 0] }]), dt: 1800, steps: 17532, save: 24 };
  }
  if (id === 'binary') {
    // two equal masses m at separation a on a circular orbit: each speed √(G m / (2a)); period 2π√(a³/(2Gm))
    const m = 1e30, a = 1e11, v = Math.sqrt((G * m) / (2 * a)), P = 2 * Math.PI * Math.sqrt(a ** 3 / (2 * G * m));
    return { bodies: [{ name: 'Star 1', m, r: [-a / 2, 0, 0], v: [0, -v, 0] }, { name: 'Star 2', m, r: [a / 2, 0, 0], v: [0, v, 0] }], dt: P / 2000, steps: 6000, save: 20 };
  }
  // Chenciner & Montgomery (2000) figure-eight in units G = m = 1 (Simó's initial data), scaled to SI with
  // mass unit M0 = 1e30 kg, length unit L0 = 1e11 m, time unit T0 = √(L0³/(G M0)); period ≈ 6.3259 T0.
  const M0 = 1e30, L0 = 1e11, T0 = Math.sqrt(L0 ** 3 / (G * M0)), V0 = L0 / T0;
  const x1: V3 = [0.97000436 * L0, -0.24308753 * L0, 0], v3: V3 = [-0.93240737 * V0, -0.86473146 * V0, 0];
  return {
    bodies: [
      { name: 'Body 1', m: M0, r: x1, v: [-v3[0] / 2, -v3[1] / 2, 0] },
      { name: 'Body 2', m: M0, r: [-x1[0], -x1[1], 0], v: [-v3[0] / 2, -v3[1] / 2, 0] },
      { name: 'Body 3', m: M0, r: [0, 0, 0], v: v3 },
    ], dt: (6.32591398 * T0) / 4000, steps: 8000, save: 20,
  };
}
const PRESETS = [
  { v: 'sun-earth', label: 'Sun–Earth (1 year)' }, { v: 'sun-earth-moon', label: 'Sun–Earth–Moon (1 year)' },
  { v: 'binary', label: 'Equal-mass circular binary (3 orbits)' }, { v: 'figure8', label: 'Three-body figure-eight (2 periods)' },
];

export default function Page(_props: { suite?: number }) {
  return (
    <div>
      <SuiteHeader n={2} intro="Classical gravitation: exact Schwarzschild orbit equation integrated numerically and compared with the post-Newtonian closed forms, plus a symplectic velocity-Verlet N-body integrator with energy monitoring." />
      <Orbit />
      <NBody />
    </div>
  );
}

function Orbit() {
  const v = useValidity();
  const [M, setM] = useState(1.98847e30);
  const [a, setA] = useState(5.7909e10);
  const [e, setE] = useState(0.2056);
  const r = useRun<OrbitOut & { M: number; a: number; e: number }>();
  const d = r.data;
  const P = d ? 2 * Math.PI * Math.sqrt(d.a ** 3 / (G * d.M)) : NaN;
  const perCentury = d ? JULIAN_CENTURY_S / P : NaN;
  const rel = (x: number, y: number) => Math.abs(x - y) / Math.abs(y);
  return (
    <Card title="Perihelion precession and light deflection (Schwarzschild)">
      <div class="split">
        <div>
          <NumberField name="M" label="Central mass M" unit="kg" value={M} min={0} max={1e40} minExclusive report={v.report} onChange={setM}
            help="Mass of the central body (default: the Sun, 1.98847×10³⁰ kg). Precession per orbit is 6πGM/(c²a(1−e²))." />
          <NumberField name="a" label="Semi-major axis a" unit="m" value={a} min={0} max={1e16} minExclusive report={v.report} onChange={setA}
            help="Orbit size (default: Mercury, 5.7909×10¹⁰ m). The light ray is evaluated at impact parameter b = a(1−e), the perihelion distance." />
          <NumberField name="e" label="Eccentricity e" unit="1" value={e} min={0} max={0.95} maxExclusive report={v.report} onChange={setE}
            help="Orbital eccentricity, 0 ≤ e < 0.95 (server limit)." />
          <RunBar label="Compute" busy={r.busy} disabled={!v.ok} onRun={() => r.run(async () => ({ ...(await apiPost<OrbitOut>('/api/gravity/orbit', undefined, { M, a, e })), M, a, e }))} />
        </div>
        <div class="stack">
          <EvidenceBanner />
          <ErrorBox error={r.err} what="computing the orbit" />
          {d && (<>
            <div class="row"><ProvBadge kind="COMPUTED" /><span class="small muted">{fmtTime(r.at)}</span></div>
            <div class="outs">
              <Out label="Precession per orbit (numeric)" value={d.precession_numeric_rad} unit="rad" prov="COMPUTED" interp="From integrating u'' + u = GM/h² + 3GMu²/c² and locating successive maxima of u = 1/r." />
              <Out label="Precession per orbit (analytic)" value={d.precession_analytic_rad} unit="rad" prov="COMPUTED" interp={`6πGM/(c²a(1−e²)); relative difference ${fmtNum(rel(d.precession_numeric_rad, d.precession_analytic_rad), 2)} (higher-order terms + integration error).`} />
              <Out label="Precession rate" value={`${fmtNum(d.precession_numeric_rad * perCentury * RAD_TO_ARCSEC, 4)} ″/century`} prov="COMPUTED"
                interp={`Numeric value × orbits per Julian century, with the Kepler period P = 2π√(a³/GM) = ${fmtQ(P, 's')} (${fmtNum(P / 86400, 4)} d). For Mercury the GR contribution is ≈ 43″/century.`} />
              <Out label="Light deflection (numeric)" value={d.deflection_numeric_rad} unit="rad" prov="COMPUTED" interp={`Null geodesic u'' + u = 3GMu²/c² at b = a(1−e) = ${fmtQ(d.a * (1 - d.e), 'm')}; = ${fmtNum(d.deflection_numeric_rad * RAD_TO_ARCSEC, 4)}″.`} />
              <Out label="Light deflection (weak field)" value={d.deflection_analytic_rad} unit="rad" prov="COMPUTED" interp={`4GM/(c²b); relative difference ${fmtNum(rel(d.deflection_numeric_rad, d.deflection_analytic_rad), 2)}.`} />
            </div>
          </>)}
        </div>
      </div>
    </Card>
  );
}

function NBody() {
  const v = useValidity();
  const [pid, setPid] = useState('sun-earth');
  const [setup, setSetup] = useState<NBodySetup>(() => preset('sun-earth'));
  const r = useRun<NBodyOut & { names: string[] }>();
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const d = r.data;
  const nFrames = d?.t.length ?? 0;
  const player = usePlayer(nFrames, 30);
  const frames = (setup.steps / setup.save) | 0;
  const tooMany = frames > 5000;

  const run = () => r.run(async () => ({
    ...(await apiPost<NBodyOut>('/api/gravity/nbody', { masses: setup.bodies.map((b) => b.m), positions: setup.bodies.map((b) => b.r), velocities: setup.bodies.map((b) => b.v), dt: setup.dt, steps: setup.steps, save_every: setup.save })),
    names: setup.bodies.map((b) => b.name),
  }));
  const series = useMemo(() => d ? d.names.map((n, k) => ({ name: n, color: SERIES_COLORS[k % SERIES_COLORS.length], points: d.positions.map((p) => p[k] as V3) })) : [], [d]);
  const drift = useMemo(() => d ? d.energy.map((E) => (E - d.energy[0]) / Math.abs(d.energy[0])) : [], [d]);
  const setBody = (k: number, b: Partial<Body>) => setSetup({ ...setup, bodies: setup.bodies.map((x, i) => (i === k ? { ...x, ...b } : x)) });

  const fallback = d && (
    <LinePlot name="nbody-xy" title="Trajectories (x–y plane)" desc="Body trajectories projected on the x–y plane" xLabel="x" xUnit="m" yLabel="y" yUnit="m" aspect={0.8}
      series={[
        ...series.map((s) => ({ name: s.name, x: s.points.map((p) => p[0]), y: s.points.map((p) => p[1]), color: s.color, width: 1.6 })),
        // body positions at the playback cursor (interpolated between saved samples for display)
        ...series.map((s) => ({ name: `${s.name} (now)`, x: [interp(s.points.map((p) => p[0]), player.pos)], y: [interp(s.points.map((p) => p[1]), player.pos)], color: s.color, markers: true })),
      ]} />
  );
  return (
    <Card title="N-body integration (velocity Verlet)">
      <div class="split">
        <div>
          <SelectField label="Preset" value={pid} onChange={(x) => { setPid(x); setSetup(preset(x)); }} options={PRESETS}
            help="Initial conditions are computed from G and the stated orbital data (circular orbits; figure-eight from Chenciner & Montgomery 2000, scaled to SI). The centre-of-mass drift is removed." />
          <NumberField name="dt" label="Time step Δt" unit="s" value={setup.dt} min={0} max={1e12} minExclusive report={v.report} onChange={(x) => setSetup({ ...setup, dt: x })}
            help="Integration step. Velocity Verlet is second order and symplectic: energy errors stay bounded and scale as Δt²." />
          <NumberField name="steps" label="Steps" unit="1" value={setup.steps} min={1} max={200000} integer report={v.report} onChange={(x) => setSetup({ ...setup, steps: x })}
            help={`Number of steps (server limit 200 000). Simulated span = steps × Δt = ${fmtQ(setup.steps * setup.dt, 's')}.`} />
          <NumberField name="save" label="Save every" unit="1" value={setup.save} min={1} max={200000} integer report={v.report} onChange={(x) => setSetup({ ...setup, save: x })}
            help="Store one frame every N steps (affects only output size, not accuracy)." />
          {tooMany && <div class="field-error">This would return {frames} frames; increase “save every” to keep the response small (≤ 5000 frames).</div>}
          <Level min="advanced">
            <details>
              <summary>Bodies ({setup.bodies.length})</summary>
              {setup.bodies.map((b, k) => (
                <fieldset class="fieldset" key={`${pid}-${k}`}>
                  <legend>{b.name}</legend>
                  <NumberField name={`m${k}`} label="Mass" unit="kg" value={b.m} min={0} max={1e42} minExclusive report={v.report} onChange={(x) => setBody(k, { m: x })} help="Point mass." />
                  {(['x', 'y', 'z'] as const).map((ax, i) => <NumberField name={`r${k}${ax}`} label={`Position ${ax}`} unit="m" value={b.r[i]} min={-1e16} max={1e16} report={v.report}
                    onChange={(x) => { const r2 = b.r.slice() as V3; r2[i] = x; setBody(k, { r: r2 }); }} help="Initial position component." />)}
                  {(['x', 'y', 'z'] as const).map((ax, i) => <NumberField name={`v${k}${ax}`} label={`Velocity ${ax}`} unit="m/s" value={b.v[i]} min={-3e8} max={3e8} report={v.report}
                    onChange={(x) => { const v2 = b.v.slice() as V3; v2[i] = x; setBody(k, { v: v2 }); }} help="Initial velocity component (Newtonian; must be ≪ c)." />)}
                </fieldset>
              ))}
            </details>
          </Level>
          <RunBar label="Integrate" busy={r.busy} disabled={!v.ok || tooMany} onRun={run} />
        </div>
        <div class="stack">
          <EvidenceBanner />
          <ErrorBox error={r.err} what="integrating the N-body system" />
          {!d && !r.busy && <InfoBanner>Pick a preset and press <b>Integrate</b>; the trajectories are computed by the server.</InfoBanner>}
          {d && (<>
            <div class="row"><ProvBadge kind="COMPUTED" /><span class="small muted">{d.t.length} frames · {fmtTime(r.at)}</span></div>
            <Seg label="Trajectory view" value={view} onChange={setView} options={[{ v: '3d', label: '3-D' }, { v: '2d', label: '2-D (x–y)' }]} />
            <PlayerControls p={player} n={nFrames} t={d.t} label="N-body" />
            {view === '3d' ? <View3D kind="trajectories" label="Computed N-body trajectories" opts={{ series, unit: 'm' }} frame={player.pos} fallback={fallback}
              title="N-body trajectories (velocity Verlet)" badge="COMPUTED" name="nbody" legend={series.map((s) => ({ label: s.name, color: s.color }))}
              onRecordStart={() => { player.setPos(0); player.setPlaying(true); }} playing={player.playing}
              frameData={() => ({ nearest_sample: player.frame, t_s: d.t[player.frame], positions_m: Object.fromEntries(series.map((s) => [s.name, s.points[player.frame]])), source: 'COMPUTED (server, POST /api/gravity/nbody)' })} /> : fallback}
            <div class="outs">
              <Out label="Max |relative energy drift|" value={Math.max(...drift.map(Math.abs))} prov="COMPUTED" interp="max |E(t) − E₀|/|E₀|. Symplectic integration keeps this bounded; halve Δt to see it drop ~4×." />
              <Out label="Simulated span" value={d.t[d.t.length - 1]} unit="s" prov="COMPUTED" interp={`${fmtNum(d.t[d.t.length - 1] / 86400, 4)} days.`} />
            </div>
            <LinePlot name="nbody-energy" title="Relative energy drift (E − E₀)/|E₀|" desc="Total energy error versus time" xLabel="Time" xUnit="s" yLabel="(E − E₀)/|E₀|" yUnit="1" cursorX={interp(d.t, player.pos)}
              series={[{ name: 'energy drift', x: d.t, y: drift, color: SERIES_COLORS[0] }]} />
            <Level min="expert"><Json data={{ t: d.t.length, energy: d.energy.slice(0, 20) }} /></Level>
          </>)}
        </div>
      </div>
    </Card>
  );
}
