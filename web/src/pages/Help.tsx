import { APP_VERSION, openWhatsNew } from '../components/UpdateDialog';
/** Help & tutorials: suites, evidence ladder, gates, assurance and provenance legends, experiment categories, offline use. */
import { useSuites } from '../components/SuiteHeader';
import { SUITES_IN_ORDER as SUITES } from '../lib/nav';
import { AssuranceBadge, ASSURANCE_LIST, ProvBadge, MaturityBadge, PageHead, Card } from '../components/ui';

const SUITE_HELP: Record<number, { what: string; outputs: string; endpoints: string }> = {
  1: { what: 'Open-system quantum dynamics: Lindblad master equation for a user-defined Hamiltonian, jump operators and initial state.', outputs: 'Populations, purity and density-matrix checks versus time; Bloch-sphere trajectory for one qubit.', endpoints: 'POST /api/quantum/lindblad' },
  2: { what: 'Classical general-relativistic tests and Newtonian N-body integration.', outputs: 'Perihelion precession and light deflection (numeric vs analytic), N-body trajectories and energy drift.', endpoints: 'POST /api/gravity/orbit, POST /api/gravity/nbody' },
  3: { what: 'Low-energy quantum gravity: linearised (Newtonian-limit) operator potential and the one-loop EFT correction of Bjerrum-Bohr, Donoghue & Holstein.', outputs: 'Model registry entries (QG-COH, QG-EFT1) and the relative size of the one-loop quantum correction.', endpoints: 'GET /api/models (correction computed locally from the published formula)' },
  4: { what: 'Flagship: two masses in spatial superposition interacting gravitationally (Bose et al.; Marletto & Vedral).', outputs: 'Entangling phase Δφ, concurrence, negativity, CPK and PPT witnesses, decoherence budget, non-gravitational channels, competing-model predictions, time series, 3-D apparatus.', endpoints: 'POST /api/bmv/predict' },
  5: { what: 'Matter-wave interferometry: closed-loop Stern–Gerlach trajectories and 2-D split-step wave-packet evolution.', outputs: 'SG phases and required magnetic gradient; animated probability density.', endpoints: 'POST /api/interferometry/sg, POST /api/interferometry/wavepacket2d' },
  6: { what: 'Gravitationally coupled mechanical oscillators in Gaussian states.', outputs: 'Logarithmic negativity versus time, coupling rate, bath occupation.', endpoints: 'POST /api/optomech/evolve' },
  7: { what: 'Environmental decoherence of one superposed mass: gas collisions, black-body scattering/absorption/emission, Diósi–Penrose collapse.', outputs: 'Rates, Γt and coherence factor per mechanism; dominant mechanism.', endpoints: 'POST /api/decoherence/budget' },
  8: { what: 'Electromagnetic confounders that can mimic gravitational entanglement.', outputs: 'Casimir–Polder, Coulomb and induced-dipole branch energies; gravity-dominance distance.', endpoints: 'POST /api/bmv/predict (nongrav_channels)' },
  9: { what: 'Virtual laboratory: a complete laboratory protocol and conceptual engineering specification derived from the design.', outputs: 'Protocol, bill of materials with statuses, tolerances, environmental requirements, readiness (TRL), safety, consistency check, STL/SVG/JSON exports.', endpoints: 'POST /api/lab/dossier, POST /api/lab/export/{fmt}, GET /api/instruments' },
  10: { what: 'Synthetic measurement records and estimators.', outputs: 'SYNTHETIC counts, witness estimate with bootstrap CI, tomography, injection–recovery efficiency.', endpoints: 'POST /api/signal/simulate, /api/signal/tomography, /api/signal/injection' },
  11: { what: 'Inverse problem: infer the gravitational coupling λ and nuisance parameters from counts.', outputs: 'Posterior samples and summaries, Bayes factor, Fisher information and Cramér–Rao bounds.', endpoints: 'inference job (POST /api/jobs)' },
  12: { what: 'Competing hypotheses for two-mass experiments and their robust discrimination.', outputs: 'Registry, predictions table, matrix of shots required (with explicit “indistinguishable” cells).', endpoints: 'GET /api/models, POST /api/falsification/predictions, discrimination_matrix job' },
  13: { what: 'Constrained design optimisation and parameter sweeps.', outputs: 'Ranked designs, 1-D sweeps of every hypothesis, 2-D heat maps of negativity and witness with inadmissible regions marked.', endpoints: 'design_optimise job, POST /api/bmv/sweep1d, POST /api/bmv/sweep2d' },
  14: { what: 'Automated discovery of scaling laws and a hypothesis ledger.', outputs: 'Dimensionally consistent power law with exponents and residuals; ledger entries with classification and novelty status.', endpoints: 'POST /api/discovery/scaling, GET /api/discovery/hypotheses, discovery_cycle / calibration_tradeoff jobs' },
  15: { what: 'Durable job queue, native C++ kernel and opt-in browser compute.', outputs: 'Job table with progress, kernel availability, local Web-Worker sweeps.', endpoints: 'GET /api/jobs, GET /api/health' },
  16: { what: 'Verification and validation: benchmark registry, latest results, machine-checked Lean theorems.', outputs: 'Pass/fail per benchmark with tolerances; proof status per theorem.', endpoints: 'GET /api/vv/registry, GET /api/vv/latest, GET /api/lean/status, vv_run job' },
  17: { what: 'Data management: public-source connectors, catalogue, upload validation, constants.', outputs: 'Catalogue with provenance and evidence scope, validation report, CODATA constants.', endpoints: 'GET /api/data/connectors, /api/data/catalogue, POST /api/data/validate, GET /api/constants, fetch_source job' },
  18: { what: 'Evidence management: hash-chained ledger, preregistration, blind vault, gates, evidence ladder, reproduction packages.', outputs: 'Ledger with chain verification, gate statuses, evidence classification, reproduction ZIP.', endpoints: 'GET /api/evidence/ledger, POST /api/evidence/{preregister,datasets,unblind,gates,signoff,package}' },
};

// Evidence ladder rungs: verbatim from qgdevs/evidence.py EVIDENCE_LADDER.
const LADDER = [
  'Hypothesis generated', 'Mathematically formulated', 'Numerically explored', 'Numerically verified within stated conditions',
  'Computationally independently reproduced', 'Experimentally testable', 'Experimental evidence obtained',
  'Independently experimentally replicated', 'Strongly supported within stated assumptions',
];

// Acceptance gates: names and criteria verbatim from qgdevs/evidence.py GATES.
const GATES: [string, string, string][] = [
  ['G1', 'Theory', 'Complete Hamiltonian/action, dynamics, assumptions; consistent known limits; independently reviewed derivation'],
  ['G2', 'Novel prediction', 'DOI-linked literature comparison; not a known restatement; reproduced by a second implementation'],
  ['G3', 'Solver assurance', 'State, conservation and convergence tests; tolerances justified in advance; applicable Lean proofs'],
  ['G4', 'Feasibility', 'Bill of materials, constraints, sensitivity and cost; experimental team confirms plausibility'],
  ['G5', 'Preregistration', 'Immutable code/config/data hashes, predicted distribution, blind analysis plan before unblinding'],
  ['G6', 'Experimental result', 'Instrument-native raw data, calibration, controls, telemetry; meets prespecified criteria'],
  ['G7', 'Replication', 'Independent lab data and code reproduce the conclusion under stated assumptions'],
];

const ASSURANCE_TEXT: Record<string, string> = {
  'FORMALLY VERIFIED': 'A machine-checked Lean 4 proof exists and its recorded status is exactly "proved". Shown for no other reason.',
  'NUMERICALLY VERIFIED': 'Registered numerical benchmarks pass within tolerances justified in advance.',
  'PARTIALLY VERIFIED': 'Only some required checks exist or pass (e.g. a proof with gaps, or partial benchmarks).',
  UNVERIFIED: 'No verification is recorded.',
  SPECULATIVE: 'The question lies outside the validated domain of every implemented model; no established result is claimed.',
  FAILED: 'A verification check failed; the result must not be relied on.',
};

const PROV_TEXT: [string, string][] = [
  ['COMPUTED', 'Calculated by the QG-DEVS server from the stated model and inputs.'],
  ['COMPUTED_LOCAL', 'Calculated in this browser by the offline engine, which is tested against the server reference values.'],
  ['SYNTHETIC', 'Data generated by a simulator from a model. Never a measurement.'],
  ['CALCULATED_REQUIREMENT', 'A requirement derived from the model (e.g. maximum pressure). Not a property of any built device.'],
  ['LITERATURE_REFERENCE', 'Taken from a cited publication.'],
  ['ESTIMATED', 'An order-of-magnitude estimate to be replaced by measurement.'],
  ['UNVERIFIED_ASSUMPTION', 'An assumption that has not been checked; dependent results are conditional.'],
  ['CACHED', 'Served from the offline cache with its cache time; may be out of date.'],
];

const TOC: [string, string][] = [
  ['suites', 'The 18 suites'], ['categories', 'Thought, computational, virtual and physical experiments'], ['ladder', 'Evidence ladder'],
  ['gates', 'Acceptance gates G1–G7'], ['assurance', 'Assurance statuses'], ['provenance', 'Provenance badges'], ['modes', 'Detail levels'],
  ['whatsnew', "What's new"], ['offline', 'Offline use and installation'], ['keys', 'Keyboard shortcuts'], ['tutorials', 'Tutorials'],
];

export default function Page(_props: any) {
  const r = useSuites();
  return (
    <div class="stack">
      <PageHead title="Help & tutorials" sub="How QG-DEVS works, what each result means and what it does not mean." />
      <nav class="card" aria-label="Contents"><h2>Contents</h2><ol class="tight">{TOC.map(([id, t]) => <li><a href={`#${id}`}>{t}</a></li>)}</ol></nav>

      <Card id="suites" title="The 18 suites">
        {r.error && <p class="small muted">Maturity and gaps are fetched from the server and are unavailable offline.</p>}
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>#</th><th>Suite</th><th>What it computes</th><th>Key outputs</th><th>Endpoints</th><th>Maturity / gaps</th></tr></thead>
            <tbody>{SUITES.map((s) => {
              const info = r.data?.find((x) => x.n === s.n);
              const h = SUITE_HELP[s.n];
              return (
                <tr><td>{s.n}</td><td><a href={`/suite/${s.slug}`}>{s.name}</a></td><td>{h.what}</td><td>{h.outputs}</td><td class="small"><code>{h.endpoints}</code></td>
                  <td>{info ? <><MaturityBadge m={info.maturity} /><div class="small muted">{info.gaps.join('; ') || 'no gaps declared'}</div></> : '—'}</td></tr>
              );
            })}</tbody>
          </table>
        </div>
      </Card>

      <Card id="categories" title="Thought, computational, virtual and physical experiments">
        <dl class="kv">
          <dt>Thought experiment (THEORETICAL)</dt><dd>A question posed in words. If no implemented model applies, it stays theoretical and no number is produced.</dd>
          <dt>Computational experiment</dt><dd>A deterministic calculation from an explicit model and inputs (e.g. the BMV prediction). It tells you what a model predicts, not what nature does.</dd>
          <dt>Virtual-laboratory experiment</dt><dd>A computational experiment that includes the apparatus: environment, decoherence, tolerances, readout errors and SYNTHETIC measurement records. Still not a measurement.</dd>
          <dt>Physical experiment</dt><dd>Real instrument data from a laboratory. No physical instrument is connected to this deployment; physical evidence requires a partner laboratory, preregistration, blind analysis and replication (gates G4–G7).</dd>
        </dl>
        <p>Completing the first three never constitutes physical evidence; every result page carries the banner “Computational prediction — not physical evidence” unless the backend classification states otherwise.</p>
      </Card>

      <Card id="ladder" title="Evidence ladder">
        <p class="small muted">Rungs are cumulative: a rung is granted only if every lower rung is. The current rung for a design is evaluated on the Evidence page (Suite 18).</p>
        <ol class="ladder">{LADDER.map((l) => <li>{l}</li>)}</ol>
      </Card>

      <Card id="gates" title="Acceptance gates G1–G7">
        <div class="table-wrap"><table class="data"><thead><tr><th>Gate</th><th>Name</th><th>Criterion</th></tr></thead>
          <tbody>{GATES.map(([g, n, c]) => <tr><td><b>{g}</b></td><td>{n}</td><td>{c}</td></tr>)}</tbody></table></div>
        <p class="small muted">Gates that need human review, physical data or independent replication cannot be passed by software alone.</p>
      </Card>

      <Card id="assurance" title="Assurance statuses">
        <ul class="clean">{ASSURANCE_LIST.map((a) => <li style={{ padding: '5px 0' }}><AssuranceBadge status={a} /> — {ASSURANCE_TEXT[a]}</li>)}</ul>
        <p class="small muted">Each status has its own colour, border style and symbol so it can be told apart without colour vision.</p>
      </Card>

      <Card id="provenance" title="Provenance badges">
        <ul class="clean">{PROV_TEXT.map(([k, t]) => <li style={{ padding: '5px 0' }}><ProvBadge kind={k} /> — {t}</li>)}</ul>
      </Card>

      <Card id="modes" title="Detail levels">
        <p><b>Beginner</b>, <b>Advanced</b> and <b>Expert</b> change only how many inputs and how much detail are shown. Calculations are identical at every level; hidden inputs keep their values and are always used. Change the level in the header or in <a href="/settings">Settings</a>.</p>
      </Card>

      <Card id="whatsnew" title="What's new">
        <p>You are running QG-DEVS version <b>{APP_VERSION}</b>. The release notes list highlights and fixes for every version; they are shown automatically once after an update.</p>
        <button type="button" class="btn" onClick={openWhatsNew}>Show what's new</button>
      </Card>
      <Card id="offline" title="Offline use and installation">
        <ul class="tight">
          <li>Use “Install app” in the header (or the browser menu: “Add to Home Screen” on iOS, “Install app” on Android, the install icon in the address bar on desktop).</li>
          <li>After a first visit, the app shell and all pages are cached and work offline.</li>
          <li>Server data shown offline comes from the cache and is labelled “cached at …”. The app never presents cached data as freshly fetched.</li>
          <li>The flagship prediction falls back to the local engine and is labelled <ProvBadge kind="COMPUTED_LOCAL" />.</li>
          <li>Job submissions and preregistrations made offline are queued on this device and sent when the connection returns (see <a href="/jobs#queue">Jobs → Offline queue</a>).</li>
        </ul>
      </Card>

      <Card id="keys" title="Keyboard shortcuts">
        <dl class="kv">
          <dt><kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>Alt</kbd>+<kbd>→</kbd></dt><dd>Back / forward in browser history (also the arrow buttons in the header).</dd>
          <dt><kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd></dt><dd>Move between controls; a visible focus ring shows where you are.</dd>
          <dt>Chart focused: <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd> <kbd>←↑→↓</kbd></dt><dd>Zoom in, zoom out, reset, pan. Ctrl+wheel zooms; double-click resets.</dd>
          <dt>Tabs: <kbd>←</kbd>/<kbd>→</kbd>, <kbd>Home</kbd>/<kbd>End</kbd></dt><dd>Switch tabs.</dd>
          <dt><kbd>Esc</kbd></dt><dd>Close tooltips and dialogs.</dd>
        </dl>
      </Card>

      <Card id="tutorials" title="Tutorials">
        <h3>1. Run your first BMV prediction</h3>
        <ol class="tight"><li>Open <a href="/suite/entanglement">Suite 4</a>. The reference design (Bose et al. 2017) is pre-filled.</li><li>Adjust mass, separation, branch separation and time; each input shows its unit, admissible range and an explanation (ⓘ).</li><li>Read Δφ, negativity and the CPK witness (⟨W⟩ &lt; 0 certifies entanglement), then the decoherence budget and its dominant mechanism.</li><li>Play the apparatus animation; the phase dial follows the computed Δφ(t).</li></ol>
        <h3>2. Compare hypotheses</h3>
        <ol class="tight"><li>On the flagship page, open “Competing hypotheses”: QG-COH, SC-MF, CC-KTM, DP-COLL and NULL-NG side by side.</li><li>Inspect negativity(t) and witness(t) curves; colours are the same for each hypothesis on every chart.</li><li>For how many shots are needed to tell them apart, run the discrimination matrix in <a href="/suite/falsification">Suite 12</a>.</li></ol>
        <h3>3. From thought experiment to preregistration</h3>
        <ol class="tight"><li>Describe the experiment in the <a href="/thought-lab">Thought-Experiment Lab</a> (the language model is OFF by default; the deterministic interpreter always works).</li><li>Review every quantity and its source badge, then approve and run.</li><li>Continue to the <a href="/suite/lab">Virtual Laboratory</a>, the <a href="/suite/falsification">discrimination matrix</a> and finally <a href="/suite/evidence">preregistration</a>.</li></ol>
        <h3>4. Design optimisation</h3>
        <ol class="tight"><li>Open <a href="/suite/design">Suite 13</a>, set bounds and submit a design_optimise job (it runs on the server and survives closing the browser).</li><li>Use the 2-D sweeps to see where the witness becomes negative; hatched cells are inadmissible designs.</li></ol>
        <h3>5. Working offline</h3>
        <ol class="tight"><li>Install the app and visit the pages you need once while online.</li><li>Offline, cached data shows its cache time; the flagship page computes locally; jobs are queued.</li><li>When back online, the queue is replayed automatically; check <a href="/jobs#queue">Jobs</a>.</li></ol>
      </Card>
    </div>
  );
}
