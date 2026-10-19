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
import { IMPLEMENTED_IDS, hypStyle } from '../../lib/hyp';
import type { Scenario } from '../../lib/types';

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
          rows={[...r.data.entries].reverse().map((e) => [e.index, <span class="small">{fmtTime(e.timestamp_utc)}</span>, <code>{e.kind}</code>, e.actor,
            <code title={e.payload_sha256}>{shortHash(e.payload_sha256)}</code>, <code title={e.entry_hash}>{shortHash(e.entry_hash)}</code>, <code title={e.prev_hash}>{shortHash(e.prev_hash)}</code>,
            <details><summary class="small">{summary(e)}</summary><Json data={e.payload} max={300} /></details>])} />
      )}
    </Card>
  );
}
function summary(e: Entry): string {
  const p = e.payload ?? {};
  return p.title ?? p.prereg_id ?? p.dataset_id ?? p.gate ?? p.classification ?? 'view';
}

// ----------------------------------------------------------------------------- preregistration
function Preregister({ onDone }: { onDone: () => void }) {
  const sc = useStore(scenario);
  const val = useValidity();
  const [title, setTitle] = useState('');
  const [hyps, setHyps] = useState<string[]>(['QG-COH', 'SC-MF', 'CC-KTM', 'NULL-NG']);
  const [rules, setRules] = useState<[string, string][]>(DEFAULT_RULES);
  const [plan, setPlan] = useState('Blind analysis: compute the readout-corrected CPK witness <W> = 1 − <XX> ∓ (<YZ> + <ZY>) in the preregistered local frame, with bootstrap 95% CI; full 9-setting tomography with MLE reconstruction; decision by the rules above. Null controls (masses not superposed; swapped timing) analysed identically.');
  const [seeds, setSeeds] = useState('0, 1, 2');
  const [shots, setShots] = useState(100000);
  const [actor, setActor] = useState('researcher');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<Entry | null>(null);
  const [queued, setQueued] = useState(false);
  const seedList = seeds.split(/[\s,;]+/).filter(Boolean).map(Number);
  const seedsErr = seedList.length === 0 || seedList.some((s) => !Number.isInteger(s) || s < 0) ? 'Enter one or more non-negative integers separated by commas.' : null;
  const ruleErr = rules.some(([k, t]) => !k.trim() || !t.trim()) ? 'Every rule needs a name and a text.' : null;
  const ok = title.trim() && hyps.length > 0 && !seedsErr && !ruleErr && val.ok && actor.trim();
  const submit = async () => {
    setBusy(true); setErr(null); setRes(null); setQueued(false);
    const body = { title: title.trim(), hypotheses: hyps, scenario: sc, decision_rules: Object.fromEntries(rules), analysis_plan: plan, seeds: seedList, sample_size: { shots_per_setting: shots, settings: 9 }, actor: actor.trim() };
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
        <div class="row">{IMPLEMENTED_IDS.map((id) => (
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
        <TextField label="Actor" value={actor} onChange={setActor} required help="Name recorded in the ledger as the author of this entry." />
      </div>
      <RunBar label="Record preregistration" scenario busy={busy} disabled={!ok} onRun={submit} />
      {!ok && <span class="small muted"> Complete the required fields.</span>}
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
function Datasets({ onDone }: { onDone: () => void }) {
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
      <RunBar label="Ingest dataset" scenario busy={busy} disabled={!file || !source.trim()} onRun={ingest} />
      <ErrorBox error={err} what="ingesting the dataset" />
      {rec && <div style={{ marginTop: '8px' }}><KV rows={[['Dataset id', <code>{rec.dataset_id}</code>], ['Label', rec.label], ['Role', rec.role], ['SHA-256', <code style={{ overflowWrap: 'anywhere' }}>{rec.sha256}</code>], ['Source', rec.source]]} /></div>}
    </Card>
  );
}

function Unblind({ onDone }: { onDone: () => void }) {
  const [ds, setDs] = useState(LS('qg.lastDataset'));
  const [pr, setPr] = useState(LS('qg.lastPrereg'));
  const [actor, setActor] = useState('researcher');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<Entry | null>(null);
  const go = async () => {
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await apiPost<Entry>('/api/evidence/unblind', { dataset_id: ds.trim(), prereg_id: pr.trim(), actor: actor.trim() })); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Card title="Unblinding">
      <p class="small muted">Records the decision to open a sealed dataset for the preregistered analysis. The server refuses if no matching preregistration exists, the dataset is unknown, or blind-test data were accessed before preregistration.</p>
      <TextField label="Dataset id" value={ds} onChange={setDs} required help="Id returned at ingestion." />
      <TextField label="Preregistration id" value={pr} onChange={setPr} required help="Id returned by the preregistration." />
      <TextField label="Actor" value={actor} onChange={setActor} required help="Name recorded in the ledger." />
      <RunBar label="Record unblinding" scenario busy={busy} disabled={!ds.trim() || !pr.trim() || !actor.trim()} onRun={go} />
      {err ? <div style={{ marginTop: '8px' }}><ErrorBox error={err} what="unblinding (the server refused; reason above)" /></div> : null}
      {res && <div class="banner ok" role="status"><div><strong>Unblinding recorded</strong> as ledger entry #{res.index} (<code>{shortHash(res.entry_hash, 16)}</code>).</div></div>}
    </Card>
  );
}

// ----------------------------------------------------------------------------- gates & ladder
function Gates({ onClass }: { onClass: (c: Classification | null) => void }) {
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
      <p class="small muted">Gates are evaluated from recorded evidence only: model registry, latest V&amp;V run, Lean proof status, ledger (preregistrations, sign-offs), the virtual-laboratory dossier and independent reproduction. Gates that need human review or physical data cannot be passed by software alone.</p>
      <div class="row">
        <SelectField label="Hypothesis" value={hyp} onChange={setHyp} options={IMPLEMENTED_IDS.map((h) => ({ v: h, label: h }))} help="Model whose G1 (theory) record is assessed." />
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
function Signoff({ onDone }: { onDone: () => void }) {
  const [gate, setGate] = useState('G1');
  const [reviewer, setReviewer] = useState('');
  const [aff, setAff] = useState('');
  const [stmt, setStmt] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<Entry | null>(null);
  const ok = reviewer.trim() && aff.trim() && stmt.trim().length >= 10 && confirm;
  const go = async () => {
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await apiPost<Entry>('/api/evidence/signoff', { gate, reviewer: reviewer.trim(), affiliation: aff.trim(), statement: stmt.trim() })); setConfirm(false); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Card title="Human sign-off">
      <div class="banner danger" role="note"><div><strong>This records a human attestation in the permanent ledger.</strong> A sign-off states that the named reviewer has independently checked the gate's criterion. It cannot be deleted and is used by the gate evaluation (e.g. G1 passes only with an independent review of the derivation). Do not sign on someone else's behalf.</div></div>
      <div class="form-grid">
        <SelectField label="Gate" value={gate} onChange={setGate} options={['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map((g) => ({ v: g, label: g }))} help="Gate being attested." />
        <TextField label="Reviewer" value={reviewer} onChange={setReviewer} required help="Full name of the reviewer." />
        <TextField label="Affiliation" value={aff} onChange={setAff} required help="Institution of the reviewer." />
      </div>
      <TextField label="Statement" value={stmt} onChange={setStmt} multiline required help="What was reviewed and the conclusion (at least 10 characters)." />
      <label class="row small" style={{ marginBottom: '8px' }}><input type="checkbox" checked={confirm} onChange={(e: any) => setConfirm(e.currentTarget.checked)} /> I am the named reviewer and this statement reflects my own independent review.</label>
      <RunBar label="Record sign-off" scenario busy={busy} disabled={!ok} onRun={go} />
      <ErrorBox error={err} what="recording the sign-off" />
      {res && <div class="banner ok" role="status"><div><strong>Sign-off recorded</strong> for {gate} as ledger entry #{res.index}.</div></div>}
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
  const bump = () => setTick((t) => t + 1);
  const tabs = [
    { id: 'ledger', label: 'Ledger' }, { id: 'prereg', label: 'Preregistration' }, { id: 'data', label: 'Datasets & unblinding' },
    { id: 'gates', label: 'Gates & ladder' }, { id: 'signoff', label: 'Sign-off' }, { id: 'package', label: 'Reproduction' },
  ];
  return (
    <div>
      <SuiteHeader n={18} intro="Hash-chained ledger, preregistration, blind data vault with data roles, seven acceptance gates, the evidence ladder and reproduction packages. Software can raise a result at most to computational rungs; physical evidence requires real data, preregistration and independent replication." />
      <EvidenceBanner classification={cls} />
      <div class="tabs">
        <Tabs label="Evidence sections" tabs={tabs} active={tab} onChange={setTab} />
        <TabPanel id="ledger" active={tab}><LedgerView tick={tick} /></TabPanel>
        <TabPanel id="prereg" active={tab}><Preregister onDone={bump} /></TabPanel>
        <TabPanel id="data" active={tab}><div class="grid-2"><Datasets onDone={bump} /><Unblind onDone={bump} /></div></TabPanel>
        <TabPanel id="gates" active={tab}><Gates onClass={setCls} /></TabPanel>
        <TabPanel id="signoff" active={tab}><Signoff onDone={bump} /></TabPanel>
        <TabPanel id="package" active={tab}><Package /></TabPanel>
      </div>
    </div>
  );
}
