import { Tex, MathText } from '../components/Tex';
import { T, F } from './formulas-l1';
import { RunBar } from '../components/Reset';
/**
 * Thought-Experiment Lab: prompt → interpretation → reviewable configuration → explicit approval →
 * deterministic computation → results, with the pipeline towards virtual laboratory and preregistration.
 */
import { useMemo, useState } from 'preact/hooks';
import { Card, Out, ProvBadge, EvidenceBanner, InfoBanner, ErrorBox, Seg, Btn, KV, DataTable, Tip, Level, Json, PageHead, StatusBadge } from '../components/ui';
import { LinePlot, BarChart } from '../plot/Chart';
import { useMaterials } from '../components/ScenarioForm';
import { useApiGet, apiPost } from '../lib/api';
import { scenario } from '../lib/store';
import { navigate } from '../lib/router';
import { fmtQ, fmtNum } from '../lib/format';
import { hypStyle } from '../lib/hyp';
import { modelCurves, IMPLEMENTED_IDS as ENGINE_IDS } from '../engine';
import { parseNumber, toSI } from '../lib/numparse';
import { DEFAULT_DESIGN, DEFAULT_ENV, type Design, type Environment, type Geometry } from '../lib/types';

type LM = 'off' | 'anthropic' | 'ollama';
interface Q { role: string; value: number; unit: string; si_value: number; source: string; text?: string }
interface Config {
  prompt: string; family: string | null; category: string; quantities: Record<string, Q>; material: string; geometry: string;
  assumptions: string[]; missing: string[]; clarifications: string[]; speculative: boolean; domain_notes: string[]; interpreter: string;
  approved?: boolean; family_description?: string;
}
interface LMStatus { providers: { anthropic: { configured: boolean }; ollama: { configured: boolean; url?: string } }; default: string }

/** Supported system families — descriptions as in FAMILIES of qgdevs/thought.py. */
const FAMILIES: Record<string, string> = {
  bmv: 'Gravity-mediated entanglement of two spatially superposed masses',
  optomech: 'Gravitationally coupled mechanical oscillators (Gaussian states)',
  atom_interferometer: 'Light-pulse atom interferometry in a gravitational field',
  orbit: 'Classical orbit / light deflection in Schwarzschild spacetime',
  collapse: 'Gravitational collapse (Diósi–Penrose) decoherence of one superposed mass',
};
const CATEGORIES: Record<string, string> = {
  THEORETICAL: 'Reasoning about an idealised situation; no numerical model is executed.',
  COMPUTATIONAL: 'A numerical model of the idealised system is solved (no apparatus imperfections).',
  VIRTUAL: 'A simulated apparatus with environment, noise and instruments — still simulation, not measurement.',
  PHYSICAL: 'Real measurements from a physical laboratory. This platform cannot produce them; only preregistered REAL data can.',
};
/** Units accepted by the server per quantity kind (qgdevs/units.py UNIT_SCALE) with factors to SI. */
const UNITS: Record<string, [string, number][]> = {
  mass: [['kg', 1], ['g', 1e-3], ['mg', 1e-6], ['ug', 1e-9], ['ng', 1e-12], ['pg', 1e-15], ['fg', 1e-18], ['amu', 1.66053906892e-27]],
  length: [['m', 1], ['cm', 1e-2], ['mm', 1e-3], ['um', 1e-6], ['nm', 1e-9]],
  time: [['s', 1], ['min', 60], ['ms', 1e-3], ['us', 1e-6], ['ns', 1e-9]],
  temperature: [['K', 1], ['mK', 1e-3], ['uK', 1e-6]],
  pressure: [['Pa', 1], ['mbar', 100], ['bar', 1e5], ['Torr', 133.322368]],
  frequency: [['rad/s', 1]],
};
const KIND: Record<string, string> = { mass: 'mass', separation: 'length', branch_separation: 'length', time: 'time', temperature: 'temperature', pressure: 'pressure', frequency: 'frequency' };
const ROLE_LABEL: Record<string, string> = { mass: 'Mass (each)', separation: 'Centre separation', branch_separation: 'Branch separation Δx', time: 'Interaction time', temperature: 'Temperature', pressure: 'Pressure', frequency: 'Trap angular frequency' };
const normUnit = (u: string) => ({ 'µm': 'um', 'μm': 'um', 'µg': 'ug', 'µs': 'us', 'µK': 'uK', u: 'amu', micrometre: 'um', micrometres: 'um', micrometer: 'um', micrometers: 'um', micron: 'um', microns: 'um', seconds: 's', second: 's', Torr: 'Torr', torr: 'Torr' } as Record<string, string>)[u] ?? u;

const EXAMPLES: [string, string][] = [
  ['Gravity-mediated entanglement', 'Two 10 fg diamond spheres 450 um apart, each in a 250 um spatial superposition, interact for 2.5 s at 0.15 K in a vacuum of 1e-15 Pa. Do they become entangled?'],
  ['Diósi–Penrose collapse', 'How fast would Penrose gravitational collapse destroy a superposition of a 1e-14 kg diamond sphere split by 1 um?'],
  ['Coupled oscillators', 'Two optomechanical oscillators of mass 1 mg separated by 1 mm with a trap frequency of 6.283 rad/s: can gravity entangle them?'],
  ['Atom interferometer', 'What gravitational phase does a Kasevich-Chu atom interferometer accumulate with pulse separation time 0.1 s?'],
  ['Mercury perihelion', 'Compute the general-relativistic perihelion precession of Mercury per orbit.'],
  ['Speculative', 'What would happen to two entangled masses thrown into a wormhole?'],
];

const STAGES = ['prompt', 'interpretation', 'formulation', 'configuration', 'verification', 'computation', 'visualisation', 'prediction', 'experimental design', 'physical measurement', 'evidence assessment'];

function SourceBadge({ s }: { s: string }) {
  const m: Record<string, [string, string]> = {
    USER_STATED: ['b-user', 'Stated in the prompt or entered by you.'],
    DEFAULT_ASSUMPTION: ['b-default', 'Not stated: a labelled reference default was assumed. Confirm or change it.'],
    LM_PROPOSED: ['b-lm', 'Proposed by the language model; not verifiable against the prompt. Review it.'],
    DERIVED: ['b-computed', 'Derived from other inputs.'],
  };
  const x = m[s] ?? ['b-neutral', ''];
  return <span class={`badge ${x[0]}`} title={x[1]}>{s.replace(/_/g, ' ')}</span>;
}

export default function Page(_props: any) {
  const lm = useApiGet<LMStatus>('/api/thought/lm-status');
  const mats = useMaterials();
  const [prompt, setPrompt] = useState('');
  const [lmSel, setLm] = useState<LM>('off');
  const [cfg, setCfg] = useState<Config | null>(null);
  const [edited, setEdited] = useState(false);
  const [busy, setBusy] = useState<'interp' | 'exec' | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<ThoughtResult | null>(null);
  const [designDone, setDesignDone] = useState(false);
  const pErr = prompt.trim().length < 3 ? 'At least 3 characters.' : prompt.length > 4000 ? 'At most 4000 characters.' : null;

  const interpret = async () => {
    setBusy('interp'); setErr(null); setRes(null); setCfg(null); setEdited(false); setDesignDone(false); setDrafts({});
    try { setCfg(await apiPost<Config>('/api/thought/interpret', { prompt: prompt.trim(), language_model: lmSel })); } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const update = (p: Partial<Config>) => { setCfg((c) => (c ? { ...c, ...p } : c)); setRes(null); setEdited(true); };
  const setQ = (role: string, p: Partial<Q>) => {
    if (!cfg) return;
    const q = { ...cfg.quantities[role], ...p, source: 'USER_STATED' };
    const f = (UNITS[KIND[role]] ?? []).find((u) => u[0] === normUnit(q.unit))?.[1] ?? 1;
    q.si_value = toSI(q.value, f);
    update({ quantities: { ...cfg.quantities, [role]: q } });
  };
  // draft text per quantity: partial input such as "1e" shows an inline error instead of "NaN"
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const editValue = (role: string, text: string) => {
    setDrafts((d) => ({ ...d, [role]: text }));
    const r = parseNumber(text);
    if (r.ok) setQ(role, { value: r.value });
  };
  const draftErr = (role: string): string | null => { const t = drafts[role]; if (t == null) return null; const r = parseNumber(t); return r.ok ? null : r.error; };
  const qErr = (q: Q): string | null => {
    if (!Number.isFinite(q.value)) return 'Enter a number.';
    if (['mass', 'separation', 'branch_separation', 'time', 'frequency'].includes(q.role) && q.value <= 0) return 'Must be > 0.';
    if (q.value < 0) return 'Must be ≥ 0.';
    if (!(UNITS[KIND[q.role]] ?? []).some((u) => u[0] === normUnit(q.unit))) return `Unit "${q.unit}" not accepted for ${q.role}.`;
    return null;
  };
  const cfgOk = cfg && Object.values(cfg.quantities).every((q) => !qErr(q) && !draftErr(q.role));

  const execute = async () => {
    if (!cfg) return;
    setBusy('exec'); setErr(null); setRes(null);
    const quantities = Object.fromEntries(Object.entries(cfg.quantities).map(([k, q]) => [k, { value: q.value, unit: normUnit(q.unit), si_value: q.si_value, source: q.source }]));
    const config = { prompt: cfg.prompt, family: cfg.family, category: cfg.category, material: cfg.material, geometry: cfg.geometry, speculative: cfg.speculative, interpreter: cfg.interpreter, quantities };
    try { setRes(await apiPost('/api/thought/execute', { config, approved: true })); } catch (e) { setErr(e); } finally { setBusy(null); }
  };

  // Design implied by an approved bmv/collapse configuration (same mapping as thought.to_design on the server).
  const implied = useMemo((): { design: Design; env: Environment } | null => {
    if (!cfg || !(cfg.family === 'bmv' || cfg.family === 'collapse')) return null;
    const q = (k: string, d: number) => cfg.quantities[k]?.si_value ?? d;
    const m = q('mass', 1e-14), dx = q('branch_separation', 250e-6), T = q('temperature', 0.15);
    const design: Design = { ...DEFAULT_DESIGN, mass_A: m, mass_B: m, dx_A: dx, dx_B: dx, separation: q('separation', 450e-6), time: q('time', 2.5),
      geometry: (cfg.geometry as Geometry) ?? 'parallel', density: mats[cfg.material]?.density ?? DEFAULT_DESIGN.density };
    const env: Environment = { ...DEFAULT_ENV, material: cfg.material, pressure: q('pressure', 1e-15), T_gas: T, T_env: T, T_int: T };
    return { design, env };
  }, [cfg, mats]);

  const cont = (path: string) => {
    if (implied) scenario.set({ design: implied.design, environment: implied.env });
    setDesignDone(true);
    navigate(path);
  };

  // pipeline progress
  const computed = res && res.status !== 'NOT_COMPUTED';
  const reached = [
    prompt.trim().length >= 3, !!cfg, !!cfg?.family, !!cfg?.family, !!computed, !!computed, !!computed, !!computed, designDone, false, false,
  ];
  const nextIdx = reached.findIndex((r) => !r);

  return (
    <div>
      <PageHead title="Thought-Experiment Lab" sub={<>Describe a gravitational or quantum thought experiment in words. The platform turns it into an explicit, reviewable configuration; nothing runs until you approve it, and results come only from the deterministic solvers.</>} />
      <div class="pipeline" aria-label="Investigation pipeline" role="list" style={{ marginBottom: '12px' }}>
        {STAGES.map((s, i) => (
          <>
            {i > 0 && <span class="arrow" aria-hidden="true">→</span>}
            <span role="listitem" class={`stage ${s === 'physical measurement' ? 'pending' : reached[i] ? 'done' : i === nextIdx ? 'active' : ''}`}
              aria-current={i === nextIdx ? 'step' : undefined}>{s}{s === 'physical measurement' ? ' (pending)' : ''}{reached[i] ? ' ✓' : ''}</span>
          </>
        ))}
      </div>
      <Level min="beginner">
        <details class="card" style={{ marginBottom: '14px' }}>
          <summary>Thought, computational, virtual and physical experiments — what is the difference?</summary>
          <ul class="tight small">{Object.entries(CATEGORIES).map(([k, v]) => <li><strong>{k}</strong>: {v}</li>)}</ul>
          <p class="small muted">Completing the first three never constitutes physical evidence about nature.</p>
        </details>
      </Level>

      <Card title="1 · Prompt">
        <div class="row" style={{ marginBottom: '8px' }}>
          <span class="field-label" id="lm-label">Language Model <Tip text="OFF uses the deterministic rule-based interpreter (always available). A language model, when configured on the server, only proposes a configuration: every value it introduces is labelled LM_PROPOSED for your review. It never computes results or triggers execution." /></span>
          <Seg label="Language Model" value={lmSel} onChange={setLm} options={[
            { v: 'off', label: 'OFF' },
            { v: 'anthropic', label: 'Anthropic API', disabled: !lm.data?.providers.anthropic.configured, title: lm.data?.providers.anthropic.configured ? 'Configured on the server' : 'Not configured on this server (no API credentials)' },
            { v: 'ollama', label: 'Local model (Ollama)', disabled: !lm.data?.providers.ollama.configured, title: lm.data?.providers.ollama.configured ? 'Configured on the server' : 'Not configured on this server (QGDEVS_OLLAMA_URL unset)' },
          ]} />
          <span class="small muted">{lm.error ? 'Provider status unavailable (offline); only OFF can be used.' : lm.data ? `Anthropic API: ${lm.data.providers.anthropic.configured ? 'available' : 'not configured'} · Local model: ${lm.data.providers.ollama.configured ? 'available' : 'not configured'}` : ''}</span>
        </div>
        <div class={`field ${pErr && prompt ? 'invalid' : ''}`}>
          <label class="field-label" for="tl-prompt">Thought experiment <span class="field-range">{prompt.length}/4000</span></label>
          <textarea id="tl-prompt" class="input" value={prompt} maxLength={4000} aria-invalid={!!(pErr && prompt)} placeholder="e.g. Two 10 fg diamond spheres 450 um apart …" onInput={(e: any) => setPrompt(e.currentTarget.value)} />
          {pErr && prompt && <div class="field-error">{pErr}</div>}
        </div>
        <div class="row small" style={{ marginBottom: '8px' }}>Examples: {EXAMPLES.map(([t, p]) => <button type="button" class="btn-sm" onClick={() => { setPrompt(p); setCfg(null); setRes(null); }}>{t}</button>)}</div>
        <RunBar label="Interpret" busy={busy === 'interp'} disabled={!!pErr} onRun={interpret} />
        <ErrorBox error={busy === null && !cfg ? err : null} what="interpreting the prompt" />
      </Card>

      {cfg && (
        <Card title="2 · Review the configuration" actions={<span class="small muted">Interpreter: <code>{cfg.interpreter}</code></span>}>
          {cfg.speculative && <div class="banner danger" role="note"><div><strong>Speculative.</strong> The prompt involves physics outside every implemented model's validated domain. No calculation will be presented as established.</div></div>}
          <div class="form-grid">
            <div class="field"><label class="field-label" for="tl-fam">Physical system <Tip text="The implemented model family used for the computation. 'None' keeps it a theoretical thought experiment." /></label>
              <div class="field-input"><select id="tl-fam" value={cfg.family ?? ''} onChange={(e: any) => update({ family: e.currentTarget.value || null })}>
                <option value="">None (theoretical only)</option>{Object.entries(FAMILIES).map(([k, v]) => <option value={k}>{v}</option>)}</select></div>
              <div class="field-hint">{cfg.family ? FAMILIES[cfg.family] : 'No implemented model selected.'}</div></div>
            <div class="field"><label class="field-label" for="tl-cat">Category <Tip text={<>{Object.entries(CATEGORIES).map(([k, v]) => <div><b>{k}</b>: {v}</div>)}</>} /></label>
              <div class="field-input"><select id="tl-cat" value={cfg.category} onChange={(e: any) => update({ category: e.currentTarget.value })}>{Object.keys(CATEGORIES).map((k) => <option value={k}>{k}</option>)}</select></div>
              <div class="field-hint"><span class="badge b-neutral">{cfg.category}</span> {CATEGORIES[cfg.category]}</div></div>
            <div class="field"><label class="field-label" for="tl-mat">Material <Tip text="Sets density (radius) and dielectric response of the masses." /></label>
              <div class="field-input"><select id="tl-mat" value={cfg.material} onChange={(e: any) => update({ material: e.currentTarget.value })}>{Object.keys(mats).map((k) => <option value={k}>{k}</option>)}</select></div></div>
            <div class="field"><label class="field-label" for="tl-geo">Geometry <Tip text="Parallel: superpositions split perpendicular to the A–B line; linear: along it." /></label>
              <div class="field-input"><select id="tl-geo" value={cfg.geometry} onChange={(e: any) => update({ geometry: e.currentTarget.value })}><option value="parallel">parallel</option><option value="linear">linear</option></select></div></div>
          </div>
          {Object.keys(cfg.quantities).length > 0 && (
            <DataTable caption="Quantities" head={['Quantity', 'Value', 'Unit', 'SI value', 'Source', 'From prompt']} numeric={[3]}
              rows={Object.values(cfg.quantities).map((q) => {
                const e = draftErr(q.role) ?? qErr(q);
                const units = UNITS[KIND[q.role]] ?? [[q.unit, 1]];
                return [
                  <label for={`tl-q-${q.role}`}>{ROLE_LABEL[q.role] ?? q.role}</label>,
                  <div class={`field ${e ? 'invalid' : ''}`} style={{ margin: 0 }}><div class="field-input"><input id={`tl-q-${q.role}`} inputMode="decimal" style={{ maxWidth: '140px' }} value={drafts[q.role] ?? String(q.value)} aria-invalid={!!e}
                    onInput={(ev: any) => editValue(q.role, ev.currentTarget.value)} /></div>{e && <div class="field-error">{e}</div>}</div>,
                  <select class="input" aria-label={`${q.role} unit`} value={normUnit(q.unit)} onChange={(ev: any) => setQ(q.role, { unit: ev.currentTarget.value })}>
                    {!units.some((u) => u[0] === normUnit(q.unit)) && <option value={q.unit}>{q.unit}</option>}{units.map((u) => <option value={u[0]}>{u[0]}</option>)}</select>,
                  fmtQ(q.si_value, { mass: 'kg', length: 'm', time: 's', temperature: 'K', pressure: 'Pa', frequency: 'rad/s' }[KIND[q.role]] ?? ''),
                  <SourceBadge s={q.source} />, <span class="small muted">{q.source === 'USER_STATED' && q.text ? `“${q.text}”` : q.source === 'DEFAULT_ASSUMPTION' ? q.text : ''}</span>,
                ];
              })} />
          )}
          <p class="small muted">Editing a value or unit marks it <SourceBadge s="USER_STATED" /> because you have now stated it explicitly. Defaults are reference values from the literature (e.g. Bose et al. 2017) and must be confirmed.</p>
          <div class="grid-2">
            <div>
              <h3>Assumptions</h3>
              {cfg.assumptions.length ? <ul class="tight small">{cfg.assumptions.map((a) => <li>{a}</li>)}</ul> : <p class="small muted">None recorded.</p>}
              {cfg.missing.length > 0 && <><h3>Not stated in the prompt (defaults assumed)</h3><ul class="tight small">{cfg.missing.map((m) => <li>{m}</li>)}</ul></>}
            </div>
            <div>
              {cfg.clarifications.length > 0 && <><h3>Clarifying questions</h3><ul class="tight small">{cfg.clarifications.map((m) => <li>{m}</li>)}</ul></>}
              {cfg.domain_notes.length > 0 && <><h3>Domain notes</h3><ul class="tight small">{cfg.domain_notes.map((m) => <li>{m}</li>)}</ul></>}
              {!cfg.clarifications.length && !cfg.domain_notes.length && <p class="small muted">No clarifications or domain warnings.</p>}
            </div>
          </div>
          {edited && <p class="small muted">The configuration was edited; the server re-validates it (fills defaults, checks the domain) when you run it.</p>}
          <div class="row" style={{ marginTop: '10px' }}>
            <RunBar label="I have reviewed these assumptions — run" busy={busy === 'exec'} disabled={!cfgOk} onRun={execute} />
            <span class="small muted">Approval is required: the server refuses unapproved configurations.</span>
          </div>
          <ErrorBox error={busy === null && cfg && !res ? err : null} what="running the approved configuration" />
        </Card>
      )}

      {res && <Results res={res} implied={implied} cont={cont} />}
    </div>
  );
}

/** Response of POST /api/thought/execute (fields present depend on the family). */
interface ThoughtResult {
  status?: string; reason?: string; domain_notes?: string[]; evidence_status?: string; family?: string | null; category?: string;
  config?: unknown; next_steps?: string[]; phase_rad?: number; assumptions_used?: string[];
  prediction?: Record<string, any>; decoherence?: { total_rate?: number; total_gamma_t?: number; coherence_factor?: number; dominant?: string | null };
  competing_models?: { id: string; negativity: number; concurrence: number; witness_cpk: number; purity: number; coherence_A?: number; coherence_B?: number }[];
  diosi_penrose?: { rate: number; E_delta_J: number; radius_m: number; convention_factor: number; regime: string };
  oscillators?: { t: number[]; log_negativity: number[]; coupling_rate_rad_s: number; thermal_occupation_bath: number; note?: string };
  mercury_precession_rad_per_orbit?: { numeric: number; analytic: number };
}

function Results({ res, implied, cont }: { res: ThoughtResult; implied: { design: Design; env: Environment } | null; cont: (p: string) => void }) {
  if (res.status === 'NOT_COMPUTED') {
    return (
      <Card title="3 · Result">
        <InfoBanner><strong>Not computed.</strong> {res.reason}</InfoBanner>
        {(res.domain_notes?.length ?? 0) > 0 && <ul class="tight small">{res.domain_notes!.map((n: string) => <li>{n}</li>)}</ul>}
        <p class="small muted">This remains a THEORETICAL thought experiment. Choose a supported physical system above to compute something.</p>
      </Card>
    );
  }
  return (
    <Card title="3 · Results" actions={<ProvBadge kind="COMPUTED" />}>
      <EvidenceBanner classification={res.evidence_status} />
      <p class="small muted">Physical system: {res.family && res.family !== 'null' ? (FAMILIES[res.family] ?? String(res.family).replace(/_/g, ' ')) : 'none — no implemented model matches, so this remains a theoretical thought experiment'}{res.category ? ` · category ${res.category}` : ''}.</p>
      {res.family === 'bmv' && <BmvResult res={res} implied={implied} />}
      {res.family === 'collapse' && res.diosi_penrose && (
        <div class="outs">
          <Out label="Diósi–Penrose rate Γ_DP" value={res.diosi_penrose.rate} unit="s⁻¹" prov="COMPUTED" interp="Single-mass coherence decay rate predicted by gravitational collapse for this superposition (uniform-sphere density)." />
          <Out label="Coherence time 1/Γ_DP" value={1 / res.diosi_penrose.rate} unit="s" prov="COMPUTED" interp={<>Time for the off-diagonal coherence to fall by <Tex tex={F.oneOverE} /> under the collapse model alone.</>} />
          <Out label="Self-energy difference E_Δ" value={res.diosi_penrose.E_delta_J} unit="J" prov="COMPUTED" />
          <Out label="Sphere radius" value={res.diosi_penrose.radius_m} unit="m" prov="COMPUTED" />
          <Out label="Convention factor κ" value={res.diosi_penrose.convention_factor} prov="COMPUTED" interp={<MathText text={T.tl_kappa} />} />
          <div class="out"><div class="out-label">Regime</div><div class="small">{res.diosi_penrose.regime}</div></div>
        </div>
      )}
      {res.family === 'optomech' && res.oscillators && (
        <div>
          <div class="outs" style={{ marginBottom: '10px' }}>
            <Out label="Gravitational coupling rate" value={res.oscillators.coupling_rate_rad_s} unit="rad/s" prov="COMPUTED" />
            <Out label="Bath thermal occupation" value={res.oscillators.thermal_occupation_bath} prov="COMPUTED" />
            <Out label="Max log-negativity" value={res.oscillators.log_negativity.length ? Math.max(...res.oscillators.log_negativity) : NaN} prov="COMPUTED" interp="E_N > 0 means the oscillators are entangled; classical-mediator hypotheses predict E_N = 0 identically." />
          </div>
          <LinePlot name="thought-optomech-logneg" title="Logarithmic negativity E_N(t)" desc="Entanglement of the two oscillators versus time"
            series={[{ name: 'E_N (QG-COH, Gaussian model)', x: res.oscillators.t, y: res.oscillators.log_negativity, color: hypStyle('QG-COH').color }]}
            xLabel="Time" xUnit="s" yLabel="E_N" />
          <p class="small muted">{res.oscillators.note}</p>
        </div>
      )}
      {res.family === 'atom_interferometer' && (
        <div>
          <div class="outs"><Out label="Interferometer phase k_eff g T²" value={res.phase_rad} unit="rad" prov="COMPUTED" sig={8} interp="Gravitational phase of a three-pulse light-pulse interferometer; measured modulo 2π in practice." /></div>
          {res.assumptions_used && <><h3>Assumptions used</h3><ul class="tight small">{res.assumptions_used.map((a: string) => <li>{a} <ProvBadge kind="UNVERIFIED_ASSUMPTION" /></li>)}</ul></>}
        </div>
      )}
      {res.family === 'orbit' && res.mercury_precession_rad_per_orbit && (() => {
        const p = res.mercury_precession_rad_per_orbit;
        return (
          <div>
            <div class="outs">
              <Out label="Precession per orbit (numerical)" value={p.numeric} unit="rad" prov="COMPUTED" sig={8} />
              <Out label="Precession per orbit (analytic)" value={p.analytic} unit="rad" prov="COMPUTED" sig={8} interp={<Tex tex={F.precAnalytic} />} />
              <Out label="Relative difference" value={Math.abs(p.numeric - p.analytic) / Math.abs(p.analytic)} prov="COMPUTED" interp="Agreement between the geodesic integration and the closed form (a verification of the solver)." />
            </div>
            <p class="small muted"><MathText text={T.tl_mercury} /></p>
          </div>
        );
      })()}
      <Level min="expert"><details><summary class="small">Raw server response</summary><Json data={res} /></details></Level>
      <div class="card" style={{ marginTop: '14px', background: 'var(--bg-sunk)' }}>
        <h3>Continue the investigation</h3>
        <p class="small muted">{implied ? 'Writes this design (masses, separations, time, material, geometry, temperature, pressure) into the shared working scenario and opens the next stage.' : 'This system has no laboratory design to transfer; the pages open with the current shared scenario.'}</p>
        <div class="row">
          <Btn kind="primary" onClick={() => cont('/suite/lab')}>Virtual Laboratory →</Btn>
          <Btn onClick={() => cont('/suite/falsification')}>Model discrimination →</Btn>
          <Btn onClick={() => cont('/suite/evidence#prereg')}>Preregistration →</Btn>
        </div>
      </div>
    </Card>
  );
}

function BmvResult({ res, implied }: { res: ThoughtResult; implied: { design: Design; env: Environment } | null }) {
  const p = res.prediction ?? {};
  const models = res.competing_models ?? [];
  const dec = res.decoherence;
  const curves = useMemo(() => {
    if (!implied || !p.design) return null;
    const T = implied.design.time;
    const t = Array.from({ length: 41 }, (_, i) => (T * i) / 40);
    // only hypotheses the local engine implements (the server may list more, e.g. CG-QFT-AH, CSL-COLL)
    const ids = models.map((m) => m.id).filter((id) => (ENGINE_IDS as readonly string[]).includes(id));
    try { return { t, c: modelCurves(implied.design, implied.env, ids, t) }; } catch { return null; }
  }, [res]);
  return (
    <div class="stack">
      {p.admissibility_issues?.length > 0 && <div class="error-box" role="alert"><strong>Inadmissible configuration:</strong> {p.admissibility_issues.join('; ')}</div>}
      <h3>Coherent prediction (QG-COH{typeof p.purity === 'number' && p.purity < 1 - 1e-12 ? ', including environmental decoherence' : ', without environmental decoherence'})</h3>
      <div class="outs">
        <Out label="Entangling phase Δφ" value={p.delta_phi_total_rad} unit="rad" prov="COMPUTED" interp={<MathText text={T.tl_dphi} />} />
        <Out label="Concurrence (ideal)" value={p.concurrence} prov="COMPUTED" interp={<>Pure-state value <Tex tex={F.sinBound} />; 0 = separable, 1 = maximal.</>} />
        <Out label="Negativity (ideal)" value={p.negativity} prov="COMPUTED" interp="N > 0 ⇔ entangled (two qubits)." />
        <Out label="CPK witness (ideal)" value={p.witness_cpk_local_corrected} prov="COMPUTED" tone={p.witness_cpk_local_corrected < 0 ? 'good' : null} interp="< 0 certifies entanglement with three local settings." />
      </div>
      <p class="small muted">{typeof p.purity === 'number' && p.purity < 1 - 1e-12
        ? <>This block is the server's <code>prediction</code> field, including the environmental decoherence budget; it agrees with the QG-COH row of the competing-model table below.</>
        : <>This block is the server's <code>prediction</code> field, evaluated without decoherence (older server). The competing-model table below includes the environmental decoherence budget, so its QG-COH row is the realistic value.</>}</p>
      {dec && (
        <div>
          <h3>Environmental decoherence (per mass)</h3>
          <div class="outs">
            <Out label="Total rate Γ" value={dec.total_rate} unit="s⁻¹" prov="COMPUTED" />
            <Out label="Γ t" value={dec.total_gamma_t} prov="COMPUTED" interp={<>Coherence factor <Tex tex={F.expGt} /> = {fmtNum(dec.coherence_factor, 4)}.</>} />
            <Out label="Dominant mechanism" value={String(dec.dominant ?? '—').replace(/_/g, ' ')} prov="COMPUTED" />
          </div>
        </div>
      )}
      {models.length > 0 && (
        <div>
          <h3>Competing hypotheses (with decoherence)</h3>
          <DataTable caption="Competing model predictions" head={['Hypothesis', 'Negativity', 'Concurrence', 'CPK witness', 'Purity', 'Coherence A']} numeric={[1, 2, 3, 4, 5]}
            rows={models.map((m) => [<span><span class="swatch" style={{ background: hypStyle(m.id).color }} /> {m.id}</span>, fmtNum(m.negativity, 4), fmtNum(m.concurrence, 4),
              <span>{fmtNum(m.witness_cpk, 4)} {m.witness_cpk < 0 ? <StatusBadge status="PASSED" /> : null}</span>, fmtNum(m.purity, 5), fmtNum(m.coherence_A, 5)])} />
          <BarChart name="thought-negativity" title="Negativity by hypothesis" desc="Entanglement negativity predicted by each hypothesis" xLabel="Negativity" unit="1"
            items={models.map((m) => ({ label: m.id, value: m.negativity, color: hypStyle(m.id).color }))} />
          <p class="small muted">Negativity is zero for every hypothesis in which gravity cannot entangle (or decoherence wins); the signed witness values are in the table.</p>
        </div>
      )}
      {curves && (
        <div>
          <div class="row-between"><h3 style={{ margin: 0 }}>Negativity versus interaction time</h3><ProvBadge kind="COMPUTED_LOCAL" /></div>
          <LinePlot name="thought-negativity-t" desc="Negativity of each hypothesis versus interaction time, computed by the local engine"
            series={Object.entries(curves.c).map(([id, v]) => ({ name: id, x: curves.t, y: v.negativity, color: hypStyle(id).color, dash: hypStyle(id).dash }))}
            xLabel="Interaction time" xUnit="s" yLabel="Negativity" />
          <LinePlot name="thought-witness-t" desc="CPK witness of each hypothesis versus interaction time, computed by the local engine"
            series={Object.entries(curves.c).map(([id, v]) => ({ name: id, x: curves.t, y: v.witness, color: hypStyle(id).color, dash: hypStyle(id).dash }))}
            xLabel="Interaction time" xUnit="s" yLabel="⟨W⟩" shadeBelow={{ y: 0, label: 'W < 0: entanglement certified', color: 'rgba(23,112,58,0.08)' }} />
          <p class="small muted">Curves computed in this browser by the offline engine (verified against the server by golden-vector tests); the endpoint values at t = T correspond to the server table above.</p>
        </div>
      )}
      {res.next_steps && <><h3>Suggested next steps</h3><ul class="tight small">{res.next_steps.map((s: string) => <li>{s}</li>)}</ul></>}
      <KV rows={[['Design (server)', p.design ? `m = ${fmtQ(p.design.mass_A, 'kg')}, R = ${fmtQ(p.design.radius_A, 'm')}, d = ${fmtQ(p.design.separation, 'm')}, Δx = ${fmtQ(p.design.dx_A, 'm')}, t = ${fmtQ(p.design.time, 's')}` : '—']]} />
    </div>
  );
}
