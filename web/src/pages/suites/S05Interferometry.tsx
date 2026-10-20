import { MathText } from '../../components/Tex';
import { T } from '../formulas-l1';
import { RunBar } from '../../components/Reset';
/** Suite 5 — Stern–Gerlach BMV phases (time-dependent trajectories) and an animated 2-D split wave packet. */
import { useMemo, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, Out, EvidenceBanner, ErrorBox, DataTable, Json, Level, Seg, InfoBanner, ProvBadge } from '../../components/ui';
import { NumberField, useValidity } from '../../components/fields';
import { ScenarioForm } from '../../components/ScenarioForm';
import { LinePlot, HeatMap } from '../../plot/Chart';
import { View3D } from '../../components/View3D';
import { usePlayer, PlayerControls, interp } from '../../components/Player';
import { apiPost } from '../../lib/api';
import { useStore, scenario } from '../../lib/store';
import { fmtNum, fmtQ, fmtTime } from '../../lib/format';
import { predictScenario } from '../../engine/index';
import { BRANCHES } from '../../lib/types';
import { useRun, SERIES_COLORS } from './f1-shared';

interface SgOut { phases: Record<string, number>; delta_phi: number; total_time: number; acceleration: number; required_gradient_T_per_m: number; trajectory_t: number[]; trajectory_x: number[] }
interface WpOut { x: number[]; t: number[]; frames: number[][][]; units: { x: string; t: string }; kind: string }

export default function Page(_props: { suite?: number }) {
  return (
    <div>
      <SuiteHeader n={5} intro="Matter-wave interferometry: closed-loop Stern–Gerlach trajectories that open and close the BMV superpositions (the branch phases are integrated along the actual time-dependent paths), and split-step Fourier evolution of a coherently split wave packet falling under gravity." />
      <SternGerlach />
      <WavePacket />
    </div>
  );
}

function SternGerlach() {
  const sc = useStore(scenario);
  const v = useValidity();
  const [tau, setTau] = useState(0.25);
  const r = useRun<SgOut>();
  const d = r.data;
  const stat = useMemo(() => {
    const p = predictScenario({ ...sc.design, gamma_A: 0, gamma_B: 0 }, { ...sc.environment, include_casimir: false, residual_charge_e: 0 }, 10);
    return 'phases_rad' in p ? p : null;
  }, [sc]);
  return (
    <Card title="Stern–Gerlach BMV phases">
      <div class="split">
        <div>
          <ScenarioForm value={sc} onChange={(s) => scenario.set(s)} report={v.report} showEnv={false} />
          <NumberField name="tau" label="Acceleration stage τ" unit="s" value={tau} min={0} max={1e3} minExclusive report={v.report} onChange={setTau}
            help={<MathText text={T.s5_tau} />} />
          <p class="small muted">The SG model uses equal branch separation Δx_A and point masses; angled geometry is treated as linear by the server.</p>
          <RunBar label="Compute SG phases" scenario busy={r.busy} disabled={!v.ok} onRun={() => r.run(() => apiPost<SgOut>('/api/interferometry/sg', sc, { tau }))} />
        </div>
        <div class="stack">
          <EvidenceBanner />
          <ErrorBox error={r.err} what="computing Stern–Gerlach phases" />
          {!d && !r.busy && <InfoBanner>Press <b>Compute SG phases</b>; the trajectory integrals are evaluated by the server.</InfoBanner>}
          {d && (<>
            <div class="row"><ProvBadge kind="COMPUTED" /><span class="small muted">{fmtTime(r.at)}</span></div>
            <div class="outs">
              <Out label="Δφ (time-dependent SG loop)" value={d.delta_phi} unit="rad" prov="COMPUTED" interp={<MathText text={T.s5_dphi} />} />
              {stat && <Out label="Δφ (static model, gravity only)" value={stat.delta_phi_gravity_rad} unit="rad" prov="COMPUTED_LOCAL"
                interp={`Branches held at full Δx for exactly t (Suite 4 model). Ratio SG/static = ${fmtNum(d.delta_phi / stat.delta_phi_gravity_rad, 4)}: the SG loop adds phase during the 4τ opening/closing stages (partially separated branches) — the static model ignores them.`} />}
              <Out label="Total loop time 4τ + t" value={d.total_time} unit="s" prov="COMPUTED" />
              <Out label="Acceleration a = Δx/(2τ²)" value={d.acceleration} unit="m/s²" prov="COMPUTED" interp="Constant acceleration of each branch during the stages." />
              <Out label="Required magnetic gradient" value={d.required_gradient_T_per_m} unit="T/m" prov="CALCULATED_REQUIREMENT" interp="Gradient needed to produce this acceleration via the spin's magnetic moment; values ≫ 10⁴ T/m exceed demonstrated technology." />
            </div>
            <DataTable caption="Branch phases" head={['Branch pair', 'φ (SG, rad)', stat ? 'φ (static, rad)' : '']} numeric={[1, 2]}
              rows={BRANCHES.map((k) => [k, fmtNum(d.phases[k], 6), stat ? fmtNum(stat.phases_rad[k], 6) : ''])} />
            <LinePlot name="sg-trajectory" title="Branch displacement x(t)" desc="Displacement of one branch from the trap centre over the closed SG loop" xLabel="Time" xUnit="s" yLabel="Displacement" yUnit="m"
              series={[{ name: '+x(t) (branch L; R is −x(t))', x: d.trajectory_t, y: d.trajectory_x, color: SERIES_COLORS[0], markers: true }]} />
            <Level min="expert"><Json data={d} /></Level>
          </>)}
        </div>
      </div>
    </Card>
  );
}

function WavePacket() {
  const v = useValidity();
  const [p, setP] = useState({ mass: 1e-25, sigma: 5e-7, split_k: 2e6, gravity: 9.81, t_final: 2e-3, frames: 40, n: 128 });
  const set = (k: keyof typeof p) => (x: number) => setP({ ...p, [k]: x });
  const r = useRun<WpOut>();
  const d = r.data;
  const player = usePlayer(d?.frames.length ?? 0, 10);
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const fr = d ? Math.min(player.frame, d.frames.length - 1) : 0;
  // display frame: linear blend of the two neighbouring solver frames at the fractional cursor (display only)
  const z = useMemo(() => {
    if (!d) return undefined;
    const x = Math.max(0, Math.min(d.frames.length - 1, player.pos)), i = Math.floor(x), j = Math.min(d.frames.length - 1, i + 1), w = x - i;
    if (w < 1e-3) return d.frames[i];
    const A = d.frames[i], B = d.frames[j];
    return A.map((row, a) => row.map((v, b) => v * (1 - w) + B[a][b] * w));
  }, [d, player.pos]);
  const tShown = d ? interp(d.t, player.pos) : 0;
  // visibility rule: largest change of the (normalised) density relative to frame 0
  const change = useMemo(() => {
    if (!d) return 0;
    let m = 0;
    const f0 = d.frames[0];
    for (const f of d.frames) for (let a = 0; a < f.length; a++) for (let b = 0; b < f[a].length; b++) m = Math.max(m, Math.abs(f[a][b] - f0[a][b]));
    return m;
  }, [d]);
  const surfOpts = useMemo(() => (z ? { z, xLabel: 'x', yLabel: 'y', zLabel: '|ψ|²/max', colormap: 'magma' } : null), [z]);
  return (
    <Card title="Split wave packet in a gravitational field (2-D split-step Fourier)">
      <div class="split">
        <div>
          <NumberField name="mass" label="Particle mass" unit="kg" value={p.mass} min={0} max={1e-15} minExclusive report={v.report} onChange={set('mass')}
            help={<MathText text={T.s5_mass} />} />
          <NumberField name="sigma" label="Packet width σ" unit="m" value={p.sigma} min={0} max={2e-5} minExclusive report={v.report} onChange={set('sigma')}
            help={<MathText text={T.s5_sigma} />} />
          <NumberField name="k" label="Split wave number k" unit="m⁻¹" value={p.split_k} min={0} max={1e9} report={v.report} onChange={set('split_k')}
            help={<MathText text={T.s5_k} />} />
          <NumberField name="g" label="Gravitational acceleration g" unit="m/s²" value={p.gravity} min={0} max={1e3} report={v.report} onChange={set('gravity')}
            help="Uniform field along −y (potential m g y); both branches fall together, so gravity shifts but does not split them." />
          <NumberField name="tf" label="Evolution time" unit="s" value={p.t_final} min={0} max={1} minExclusive report={v.report} onChange={set('t_final')} help="Total simulated time (400 split-step steps)." />
          <NumberField name="frames" label="Frames" unit="1" value={p.frames} min={2} max={120} integer report={v.report} onChange={set('frames')} help="Number of stored snapshots (server limit ≤ 120)." />
          <NumberField name="n" label="Grid points per axis" unit="1" value={p.n} min={16} max={256} integer level="advanced" report={v.report} onChange={set('n')}
            help={<MathText text={T.s5_n} />} />
          <RunBar label="Simulate" scenario busy={r.busy} disabled={!v.ok} onRun={() => r.run(() => apiPost<WpOut>('/api/interferometry/wavepacket2d', undefined, p))} />
        </div>
        <div class="stack">
          <EvidenceBanner />
          <ErrorBox error={r.err} what="evolving the wave packet" />
          {!d && !r.busy && <InfoBanner>Press <b>Simulate</b> to compute the density frames on the server.</InfoBanner>}
          {d && z && (<>
            <div class="row"><ProvBadge kind="COMPUTED" /><span class="small muted">{d.kind} · {d.frames.length} frames · grid {d.x.length}² · {fmtTime(r.at)}</span></div>
            <PlayerControls p={player} n={d.frames.length} t={d.t} label="Wave packet" />
            <Seg label="Density view" value={view} onChange={setView} options={[{ v: '2d', label: 'Heat map' }, { v: '3d', label: '3-D surface' }]} />
            {view === '2d'
              ? <HeatMap animated name="wavepacket" title={`|ψ(x, y)|² at t = ${fmtQ(tShown, 's')}${Math.abs(player.pos - fr) > 1e-3 ? ' (display blend of neighbouring solver frames)' : ''}`} desc="Normalised probability density of the split wave packet" z={z} x={d.x} y={d.x} xLabel="x" xUnit="m" yLabel="y" yUnit="m" zLabel="|ψ|²/max" palette="magma" zDomain={[0, 1]} aspect={0.85} />
              : <View3D kind="surface" label="Probability density surface" opts={surfOpts} frame={player.pos}
                  title={`|ψ(x, y)|² surface, t = ${fmtQ(tShown, 's')}`} badge="COMPUTED" name="wavepacket-surface" change={{ rel: change, what: 'normalised density' }}
                  colorbar={{ map: 'magma', titleTex: String.raw`|\psi|^2/\max`, title: '|ψ|²/max', ticks: [{ at: 0, tex: '0' }, { at: 0.5, tex: '0.5' }, { at: 1, tex: '1' }] }}
                  onRecordStart={() => { player.setPos(0); player.setPlaying(true); }} playing={player.playing}
                  frameData={() => ({ nearest_frame: fr, t_s: d.t[fr], x_m: d.x, density_normalised: d.frames[fr], source: `COMPUTED (server, ${d.kind})` })}
                  fallback={<HeatMap animated name="wavepacket" title="|ψ|²" desc="Normalised density" z={z} x={d.x} y={d.x} xLabel="x" xUnit="m" yLabel="y" yUnit="m" zLabel="|ψ|²/max" palette="magma" zDomain={[0, 1]} />} />}
            {change < 5e-3 && <p class="small" role="note" data-below-resolution>Change over this run (normalised density): {fmtNum(change, 2)} — below display resolution.</p>}
            <p class="small muted">Each frame is normalised to its own maximum by the server (shape, not absolute density). Grid: ±{fmtQ(Math.max(...d.x), 'm')}.</p>
            <Level min="expert"><Json data={{ t: d.t, units: d.units, kind: d.kind, grid: d.x.length }} /></Level>
          </>)}
        </div>
      </div>
    </Card>
  );
}
