/** Suite 12 — Competing gravity models and scientific falsification. */
import { useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, ProvBadge, EvidenceBanner, ErrorBox, Loading, SourceChip, AssuranceBadge, DataTable, Btn, Tabs, TabPanel, InfoBanner, Tip, KV } from '../../components/ui';
import { ScenarioForm } from '../../components/ScenarioForm';
import { useValidity } from '../../components/fields';
import { JobRunner } from '../../components/JobRunner';
import { BarChart, HeatMap } from '../../plot/Chart';
import { apiPost, useApiGet, num } from '../../lib/api';
import { useStore, scenario, settings, atLeast } from '../../lib/store';
import { fmtNum } from '../../lib/format';
import { hypStyle, IMPLEMENTED_IDS } from '../../lib/hyp';
import type { ModelPrediction } from '../../lib/types';

interface Nuis { name: string; low: number; high: number; nominal: number; unit: string; description: string }
interface ModelMeta {
  id: string; name: string; family: string; implemented: boolean; nuisance: Nuis[]; dynamics: string; assumptions: string[];
  approximations: string[]; admissible_domain: string; known_limits: string[]; entangling_by_gravity: boolean; references: string[];
  assurance: string; status_note: string;
}

function Registry() {
  const r = useApiGet<ModelMeta[]>('/api/models');
  const s = useStore(settings);
  if (r.loading && !r.data) return <Loading label="Loading model registry" />;
  if (r.error && !r.data) return <ErrorBox error={r.error} what="loading GET /api/models" />;
  const models = r.data ?? [];
  return (
    <div class="stack">
      <div class="row-between"><p class="small muted" style={{ margin: 0 }}>{models.length} hypotheses registered ({models.filter((m) => m.implemented).length} implemented). No model is privileged: each passes through the same measurement chain and nuisance treatment.</p><SourceChip source={r.source} cachedAt={r.cachedAt} /></div>
      <div class="grid-2">
        {models.map((m) => (
          <article class="card" style={{ borderLeft: `5px solid ${hypStyle(m.id).color}`, ...(m.implemented ? {} : { borderStyle: 'dashed' }) }} aria-label={m.id}>
            <div class="row-between">
              <h3 style={{ margin: 0 }}><span class="mono">{m.id}</span></h3>
              <div class="row"><AssuranceBadge status={m.assurance} raw={m.assurance} />{m.implemented ? <span class="badge b-ok">implemented</span> : <span class="badge b-bad">registered — not implemented</span>}</div>
            </div>
            <p style={{ margin: '4px 0' }}>{m.name}</p>
            <p class="small muted" style={{ margin: '0 0 6px' }}>Family: {m.family} · Gravity can entangle: <b>{m.entangling_by_gravity ? 'yes' : 'no'}</b></p>
            {!m.implemented && <InfoBanner kind="danger">{m.status_note}</InfoBanner>}
            {m.implemented && <p class="small">{m.status_note}</p>}
            <KV rows={[['Dynamics', <code>{m.dynamics}</code>], ['Domain', m.admissible_domain]]} />
            {atLeast(s.mode, 'advanced') && (<>
              <details><summary class="small">Assumptions, approximations, known limits</summary>
                <h4 class="small">Assumptions</h4><ul class="tight small">{m.assumptions.map((a) => <li>{a}</li>)}</ul>
                {m.approximations.length > 0 && <><h4 class="small">Approximations</h4><ul class="tight small">{m.approximations.map((a) => <li>{a}</li>)}</ul></>}
                {m.known_limits.length > 0 && <><h4 class="small">Known limits</h4><ul class="tight small">{m.known_limits.map((a) => <li>{a}</li>)}</ul></>}
              </details>
              <details><summary class="small">Nuisance parameters ({m.nuisance.length})</summary>
                <DataTable head={['Name', 'Low', 'Nominal', 'High', 'Unit', 'Meaning']} numeric={[1, 2, 3]}
                  rows={m.nuisance.map((n) => [<code>{n.name}</code>, fmtNum(n.low), fmtNum(n.nominal), fmtNum(n.high), n.unit, n.description])} />
              </details>
            </>)}
            <details><summary class="small">References</summary><ul class="tight small">{m.references.map((x) => <li><ProvBadge kind="LITERATURE_REFERENCE" /> {x}</li>)}</ul></details>
          </article>
        ))}
      </div>
    </div>
  );
}

function Predictions() {
  const sc = useStore(scenario);
  const v = useValidity();
  const [res, setRes] = useState<{ predictions: ModelPrediction[]; registered_not_implemented: ModelMeta[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setRes(await apiPost('/api/falsification/predictions', sc)); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const p = res?.predictions ?? [];
  return (
    <div class="split">
      <div class="card sticky-side">
        <h2>Scenario</h2>
        <ScenarioForm value={sc} onChange={(x) => scenario.set(x)} report={v.report} />
        <Btn kind="primary" busy={busy} disabled={!v.ok} onClick={run}>Compute predictions</Btn>
        {!v.ok && <p class="field-error">Fix the highlighted inputs first.</p>}
      </div>
      <div class="stack">
        <EvidenceBanner />
        <ErrorBox error={err} what="computing POST /api/falsification/predictions" />
        {!res && !err && <p class="muted">Compute the observable predictions of every implemented hypothesis at nominal nuisance for the scenario on the left.</p>}
        {res && (<>
          <Card title="Predictions side by side" actions={<ProvBadge kind="COMPUTED" />}>
            <DataTable head={['Hypothesis', 'Negativity', 'Concurrence', <>CPK witness ⟨W⟩ <Tip text="⟨W⟩ < 0 certifies entanglement (three settings XX, YZ, ZY in the protocol frame fixed from the nominal gravitational local phases)." /></>, 'Purity', 'Coherence A', 'Coherence B', 'Entanglement certified?']}
              numeric={[1, 2, 3, 4, 5, 6]}
              rows={p.map((r) => [<span><span class="swatch" style={{ background: hypStyle(r.id).color }} /> <code>{r.id}</code></span>, fmtNum(r.negativity, 5), fmtNum(r.concurrence, 5), fmtNum(r.witness_cpk, 5), fmtNum(r.purity, 6), fmtNum(r.coherence_A, 6), fmtNum(r.coherence_B, 6), r.witness_cpk < 0 ? <span class="badge b-ok">yes (W&lt;0)</span> : <span class="badge b-neutral">no</span>])} />
            <p class="small muted">Interpretation: hypotheses whose witness is negative predict certifiable entanglement; a measured ⟨W⟩ &lt; 0 would disfavour those predicting ⟨W⟩ ≥ 0 <em>within their stated assumptions</em>. Overlapping predictions (e.g. QG-COH vs QG-EFT1) cannot be told apart by this design.</p>
            {res.registered_not_implemented.length > 0 && <p class="small"><span class="badge b-bad">no prediction</span> Registered but not implemented: {res.registered_not_implemented.map((m) => <code>{m.id} </code>)} — no claim that observed entanglement excludes all classical-gravity models is possible while these remain unimplemented.</p>}
          </Card>
          <Card title="Predicted witness by hypothesis">
            <BarChart name="witness-by-hypothesis" desc="CPK witness predicted by each hypothesis" xLabel="⟨W⟩ (CPK, protocol frame) — shown as |⟨W⟩| on log axis" logX unit=""
              items={p.map((r) => ({ label: `${r.id} (${r.witness_cpk < 0 ? '−' : '+'})`, value: Math.abs(r.witness_cpk), color: hypStyle(r.id).color }))} />
            <p class="small muted">Bar length is |⟨W⟩| on a logarithmic axis; the sign (in the label) decides whether entanglement is certified.</p>
          </Card>
          <Card title="Predicted Pauli correlators (protocol frame)" level="expert">
            <DataTable head={['Setting', ...p.map((r) => r.id)]} numeric={p.map((_, i) => i + 1)}
              rows={Object.keys(p[0]?.correlators ?? {}).map((s) => [<code>{s}</code>, ...p.map((r) => fmtNum(r.correlators[s], 6))])} />
          </Card>
        </>)}
      </div>
    </div>
  );
}

interface Pair { true: string; alternative: string; D_per_shot: number; best_alt_nuisance: Record<string, number>; nuisance_at_bounds: string[]; shots_per_setting: number | string; verdict: string }
interface DiscResult { hypotheses: string[]; settings: string[]; ln_bayes_target: number; max_feasible_shots: number; pairs: Pair[] }

function DiscMatrix({ r }: { r: DiscResult }) {
  const ids = r.hypotheses;
  const look = (t: string, a: string) => r.pairs.find((p) => p.true === t && p.alternative === a);
  const z = ids.map((t) => ids.map((a) => { if (t === a) return null; const p = look(t, a); const n = p ? num(p.shots_per_setting) : NaN; return Number.isFinite(n) ? n : null; }));
  return (
    <div class="stack">
      <InfoBanner>Each cell: shots per measurement setting needed for an expected ln Bayes factor of {fmtNum(r.ln_bayes_target, 4)} (B ≈ {fmtNum(Math.exp(r.ln_bayes_target), 3)}, Kass–Raftery “very strong”) in favour of the <b>true</b> hypothesis (row) after the <b>alternative</b> (column) adjusts all its admissible nuisance parameters. Settings: {r.settings.length} ({r.settings.join(', ')}). Shot budget for “distinguishable”: {fmtNum(r.max_feasible_shots)}.</InfoBanner>
      <HeatMap name="discrimination-matrix" title="Shots per setting required" desc="robust discrimination matrix, rows true hypothesis, columns alternative"
        z={z.slice().reverse()} xCats={ids} yCats={ids.slice().reverse()} xLabel="Alternative hypothesis" yLabel="True hypothesis" zLabel="shots/setting" palette="magma" logZ
        nullLabel="indistinguishable / diagonal"
        annotate={(v, i, j) => { const yi = ids.length - 1 - i; if (yi === j) return '—'; return v == null ? 'indistinguishable' : fmtNum(v, 2); }}
        cellLabel={(i, j, v) => { const t = ids[ids.length - 1 - i], a = ids[j]; if (t === a) return `${t} vs itself`; const p = look(t, a); return `true ${t} vs alternative ${a}: ${v == null ? 'indistinguishable (D = 0 after nuisance adjustment)' : `${fmtNum(v, 4)} shots/setting`}${p ? ` — ${p.verdict}` : ''}`; }} />
      <DataTable head={['True', 'Alternative', 'D per shot (nats)', 'Shots / setting', 'Verdict', 'Nuisance at bounds', 'Best alternative nuisance']} numeric={[2, 3]}
        rows={r.pairs.map((p) => {
          const n = num(p.shots_per_setting);
          return [<code>{p.true}</code>, <code>{p.alternative}</code>, fmtNum(p.D_per_shot, 4), Number.isFinite(n) ? fmtNum(n, 4) : '∞',
            <span class={`badge ${p.verdict === 'distinguishable' ? 'b-ok' : p.verdict === 'indistinguishable' ? 'b-bad' : 'b-warn'}`}>{p.verdict}</span>,
            p.nuisance_at_bounds.length ? p.nuisance_at_bounds.join(', ') : '—',
            <span class="small mono">{Object.entries(p.best_alt_nuisance).map(([k, v]) => `${k}=${fmtNum(v, 4)}`).join('; ')}</span>];
        })} />
      <p class="small muted">“Indistinguishable” means the per-shot divergence is zero after the alternative adjusts its nuisance parameters: no number of shots with this design and measurement chain can separate the pair. Nuisance at bounds indicates the alternative needed an extreme (but admissible) calibration to mimic the truth.</p>
    </div>
  );
}

function Discrimination() {
  const sc = useStore(scenario);
  const v = useValidity();
  const [sel, setSel] = useState<string[]>(['QG-COH', 'QG-EFT1', 'SC-MF', 'CC-KTM', 'DP-COLL', 'NULL-NG']);
  return (
    <div class="split">
      <div class="card sticky-side">
        <h2>Scenario &amp; hypotheses</h2>
        <ScenarioForm value={sc} onChange={(x) => scenario.set(x)} report={v.report} />
        <fieldset class="fieldset"><legend>Hypotheses to compare</legend>
          {IMPLEMENTED_IDS.map((id) => (
            <label class="row small" style={{ marginBottom: '4px' }}><input type="checkbox" checked={sel.includes(id)} onChange={(e: any) => setSel(e.currentTarget.checked ? [...sel, id] : sel.filter((x) => x !== id))} /><span class="swatch" style={{ background: hypStyle(id).color }} /><code>{id}</code> {hypStyle(id).short}</label>
          ))}
          {sel.length < 2 && <p class="field-error">Select at least two hypotheses.</p>}
        </fieldset>
      </div>
      <div class="stack">
        <EvidenceBanner />
        <Card title="Robust discrimination matrix">
          <JobRunner type="discrimination_matrix" label="Run discrimination job" disabled={!v.ok || sel.length < 2}
            note={`Server job (nuisance-robust KL optimisation, ${sel.length * (sel.length - 1)} ordered pairs); typically tens of seconds. Readout error from the environment applies to both masses.`}
            params={() => ({ design: sc.design, environment: sc.environment, hypotheses: IMPLEMENTED_IDS.filter((i) => sel.includes(i)) })}>
            {(r: DiscResult) => <><ProvBadge kind="COMPUTED" /><DiscMatrix r={r} /></>}
          </JobRunner>
        </Card>
      </div>
    </div>
  );
}

export default function Page(_props: { suite?: number }) {
  const [tab, setTab] = useState('registry');
  return (
    <div>
      <SuiteHeader n={12} intro="Explicit competing hypotheses for two-mass gravitational experiments: the registry of models with their assumptions and assurance, their observable predictions for a design, and a nuisance-robust discrimination engine that states explicitly when two models cannot be told apart." />
      <div class="tabs">
        <Tabs label="Suite 12 sections" active={tab} onChange={setTab} tabs={[{ id: 'registry', label: 'Model registry' }, { id: 'pred', label: 'Predictions' }, { id: 'disc', label: 'Discrimination matrix' }]} />
        <TabPanel id="registry" active={tab}><Registry /></TabPanel>
        <TabPanel id="pred" active={tab}><Predictions /></TabPanel>
        <TabPanel id="disc" active={tab}><Discrimination /></TabPanel>
      </div>
    </div>
  );
}
