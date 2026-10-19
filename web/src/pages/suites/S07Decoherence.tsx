import { hypStyle } from '../../lib/hyp';
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
import { Tex, MathText } from '../../components/Tex';
import { View3D } from '../../components/View3D';
import { usePlayer, PlayerControls, interp } from '../../components/Player';

type Budget2 = DecoBudget & { environmental_total_rate?: number; includes_hypothetical?: boolean; suggested_display_window_s?: number };
const isHyp = (b: DecoBudget, k: string) => !!(b.mechanisms[k] as any)?.hypothetical;
const LABEL = (k: string) => (k === 'env_total' ? 'Environmental total' : k === 'csl_collapse' ? 'CSL collapse' : MECH_LABEL[k] ?? k);
const COLOR = (k: string) => (k === 'env_total' ? '#56B4E9' : k === 'csl_collapse' ? hypStyle('CSL-COLL').color : k === 'diosi_penrose_collapse' ? hypStyle('DP-COLL').color : MECH_COLOR[k] ?? '#7f7f7f');
const envRate = (b: Budget2) => b.environmental_total_rate ?? Object.keys(b.mechanisms).filter((k) => !isHyp(b, k)).reduce((s, k) => s + b.mechanisms[k].rate, 0);

export default function Page(_props: { suite?: number }) {
  const sc = useStore(scenario);
  const st = useStore(settings);
  const v = useValidity();
  const [dp, setDp] = useState(false);
  const [csl, setCsl] = useState(false);
  const [cslL, setCslL] = useState(-16);
  const r = useRun(() => apiPost<Budget2>('/api/decoherence/budget', body(sc), { include_dp: dp, include_csl: csl, ...(csl ? { csl_log10_lambda: cslL } : {}) }));
  const afterReset = useAfterReset();
  // default computation shown on arrival (also after a Reset, which restores the first-visit view)
  useEffect(() => { if (afterReset) return; r.run(); }, []);
  const b = r.data;

  return (
    <div>
      <SuiteHeader n={7} intro={<MathText text="Environmental decoherence of one superposed mass: residual-gas collisions and black-body scattering, absorption and emission. Rates are single-mass branch-coherence decay rates $\Gamma$, with $|\rho_{LR}(t)| = |\rho_{LR}(0)|\,e^{-\Gamma t}$; they feed the joint-state model of Suite 4. Hypothetical collapse models (Diósi–Penrose, CSL) can be added for comparison; they are shown separately and never merged into the environmental total." />} />
      <div class="split">
        <div class="sticky-side card">
          <h2>Configuration</h2>
          <ScenarioForm value={sc} onChange={(s) => scenario.set(s)} report={v.report} />
          <fieldset class="fieldset">
            <legend>Hypothetical collapse models</legend>
            <div class="row" style={{ margin: '4px 0' }}>
              <Switch checked={dp} onChange={setDp} label="Diósi–Penrose (hypothetical collapse model)" />
              <Tip text={<MathText text="$\Gamma_{DP} = \kappa\,E_\Delta/\hbar$ with $E_\Delta = U(\Delta x) - U(0)$ for a uniform sphere; the server uses $\kappa = 1$ (Diósi's convention; Penrose's differs by a factor 2). A hypothesis (model DP-COLL), not established environmental physics." />} />
            </div>
            <div class="row" style={{ margin: '4px 0' }}>
              <Switch checked={csl} onChange={setCsl} label="CSL (hypothetical collapse model)" />
              <Tip text={<MathText text="Continuous spontaneous localisation with collapse rate $\lambda_{CSL}$ and correlation length $r_C$; the server includes the extended-body form factor. A hypothesis (model CSL-COLL); its parameters are constrained but not established." />} />
            </div>
            {csl && <NumberField name="csl" label="log₁₀ λ_CSL" unit="1" value={cslL} min={-20} max={-8} report={v.report} onChange={setCslL}
              help={<MathText text="Base-10 logarithm of the CSL collapse rate $\lambda_{CSL}$ in s⁻¹ (GRW value $\approx 10^{-16}$; Adler's proposal $\approx 10^{-8}$). Admissible −20 to −8." />} />}
          </fieldset>
          <RunBar label="Compute budget" scenario busy={r.busy} disabled={!v.ok} onRun={r.run} />
          {!v.ok && <p class="field-error">Fix the highlighted inputs first.</p>}
        </div>
        <div class="stack">
          <EvidenceBanner />
          <ErrorBox error={r.error} what="computing the decoherence budget" />
          {r.offline && <p class="small muted">No fresh data was fetched. {b ? 'The values below are from the last successful server computation.' : ''} The Advanced view below still computes locally.</p>}
          {b && <Budget b={b} t={sc.design.time} />}
          {b && <BlochDecay b={b} t={sc.design.time} />}
          <Level min="advanced"><LocalPressure b={b} /></Level>
          {b && atLeast(st.mode, 'expert') && <Card title="Raw response (expert)"><Json data={b} /></Card>}
        </div>
      </div>
    </div>
  );
}

function Budget({ b, t }: { b: Budget2; t: number }) {
  const keys = Object.keys(b.mechanisms);
  const envKeys = keys.filter((k) => !isHyp(b, k)), hypKeys = keys.filter((k) => isHyp(b, k));
  const total = envRate(b);
  const envDom = envKeys.reduce<string | null>((m, k) => (m == null || b.mechanisms[k].rate > b.mechanisms[m].rate ? k : m), null);
  const gt = total * t, cf = Math.exp(-gt);
  return (
    <>
      <Card title="Environmental totals" actions={<ProvBadge kind="COMPUTED" />}>
        <div class="outs">
          <Out label="Environmental decoherence rate Γ" value={total} unit="s⁻¹" prov="COMPUTED" interp="Sum of the established environmental mechanisms for one mass (hypothetical collapse models excluded)." />
          <Out label="Γt over the interaction time" value={gt} sig={4} prov="COMPUTED"
            interp={<>Over t = {fmtQ(t, 's')}. <MathText text="$\Gamma t \ll 1$ keeps branch coherence; $\Gamma t \gtrsim 1$ erases it." /></>} />
          <Out label="Coherence factor" value={cf} sig={6} prov="COMPUTED" tone={cf > 0.9 ? 'good' : cf < 0.37 ? 'bad' : null}
            interp={<MathText text="$e^{-\Gamma t}$: remaining off-diagonal coherence $|\rho_{LR}(t)/\rho_{LR}(0)|$ of each mass." />} />
          <Out label="Dominant environmental mechanism" value={envDom ? LABEL(envDom) : '—'} prov="COMPUTED"
            interp={envDom && total > 0 ? `Contributes ${fmtPct(b.mechanisms[envDom].rate / total)} of the environmental rate — the first thing to improve.` : 'All environmental rates are zero.'} />
        </div>
        {hypKeys.length > 0 && (
          <div class="outs" style={{ marginTop: '10px' }}>
            {hypKeys.map((k) => <Out label={`${LABEL(k)} — hypothetical`} value={b.mechanisms[k].rate} unit="s⁻¹" prov="COMPUTED"
              interp={<>Predicted by a collapse hypothesis, not an environmental effect; shown separately. Over t: <Tex tex="\Gamma t" /> = {fmtNum(b.mechanisms[k].rate * t, 3)}.</>} />)}
          </div>
        )}
      </Card>
      <Card title="Mechanisms">
        <DataTable caption="Decoherence mechanisms" head={['Mechanism', <>Rate <Tex tex="\Gamma" /> (s⁻¹)</>, <Tex tex="\Gamma t" />, <Tex tex="e^{-\Gamma t}" />, 'Regime']} numeric={[1, 2, 3]}
          hl={(i) => keys[i] === envDom}
          rows={keys.map((k) => {
            const m = b.mechanisms[k];
            return [<><span class="swatch" style={{ background: COLOR(k) }} /> {LABEL(k)}{k === envDom && <span class="badge b-warn" style={{ marginLeft: '6px' }}>dominant</span>}{isHyp(b, k) && <span class="badge b-estimated" style={{ marginLeft: '6px' }}>hypothetical</span>}</>,
              fmtNum(m.rate), fmtNum(m.gamma_t), <span title={String(m.coherence_factor)}>{fmtNum(m.coherence_factor, 6)}</span>, <span class="small">{String(m.regime ?? '')}</span>];
          })} />
        {b.mechanisms.diosi_penrose_collapse && (
          <p class="small muted">Diósi–Penrose convention factor <Tex tex="\kappa" /> = {String((b.mechanisms.diosi_penrose_collapse as any).convention_factor ?? '—')}; <Tex tex="E_\Delta" /> = {fmtQ((b.mechanisms.diosi_penrose_collapse as any).E_delta_J, 'J')}. A hypothesised collapse rate, not an environmental effect.</p>
        )}
        <h3 style={{ marginTop: '14px' }}>Share of the environmental rate</h3>
        {total > 0 ? (
          <>
            <div class="stackbar" role="img" aria-label={`Share of environmental rate: ${envKeys.map((k) => `${LABEL(k)} ${fmtPct(b.mechanisms[k].rate / total, 3)}`).join(', ')}`}>
              {envKeys.map((k) => <div title={`${LABEL(k)}: ${fmtPct(b.mechanisms[k].rate / total, 4)}`} style={{ width: `${(100 * b.mechanisms[k].rate) / total}%`, background: COLOR(k) }} />)}
            </div>
            <div class="row small" style={{ marginTop: '6px' }}>
              {envKeys.map((k) => <span><span class="swatch" style={{ background: COLOR(k) }} /> {LABEL(k)}: {fmtPct(b.mechanisms[k].rate / total, 3)}</span>)}
            </div>
          </>
        ) : <p class="muted">Environmental rate is zero: no share to display.</p>}
        <BarChart name="decoherence-rates" title="Rates by mechanism (log scale)" desc="Horizontal log-scale bars of each decoherence rate, hypothetical collapse models marked"
          items={keys.map((k) => ({ label: `${LABEL(k)}${isHyp(b, k) ? ' (hypothetical)' : ''}`, value: b.mechanisms[k].rate, color: COLOR(k) }))}
          xLabel="Decoherence rate Γ" unit="s⁻¹" logX highlight={envDom ? LABEL(envDom) : undefined} />
        <p class="small muted">The stacked bar shows linear shares of the environmental total (they add up); the log-scale chart shows magnitudes spanning many decades, including hypothetical collapse models for comparison. Zero rates (e.g. absorption/emission with Im ε = 0) are omitted from the log chart.</p>
      </Card>
    </>
  );
}

/** Local engine: total rate versus pressure, with the server value cross-checked at the current scenario. */
function LocalPressure({ b }: { b: Budget2 | null }) {
  const sc = useStore(scenario);
  const d = sc.design, e = sc.environment;
  const [pMin, setPMin] = useState(1e-18);
  const [pMax, setPMax] = useState(1e-6);
  const v = useValidity();
  const calc = useMemo(() => {
    try {
      const cm = clausiusMossotti(getMaterial(e.material));
      const R = radiusOf(d.mass_A, d.density);
      const base = { T_gas: e.T_gas, T_env: e.T_env, T_int: e.T_int, cm, t: d.time, include_dp: false };
      const ps = logspace(pMin, pMax, 80);
      const tot = ps.map((p) => decoherenceBudget(d.mass_A, R, d.dx_A, { ...base, pressure: p }).total_rate);
      const here = decoherenceBudget(d.mass_A, R, d.dx_A, { ...base, pressure: e.pressure });
      return { ps, tot, here, err: null as string | null };
    } catch (x) { return { ps: [], tot: [], here: null, err: String((x as Error).message) }; }
  }, [d.mass_A, d.density, d.dx_A, d.time, e.material, e.T_gas, e.T_env, e.T_int, e.pressure, pMin, pMax]);
  const rel = b && calc.here ? Math.abs(calc.here.total_rate - envRate(b)) / Math.max(Math.abs(envRate(b)), 1e-300) : null;
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
          <Out label="Local environmental Γ at current scenario" value={calc.here.total_rate} unit="s⁻¹" prov="COMPUTED_LOCAL" />
          {b ? <Out label="Relative difference local vs server" value={rel!} sig={3} prov="COMPUTED_LOCAL"
            tone={rel! < 1e-9 ? 'good' : 'bad'} interp={rel! < 1e-9 ? 'Independent implementations agree to the golden-test tolerance (1e-9).' : 'Disagreement above 1e-9: check that the server and engine inputs are identical.'} />
            : <InfoBanner>No server result yet to cross-check against.</InfoBanner>}
        </div>
      )}
    </Card>
  );
}

// ----------------------------------------------------------------------------- Bloch-vector decay
type Win = 'run' | 'e1' | 'fast5';
const linspaceN = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

/**
 * Each mass's branch qubit starts in |+⟩ (Bloch vector (1, 0, 0)). Pure dephasing at rate Γ leaves the
 * populations unchanged and multiplies the coherence by e^{−Γt} — the definition of Γ in
 * qgdevs/decoherence.py (|ρ_LR(t)| = |ρ_LR(0)| e^{−Γt}) — so r(t) = (e^{−Γt}, 0, 0). The rates are the
 * server's budget; the curves are that definition evaluated at the displayed sample times. The
 * environmental total and every hypothetical collapse model are drawn as separate vectors.
 */
function BlochDecay({ b, t }: { b: Budget2; t: number }) {
  const keys = Object.keys(b.mechanisms);
  const hypKeys = keys.filter((k) => isHyp(b, k));
  const series = ['env_total', ...keys.filter((k) => !isHyp(b, k) && b.mechanisms[k].rate > 0), ...hypKeys];
  const rate = (k: string) => (k === 'env_total' ? envRate(b) : b.mechanisms[k].rate);
  const [sel, setSel] = useState<string>('env_total');
  const selKey = series.includes(sel) ? sel : 'env_total';
  const [win, setWin] = useState<Win>('run');
  const [logT, setLogT] = useState(false);
  const [mag, setMag] = useState(false);
  const shown = ['env_total', ...hypKeys, ...(selKey !== 'env_total' && !hypKeys.includes(selKey) ? [selKey] : [])];
  const fastest = Math.max(...shown.map(rate), 0);
  const T = win === 'run' ? t
    : win === 'e1' ? (rate(selKey) > 0 ? 1 / rate(selKey) : t)
      : fastest > 0 ? (hypKeys.length === 0 && b.suggested_display_window_s ? b.suggested_display_window_s : 5 / fastest) : t;
  const N = 241;
  const ts = useMemo(() => (logT ? [0, ...linspaceN(Math.log10(T) - 4, Math.log10(T), N - 1).map((e) => 10 ** e)] : linspaceN(0, T, N)), [T, logT]);
  const p = usePlayer(N, 40);
  const curves = useMemo(() => Object.fromEntries(series.map((k) => [k, ts.map((x) => Math.exp(-rate(k) * x))])), [b, ts]);
  const tNow = interp(ts, p.pos);
  // visibility: relative change of |r| for the selected vector over the displayed window
  const relChange = 1 - curves[selKey][N - 1];
  const factor = relChange > 0 && relChange < 5e-3 ? 0.3 / relChange : 1;
  const disp = (rx: number) => (mag ? 1 - factor * (1 - rx) : rx);
  const rNow = (k: string) => interp(curves[k], p.pos);
  const spec = useMemo(() => {
    const k = Math.max(0, Math.min(N - 1, Math.floor(p.pos)));
    return {
      x: { label: 'r_x', tex: 'r_x', min: -1, max: 1 }, y: { label: 'r_y', tex: 'r_y', min: -1, max: 1 }, z: { label: 'r_z', tex: 'r_z', min: -1, max: 1 },
      ellipsoids: [{ name: 'Bloch sphere', center: [0, 0, 0] as [number, number, number], cov: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], color: '#9aa3c7', nsigma: 1 }],
      points: [
        // trail of the selected mechanism (computed samples up to the displayed one)
        { name: 'trail', pts: curves[selKey].slice(0, k + 1).map((x) => [disp(x), 0, 0] as [number, number, number]), color: COLOR(selKey), size: 0.012, line: true, lineWidth: 2.5 },
        ...shown.map((m) => ({ name: LABEL(m), pts: [[0, 0, 0], [disp(rNow(m)), 0, 0]] as [number, number, number][], color: COLOR(m), size: 0.035, line: true, lineWidth: m === selKey ? 4 : 2.5, highlightLast: true })),
      ],
      notes: [
        { at: [1.08, 0, 0] as [number, number, number], text: '|+⟩' }, { at: [-1.08, 0, 0] as [number, number, number], text: '|−⟩' },
        { at: [0, 0, 1.1] as [number, number, number], text: '|L⟩' }, { at: [0, 0, -1.1] as [number, number, number], text: '|R⟩' },
        { at: [0, 1.1, 0] as [number, number, number], text: '|+i⟩' },
      ],
    };
  }, [curves, selKey, p.pos, mag, factor, shown.join()]);
  const view2d = (
    <div class="grid-2">
      <LinePlot name="coherence-decay" title="Coherence |r_x| = e^{−Γt}" desc="Remaining branch coherence of one mass: environmental total and each hypothetical collapse model separately" xLabel="Time" xUnit="s" yLabel="|r_x|" yUnit="1" cursorX={tNow} yDomain={[0, 1.02]} logX={logT}
        series={series.map((k) => ({ name: `${LABEL(k)}${isHyp(b, k) ? ' (hypothetical)' : ''}`, x: logT ? ts.slice(1) : ts, y: logT ? curves[k].slice(1) : curves[k], color: COLOR(k), width: k === selKey ? 3 : 1.5, dash: isHyp(b, k) ? [5, 3] : [] }))} />
      <LinePlot name="coherence-loss" title="Coherence loss 1 − e^{−Γt} (log scale)" desc="Coherence loss on a logarithmic axis so that tiny mechanisms remain visible" xLabel="Time" xUnit="s" yLabel="1 − |r_x|" yUnit="1" logY logX={logT} cursorX={tNow}
        series={series.filter((k) => rate(k) > 0).map((k) => ({ name: LABEL(k), x: ts.slice(1), y: ts.slice(1).map((x) => -Math.expm1(-rate(k) * x)), color: COLOR(k), width: k === selKey ? 3 : 1.5, dash: isHyp(b, k) ? [5, 3] : [] }))} />
    </div>
  );
  return (
    <Card title="Branch-qubit Bloch vector" actions={<ProvBadge kind="COMPUTED" />}>
      <p class="small muted"><MathText text="The branch qubit ($|L\rangle$, $|R\rangle$) of one mass starts in $|+\rangle$. Pure dephasing at the computed rate $\Gamma$ shrinks the Bloch vector toward the $z$ axis as $\vec r(t) = (e^{-\Gamma t}, 0, 0)$ — the definition of $\Gamma$ in the decoherence model. The environmental total and each hypothetical collapse model are separate vectors; they all point along $r_x$, so their tips are distinguished by colour and length." /></p>
      <div class="row" style={{ marginBottom: '6px', gap: '10px', minWidth: 0 }}>
        <label class="small" style={{ display: "grid", gap: "2px", maxWidth: "100%", minWidth: 0 }}>Highlight{' '}
          <select class="input" style={{ maxWidth: '100%' }} value={selKey} onChange={(e: any) => setSel(e.currentTarget.value)}>
            {series.map((k) => <option value={k}>{LABEL(k)}{isHyp(b, k) ? ' (hypothetical)' : ''} — Γ = {fmtNum(rate(k), 3)} s⁻¹</option>)}
          </select></label>
        <label class="small" style={{ display: "grid", gap: "2px", maxWidth: "100%", minWidth: 0 }}>Time window{' '}
          <select class="input" style={{ maxWidth: '100%' }} value={win} onChange={(e: any) => setWin(e.currentTarget.value)}>
            <option value="run">Experiment duration (t = {fmtQ(t, 's')})</option>
            <option value="e1">Until coherence = 1/e for the highlighted mechanism (t = 1/Γ)</option>
            <option value="fast5">First 5 decay times of the fastest shown mechanism</option>
          </select></label>
        <Switch checked={logT} onChange={setLogT} label="Logarithmic time" />
      </div>
      <PlayerControls p={p} n={N} t={ts} label="Decoherence" />
      <div class="grid-2">
        <View3D kind="plot3d" name="decoherence-bloch" opts={spec} frame={p.pos} label={`Bloch vectors of the branch qubit; highlighted: ${LABEL(selKey)}`}
          title={`${LABEL(selKey)} · |r| = ${fmtNum(rNow(selKey), 6)} at t = ${fmtQ(tNow, 's')}`} badge="COMPUTED"
          legend={shown.map((k) => ({ label: `${LABEL(k)}${isHyp(b, k) ? ' (hyp.)' : ''}`, color: COLOR(k) }))}
          change={{ rel: relChange, what: `|r| of ${LABEL(selKey)}` }}
          magnify={factor > 1 ? { on: mag, factor, onToggle: setMag, reference: '|+⟩ (no decoherence)' } : undefined}
          playing={p.playing} onRecordStart={() => { p.setPos(0); p.setPlaying(true); }}
          frameData={() => ({ window_s: T, log_time: logT, t_display_s: tNow, interpolated: Math.abs(p.pos - Math.round(p.pos)) > 1e-3, magnified: mag ? factor : 1, vectors: Object.fromEntries(shown.map((k) => [k, { rate_s: rate(k), r_x: rNow(k), hypothetical: isHyp(b, k) }])) })}
          fallback={view2d} />
        <div class="outs" style={{ alignContent: 'start' }}>
          <Out label="Displayed time" value={tNow} unit="s" interp={Math.abs(p.pos - Math.round(p.pos)) > 1e-3 ? 'between samples (display interpolation)' : `sample ${p.frame + 1}/${N}`} />
          {shown.map((k) => <Out label={`|r| — ${LABEL(k)}${isHyp(b, k) ? ' (hypothetical)' : ''}`} value={rNow(k)} sig={8} prov="COMPUTED" tone={k === selKey ? 'good' : null} />)}
        </div>
      </div>
      {view2d}
    </Card>
  );
}
