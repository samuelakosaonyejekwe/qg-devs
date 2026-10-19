import { RunBar, useAfterReset } from '../../components/Reset';
/** Suite 8 — electromagnetic backgrounds (non-gravitational branch phases) and the gravity-dominance distance. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, Out, ProvBadge, EvidenceBanner, ErrorBox, DataTable, Json, Level, InfoBanner } from '../../components/ui';
import { NumberField, useValidity } from '../../components/fields';
import { ScenarioForm } from '../../components/ScenarioForm';
import { LinePlot } from '../../plot/Chart';
import { useStore, scenario, settings, atLeast } from '../../lib/store';
import { apiPost } from '../../lib/api';
import { fmtQ, fmtNum } from '../../lib/format';
import type { PredictResult } from '../../lib/types';
import { minDistanceForGravityDominance, casimirToGravityRatio, getMaterial, clausiusMossotti, radiusOf, CONSTANTS, casimirPolderEnergy, branchPositions } from '../../engine/index';
import { Seg } from '../../components/ui';
import { HeatMap } from '../../plot/Chart';
import { View3D } from '../../components/View3D';
import { usePlayer, PlayerControls } from '../../components/Player';
import { useRun, body, BRANCH_PAIRS, entComb, logspace } from './f2-shared';

const CH_LABEL: Record<string, string> = { casimir: 'Casimir–Polder', coulomb: 'Coulomb', induced: 'Charge–induced dipole', dipole: 'Dipole–dipole' };

export default function Page(_props: { suite?: number }) {
  const sc = useStore(scenario);
  const st = useStore(settings);
  const v = useValidity();
  const r = useRun(() => apiPost<PredictResult | { admissibility_issues: string[] }>('/api/bmv/predict', body(sc), { n_times: 10 }));
  const afterReset = useAfterReset();
  // auto-run once on arrival, but never right after a Reset (the user asked for a clean page)
  useEffect(() => { if (afterReset) return; r.run(); }, []);
  const p = r.data && 'branch_distances_m' in r.data ? (r.data as PredictResult) : null;
  const issues = r.data && !p ? r.data.admissibility_issues : null;

  return (
    <div>
      <SuiteHeader n={8} intro="Non-gravitational interactions between the branches — retarded Casimir–Polder, Coulomb forces from residual charge and charge–induced-dipole forces — produce branch-dependent phases that can entangle the masses without any gravitational involvement. This page isolates their contribution to the entangling phase and computes the separation beyond which gravity dominates." />
      <div class="split">
        <div class="sticky-side card">
          <h2>Configuration</h2>
          <ScenarioForm value={sc} onChange={(s) => scenario.set(s)} report={v.report} />
          <RunBar label="Compute channels" scenario busy={r.busy} disabled={!v.ok} onRun={r.run} />
        </div>
        <div class="stack">
          <EvidenceBanner />
          <ErrorBox error={r.error} what="computing the prediction" />
          {r.offline && <p class="small muted">No fresh data was fetched{p ? '; the tables show the last successful server result' : ''}. The gravity-dominance section below is computed locally and still works.</p>}
          {issues && <div class="error-box" role="alert"><strong>Inadmissible design:</strong><ul class="tight">{issues.map((i) => <li>{i}</li>)}</ul></div>}
          {p && <Channels p={p} />}
          <Dominance />
          <EnergySurfaces />
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

// ----------------------------------------------------------------------------- energy landscape
/**
 * Interaction energy of a probe sphere identical to B, placed at each point (x, y) of the plane containing
 * the branches, with mass A in its equal-weight superposition: U(x, y) = ½ Σ_{i∈{L,R}} U(|r − r_A,i|).
 * The ½-weighted sum is the expectation over A's branches (what a branch-averaged probe feels); the
 * entangling phase depends on branch-resolved differences, which Suite 4 computes. Formulas (engine,
 * mirrored from qgdevs/em.py and bmv.py): gravity −G m_A m_B / r (exact outside contact for uniform spheres),
 * retarded Casimir–Polder −(23ħc/4π) R_A³ R_B³ cm_A cm_B / r⁷. Points where the probe would touch a branch
 * (r ≤ R_A + R_B) are masked.
 */
function EnergySurfaces() {
  const sc = useStore(scenario);
  const d0 = sc.design, e = sc.environment;
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const F = 48; // sweep frames
  const calc = useMemo(() => {
    const cm = clausiusMossotti(getMaterial(e.material)).re;
    const RA = radiusOf(d0.mass_A, d0.density), RB = radiusOf(d0.mass_B, d0.density);
    const G = CONSTANTS.G;
    const pos = branchPositions(d0);
    const A = [pos.A_L, pos.A_R];
    const ds = Array.from({ length: F }, (_, k) => d0.separation * 0.3 * Math.pow(2.5 / 0.3, k / (F - 1)));
    const dMax = ds[F - 1];
    const span = Math.max(dMax * 1.15, Math.abs(pos.B_L[1] - pos.B_R[1]) * 1.5);
    const nx = 112, ny = 84;
    const xs = Array.from({ length: nx }, (_, i) => -0.35 * span + (1.5 * span * i) / (nx - 1));
    const halfY = 0.5 * Math.max(Math.abs(pos.A_L[1] - pos.A_R[1]), Math.abs(pos.A_L[0] - pos.A_R[0])) + 0.45 * span;
    const ys = Array.from({ length: ny }, (_, j) => -halfY + (2 * halfY * j) / (ny - 1));
    const energies = (x: number, y: number) => {
      let ug = 0, ucp = 0;
      for (const a of A) {
        const r = Math.hypot(x - a[0], y - a[1]);
        if (r <= RA + RB) return null;
        ug += 0.5 * (-G * d0.mass_A * d0.mass_B / r);
        ucp += 0.5 * casimirPolderEnergy(RA, RB, cm, cm, r);
      }
      return { ug, ucp };
    };
    const zg: (number | null)[][] = [], zc: (number | null)[][] = [], zr: (number | null)[][] = [];
    for (const y of ys) {
      const rg: (number | null)[] = [], rc: (number | null)[] = [], rr: (number | null)[] = [];
      for (const x of xs) {
        const u = energies(x, y);
        rg.push(u ? Math.log10(Math.abs(u.ug)) : null);
        rc.push(u && u.ucp !== 0 ? Math.log10(Math.abs(u.ucp)) : null);
        rr.push(u && u.ucp !== 0 ? Math.log10(Math.abs(u.ucp) / Math.abs(u.ug)) : null);
      }
      zg.push(rg); zc.push(rc); zr.push(rr);
    }
    const gFin = zg.flat().filter((v): v is number => v != null);
    const zMax = Math.max(...gFin, ...zc.flat().filter((v): v is number => v != null));
    const zFloor = Math.min(...gFin) - 6; // CP values far below gravity are not drawn (stated on the plot)
    const zcClip = zc.map((r) => r.map((v) => (v == null || v < zFloor ? null : v)));
    const rDom = minDistanceForGravityDominance(d0.mass_A, RA, cm, 0.1);
    const frames = ds.map((d) => {
      const dd = { ...d0, separation: d };
      const pb = branchPositions(dd);
      return { d, B: [pb.B_L, pb.B_R].map((b) => { const u = energies(b[0], b[1]); return { x: b[0], y: b[1], ug: u?.ug ?? NaN, ucp: u?.ucp ?? NaN }; }) };
    });
    return { xs, ys, zg, zcClip, zr, zMax, zFloor, rDom, frames, cm, RA, RB };
  }, [d0.mass_A, d0.mass_B, d0.density, d0.separation, d0.dx_A, d0.dx_B, d0.geometry, d0.angle_deg, e.material]);
  const p = usePlayer(F, 8);
  const fr = calc.frames[p.frame];
  const spec = useMemo(() => ({
    x: { label: 'x (A→B)', unit: 'm', min: calc.xs[0], max: calc.xs[calc.xs.length - 1] },
    y: { label: 'y (split axis)', unit: 'm', min: calc.ys[0], max: calc.ys[calc.ys.length - 1] },
    z: { label: 'log10 |U| (U in J)', min: calc.zFloor, max: calc.zMax },
    surfaces: [
      { name: 'gravity', xs: calc.xs, ys: calc.ys, z: calc.zg, color: '#0072B2', opacity: 0.85 },
      { name: 'Casimir–Polder', xs: calc.xs, ys: calc.ys, z: calc.zcClip, color: '#D55E00', opacity: 0.8 },
    ],
    points: [
      { name: 'B branches (gravity)', pts: fr.B.map((b) => [b.x, b.y, Math.log10(Math.abs(b.ug))] as [number, number, number]), color: '#0072B2', size: 0.035 },
      { name: 'B branches (CP)', pts: fr.B.filter((b) => Math.log10(Math.abs(b.ucp)) >= calc.zFloor).map((b) => [b.x, b.y, Math.log10(Math.abs(b.ucp))] as [number, number, number]), color: '#D55E00', size: 0.035 },
    ],
    notes: calc.rDom >= calc.xs[0] && calc.rDom <= calc.xs[calc.xs.length - 1] ? [{ at: [calc.rDom, calc.ys[0], calc.zFloor] as [number, number, number], text: `|U_CP| = 0.1|U_g| at r = ${fmtQ(calc.rDom, 'm', 3)}`, color: '#D55E00' }] : [],
  }), [calc, p.frame]);
  const ratioB = fr.B.map((b) => Math.abs(b.ucp) / Math.abs(b.ug));
  return (
    <Card title="Gravity vs Casimir–Polder energy landscape (local engine)" actions={<><ProvBadge kind="COMPUTED_LOCAL" /><Seg label="View" value={view} onChange={setView} options={[{ v: '3d', label: '3-D' }, { v: '2d', label: '2-D' }]} /></>}>
      <p class="small muted">Energy of a probe identical to B at each point of the branch plane, averaged over A's two branches (½ each — what a branch-averaged probe feels; the branch-resolved differences that entangle are in Suite 4). Gravity −G m_A m_B/r falls as 1/r, Casimir–Polder as 1/r⁷. Grid cells where the probe would touch a branch are masked; Casimir–Polder values more than 6 decades below the weakest gravitational value are not drawn. The animation sweeps the centre separation d from 0.3× to 2.5× the design value and marks B's branches.</p>
      <PlayerControls p={p} n={F} t={calc.frames.map((f) => f.d)} tUnit="m" label="Separation sweep" />
      {view === '3d' ? (
        <View3D kind="plot3d" name="em-energy-landscape" opts={spec} label="Surfaces of log10 of gravitational and Casimir-Polder interaction energy" title={`log10|U| · d = ${fmtQ(fr.d, 'm', 3)}`} badge="COMPUTED LOCALLY"
          legend={[{ label: 'gravity |U_g|', color: '#0072B2' }, { label: 'Casimir–Polder |U_CP|', color: '#D55E00' }]} playing={p.playing}
          onRecordStart={() => { p.setPos(0); p.setPlaying(true); }} frameData={() => ({ separation_m: fr.d, B_branches: fr.B, cp_over_gravity_at_B: ratioB })}
          fallback={<RatioMap calc={calc} />} />
      ) : <RatioMap calc={calc} />}
      <div class="outs">
        <Out label="Separation d (sweep)" value={fr.d} unit="m" prov="COMPUTED_LOCAL" interp={`frame ${p.frame + 1}/${F}; design value ${fmtQ(d0.separation, 'm', 3)}`} />
        <Out label="|U_CP|/|U_g| at B_L" value={ratioB[0]} sig={3} prov="COMPUTED_LOCAL" tone={ratioB[0] <= 0.1 ? 'good' : 'bad'} />
        <Out label="|U_CP|/|U_g| at B_R" value={ratioB[1]} sig={3} prov="COMPUTED_LOCAL" tone={ratioB[1] <= 0.1 ? 'good' : 'bad'} />
        <Out label="Gravity-dominance distance (ratio 0.1)" value={calc.rDom} unit="m" prov="COMPUTED_LOCAL" interp="Equal spheres at the same distance (see above)." />
      </div>
    </Card>
  );
}

function RatioMap({ calc }: { calc: { xs: number[]; ys: number[]; zr: (number | null)[][] } }) {
  // down-sample for the 2-D map (every 2nd cell keeps it crisp and fast)
  const xs = calc.xs.filter((_, i) => i % 2 === 0), ys = calc.ys.filter((_, j) => j % 2 === 0);
  const z = calc.zr.filter((_, j) => j % 2 === 0).map((r) => r.filter((_, i) => i % 2 === 0));
  return (
    <HeatMap name="cp-gravity-ratio-map" title="log10(|U_CP| / |U_g|) in the branch plane" desc="Map of the base-10 logarithm of the Casimir-Polder to gravity energy ratio"
      x={xs} y={ys} z={z} xLabel="x (A→B)" xUnit="m" yLabel="y (split axis)" yUnit="m" zLabel="log10 ratio" palette="cividis" nullLabel="probe would touch a branch" />
  );
}
