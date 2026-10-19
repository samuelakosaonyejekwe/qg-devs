/** Suite 8 — electromagnetic backgrounds (non-gravitational branch phases) and the gravity-dominance distance. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, Out, ProvBadge, EvidenceBanner, ErrorBox, Btn, DataTable, Json, Level, InfoBanner } from '../../components/ui';
import { NumberField, useValidity } from '../../components/fields';
import { ScenarioForm } from '../../components/ScenarioForm';
import { LinePlot } from '../../plot/Chart';
import { useStore, scenario, settings, atLeast } from '../../lib/store';
import { apiPost } from '../../lib/api';
import { fmtQ, fmtNum } from '../../lib/format';
import type { PredictResult } from '../../lib/types';
import { minDistanceForGravityDominance, casimirToGravityRatio, getMaterial, clausiusMossotti, radiusOf, CONSTANTS } from '../../engine/index';
import { useRun, body, BRANCH_PAIRS, entComb, logspace } from './f2-shared';

const CH_LABEL: Record<string, string> = { casimir: 'Casimir–Polder', coulomb: 'Coulomb', induced: 'Charge–induced dipole', dipole: 'Dipole–dipole' };

export default function Page(_props: { suite?: number }) {
  const sc = useStore(scenario);
  const st = useStore(settings);
  const v = useValidity();
  const r = useRun(() => apiPost<PredictResult | { admissibility_issues: string[] }>('/api/bmv/predict', body(sc), { n_times: 10 }));
  useEffect(() => { r.run(); }, []);
  const p = r.data && 'branch_distances_m' in r.data ? (r.data as PredictResult) : null;
  const issues = r.data && !p ? r.data.admissibility_issues : null;

  return (
    <div>
      <SuiteHeader n={8} intro="Non-gravitational interactions between the branches — retarded Casimir–Polder, Coulomb forces from residual charge and charge–induced-dipole forces — produce branch-dependent phases that can entangle the masses without any gravitational involvement. This page isolates their contribution to the entangling phase and computes the separation beyond which gravity dominates." />
      <div class="split">
        <div class="sticky-side card">
          <h2>Configuration</h2>
          <ScenarioForm value={sc} onChange={(s) => scenario.set(s)} report={v.report} />
          <Btn kind="primary" busy={r.busy} disabled={!v.ok} onClick={r.run}>Compute channels</Btn>
        </div>
        <div class="stack">
          <EvidenceBanner />
          <ErrorBox error={r.error} what="computing the prediction" />
          {r.offline && <p class="small muted">No fresh data was fetched{p ? '; the tables show the last successful server result' : ''}. The gravity-dominance section below is computed locally and still works.</p>}
          {issues && <div class="error-box" role="alert"><strong>Inadmissible design:</strong><ul class="tight">{issues.map((i) => <li>{i}</li>)}</ul></div>}
          {p && <Channels p={p} />}
          <Dominance />
          {p && atLeast(st.mode, 'expert') && <Card title="Raw nongrav_channels (expert)"><Json data={{ nongrav_channels: p.nongrav_channels, total_energies_J: p.total_energies_J, gravitational_energies_J: p.gravitational_energies_J }} /></Card>}
        </div>
      </div>
    </div>
  );
}

function Channels({ p }: { p: PredictResult }) {
  const env = useStore(scenario).environment;
  const t = p.design.time;
  const hbar = CONSTANTS.hbar;
  const chans = Array.from(new Set(BRANCH_PAIRS.flatMap((k) => Object.keys(p.nongrav_channels[k] ?? {}))));
  // Derived: Δφ_ch = −(t/ħ)(U_LL + U_RR − U_LR − U_RL) from the returned per-channel energies.
  const dphi = Object.fromEntries(chans.map((c) => [c, (-t / hbar) * entComb(Object.fromEntries(BRANCH_PAIRS.map((k) => [k, p.nongrav_channels[k]?.[c] ?? 0])))]));
  const dNg = p.delta_phi_total_rad - p.delta_phi_gravity_rad;
  const maxPhase = Math.max(...BRANCH_PAIRS.map((k) => Math.abs(p.phases_rad[k])));
  const frac = Math.abs(dNg) / Math.max(Math.abs(p.delta_phi_gravity_rad), 1e-300);
  return (
    <>
      {maxPhase > 1e6 && (
        <div class="banner danger" role="alert"><div><strong>Numerically meaningless regime.</strong> Branch phases reach {fmtQ(maxPhase, 'rad', 3)}. In double precision a phase is resolved only to ≈ ε·|φ| = {fmtQ(2.2e-16 * maxPhase, 'rad', 2)}, so entanglement measures (which depend on Δφ mod 2π) carry no reliable digits beyond ~{fmtNum(2.2e-16 * maxPhase, 1)}. This is typically caused by residual charge: Coulomb energies dwarf gravity. Treat measures here as undefined; reduce the residual charge.</div></div>
      )}
      <Card title="Entangling-phase contributions" actions={<ProvBadge kind="COMPUTED" />}>
        <div class="outs">
          <Out label="Δφ gravity" value={p.delta_phi_gravity_rad} unit="rad" sig={6} prov="COMPUTED" interp="Gravitational branch energies only." />
          <Out label="Δφ total" value={p.delta_phi_total_rad} unit="rad" sig={6} prov="COMPUTED" interp="Gravity plus every non-gravitational channel included." />
          <Out label="Δφ non-gravitational (total − gravity)" value={dNg} unit="rad" sig={4} prov="COMPUTED"
            tone={frac > 0.1 ? 'bad' : 'good'} interp={`|Δφ_ng|/|Δφ_g| = ${fmtNum(frac, 3)}. The Virtual Laboratory requires ≤ 0.1 so that a positive witness cannot be attributed to electromagnetic forces.`} />
        </div>
        <h3 style={{ marginTop: '12px' }}>Per channel (derived from the returned energies)</h3>
        <DataTable caption="Per-channel entangling phase" head={['Channel', 'Δφ_ch (rad)', 'Fraction of |Δφ_gravity|']} numeric={[1, 2]}
          rows={chans.map((c) => [CH_LABEL[c] ?? c, fmtNum(dphi[c], 5), fmtNum(Math.abs(dphi[c]) / Math.max(Math.abs(p.delta_phi_gravity_rad), 1e-300), 3)])} />
        <p class="small muted">Δφ_ch = −(t/ħ)(U_LL + U_RR − U_LR − U_RL) is computed in the browser from the server's per-channel energies U_ij (t = {fmtQ(t, 's')}). A channel that shifts all four branches equally (e.g. far-field Coulomb with tiny Δx) contributes little to Δφ even when its energy is large; local phases are removed by the protocol frame.</p>
      </Card>
      <Card title="Branch energies by channel (J)">
        <DataTable caption="Non-gravitational branch energies" head={['Branch pair', 'Distance', 'Gravity U_g', ...chans.map((c) => CH_LABEL[c] ?? c)]} numeric={[1, 2, ...chans.map((_, i) => i + 3)]}
          rows={BRANCH_PAIRS.map((k) => [k, fmtQ(p.branch_distances_m[k], 'm', 5), fmtNum(p.gravitational_energies_J[k], 5), ...chans.map((c) => fmtNum(p.nongrav_channels[k]?.[c] ?? NaN, 5))])} />
        <Level min="advanced">
          <p class="small muted">Residual charge: {fmtNum(env.residual_charge_e)} e per mass. Coulomb energy q²/(4πε₀r) and the charge–induced-dipole term −q²R³cm/(8πε₀r⁴) both enter Δφ through their difference across branch pairs.</p>
        </Level>
      </Card>
    </>
  );
}

function Dominance() {
  const sc = useStore(scenario);
  const d = sc.design, e = sc.environment;
  const v = useValidity();
  const [ratio, setRatio] = useState(0.1);
  const calc = useMemo(() => {
    try {
      const cm = clausiusMossotti(getMaterial(e.material)).re;
      const m = d.mass_A, R = radiusOf(m, d.density);
      const rDom = minDistanceForGravityDominance(m, R, cm, ratio);
      const lo = Math.max(2.05 * R, Math.min(rDom, d.separation) / 30), hi = Math.max(rDom, d.separation) * 30;
      const rs = logspace(lo, hi, 120);
      return { cm, R, rDom, rs, ys: rs.map((r) => casimirToGravityRatio(m, R, cm, r)), here: casimirToGravityRatio(m, R, cm, d.separation), err: null as string | null };
    } catch (x) { return { err: String((x as Error).message) } as any; }
  }, [d.mass_A, d.density, d.separation, e.material, ratio]);
  return (
    <Card title="Gravity-dominance distance (local engine)" actions={<ProvBadge kind="COMPUTED_LOCAL" />}>
      <p class="small muted">Uses mass A and the material's Clausius–Mossotti factor. Equal spheres: r⁶ = 23ħcR⁶cm² / (4πGm²·ratio), from |U_CP| ≤ ratio·|U_grav| at the same distance (far-field Casimir–Polder form).</p>
      <div class="form-grid">
        <NumberField name="ratio" label="Allowed |U_CP| / |U_grav|" unit="1" value={ratio} min={0} minExclusive max={1e6} report={v.report} onChange={setRatio}
          help="Maximum tolerated ratio of Casimir–Polder to gravitational interaction energy at equal distance. 0.1 is the Virtual Laboratory default." />
      </div>
      {calc.err ? <ErrorBox error={calc.err} what="computing locally" /> : v.ok && (
        <>
          <div class="outs">
            <Out label="Minimum distance for gravity dominance" value={calc.rDom} unit="m" prov="COMPUTED_LOCAL" interp={`Below this centre–centre distance Casimir–Polder exceeds ${fmtNum(ratio)}× gravity.`} />
            <Out label="|U_CP|/|U_grav| at current separation" value={calc.here} sig={4} prov="COMPUTED_LOCAL" tone={calc.here <= ratio ? 'good' : 'bad'}
              interp={calc.here <= ratio ? 'Gravity dominates at the design separation.' : 'Casimir–Polder exceeds the allowed fraction at the design separation; note the inner branches are closer still.'} />
            <Out label="Sphere radius R" value={calc.R} unit="m" prov="COMPUTED_LOCAL" />
            <Out label="Clausius–Mossotti Re cm" value={calc.cm} sig={5} prov="COMPUTED_LOCAL" />
          </div>
          <LinePlot name="casimir-gravity-ratio" title="|U_CP| / |U_grav| versus distance" desc="Log-log plot of Casimir-Polder to gravity energy ratio"
            series={[{ name: '|U_CP|/|U_grav|', x: calc.rs, y: calc.ys, color: '#D55E00' }]}
            xLabel="Centre distance r" xUnit="m" yLabel="Energy ratio" logX logY cursorX={d.separation}
            hlines={[{ y: ratio, label: `allowed ratio ${fmtNum(ratio)} → r = ${fmtQ(calc.rDom, 'm', 3)}`, color: '#0072B2' }]} />
          <p class="small muted">The vertical marker is the current centre separation; the ratio falls as r⁻⁶. The closest branch pair sits nearer than the centre distance in linear geometry.</p>
        </>
      )}
      {!v.ok && <InfoBanner kind="danger">Fix the ratio input.</InfoBanner>}
    </Card>
  );
}
