import { RunBar, useAfterReset } from '../../components/Reset';
/** Suite 7 — decoherence budget of one superposed mass (POST /api/decoherence/budget). */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, Out, ProvBadge, EvidenceBanner, ErrorBox, Switch, Tip, DataTable, Json, Level, InfoBanner } from '../../components/ui';
import { NumberField, useValidity } from '../../components/fields';
import { ScenarioForm } from '../../components/ScenarioForm';
import { BarChart, LinePlot } from '../../plot/Chart';
import { useStore, scenario, settings, atLeast } from '../../lib/store';
import { apiPost } from '../../lib/api';
import { fmtQ, fmtNum, fmtPct } from '../../lib/format';
import type { DecoBudget } from '../../lib/types';
import { decoherenceBudget, getMaterial, clausiusMossotti, radiusOf } from '../../engine/index';
import { useRun, body, logspace, MECH_LABEL, MECH_COLOR } from './f2-shared';

export default function Page(_props: { suite?: number }) {
  const sc = useStore(scenario);
  const st = useStore(settings);
  const v = useValidity();
  const [dp, setDp] = useState(true);
  const r = useRun(() => apiPost<DecoBudget>('/api/decoherence/budget', body(sc), { include_dp: dp }));
  const afterReset = useAfterReset();
  // auto-run once on arrival, but never right after a Reset (the user asked for a clean page)
  useEffect(() => { if (afterReset) return; r.run(); }, []);
  const b = r.data;

  return (
    <div>
      <SuiteHeader n={7} intro="Environmental decoherence of one superposed mass: residual-gas collisions, black-body scattering, absorption and emission, and optionally Diósi–Penrose gravitational collapse. Rates are single-mass branch-coherence decay rates Γ, with |ρ_LR(t)| = |ρ_LR(0)| e^{−Γt}; they feed the joint-state model of Suite 4." />
      <div class="split">
        <div class="sticky-side card">
          <h2>Configuration</h2>
          <ScenarioForm value={sc} onChange={(s) => scenario.set(s)} report={v.report} />
          <div class="row" style={{ margin: '8px 0' }}>
            <Switch checked={dp} onChange={setDp} label="Include Diósi–Penrose collapse" />
            <Tip text="Γ_DP = κ·E_Δ/ħ with E_Δ = U(Δx) − U(0) for a uniform sphere. The server uses κ = 1 (Diósi's mass-density convention); Penrose's convention differs by a factor 2. DP is a hypothesis (model DP-COLL), not established environmental physics — include it only to compare." />
          </div>
          <RunBar label="Compute budget" scenario busy={r.busy} disabled={!v.ok} onRun={r.run} />
          {!v.ok && <p class="field-error">Fix the highlighted inputs first.</p>}
        </div>
        <div class="stack">
          <EvidenceBanner />
          <ErrorBox error={r.error} what="computing the decoherence budget" />
          {r.offline && <p class="small muted">No fresh data was fetched. {b ? 'The values below are from the last successful server computation.' : ''} The Advanced view below still computes locally.</p>}
          {b && <Budget b={b} t={sc.design.time} dp={dp} />}
          <Level min="advanced"><LocalPressure b={b} dp={dp} /></Level>
          {b && atLeast(st.mode, 'expert') && <Card title="Raw response (expert)"><Json data={b} /></Card>}
        </div>
      </div>
    </div>
  );
}

function Budget({ b, t, dp }: { b: DecoBudget; t: number; dp: boolean }) {
  const keys = Object.keys(b.mechanisms);
  const total = b.total_rate;
  return (
    <>
      <Card title="Totals" actions={<ProvBadge kind="COMPUTED" />}>
        <div class="outs">
          <Out label="Total decoherence rate Γ" value={total} unit="s⁻¹" prov="COMPUTED" interp="Sum of all mechanisms for one mass." />
          <Out label="Total Γt over the interaction time" value={b.total_gamma_t} sig={4} prov="COMPUTED"
            interp={`Exponent of coherence loss over t = ${fmtQ(t, 's')}. Γt ≪ 1 keeps branch coherence; Γt ≳ 1 erases it.`} />
          <Out label="Coherence factor e^{−Γt}" value={b.coherence_factor} sig={6} prov="COMPUTED" tone={b.coherence_factor > 0.9 ? 'good' : b.coherence_factor < 0.37 ? 'bad' : null}
            interp="Remaining off-diagonal coherence |ρ_LR(t)/ρ_LR(0)| of each mass." />
          <Out label="Dominant mechanism" value={b.dominant ? MECH_LABEL[b.dominant] ?? b.dominant : '—'} prov="COMPUTED"
            interp={b.dominant && total > 0 ? `Contributes ${fmtPct(b.mechanisms[b.dominant].rate / total)} of the total rate — the first thing to improve.` : 'All rates are zero.'} />
        </div>
      </Card>
      <Card title="Mechanisms">
        <DataTable caption="Decoherence mechanisms" head={['Mechanism', 'Rate Γ (s⁻¹)', 'Γt', 'e^{−Γt}', 'Regime']} numeric={[1, 2, 3]}
          hl={(i) => keys[i] === b.dominant}
          rows={keys.map((k) => {
            const m = b.mechanisms[k];
            return [<>{MECH_LABEL[k] ?? k}{k === b.dominant && <span class="badge b-warn" style={{ marginLeft: '6px' }}>dominant</span>}</>,
              fmtNum(m.rate), fmtNum(m.gamma_t), fmtNum(m.coherence_factor, 8), <span class="small">{String(m.regime ?? '')}</span>];
          })} />
        {dp && b.mechanisms.diosi_penrose_collapse && (
          <p class="small muted">Diósi–Penrose convention factor κ = {String((b.mechanisms.diosi_penrose_collapse as any).convention_factor)} (Diósi); E_Δ = {fmtQ((b.mechanisms.diosi_penrose_collapse as any).E_delta_J, 'J')}. This is a hypothesised collapse rate, not an environmental effect.</p>
        )}
        <h3 style={{ marginTop: '14px' }}>Share of the total rate</h3>
        {total > 0 ? (
          <>
            <div class="stackbar" role="img" aria-label={`Share of total rate: ${keys.map((k) => `${MECH_LABEL[k] ?? k} ${fmtPct(b.mechanisms[k].rate / total, 3)}`).join(', ')}`}>
              {keys.map((k) => <div title={`${MECH_LABEL[k] ?? k}: ${fmtPct(b.mechanisms[k].rate / total, 4)}`} style={{ width: `${(100 * b.mechanisms[k].rate) / total}%`, background: MECH_COLOR[k] ?? '#888' }} />)}
            </div>
            <div class="row small" style={{ marginTop: '6px' }}>
              {keys.map((k) => <span><span class="swatch" style={{ background: MECH_COLOR[k] ?? '#888' }} /> {MECH_LABEL[k] ?? k}: {fmtPct(b.mechanisms[k].rate / total, 3)}</span>)}
            </div>
          </>
        ) : <p class="muted">Total rate is zero: no share to display.</p>}
        <BarChart name="decoherence-rates" title="Rates by mechanism (log scale)" desc="Horizontal log-scale bars of each decoherence rate"
          items={keys.map((k) => ({ label: MECH_LABEL[k] ?? k, value: b.mechanisms[k].rate, color: MECH_COLOR[k] }))}
          xLabel="Decoherence rate Γ" unit="s⁻¹" logX highlight={b.dominant ? MECH_LABEL[b.dominant] : undefined} />
        <p class="small muted">The stacked bar shows linear shares of the total (which add up); the log-scale chart shows magnitudes spanning many decades. Stacking on a log axis would misrepresent the sum, so the two views are kept separate. Zero rates (e.g. absorption/emission with Im ε = 0) are omitted from the log chart.</p>
      </Card>
    </>
  );
}

/** Local engine: total rate versus pressure, with the server value cross-checked at the current scenario. */
function LocalPressure({ b, dp }: { b: DecoBudget | null; dp: boolean }) {
  const sc = useStore(scenario);
  const d = sc.design, e = sc.environment;
  const [pMin, setPMin] = useState(1e-18);
  const [pMax, setPMax] = useState(1e-6);
  const v = useValidity();
  const calc = useMemo(() => {
    try {
      const cm = clausiusMossotti(getMaterial(e.material));
      const R = radiusOf(d.mass_A, d.density);
      const base = { T_gas: e.T_gas, T_env: e.T_env, T_int: e.T_int, cm, t: d.time, include_dp: dp };
      const ps = logspace(pMin, pMax, 80);
      const tot = ps.map((p) => decoherenceBudget(d.mass_A, R, d.dx_A, { ...base, pressure: p }).total_rate);
      const here = decoherenceBudget(d.mass_A, R, d.dx_A, { ...base, pressure: e.pressure });
      return { ps, tot, here, err: null as string | null };
    } catch (x) { return { ps: [], tot: [], here: null, err: String((x as Error).message) }; }
  }, [d.mass_A, d.density, d.dx_A, d.time, e.material, e.T_gas, e.T_env, e.T_int, e.pressure, dp, pMin, pMax]);
  const rel = b && calc.here ? Math.abs(calc.here.total_rate - b.total_rate) / Math.max(Math.abs(b.total_rate), 1e-300) : null;
  return (
    <Card title="Total rate versus pressure (local engine)" actions={<ProvBadge kind="COMPUTED_LOCAL" />}>
      <div class="form-grid">
        <NumberField name="pmin" label="Pressure from" unit="Pa" value={pMin} min={0} minExclusive max={2e5} report={v.report} onChange={setPMin} help="Lower end of the logarithmic pressure axis." />
        <NumberField name="pmax" label="Pressure to" unit="Pa" value={pMax} min={0} minExclusive max={2e5} report={v.report} onChange={setPMax} help="Upper end of the logarithmic pressure axis (must exceed the lower end)." />
      </div>
      {calc.err && <ErrorBox error={calc.err} what="computing locally" />}
      {v.ok && pMax > pMin && calc.ps.length > 0 && (
        <LinePlot name="rate-vs-pressure" title="Γ_total(P) for mass A" desc="Total single-mass decoherence rate versus gas pressure"
          series={[{ name: 'Γ total (local engine)', x: calc.ps, y: calc.tot, color: '#0072B2' }]}
          xLabel="Pressure" xUnit="Pa" yLabel="Decoherence rate" yUnit="s⁻¹" logX logY cursorX={e.pressure}
          hlines={[{ y: 1 / d.time, label: 'Γ = 1/t (coherence lost over the run)', color: '#D55E00' }]} />
      )}
      {pMax <= pMin && <p class="field-error">The upper pressure must exceed the lower one.</p>}
      <p class="small muted">The vertical marker is the current pressure. Gas collisions scale linearly with P; black-body terms do not depend on P, so the curve flattens where radiation dominates.</p>
      {calc.here && (
        <div class="outs">
          <Out label="Local total Γ at current scenario" value={calc.here.total_rate} unit="s⁻¹" prov="COMPUTED_LOCAL" />
          {b ? <Out label="Relative difference local vs server" value={rel!} sig={3} prov="COMPUTED_LOCAL"
            tone={rel! < 1e-9 ? 'good' : 'bad'} interp={rel! < 1e-9 ? 'Independent implementations agree to the golden-test tolerance (1e-9).' : 'Disagreement above 1e-9: check that the server and engine inputs are identical.'} />
            : <InfoBanner>No server result yet to cross-check against.</InfoBanner>}
        </div>
      )}
    </Card>
  );
}
