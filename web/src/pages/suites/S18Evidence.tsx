import { useImplementedModels } from './f2-shared';
import { RunBar, useResetKey } from '../../components/Reset';
import { View3D } from '../../components/View3D';
/** Suite 18 — Discovery evidence and independent replication. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, ErrorBox, Loading, SourceChip, DataTable, Json, Btn, Level, Tip, StatusBadge, KV, InfoBanner, EvidenceBanner, Tabs, TabPanel } from '../../components/ui';
import { NumberField, SelectField, TextField, useValidity } from '../../components/fields';
import { ScenarioForm } from '../../components/ScenarioForm';
import { useApiGet, apiPost, apiPostBlob, apiUpload, downloadBlob, isOfflineError } from '../../lib/api';
import { enqueue } from '../../lib/queue';
import { useStore, scenario } from '../../lib/store';
import { fmtQ, fmtTime, shortHash } from '../../lib/format';
import { hypStyle } from '../../lib/hyp';
import type { Scenario } from '../../lib/types';
import { ActingAs, canAct, useWhoami, type WhoamiState } from '../../components/Identity';
import { MathText } from '../../components/Tex';
import { anchorPlaces, anchorVerdict, datasetOptions, GATES_WITH_DATASET, parseAnchorFile, signoffBody, signoffErrors, unblindBody, type AnchorsResp, type AnchorVerification } from '../../lib/evidence';

/** The nine rungs of the evidence ladder — verbatim from EVIDENCE_LADDER in qgdevs/evidence.py. */
const EVIDENCE_LADDER = [
  'Hypothesis generated',
  'Mathematically formulated',
  'Numerically explored',
  'Numerically verified within stated conditions',
  'Computationally independently reproduced',
  'Experimentally testable',
  'Experimental evidence obtained',
  'Independently experimentally replicated',
  'Strongly supported within stated assumptions',
];
const DATA_LABELS = ['REAL', 'SYNTHETIC', 'REFERENCE', 'LITERATURE', 'TRAINING'];
const ROLES = ['calibration', 'selection', 'blind_test', 'replication', 'exploratory'];
/** Default decision rules: the wording of the Virtual Laboratory protocol §9 (qgdevs/lab.py generate_dossier). */
const DEFAULT_RULES: [string, string][] = [
  ['entanglement_claim', 'one-sided z ≥ 5 on the preregistered witness, readout-corrected, with all null controls consistent with zero'],
  ['excludes', 'a passing witness excludes SC-MF, CC-KTM (κ ≥ 1) and NULL-NG *within their stated assumptions*; it does not exclude unregistered or unimplemented classical models (e.g. CG-QFT-AH)'],
  ['disfavours_QG_COH', 'witness consistent with ≥ 0 at 95% while independent decoherence calibration predicts W < 0 at ≥ 5σ under QG-COH'],
  ['inconclusive', 'any other outcome, or failed calibration/null controls; must be reported as inconclusive'],
];

interface Entry { index: number; timestamp_utc: string; kind: string; actor: string; payload_sha256: string; payload: any; prev_hash: string; entry_hash: string }
interface LedgerResp { entries: Entry[]; verification: { valid: boolean; length?: number; head?: string; broken_at?: number; reason?: string } }
interface Gate { gate: string; name: string; criterion: string; status: string; evidence: (string | null)[]; missing: string[] }
interface Classification { level: number; classification: string; physical_claim_permitted: boolean; statement: string }

const LS = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const LSset = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

// ----------------------------------------------------------------------------- ledger
function LedgerView({ tick }: { tick: number }) {
  const [kind, setKind] = useState('');
  const [limit, setLimit] = useState(200);
  const r = useApiGet<LedgerResp>('/api/evidence/ledger', { kind: kind || undefined, limit, _t: tick || undefined });
  const v = r.data?.verification;
  return (
    <Card title="Hash-chained ledger" actions={<><SourceChip source={r.source} cachedAt={r.cachedAt} /><Btn onClick={r.reload}>Refresh</Btn></>}>
      <p class="small muted">Append-only record: each entry commits to the hash of the previous one, so any retrospective edit of a preregistration, dataset record, sign-off or hypothesis breaks the chain and is detected by the server-side verification below.</p>
      <div class="form-grid">
        <SelectField label="Kind" value={kind} onChange={setKind} help="Show only entries of one kind."
          options={[{ v: '', label: 'all kinds' }, ...['preregistration', 'dataset_ingest', 'unblinding', 'data_access', 'human_signoff', 'hypothesis'].map((k) => ({ v: k, label: k }))]} />
        <NumberField name="limit" label="Show last" unit="entries" value={limit} min={1} max={5000} integer onChange={setLimit} help="Number of most recent entries to list (verification always covers the whole chain)." />
      </div>
      {r.loading && <Loading />}
      <ErrorBox error={r.error} what="loading the ledger" />
      {v && (v.valid
        ? <div class="banner ok" role="status"><div><strong>Chain verified intact</strong> — {v.length} entries; head <code title={v.head}>{shortHash(v.head, 16)}</code>{r.source === 'cache' ? ' (as of the cached copy)' : ''}.</div></div>
        : <div class="banner danger" role="alert"><div><strong>Chain verification FAILED</strong> at entry {v.broken_at}: {v.reason}. The ledger has been altered after the fact; nothing recorded after that point can be trusted.</div></div>)}
      {r.data && r.data.entries.length === 0 && <p class="muted">No entries{kind ? ` of kind ${kind}` : ''} yet.</p>}
      {r.data && r.data.entries.length > 0 && (
        <DataTable caption="Ledger entries" head={['#', 'Time (UTC)', 'Kind', 'Actor', 'Payload hash', 'Entry hash', 'Previous hash', 'Payload']} numeric={[0]}
          rows={[...r.data.entries].reverse().map((e) => [e.index, <span class="small">{fmtTime(e.timestamp_utc)}</span>, <code>{e.kind}</code>, <ActorCell e={e} />,
            <code title={e.payload_sha256}>{shortHash(e.payload_sha256)}</code>, <code title={e.entry_hash}>{shortHash(e.entry_hash)}</code>, <code title={e.prev_hash}>{shortHash(e.prev_hash)}</code>,
            <details><summary class="small">{summary(e)}</summary><Json data={e.payload} max={300} /></details>])} />
      )}
    </Card>
  );
}
/** Actor plus whether the server bound it to a verified token identity (recorded in the payload). */
function ActorCell({ e }: { e: Entry }) {
  const p = e.payload ?? {};
  const verified = p.identity?.verified ?? p.identity_verified;
  const tid = p.identity?.token_id ?? p.token_id;
  return (
    <span>{e.actor}{verified === true ? <> <span class="badge b-ok" title={tid ? `token fingerprint …${tid}` : undefined}>verified</span></> : verified === false ? <> <span class="badge b-neutral" title="Recorded without a verified token identity (development server or older entry)">unverified</span></> : null}
      {p.claimed_reviewer_ignored ? <span class="small muted"> (claimed name “{String(p.claimed_reviewer_ignored)}” ignored)</span> : null}</span>
  );
}
function summary(e: Entry): string {
  const p = e.payload ?? {};
  return p.title ?? p.prereg_id ?? p.dataset_id ?? p.gate ?? p.classification ?? 'view';
}

// ----------------------------------------------------------------------------- preregistration
function Preregister({ onDone, id }: { onDone: () => void; id: WhoamiState }) {
  const HYP_IDS = useImplementedModels(); // live registry (server implements more models than the local engine)
  const sc = useStore(scenario);
  const val = useValidity();
  const [title, setTitle] = useState('');
  const [hyps, setHyps] = useState<string[]>(['QG-COH', 'SC-MF', 'CC-KTM', 'NULL-NG']);
  const [rules, setRules] = useState<[string, string][]>(DEFAULT_RULES);
  const [plan, setPlan] = useState('Blind analysis: compute the readout-corrected CPK witness <W> = 1 − <XX> ∓ (<YZ> + <ZY>) in the preregistered local frame, with bootstrap 95% CI; full 9-setting tomography with MLE reconstruction; decision by the rules above. Null controls (masses not superposed; swapped timing) analysed identically.');
  const [seeds, setSeeds] = useState('0, 1, 2');
  const [shots, setShots] = useState(100000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<Entry | null>(null);
  const [queued, setQueued] = useState(false);
  const allowed = canAct(id.kind, id.w);
  const seedList = seeds.split(/[\s,;]+/).filter(Boolean).map(Number);
  const seedsErr = seedList.length === 0 || seedList.some((s) => !Number.isInteger(s) || s < 0) ? 'Enter one or more non-negative integers separated by commas.' : null;
  const ruleErr = rules.some(([k, t]) => !k.trim() || !t.trim()) ? 'Every rule needs a name and a text.' : null;
  const ok = title.trim() && hyps.length > 0 && !seedsErr && !ruleErr && val.ok && allowed;
  const submit = async () => {
    setBusy(true); setErr(null); setRes(null); setQueued(false);
    const body = { title: title.trim(), hypotheses: hyps, scenario: sc, decision_rules: Object.fromEntries(rules), analysis_plan: plan, seeds: seedList, sample_size: { shots_per_setting: shots, settings: 9 } };
    try {
      const e = await apiPost<Entry>('/api/evidence/preregister', body);
      setRes(e); LSset('qg.lastPrereg', e.payload?.prereg_id ?? ''); onDone();
    } catch (e) {
      if (isOfflineError(e)) {
        try { await enqueue('/api/evidence/preregister', JSON.stringify(body), `Preregistration: ${title.trim()}`); setQueued(true); } catch (qe) { setErr(qe); }
      } else setErr(e);
    } finally { setBusy(false); }
  };
  return (
    <Card title="Preregistration">
      <p class="small muted">Freezes the hypotheses, design, the server-computed predictions of each hypothesis for this design, decision rules, seeds, sample size, nuisance ranges and the exact code hash — <strong>before</strong> any outcome data are unblinded. Once recorded it cannot be edited (only superseded by a new entry).</p>
      <TextField label="Title" value={title} onChange={setTitle} required placeholder="e.g. BMV witness test, 1e-14 kg, 450 µm" help="Short, unique description of the study." />
      <fieldset class="fieldset"><legend>Hypotheses under test</legend>
        <div class="row">{HYP_IDS.map((id) => (
          <label class="row" style={{ gap: '4px' }}><input type="checkbox" checked={hyps.includes(id)} onChange={(e: any) => setHyps(e.currentTarget.checked ? [...hyps, id] : hyps.filter((h) => h !== id))} />
            <span class="swatch" style={{ background: hypStyle(id).color }} /> {id}</label>))}</div>
        {hyps.length === 0 && <div class="field-error">Select at least one hypothesis.</div>}
        <p class="small muted">The server stores each selected hypothesis's predictions for the scenario below (computed at submission).</p>
      </fieldset>
      <details class="fieldset"><summary><strong>Scenario</strong> (shared working design: m = {fmtQ(sc.design.mass_A, 'kg')}, d = {fmtQ(sc.design.separation, 'm')}, Δx = {fmtQ(sc.design.dx_A, 'm')}, t = {fmtQ(sc.design.time, 's')}, {sc.environment.material}, P = {fmtQ(sc.environment.pressure, 'Pa')}) — edit</summary>
        <ScenarioForm value={sc} onChange={(s: Scenario) => scenario.set(s)} report={val.report} />
      </details>
      <fieldset class="fieldset"><legend>Decision rules</legend>
        {rules.map(([k, t], i) => (
          <div class="row" style={{ alignItems: 'flex-start', marginBottom: '6px' }}>
            <input class="input" style={{ flex: '0 1 200px' }} aria-label={`Rule ${i + 1} name`} value={k} onInput={(e: any) => setRules(rules.map((r, j) => (j === i ? [e.currentTarget.value, r[1]] : r)))} />
            <textarea class="input" style={{ flex: '1 1 300px', minHeight: '54px' }} aria-label={`Rule ${i + 1} text`} value={t} onInput={(e: any) => setRules(rules.map((r, j) => (j === i ? [r[0], e.currentTarget.value] : r)))} />
            <button type="button" class="btn-sm" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label={`Remove rule ${k}`}>Remove</button>
          </div>))}
        <button type="button" class="btn-sm" onClick={() => setRules([...rules, ['', '']])}>Add rule</button>
        {ruleErr && <div class="field-error">{ruleErr}</div>}
        <p class="small muted">Defaults follow the Virtual Laboratory protocol wording.</p>
      </fieldset>
      <TextField label="Analysis plan" value={plan} onChange={setPlan} multiline required help="The blind analysis to be run after unblinding, fixed in advance." />
      <div class="form-grid">
        <div class={`field ${seedsErr ? 'invalid' : ''}`}>
          <label class="field-label" for="s18-seeds">Random seeds <Tip text="Seeds for every stochastic step (bootstrap, MCMC), fixed so the analysis is exactly reproducible." /></label>
          <div class="field-input"><input id="s18-seeds" value={seeds} aria-invalid={!!seedsErr} onInput={(e: any) => setSeeds(e.currentTarget.value)} /></div>
          {seedsErr && <div class="field-error">{seedsErr}</div>}
        </div>
        <NumberField name="shots" label="Shots per setting" unit="1" value={shots} min={10} max={1e9} integer onChange={setShots} report={val.report}
          help="Planned number of repetitions per Pauli setting (9 settings). Fixed in advance so optional stopping cannot inflate significance. Suite 9/13 report the shots needed for 5σ." />
      </div>
      <ActingAs id={id} verb="Preregistering as" what="preregistration" />
      <RunBar label="Record preregistration" requiresToken scenario busy={busy} disabled={!ok} onRun={submit} />
      {!ok && allowed && <span class="small muted"> Complete the required fields.</span>}
      <ErrorBox error={err} what="recording the preregistration" />
      {queued && <InfoBanner>Offline: the preregistration was queued on this device and will be submitted when the server is reachable. It is <strong>not</strong> recorded in the ledger until then (see Jobs → Offline queue).</InfoBanner>}
      {res && (
        <div class="banner ok" role="status"><div><strong>Recorded.</strong> Preregistration id <code>{res.payload?.prereg_id}</code> · ledger entry #{res.index} · hash <code>{shortHash(res.entry_hash, 16)}</code> · code hash <code>{shortHash(res.payload?.code_sha256 ?? res.payload?.code_hash, 16)}</code>
          <Level min="advanced"><details><summary class="small">Frozen payload</summary><Json data={res.payload} /></details></Level></div></div>
      )}
    </Card>
  );
}

// ----------------------------------------------------------------------------- datasets & unblinding
function Datasets({ onDone, id }: { onDone: () => void; id: WhoamiState }) {
  const allowed = canAct(id.kind, id.w, ['researcher', 'operator']);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('SYNTHETIC');
  const [role, setRole] = useState('blind_test');
  const [source, setSource] = useState('');
  const [desc, setDesc] = useState('');
  const [prereg, setPrereg] = useState(LS('qg.lastPrereg'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [rec, setRec] = useState<any>(null);
  const ingest = async () => {
    if (!file) return;
    setBusy(true); setErr(null); setRec(null);
    const fd = new FormData();
    fd.append('file', file); fd.append('label', label); fd.append('role', role); fd.append('source', source.trim()); fd.append('description', desc);
    if (prereg.trim()) fd.append('prereg_id', prereg.trim());
    try { const r = await apiUpload<any>('/api/evidence/datasets', fd); setRec(r); LSset('qg.lastDataset', r.dataset_id); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Card title="Dataset ingest (blind vault)">
      <InfoBanner>
        <strong>Blind-test rules.</strong> A dataset's bytes are committed by SHA-256 on ingestion. Data with role <code>blind_test</code> are sealed: they can only be read for analysis after an <em>unblinding</em> entry tied to a matching preregistration, and they are refused for calibration, model selection or training. Use <code>calibration</code>/<code>selection</code> data for tuning, <code>replication</code> for independent repeats.
        Only data labelled <code>REAL</code> can ever count as experimental evidence; SYNTHETIC data stay synthetic.
      </InfoBanner>
      <div class="field"><label class="field-label" for="s18-ds-file">File <Tip text="The bytes are stored in the vault and hashed; the hash is written to the ledger." /></label>
        <input id="s18-ds-file" type="file" onChange={(e: any) => setFile(e.currentTarget.files?.[0] ?? null)} />{!file && <div class="field-hint">Choose a file.</div>}</div>
      <div class="form-grid">
        <SelectField label="Data label" value={label} onChange={setLabel} options={DATA_LABELS.map((l) => ({ v: l, label: l }))} help="What the data are: REAL (instrument-native measurement), SYNTHETIC (simulated), REFERENCE, LITERATURE or TRAINING." />
        <SelectField label="Role" value={role} onChange={setRole} options={ROLES.map((r) => ({ v: r, label: r }))} help="How the data may be used. blind_test data are sealed until a preregistered unblinding." />
      </div>
      <TextField label="Source" value={source} onChange={setSource} required placeholder="instrument / lab / generator and run id" help="Where the data came from (recorded in the ledger)." />
      <TextField label="Description" value={desc} onChange={setDesc} help="Optional free text." />
      <TextField label="Preregistration id (optional)" value={prereg} onChange={setPrereg} help="Link the dataset to an existing preregistration." />
      <ActingAs id={id} verb="Ingesting as" roles={['researcher', 'operator']} what="dataset ingestion" />
      <RunBar label="Ingest dataset" requiresToken scenario busy={busy} disabled={!file || !source.trim() || !allowed} onRun={ingest} />
      <ErrorBox error={err} what="ingesting the dataset" />
      {rec && <div style={{ marginTop: '8px' }}><KV rows={[['Dataset id', <code>{rec.dataset_id}</code>], ['Label', rec.label], ['Role', rec.role], ['SHA-256', <code style={{ overflowWrap: 'anywhere' }}>{rec.sha256}</code>], ['Source', rec.source]]} /></div>}
    </Card>
  );
}

function Unblind({ onDone, id }: { onDone: () => void; id: WhoamiState }) {
  const [ds, setDs] = useState(LS('qg.lastDataset'));
  const [pr, setPr] = useState(LS('qg.lastPrereg'));
  const allowed = canAct(id.kind, id.w);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<Entry | null>(null);
  const go = async () => {
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await apiPost<Entry>('/api/evidence/unblind', unblindBody(ds, pr))); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Card title="Unblinding">
      <p class="small muted">Records the decision to open a sealed dataset for the preregistered analysis. The server refuses if no matching preregistration exists, the dataset is unknown, or blind-test data were accessed before preregistration.</p>
      <TextField label="Dataset id" value={ds} onChange={setDs} required help="Id returned at ingestion." />
      <TextField label="Preregistration id" value={pr} onChange={setPr} required help="Id returned by the preregistration." />
      <ActingAs id={id} verb="Unblinding as" what="unblinding" />
      <RunBar label="Record unblinding" requiresToken scenario busy={busy} disabled={!ds.trim() || !pr.trim() || !allowed} onRun={go} />
      {err ? <div style={{ marginTop: '8px' }}><ErrorBox error={err} what="unblinding (the server refused; reason above)" /></div> : null}
      {res && <div class="banner ok" role="status"><div><strong>Unblinding recorded</strong> as ledger entry #{res.index} (<code>{shortHash(res.entry_hash, 16)}</code>) by <strong>{res.actor}</strong>.</div></div>}
    </Card>
  );
}

// ----------------------------------------------------------------------------- gates & ladder
function Gates({ onClass }: { onClass: (c: Classification | null) => void }) {
  const HYP_IDS = useImplementedModels(); // live registry (server implements more models than the local engine)
  const sc = useStore(scenario);
  const [hyp, setHyp] = useState('QG-COH');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<{ gates: Gate[]; classification: Classification } | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try { const r = await apiPost<{ gates: Gate[]; classification: Classification }>('/api/evidence/gates', sc, { hypothesis: hyp }); setRes(r); onClass(r.classification); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const c = res?.classification;
  return (
    <Card title="Seven acceptance gates and the evidence ladder">
      <p class="small muted">Gates are evaluated from recorded evidence only: model registry, latest V&amp;V run, Lean proof status, ledger (preregistrations, sign-offs), the virtual-laboratory dossier and independent reproduction. Gates that need human review or physical data cannot be passed by software alone: G6 and G7 can pass only with <code>REAL</code> data that were preregistered and unblinded, together with identity-verified, independent sign-offs. Statuses, evidence and missing items below are exactly as returned by the server.</p>
      <div class="row">
        <SelectField label="Hypothesis" value={hyp} onChange={setHyp} options={HYP_IDS.map((h) => ({ v: h, label: h }))} help="Model whose G1 (theory) record is assessed." />
        <span class="small muted">Scenario: current shared design (m = {fmtQ(sc.design.mass_A, 'kg')}, d = {fmtQ(sc.design.separation, 'm')}).</span>
      </div>
      <RunBar label="Evaluate gates" scenario busy={busy} onRun={run} />
      <ErrorBox error={err} what="evaluating gates" />
      {res && (
        <div class="grid-2" style={{ marginTop: '12px' }}>
          <DataTable caption="Acceptance gates" head={['Gate', 'Criterion', 'Status', 'Evidence', 'Missing']}
            rows={res.gates.map((g) => [<strong>{g.gate} {g.name}</strong>, <span class="small">{g.criterion}</span>, <StatusBadge status={g.status} />,
              <ul class="tight small">{g.evidence.filter(Boolean).map((x) => <li>{x}</li>)}</ul>, <ul class="tight small">{g.missing.map((x) => <li>{x}</li>)}</ul>])} />
          <div>
            <h3>Evidence ladder</h3>
            <ol class="ladder" aria-label="Evidence ladder">
              {EVIDENCE_LADDER.map((rung, i) => <li class={`${c && i <= c.level ? 'reached' : ''} ${c && i === c.level ? 'current' : ''}`} aria-current={c && i === c.level ? 'step' : undefined}>{rung}</li>)}
            </ol>
            {c && <div style={{ marginTop: '10px' }}><KV rows={[['Classification', <strong>{c.classification}</strong>], ['Rung', `${c.level} of ${EVIDENCE_LADDER.length - 1}`], ['Physical claim permitted', c.physical_claim_permitted ? <span class="badge b-ok">yes</span> : <span class="badge b-bad">no</span>], ['Statement', c.statement]]} /></div>}
          </div>
        </div>
      )}
      {res && <Ladder3D gates={res.gates} c={c!} />}
    </Card>
  );
}

/** Conceptual heights: an ordinal of gate status only — no physical or statistical meaning. */
const GATE_RANK: Record<string, number> = { PASSED: 3, PARTIAL: 2, REQUIRES_HUMAN: 1, NOT_PASSED: 0.4 };
const GATE_COLOR: Record<string, string> = { PASSED: '#1b7f3b', PARTIAL: '#E69F00', REQUIRES_HUMAN: '#0072B2', NOT_PASSED: '#b3261e' };

function Ladder3D({ gates, c }: { gates: Gate[]; c: Classification }) {
  const opts = useMemo(() => ({
    x: { label: 'Position', cats: EVIDENCE_LADDER.map((_, i) => String(i + 1)) },
    y: { label: 'Structure', cats: ['Evidence ladder', 'Gates G1–G7'] },
    z: { label: 'Conceptual level (ordinal, no units)', min: 0, max: EVIDENCE_LADDER.length },
    bars: [
      ...EVIDENCE_LADDER.map((rung, i) => ({ xi: i, yi: 0, h: i + 1, color: i <= c.level ? '#1b7f3b' : '#b8bcc8', label: i === c.level ? `▶ ${rung}` : undefined })),
      ...gates.map((g, i) => ({ xi: i, yi: 1, h: GATE_RANK[g.status] ?? 0.4, color: GATE_COLOR[g.status] ?? '#888888', label: `${g.gate}: ${g.status.replace(/_/g, ' ')}` })),
    ],
  }), [gates, c]);
  return (
    <div style={{ marginTop: '14px' }}>
      <View3D kind="plot3d" name="evidence-ladder-3d" title="Evidence ladder and acceptance gates" badge="CONCEPTUAL" opts={opts}
        legend={[{ label: 'rung reached (backend classification)', color: '#1b7f3b' }, { label: 'rung not reached', color: '#b8bcc8' }, { label: 'gate passed', color: GATE_COLOR.PASSED }, { label: 'gate partial', color: GATE_COLOR.PARTIAL }, { label: 'gate requires human review', color: GATE_COLOR.REQUIRES_HUMAN }, { label: 'gate not passed', color: GATE_COLOR.NOT_PASSED }]}
        frameData={() => ({ classification: c, gates: gates.map((g) => ({ gate: g.gate, status: g.status })) })}
        label="Conceptual staircase of the nine evidence rungs with the reached level highlighted, and the seven gates as pillars coloured by status"
        fallback={<p class="small muted">See the ladder list and gate table above.</p>} />
      <p class="small muted"><b>Conceptual view:</b> heights and positions only encode order (rung number) and gate status; they are not physical or statistical quantities. Rung reached: {c.level} ({c.classification}).</p>
    </div>
  );
}

// ----------------------------------------------------------------------------- sign-off
function Signoff({ onDone, id }: { onDone: () => void; id: WhoamiState }) {
  const [gate, setGate] = useState('G1');
  const [aff, setAff] = useState('');
  const [stmt, setStmt] = useState('');
  const [ds, setDs] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<Entry | null>(null);
  const allowed = canAct(id.kind, id.w);
  const needsDs = GATES_WITH_DATASET.includes(gate);
  const led = useApiGet<LedgerResp>(needsDs ? '/api/evidence/ledger' : null, { kind: 'dataset_ingest', limit: 1000 });
  const opts = led.data ? datasetOptions(led.data.entries) : [];
  const fe = signoffErrors(aff, stmt);
  const ok = !fe.affiliation && !fe.statement && confirm && allowed;
  const go = async () => {
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await apiPost<Entry>('/api/evidence/signoff', signoffBody(gate, aff, stmt, needsDs ? ds : null))); setConfirm(false); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const name = id.w && id.w.role !== 'public' ? id.w.name : null;
  return (
    <Card title="Human sign-off">
      <div class="banner danger" role="note"><div><strong>This records a human attestation in the permanent ledger.</strong> The reviewer recorded is the identity bound to your access token — there is no name field to fill in. A sign-off states that you have independently checked the gate's criterion; it cannot be deleted and is used by the gate evaluation (e.g. G1 passes only with an independent review of the derivation; G6/G7 need identity-verified, independent sign-offs about REAL data).</div></div>
      <ActingAs id={id} verb="Signing as" what="a sign-off" />
      <div class="form-grid" style={{ marginTop: '8px' }}>
        <SelectField label="Gate" value={gate} onChange={setGate} options={['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map((g) => ({ v: g, label: g }))} help="Gate being attested." />
        <div class={`field ${touched && fe.affiliation ? 'invalid' : ''}`}>
          <label class="field-label" for="s18-aff">Affiliation <Tip text="Your institution (at least 2 characters). Recorded with the sign-off." /></label>
          <div class="field-input"><input id="s18-aff" value={aff} aria-invalid={touched && !!fe.affiliation} aria-describedby="s18-aff-msg" onInput={(e: any) => { setAff(e.currentTarget.value); setTouched(true); }} /></div>
          <div id="s18-aff-msg" aria-live="polite">{touched && fe.affiliation && <div class="field-error">{fe.affiliation}</div>}</div>
        </div>
        {needsDs && (
          <div class="field">
            <label class="field-label" for="s18-ds">Dataset assessed (optional) <Tip text="For G6/G7: the dataset this assessment concerns. Only REAL data that were preregistered and unblinded can make these gates pass; the server checks this." /></label>
            <div class="field-input"><select id="s18-ds" value={ds} onChange={(e: any) => setDs(e.currentTarget.value)}>
              <option value="">— none —</option>
              {opts.map((o) => <option value={o.id}>{o.id} · {o.label} · {o.role}{o.source ? ` · ${o.source.slice(0, 40)}` : ''}</option>)}
            </select></div>
            <div class="field-hint">{led.loading ? 'Loading datasets…' : opts.length ? `${opts.filter((o) => o.label === 'REAL').length} REAL of ${opts.length} ingested dataset(s); REAL listed first.` : 'No datasets have been ingested yet.'}</div>
          </div>
        )}
      </div>
      <div class={`field ${touched && fe.statement ? 'invalid' : ''}`}>
        <label class="field-label" for="s18-stmt">Statement <Tip text="What you reviewed and your conclusion (at least 10 characters)." /></label>
        <textarea id="s18-stmt" class="input" value={stmt} aria-invalid={touched && !!fe.statement} aria-describedby="s18-stmt-msg" onInput={(e: any) => { setStmt(e.currentTarget.value); setTouched(true); }} />
        <div id="s18-stmt-msg" aria-live="polite">{touched && fe.statement && <div class="field-error">{fe.statement}</div>}</div>
      </div>
      <label class="row small" style={{ marginBottom: '8px' }}><input type="checkbox" checked={confirm} disabled={!allowed} onChange={(e: any) => setConfirm(e.currentTarget.checked)} /> I{name ? <>, <strong>{name}</strong>,</> : ''} performed this review myself and the statement reflects my own independent assessment.</label>
      <RunBar label="Record sign-off" requiresToken scenario busy={busy} disabled={!ok} onRun={go} />
      {!allowed && <p class="small muted">Submitting is disabled until a researcher access token is set in <a href="/settings#api-token">Settings</a>.</p>}
      <ErrorBox error={err} what="recording the sign-off" />
      {res && <div class="banner ok" role="status"><div><strong>Sign-off recorded</strong> for {gate} as ledger entry #{res.index}, reviewer <strong>{res.payload?.reviewer ?? res.actor}</strong>{res.payload?.identity_verified ? ' (identity verified)' : ' (identity not verified)'}{res.payload?.dataset_id ? `, dataset ${res.payload.dataset_id}` : ''}.</div></div>}
    </Card>
  );
}

// ----------------------------------------------------------------------------- external anchors
function VerdictBadge({ v }: { v: AnchorVerification | null | undefined }) {
  const r = anchorVerdict(v);
  return (
    <div>
      <span class={`badge ${r.ok ? 'b-ok' : 'b-bad'}`} data-anchor-verdict={r.ok ? 'valid' : 'problems'}>{r.text}</span>
      {r.problems.length > 0 && <ul class="tight small">{r.problems.map((p) => <li>{p}</li>)}</ul>}
    </div>
  );
}

export function Anchors() {
  const r = useApiGet<AnchorsResp>('/api/evidence/anchors');
  const [vres, setVres] = useState<AnchorVerification | null>(null);
  const [vErr, setVErr] = useState<unknown>(null);
  const [vName, setVName] = useState('');
  const [busy, setBusy] = useState(false);
  const d = r.data && typeof r.data === 'object' && Array.isArray(r.data.anchors) ? r.data : null;
  const verifyFile = async (f: File) => {
    setBusy(true); setVErr(null); setVres(null); setVName(f.name);
    try { const anchors = parseAnchorFile(await f.text()); setVres(await apiPost<AnchorVerification>('/api/evidence/verify-anchors', { anchors })); }
    catch (e) { setVErr(e); } finally { setBusy(false); }
  };
  return (
    <Card id="anchors" title="External anchors of the ledger" actions={<><SourceChip source={r.source} cachedAt={r.cachedAt} /><Btn onClick={r.reload}>Refresh</Btn></>}>
      <p class="small"><MathText text="Each anchor commits to one ledger position — the pair $(i, h_i)$ of entry index $i$ and that entry's hash $h_i$ — and is published outside this server (object store and OpenTimestamps calendars). Because every entry's hash also commits to all earlier entries, anyone holding an archived anchor can later detect if entry $i$ or anything before it was removed or rewritten." /></p>
      <p class="small muted"><strong>What anchoring does not prove:</strong> that the recorded content is scientifically true; that entries added after the latest anchor are untouched (they are protected only once a later anchor covers them); or who a signer is beyond the binding of their access token to a registered name.</p>
      {r.loading && !d && <Loading />}
      <ErrorBox error={r.error} what="loading the anchors" />
      {d && (
        <>
          <div class="row" style={{ margin: '6px 0' }}>
            <span class="small">Server-side verification:</span> <VerdictBadge v={d.verification} />
            <span class="small muted">chain {d.verification.chain_valid ? 'intact' : 'BROKEN'} · {d.verification.anchors_checked} checked{d.verification.latest_anchor && (d.verification.latest_anchor as any).ledger_index != null ? ` · latest anchor at entry #${(d.verification.latest_anchor as any).ledger_index}` : ''}</span>
          </div>
          <p class="small">{d.remote_available ? <span class="badge b-ok">object store reachable</span> : <span class="badge b-warn">object store not reachable{d.remote_error ? ` (${d.remote_error})` : ''}</span>} {!d.remote_available && <span class="muted">Only the anchors recorded on this server are listed; the published copies could not be read right now.</span>}</p>
          {d.anchors.length === 0 ? <p class="muted">No anchors have been published yet (the server anchors the ledger head periodically once it changes).</p> : (
            <DataTable caption="Ledger anchors" head={['Ledger entry', 'Anchored (UTC)', 'Entry hash', 'Anchor digest', 'Published at']} numeric={[0]}
              rows={[...d.anchors].reverse().map((a) => [`#${a.ledger_index}`, <span class="small">{fmtTime(a.created_utc)}</span>,
                <code title={a.entry_hash}>{shortHash(a.entry_hash, 12)}</code>, <code title={a.anchor_sha256}>{shortHash(a.anchor_sha256, 12)}</code>,
                anchorPlaces(a).length ? <ul class="tight small">{anchorPlaces(a).map((x) => <li style={{ overflowWrap: 'anywhere' }}>{x}</li>)}</ul> : <span class="small muted">this server only (not yet published externally)</span>])} />
          )}
          <div class="row" style={{ marginTop: '10px' }}>
            <Btn onClick={() => downloadBlob(new Blob([JSON.stringify({ anchors: d.anchors }, null, 2)], { type: 'application/json' }), 'qgdevs-ledger-anchors.json')} disabled={d.anchors.length === 0}>Download anchors (JSON)</Btn>
            <label class="btn" aria-busy={busy}>Verify archived anchors…<input type="file" accept="application/json,.json" class="sr-only" onChange={(e: any) => { const f = e.currentTarget.files?.[0]; if (f) verifyFile(f); e.currentTarget.value = ''; }} /></label>
            {busy && <span class="spinner" aria-hidden="true" />}
          </div>
          <p class="small muted">The download contains the exact anchor records returned by the server, for archiving by third parties. {d.how_to_verify}</p>
        </>
      )}
      {vErr ? <ErrorBox error={vErr} what="verifying the archived anchors" /> : null}
      {vres && <div style={{ marginTop: '8px' }} role="status"><span class="small">Verification of <code>{vName}</code> against the current ledger: </span><VerdictBadge v={vres} /></div>}
    </Card>
  );
}

function Package() {
  const sc = useStore(scenario);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null); setDone(null);
    try { const b = await apiPostBlob('/api/evidence/package', sc); downloadBlob(b, 'qgdevs-reproduction.zip'); setDone(`${fmtQ(b.size, 'B', 3)} downloaded`); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Card title="Reproduction package">
      <p class="small muted">A zip archive with the configuration, the server's prediction for the current shared scenario, the code hash, software environment, ledger and instructions to reproduce the computation independently.</p>
      <RunBar label="Download reproduction package" scenario busy={busy} onRun={go} />
      {done && <span class="small muted"> {done}.</span>}
      <ErrorBox error={err} what="building the package" />
    </Card>
  );
}

export default function Page(_props: any) {
  useResetKey('qg.lastPrereg'); useResetKey('qg.lastDataset'); // page reset forgets these bindings
  const [tab, setTab] = useState(() => (location.hash.slice(1) || 'ledger'));
  const [tick, setTick] = useState(0);
  const [cls, setCls] = useState<Classification | null>(null);
  useEffect(() => { if (location.hash.slice(1) !== tab) history.replaceState(history.state, '', `#${tab}`); }, [tab]);
  // follow in-page links to a section (e.g. /suite/evidence#anchors) while this page is open
  useEffect(() => {
    const onHash = () => { const h = location.hash.slice(1); if (h && ['ledger', 'prereg', 'data', 'gates', 'signoff', 'anchors', 'package'].includes(h)) setTab(h); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const bump = () => setTick((t) => t + 1);
  const id = useWhoami();
  const tabs = [
    { id: 'ledger', label: 'Ledger' }, { id: 'prereg', label: 'Preregistration' }, { id: 'data', label: 'Datasets & unblinding' },
    { id: 'gates', label: 'Gates & ladder' }, { id: 'signoff', label: 'Sign-off' }, { id: 'anchors', label: 'Anchors' }, { id: 'package', label: 'Reproduction' },
  ];
  return (
    <div>
      <SuiteHeader n={18} intro="Hash-chained ledger, preregistration, blind data vault with data roles, seven acceptance gates, the evidence ladder and reproduction packages. Software can raise a result at most to computational rungs; physical evidence requires real data, preregistration and independent replication." />
      <EvidenceBanner classification={cls} />
      <div class="tabs">
        <Tabs label="Evidence sections" tabs={tabs} active={tab} onChange={setTab} />
        <TabPanel id="ledger" active={tab}><LedgerView tick={tick} /></TabPanel>
        <TabPanel id="prereg" active={tab}><Preregister onDone={bump} id={id} /></TabPanel>
        <TabPanel id="data" active={tab}><div class="grid-2"><Datasets onDone={bump} id={id} /><Unblind onDone={bump} id={id} /></div></TabPanel>
        <TabPanel id="gates" active={tab}><Gates onClass={setCls} /></TabPanel>
        <TabPanel id="signoff" active={tab}><Signoff onDone={bump} id={id} /></TabPanel>
        <TabPanel id="anchors" active={tab}><Anchors /></TabPanel>
        <TabPanel id="package" active={tab}><Package /></TabPanel>
      </div>
    </div>
  );
}
