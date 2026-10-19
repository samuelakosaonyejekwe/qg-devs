import { RunBar } from '../../components/Reset';
/** Suite 10 — synthetic measurement records, witness estimation, tomography and injection–recovery. Everything here is SYNTHETIC. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { View3D } from '../../components/View3D';
import { usePlayer, PlayerControls, interp } from '../../components/Player';
import { HeatMap } from '../../plot/Chart';
import { Seg } from '../../components/ui';
import { MathText } from '../../components/Tex';
import { bornProbabilities } from '../../engine/index';
import { isOfflineError } from '../../lib/api';
import type { Scenario } from '../../lib/types';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, Out, ProvBadge, SyntheticBanner, ErrorBox, Json, Level, InfoBanner, StatusBadge, KV } from '../../components/ui';
import { NumberField, SelectField, useValidity } from '../../components/fields';
import { ScenarioForm } from '../../components/ScenarioForm';
import { LinePlot } from '../../plot/Chart';
import { useStore, scenario, settings, atLeast } from '../../lib/store';
import { apiPost } from '../../lib/api';
import { fmtNum, shortHash } from '../../lib/format';
import { hypStyle } from '../../lib/hyp';
import { useRun, body, PAULI_SETTINGS, CountsTable, useImplementedModels, type SimRecord } from './f2-shared';

export default function Page(_props: { suite?: number }) {
  const sc = useStore(scenario);
  const st = useStore(settings);
  const v = useValidity();
  const models = useImplementedModels();
  const [model, setModel] = useState('QG-COH');
  const [shots, setShots] = useState(2000);
  const [seed, setSeed] = useState(0);
  const [sel, setSel] = useState<string[]>(PAULI_SETTINGS);
  const sim = useRun(() => apiPost<SimRecord>('/api/signal/simulate', { ...body(sc), model, shots, seed, settings: sel }));
  const tomoReady = sim.data && PAULI_SETTINGS.every((s) => s in sim.data!.counts);
  const tomo = useRun(() => apiPost<any>('/api/signal/tomography', { counts: sim.data!.counts }));
  const rec = sim.data;
  const w = rec?.witness_estimate;
  const hasW = ['XX', 'YZ', 'ZY'].every((s) => sel.includes(s));
  return (
    <div>
      <SuiteHeader n={10} intro="Generates labelled synthetic measurement records from any hypothesis through the full measurement chain (readout error, finite shots), then estimates the entanglement witness with bootstrap uncertainties, reconstructs the two-qubit state by maximum-likelihood tomography, and calibrates detection by injection–recovery. No physical device is involved." />
      <SyntheticBanner>Every count, estimate and efficiency on this page is computed from simulated data.</SyntheticBanner>
      <div class="split">
        <div class="sticky-side card">
          <h2>Simulation</h2>
          <SelectField label="Generating hypothesis" value={model} onChange={setModel} options={models.map((m) => ({ v: m, label: `${m} — ${hypStyle(m).short}` }))}
            help="The model whose predicted state generates the synthetic counts. Comparing records from different hypotheses shows what a real experiment would need to distinguish them." />
          <div class="form-grid">
            <NumberField name="shots" label="Shots per setting" unit="1" integer value={shots} min={10} max={1e7} report={v.report} onChange={setShots}
              help={<MathText text="Number of repeated runs per measurement setting. Statistical uncertainty of each correlator scales as $1/\sqrt{N}$." />} />
            <NumberField name="seed" label="Random seed" unit="1" integer value={seed} min={0} max={2 ** 31 - 1} report={v.report} onChange={setSeed}
              help="Seed of the pseudo-random generator; the same seed reproduces the same record (recorded in its SHA-256)." />
          </div>
          <fieldset class="fieldset">
            <legend>Measurement settings</legend>
            <div class="row">{PAULI_SETTINGS.map((s) => (
              <label class="small"><input type="checkbox" checked={sel.includes(s)} onChange={(e: any) => setSel(e.currentTarget.checked ? PAULI_SETTINGS.filter((x) => x === s || sel.includes(x)) : sel.filter((x) => x !== s))} /> {s}</label>
            ))}</div>
            <p class="small muted">The CPK witness needs XX, YZ and ZY; tomography needs all nine.{!hasW && <strong> Witness will not be estimated with this selection.</strong>}</p>
            {sel.length === 0 && <p class="field-error">Select at least one setting.</p>}
          </fieldset>
          <ScenarioForm value={sc} onChange={(s) => scenario.set(s)} report={v.report} />
          <RunBar label="Simulate measurement" scenario busy={sim.busy} disabled={!v.ok || sel.length === 0} onRun={sim.run} />
        </div>
        <div class="stack">
          <ErrorBox error={sim.error} what="simulating the measurement" />
          {sim.offline && <p class="small muted">No fresh data was fetched; synthetic records are generated only by the server.</p>}
          {!rec && !sim.busy && !sim.error && <InfoBanner>Configure the simulation and press “Simulate measurement”.</InfoBanner>}
          {rec && (
            <>
              <Card title="Synthetic record" actions={<ProvBadge kind={rec.data_label} />}>
                <KV rows={[['Generated by', <><b>{rec.generator.model_id}</b> (seed {rec.generator.seed}, {rec.generator.shots_per_setting} shots/setting)</>],
                  ['Detector model', Object.entries(rec.generator.detector).map(([k, x]) => `${k} = ${x}`).join(', ')],
                  ['Record SHA-256', <code title={rec.sha256}>{shortHash(rec.sha256, 16)}…</code>],
                  ['Assumptions', <ul class="tight">{rec.assumptions.map((a) => <li>{a}</li>)}</ul>]]} />
                <CountsTable rec={rec} />
                <p class="small muted">Correlators are computed in the browser from the counts as E = (n₊₊ − n₊₋ − n₋₊ + n₋₋)/N; they include readout error (not corrected).</p>
              </Card>
              <Card title="Entanglement witness estimate" actions={<ProvBadge kind="SYNTHETIC" />}>
                {w ? (
                  <>
                    <div class="outs">
                      <Out label="Witness ⟨W⟩ (readout-corrected)" value={w.witness} sig={5} unc={w.stderr} prov="SYNTHETIC" tone={w.bootstrap_ci95[1] < 0 ? 'good' : null}
                        interp={<MathText text="$\langle W\rangle < 0$ certifies entanglement, since $\langle W\rangle \ge 0$ for every separable state (CPK witness)." />} />
                      <Out label="Bootstrap 95 % interval" value={`[${fmtNum(w.bootstrap_ci95[0], 4)}, ${fmtNum(w.bootstrap_ci95[1], 4)}]`} prov="SYNTHETIC"
                        interp={w.bootstrap_ci95[1] < 0 ? 'Entirely below zero.' : 'Includes zero or positive values: not certified at 95 %.'} />
                      <Out label="z-score" value={w.z_score} sig={4} prov="SYNTHETIC" interp={<MathText text="$z = (0 - \langle W\rangle)/\mathrm{stderr}$; the preregistered decision rule asks for $z \ge 5$." />} />
                      <Out label="One-sided p-value" value={w.p_value_one_sided} sig={3} prov="SYNTHETIC" interp={<MathText text="Probability of a value this negative if the state were separable at the boundary $\langle W\rangle = 0$." />} />
                      <Out label="Sign variant" value={w.sign_variant > 0 ? 'W₊ = 1 − XX − (YZ + ZY)' : 'W₋ = 1 − XX + (YZ + ZY)'} prov="SYNTHETIC" interp="Chosen from the model prediction before looking at the data." />
                      <Out label="Readout correction factor" value={w.readout_correction_factor} sig={6} prov="SYNTHETIC" interp={<MathText text="$1/(1-2\varepsilon)^2$ applied to the measured correlators." />} />
                    </div>
                    <p class="small"><strong>Interpretation:</strong> {w.z_score >= 5 ? 'this synthetic record would meet a 5σ entanglement claim.' : w.z_score >= 2 ? 'a hint of entanglement, below the 5σ claim threshold; more shots are needed.' : 'no significant evidence of entanglement in this synthetic record.'} This concerns simulated data from {rec.generator.model_id}, not nature.</p>
                  </>
                ) : <p class="muted">No witness estimate: the record lacks one of XX, YZ, ZY.</p>}
              </Card>
              <Card title="State tomography (maximum likelihood)" actions={<ProvBadge kind="SYNTHETIC" />}>
                <RunBar label="Reconstruct state" scenario busy={tomo.busy} disabled={!tomoReady} onRun={tomo.run} />
                {!tomoReady && <p class="small muted">Requires counts for all nine Pauli settings.</p>}
                <ErrorBox error={tomo.error} what="reconstructing the state" />
                {tomo.data && <Tomo t={tomo.data} />}
              </Card>
              {atLeast(st.mode, 'expert') && <Card title="Raw record (expert)"><Json data={rec} /></Card>}
            </>
          )}
          <Convergence model={model} shots={shots} seed={seed} settings={sel} valid={v.ok && sel.length > 0} />
          <Injection />
        </div>
      </div>
    </div>
  );
}

function Tomo({ t }: { t: any }) {
  const re: number[][] | undefined = t.rho_real, im: number[][] | undefined = t.rho_imag;
  const labels = ['LL', 'LR', 'RL', 'RR'];
  return (
    <div class="stack" style={{ marginTop: '8px' }}>
      <p class="small muted">Method: {t.method}</p>
      <div class="outs">
        {'negativity' in t && <Out label="Negativity" value={t.negativity} sig={4} unc={t.negativity_ci95 ? `95 % CI [${fmtNum(t.negativity_ci95[0], 3)}, ${fmtNum(t.negativity_ci95[1], 3)}]` : null} prov="SYNTHETIC" interp="N > 0 indicates entanglement; a CI touching 0 means it is not resolved." />}
        {'concurrence' in t && <Out label="Concurrence" value={t.concurrence} sig={4} unc={t.concurrence_ci95 ? `95 % CI [${fmtNum(t.concurrence_ci95[0], 3)}, ${fmtNum(t.concurrence_ci95[1], 3)}]` : null} prov="SYNTHETIC" />}
        {'purity' in t && <Out label="Purity" value={t.purity} sig={5} prov="SYNTHETIC" />}
        {t.state_check && <Out label="Physical state check" value={t.state_check.passed ? 'passed' : 'failed'} tone={t.state_check.passed ? 'good' : 'bad'} prov="SYNTHETIC" interp={`trace ${fmtNum(t.state_check.trace, 10)}, min eigenvalue ${fmtNum(t.state_check.min_eigenvalue, 3)}`} />}
      </div>
      {re && (
        <div class="grid-2">
          {[['Re ρ', re], ['Im ρ', im]].map(([title, m]) => m && (
            <div>
              <h3>{title as string}</h3>
              <table class="matrix" aria-label={`${title} of reconstructed density matrix`}>
                <thead><tr><th /> {labels.map((l) => <th>{l}</th>)}</tr></thead>
                <tbody>{(m as number[][]).map((row, i) => <tr><th>{labels[i]}</th>{row.map((x) => <td>{x.toFixed(4)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      <Level min="expert"><Json data={t} /></Level>
    </div>
  );
}

function Injection() {
  const v = useValidity();
  const [noise, setNoise] = useState(1);
  const [thr, setThr] = useState(5);
  const [trials, setTrials] = useState(100);
  const r = useRun(() => apiPost<{ amplitudes: number[]; detection_efficiency: number[]; false_positive_rate: number; trials: number; threshold_snr: number; data_label: string }>('/api/signal/injection', undefined, { noise, threshold: thr, trials }));
  useEffect(() => { /* not auto-run: it is a Monte-Carlo study */ }, []);
  const d = r.data;
  return (
    <Card title="Injection–recovery calibration" actions={<ProvBadge kind="SYNTHETIC" />}>
      <p class="small muted">A known template (windowed sinusoid) is injected at several amplitudes into white Gaussian noise and searched for with a matched filter. The fraction recovered above the SNR threshold is the detection efficiency; trials with no injection give the false-positive rate.</p>
      <div class="form-grid">
        <NumberField name="noise" label="Noise σ" unit="1" value={noise} min={0} minExclusive max={1e6} report={v.report} onChange={setNoise} help="Standard deviation of the white Gaussian noise per sample (arbitrary signal units)." />
        <NumberField name="thr" label="Detection threshold" unit="SNR" value={thr} min={0} minExclusive max={100} report={v.report} onChange={setThr} help="Matched-filter signal-to-noise ratio above which an injection counts as detected. Higher thresholds lower false positives at the cost of efficiency." />
        <NumberField name="trials" label="Trials per amplitude" unit="1" integer value={trials} min={1} max={300} report={v.report} onChange={setTrials} help={<MathText text="Monte-Carlo repetitions per amplitude (the server caps this at 300). Efficiency uncertainty $\approx \sqrt{p(1-p)/n_{\text{trials}}}$." />} />
      </div>
      <RunBar label="Run injection–recovery" scenario busy={r.busy} disabled={!v.ok} onRun={r.run} />
      <ErrorBox error={r.error} what="running injection–recovery" />
      {r.offline && <p class="small muted">No fresh data was fetched.</p>}
      {d && (
        <div class="stack" style={{ marginTop: '10px' }}>
          <div class="outs">
            <Out label="False-positive rate" value={d.false_positive_rate} sig={3} prov={d.data_label} interp={`Fraction of ${d.trials} noise-only trials exceeding SNR ${d.threshold_snr}.`} />
            <Out label="Data label" value={d.data_label} prov={d.data_label} />
          </div>
          <LinePlot name="injection-recovery" title="Detection efficiency vs injected amplitude" desc="Fraction of injections recovered as a function of amplitude"
            series={[{ name: 'Detection efficiency', x: d.amplitudes, y: d.detection_efficiency, color: '#0072B2', markers: true,
              band: { lo: d.detection_efficiency.map((p) => Math.max(0, p - Math.sqrt((p * (1 - p)) / d.trials))), hi: d.detection_efficiency.map((p) => Math.min(1, p + Math.sqrt((p * (1 - p)) / d.trials))) } }]}
            xLabel="Injected amplitude" yLabel="Efficiency" yDomain={[0, 1.05]} />
          <p class="small muted"><MathText text="Shaded band: binomial standard error $\sqrt{p(1-p)/n_{\text{trials}}}$, computed in the browser from the returned efficiencies." /> <StatusBadge status={d.data_label} /></p>
        </div>
      )}
    </Card>
  );
}

// ----------------------------------------------------------------------------- convergence animation
const OUTCOMES = ['++', '+−', '−+', '−−'];
const OUTCOME_COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7'];

/** Geometric ladder of record sizes from 10 up to `max` (at most 10 distinct values). */
function ladder(max: number): number[] {
  const K = Math.min(10, Math.max(2, Math.ceil(Math.log10(max / 10) * 3) + 1));
  const out = new Set<number>();
  for (let k = 0; k < K; k++) out.add(Math.round(10 * (max / 10) ** (k / (K - 1))));
  return [...out].sort((a, b) => a - b);
}

interface Frames { Ns: number[]; freq: Record<string, number[]>[]; settings: string[]; model: string; seed: number; scenario: Scenario; born: Record<string, number[]> | null; bornError?: string; tv: number[] }

/**
 * Empirical outcome frequencies converging to the Born probabilities. Every frame is an independent SYNTHETIC
 * record of N shots per setting produced by POST /api/signal/simulate (same model, design and seed); nothing
 * is resampled in the browser. Born probabilities are computed locally from the hypothesis state in the
 * protocol frame including readout error.
 */
function Convergence({ model, shots, seed, settings: sel, valid }: { model: string; shots: number; seed: number; settings: string[]; valid: boolean }) {
  const sc = useStore(scenario);
  const [fr, setFr] = useState<Frames | null>(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const run = async () => {
    setBusy(true); setErr(null); setFr(null);
    const Ns = ladder(shots);
    const freq: Record<string, number[]>[] = [];
    try {
      for (let k = 0; k < Ns.length; k++) {
        setProg(`record ${k + 1}/${Ns.length}: N = ${Ns[k]} shots per setting`);
        const r = await apiPost<SimRecord>('/api/signal/simulate', { ...body(sc), model, shots: Ns[k], seed, settings: sel });
        const f: Record<string, number[]> = {};
        for (const s of sel) { const c = r.counts[s]; const n = c.reduce((a, b) => a + b, 0) || 1; f[s] = c.map((x) => x / n); }
        freq.push(f);
      }
      let born: Record<string, number[]> | null = null, bornError: string | undefined;
      try { born = bornProbabilities(sc.design, sc.environment, model, sc.environment.readout_error, sel); }
      catch (e) { bornError = String((e as Error).message); }
      // total-variation distance, averaged over settings: ½ Σ_o |f_o − p_o|
      const tv = born ? freq.map((f) => sel.reduce((a, s) => a + 0.5 * f[s].reduce((b, x, o) => b + Math.abs(x - born![s][o]), 0), 0) / sel.length) : [];
      setFr({ Ns, freq, settings: sel, model, seed, scenario: sc, born, bornError, tv });
    } catch (e) { setErr(e); } finally { setBusy(false); setProg(''); }
  };
  const n = fr?.Ns.length ?? 0;
  const p = usePlayer(n, 1.5);
  const zMax = useMemo(() => {
    if (!fr) return 1;
    let m = 0;
    for (const f of fr.freq) for (const s of fr.settings) for (const x of f[s]) m = Math.max(m, x);
    if (fr.born) for (const s of fr.settings) for (const x of fr.born[s]) m = Math.max(m, x);
    return Math.min(1, Math.ceil(m * 11) / 10);
  }, [fr]);
  // display values at the player's position (linear interpolation between neighbouring records, display only)
  const cur = useMemo(() => {
    if (!fr) return null;
    const out: Record<string, number[]> = {};
    for (const s of fr.settings) out[s] = [0, 1, 2, 3].map((o) => interp(fr.freq.map((f) => f[s][o]), p.pos));
    return out;
  }, [fr, p.pos]);
  const spec = useMemo(() => {
    if (!fr || !cur) return null;
    const bars = fr.settings.flatMap((s, i) => [0, 1, 2, 3].map((o) => ({ xi: i, yi: o, h: cur[s][o], color: OUTCOME_COLORS[o] })));
    const pts = fr.born ? fr.settings.flatMap((s, i) => [0, 1, 2, 3].map((o) => [i, o, fr.born![s][o]] as [number, number, number])) : [];
    return {
      x: { label: 'Pauli setting', cats: fr.settings, catsTex: fr.settings.map((st) => String.raw`${st[0]}\otimes ${st[1]}`) }, y: { label: 'Outcome', cats: OUTCOMES, catsTex: OUTCOMES.map((o) => o.split('').map((c) => (c === '+' ? '{+}' : '{-}')).join('')) }, z: { label: 'Frequency', tex: String.raw`\hat p`, unit: '1', min: 0, max: zMax },
      bars, barWidth: 0.55,
      points: pts.length ? [{ name: 'Born probability', pts, color: '#D55E00', size: 0.03 }] : [],
    };
  }, [fr, cur, zMax]);
  const i = Math.floor(p.pos);
  return (
    <Card title="Convergence of outcome frequencies to the Born probabilities" actions={<ProvBadge kind="SYNTHETIC" />}>
      <p class="small muted">Requests a ladder of independent synthetic records (N = 10 … {shots} shots per setting, ≤ 10 server calls, same model, design and seed) and animates the empirical outcome frequencies. Orange markers are the Born probabilities of {model} in the protocol frame including readout error ε = {sc.environment.readout_error}, computed locally by the engine.</p>
      <RunBar label="Generate record ladder" scenario busy={busy} disabled={!valid} onRun={run} />
      {busy && <p class="small muted" role="status">{prog}</p>}
      <ErrorBox error={err} what="generating synthetic records" />
      {isOfflineError(err) && <p class="small muted">No fresh data was fetched; synthetic records are produced only by the server.</p>}
      {fr && spec && cur && (
        <div class="stack" style={{ marginTop: '8px' }}>
          {fr.bornError && <InfoBanner>Born probabilities are not available in the offline engine for {fr.model} ({fr.bornError}); frequencies are shown without targets.</InfoBanner>}
          <div class="row-between"><Seg label="View" value={view} onChange={setView} options={[{ v: '3d', label: '3-D bars' }, { v: '2d', label: '2-D' }]} />
            <span class="small">Showing record N = <b>{fr.Ns[i]}</b>{p.pos - i > 1e-3 && i + 1 < n ? ` → ${fr.Ns[i + 1]} (interpolated between records for display only)` : ''} shots per setting</span></div>
          {view === '3d' ? (
            <View3D kind="plot3d" opts={spec} name="outcome-convergence" title={`Outcome frequencies, N = ${fr.Ns[i]}`} badge="SYNTHETIC" playing={p.playing}
              change={{ rel: Math.max(0, ...fr.settings.flatMap((s) => [0, 1, 2, 3].map((o) => Math.abs(fr.freq[fr.freq.length - 1][s][o] - fr.freq[0][s][o])))) / Math.max(zMax, 1e-12), what: 'bar heights between the smallest and largest record' }}
              label="Three-dimensional bars of empirical outcome frequencies per Pauli setting with Born-probability markers"
              legend={[...OUTCOMES.map((o, k) => ({ label: `outcome ${o}`, color: OUTCOME_COLORS[k] })), ...(fr.born ? [{ label: 'Born probability (engine)', color: '#D55E00' }] : [])]}
              onRecordStart={() => { p.setPos(0); p.setPlaying(true); }}
              frameData={() => ({ label: 'SYNTHETIC', N: fr.Ns[i], settings: fr.settings, outcomes: OUTCOMES, frequencies: fr.freq[i], born: fr.born, model: fr.model, seed: fr.seed })}
              fallback={<FreqHeat fr={fr} cur={cur} />} />
          ) : <FreqHeat fr={fr} cur={cur} />}
          <PlayerControls p={p} n={n} label="Record size" />
          {fr.tv.length > 0 && (
            <LinePlot name="tv-distance" title="Mean total-variation distance to the Born probabilities" desc="Average over settings of half the L1 distance between frequencies and Born probabilities versus record size"
              xLabel="Shots per setting N" yLabel="TV distance" logX logY cursorX={Math.exp(interp(fr.Ns.map(Math.log), p.pos))}
              series={[{ name: 'Synthetic records', x: fr.Ns, y: fr.tv, color: '#0072B2', markers: true },
                { name: 'Reference ∝ 1/√N (through first point)', x: fr.Ns, y: fr.Ns.map((N) => fr.tv[0] * Math.sqrt(fr.Ns[0] / N)), color: '#7f7f7f', dash: [5, 4] }]} />
          )}
          <p class="small muted"><MathText text="Frequencies of independent records fluctuate around the Born probabilities with spread $\propto 1/\sqrt{N}$; the dashed line is the scaling expectation, not a fit." /></p>
        </div>
      )}
    </Card>
  );
}

function FreqHeat({ fr, cur }: { fr: Frames; cur: Record<string, number[]> }) {
  return (
    <HeatMap name="outcome-frequencies" title="Outcome frequencies (cell text: Born probability)" desc="Heat map of empirical outcome frequencies per setting and outcome"
      z={OUTCOMES.map((_, o) => fr.settings.map((s) => cur[s][o]))} xCats={fr.settings} yCats={OUTCOMES} xLabel="Pauli setting" yLabel="Outcome" zLabel="Frequency" palette="viridis" zDomain={[0, 1]}
      annotate={fr.born ? (_v, o, j) => fmtNum(fr.born![fr.settings[j]][o], 2) : undefined} />
  );
}
