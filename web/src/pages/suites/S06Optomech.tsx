import { RunBar } from '../../components/Reset';
/** Suite 6 — Gravitationally coupled harmonic oscillators (Gaussian covariance dynamics), POST /api/optomech/evolve. */
import { useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, Out, EvidenceBanner, ErrorBox, Json, Level, InfoBanner, ProvBadge } from '../../components/ui';
import { NumberField, useValidity } from '../../components/fields';
import { LinePlot } from '../../plot/Chart';
import { apiPost } from '../../lib/api';
import { fmtNum, fmtTime } from '../../lib/format';
import { hypStyle } from '../../lib/hyp';
import { useRun } from './f1-shared';

interface OptoOut { t: number[]; log_negativity: number[]; coupling_rate_rad_s: number; thermal_occupation_bath: number; omega: number; note: string }
interface Params { m: number; d: number; omega: number; T: number; gamma: number; n_init: number; t_final: number; squeeze_r: number; coupling_scale: number }

export default function Page(_props: { suite?: number }) {
  const v = useValidity();
  const [p, setP] = useState<Params>({ m: 1e-14, d: 1e-4, omega: 6.283, T: 0, gamma: 1e-4, n_init: 0, t_final: 100, squeeze_r: 0, coupling_scale: 1 });
  const set = (k: keyof Params) => (x: number) => setP({ ...p, [k]: x });
  const r = useRun<{ main: OptoOut; ref: OptoOut | null }>();
  const [compare, setCompare] = useState(true);
  const run = () => r.run(async () => {
    const main = await apiPost<OptoOut>('/api/optomech/evolve', undefined, { ...p });
    const ref = compare ? await apiPost<OptoOut>('/api/optomech/evolve', undefined, { ...p, coupling_scale: 0 }) : null;
    return { main, ref };
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
            <Level min="expert"><Json data={r.data} /></Level>
          </>)}
        </div>
      </div>
    </div>
  );
}
