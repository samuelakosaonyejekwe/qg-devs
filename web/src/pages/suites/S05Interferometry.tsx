import { RunBar } from '../../components/Reset';
/** Suite 5 — Stern–Gerlach BMV phases (time-dependent trajectories) and an animated 2-D split wave packet. */
import { useMemo, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, Out, EvidenceBanner, ErrorBox, DataTable, Json, Level, Seg, InfoBanner, ProvBadge } from '../../components/ui';
import { NumberField, useValidity } from '../../components/fields';
import { ScenarioForm } from '../../components/ScenarioForm';
import { LinePlot, HeatMap } from '../../plot/Chart';
import { View3D } from '../../components/View3D';
import { usePlayer, PlayerControls } from '../../components/Player';
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
            help="Duration of each of the four constant-acceleration stages that open (2τ) and close (2τ) the superposition. Branch separation reaches Δx after 2τ and is held for the interaction time t; total loop time 4τ + t. The required magnetic gradient grows as Δx/τ²." />
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
              <Out label="Δφ (time-dependent SG loop)" value={d.delta_phi} unit="rad" prov="COMPUTED" interp="φ_LL + φ_RR − φ_LR − φ_RL with φ_ij = −(1/ħ)∫U_ij(t)dt along the actual SG trajectories." />
              {stat && <Out label="Δφ (static model, gravity only)" value={stat.delta_phi_gravity_rad} unit="rad" prov="COMPUTED_LOCAL"
                interp={`Branches held at full Δx for exactly t (Suite 4 model). Ratio SG/static = ${fmtNum(d.delta_phi / stat.delta_phi_gravity_rad, 4)}: the SG loop adds phase during the 4τ opening/closing stages (partially separated branches) — the static model ignores them.`} />}
              <Out label="Total loop time 4τ + t" value={d.total_time} unit="s" prov="COMPUTED" />
              <Out label="Acceleration a = Δx/(2τ²)" value={d.acceleration} unit="m/s²" prov="COMPUTED" interp="Constant acceleration of each branch during the stages." />
              <Out label="Required magnetic gradient" value={d.required_gradient_T_per_m} unit="T/m" prov="CALCULATED_REQUIREMENT" interp="Gradient needed to produce this acceleration via the spin's magnetic moment; values ≫ 10⁴ T/m exceed demonstrated technology." />
            </div>
            <DataTable caption="Branch phases" head={['Branch pair', 'φ (SG, rad)', stat ? 'φ (static, rad)' : '']} numeric={[1, 2]}
              rows={BRANCHES.map((k) => [k, fmtNum(d.phases[k], 8), stat ? fmtNum(stat.phases_rad[k], 8) : ''])} />
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
  const z = d?.frames[fr];
  return (
    <Card title="Split wave packet in a gravitational field (2-D split-step Fourier)">
      <div class="split">
        <div>
          <NumberField name="mass" label="Particle mass" unit="kg" value={p.mass} min={0} max={1e-15} minExclusive report={v.report} onChange={set('mass')}
            help="Mass of the matter wave (default 1×10⁻²⁵ kg ≈ 60 u, an atom/small molecule). Spreading rate ∝ ħ/(mσ)." />
          <NumberField name="sigma" label="Packet width σ" unit="m" value={p.sigma} min={0} max={2e-5} minExclusive report={v.report} onChange={set('sigma')}
            help="Initial Gaussian width (the grid spans ±40 µm, so σ must be well inside it)." />
          <NumberField name="k" label="Split wave number k" unit="m⁻¹" value={p.split_k} min={0} max={1e9} report={v.report} onChange={set('split_k')}
            help="The packet is prepared as a superposition of momenta ±ħk along x (a beam splitter); the branches separate at speed ħk/m and interfere where they overlap." />
          <NumberField name="g" label="Gravitational acceleration g" unit="m/s²" value={p.gravity} min={0} max={1e3} report={v.report} onChange={set('gravity')}
            help="Uniform field along −y (potential m g y); both branches fall together, so gravity shifts but does not split them." />
          <NumberField name="tf" label="Evolution time" unit="s" value={p.t_final} min={0} max={1} minExclusive report={v.report} onChange={set('t_final')} help="Total simulated time (400 split-step steps)." />
          <NumberField name="frames" label="Frames" unit="1" value={p.frames} min={2} max={120} integer report={v.report} onChange={set('frames')} help="Number of stored snapshots (server limit ≤ 120)." />
          <NumberField name="n" label="Grid points per axis" unit="1" value={p.n} min={16} max={256} integer level="advanced" report={v.report} onChange={set('n')}
            help="Spatial grid resolution (server limit ≤ 256). Must resolve the fringe spacing π/k. Cost grows as n² log n: 128 points takes about 15 s on the reference server." />
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
              ? <HeatMap name="wavepacket" title={`|ψ(x, y)|² at t = ${fmtQ(d.t[fr], 's')}`} desc="Normalised probability density of the split wave packet" z={z} x={d.x} y={d.x} xLabel="x" xUnit="m" yLabel="y" yUnit="m" zLabel="|ψ|²/max" palette="magma" zDomain={[0, 1]} aspect={0.85} />
              : <View3D kind="surface" label="Probability density surface" opts={{ z, xLabel: 'x', yLabel: 'y', zLabel: '|ψ|²/max', colormap: 'magma' }} frame={fr}
                  fallback={<HeatMap name="wavepacket" title="|ψ|²" desc="Normalised density" z={z} x={d.x} y={d.x} xLabel="x" xUnit="m" yLabel="y" yUnit="m" zLabel="|ψ|²/max" palette="magma" zDomain={[0, 1]} />} />}
            <p class="small muted">Each frame is normalised to its own maximum by the server (shape, not absolute density). Grid: ±{fmtQ(Math.max(...d.x), 'm')}.</p>
            <Level min="expert"><Json data={{ t: d.t, units: d.units, kind: d.kind, grid: d.x.length }} /></Level>
          </>)}
        </div>
      </div>
    </Card>
  );
}
