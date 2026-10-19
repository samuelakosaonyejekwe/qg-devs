/** Dashboard: mission, quick actions, live snapshot of the shared scenario, the 18 suites and system status. */
import { useEffect, useState } from 'preact/hooks';
import { apiPost, useApiGet, apiGet, isOfflineError, ApiError, type Job } from '../lib/api';
import { useStore, scenario } from '../lib/store';
import { SUITES_IN_ORDER, topicOf } from '../lib/nav';
import { useSuites } from '../components/SuiteHeader';
import { Card, Out, EvidenceBanner, ErrorBox, Loading, MaturityBadge, SourceChip, StatusBadge, ProvBadge } from '../components/ui';
import { fmtQ, fmtTime, humanKey } from '../lib/format';
import type { PredictResult } from '../lib/types';
import { predictScenario } from '../engine';

type Snap = { r: PredictResult; local: boolean } | { issues: string[] };

function Snapshot() {
  const sc = useStore(scenario);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setBusy(true); setErr(null);
    const t = setTimeout(async () => {
      try {
        const r = await apiPost<PredictResult | { admissibility_issues: string[] }>('/api/bmv/predict', sc, { n_times: 10 });
        if (!alive) return;
        if (!('negativity' in r)) setSnap({ issues: r.admissibility_issues }); else setSnap({ r, local: false });
      } catch (e) {
        if (!alive) return;
        if (isOfflineError(e)) {
          const r = predictScenario(sc.design, sc.environment, 10);
          if (!('negativity' in r)) setSnap({ issues: r.admissibility_issues }); else setSnap({ r, local: true });
        } else setErr(e);
      } finally { if (alive) setBusy(false); }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [sc]);
  const prov = snap && 'r' in snap && snap.local ? 'COMPUTED_LOCAL' : 'COMPUTED';
  return (
    <Card title="Live snapshot of the current scenario" actions={<a class="btn" href="/suite/entanglement">Open full prediction →</a>}>
      <p class="small muted">
        Design: m = {fmtQ(sc.design.mass_A, 'kg')}, d = {fmtQ(sc.design.separation, 'm')}, Δx = {fmtQ(sc.design.dx_A, 'm')}, t = {fmtQ(sc.design.time, 's')}, {sc.design.geometry}; {sc.environment.material}, P = {fmtQ(sc.environment.pressure, 'Pa')}, T_gas = {fmtQ(sc.environment.T_gas, 'K')}. Edit it in the <a href="/builder">Experiment Builder</a>.
      </p>
      {busy && !snap && <Loading label="Computing" />}
      <ErrorBox error={err} what="computing the snapshot" />
      {snap && 'issues' in snap && <div class="error-box" role="alert"><strong>Inadmissible design:</strong> {snap.issues.join('; ')}</div>}
      {snap && 'r' in snap && (
        <>
          <EvidenceBanner classification={snap.local ? 'COMPUTED LOCALLY (offline engine)' : null} />
          <div class="outs">
            <Out label="Entangling phase Δφ" value={snap.r.delta_phi_total_rad} unit="rad" prov={prov}
              interp={`Gravity alone: ${fmtQ(snap.r.delta_phi_gravity_rad, 'rad')}. Entanglement is maximal at Δφ = π.`} />
            <Out label="Negativity" value={snap.r.negativity} prov={prov} tone={snap.r.negativity > 0 ? 'good' : null}
              interp={snap.r.negativity > 0 ? 'N > 0: the predicted joint state is entangled (PPT criterion).' : 'N = 0: no entanglement predicted for this design.'} />
            <Out label="CPK witness ⟨W⟩" value={snap.r.witness_cpk_local_corrected} prov={prov} tone={snap.r.witness_cpk_local_corrected < 0 ? 'good' : 'bad'}
              interp={snap.r.witness_cpk_local_corrected < 0 ? '⟨W⟩ < 0 would certify entanglement with three settings (XX, YZ, ZY).' : '⟨W⟩ ≥ 0: this witness cannot certify entanglement here.'} />
            <Out label="Dominant decoherence" value={snap.r.decoherence.dominant ? humanKey(snap.r.decoherence.dominant) : '—'} prov={prov}
              interp={`Total rate per mass ${fmtQ(snap.r.decoherence.total_rate, 'Hz')} · Γt = ${fmtQ(snap.r.decoherence.total_gamma_t, '1', 3)}.`} />
          </div>
          {busy && <div class="small muted" role="status">Updating…</div>}
        </>
      )}
    </Card>
  );
}

function SuitesGrid() {
  const r = useSuites();
  return (
    <section id="suites" class="card" aria-labelledby="suites-h">
      <div class="card-head"><h2 id="suites-h">The 18 scientific suites</h2><SourceChip source={r.source === 'cache' ? 'cache' : null} cachedAt={r.cachedAt} /></div>
      {r.error && <p class="small muted">Maturity information is unavailable offline (no cached copy); navigation still works.</p>}
      <div class="grid-3" data-dashboard-suites>
        {SUITES_IN_ORDER.map((s) => {
          const n = s.n;
          const info = r.data?.find((x) => x.n === n);
          return (
            <a class="card suite-card" href={`/suite/${s.slug}`} style={{ marginTop: 0 }} data-suite-n={n}>
              <span class="n">Suite {n} <span class="muted" style={{ fontWeight: 400 }}>· {topicOf(n)}</span></span>
              <strong>{info?.name ?? s.name}</strong>
              <span class="row">{info ? <MaturityBadge m={info.maturity} /> : null}
                {info && <span class="small muted">{info.gaps.length ? `${info.gaps.length} documented gap${info.gaps.length > 1 ? 's' : ''}` : 'no open gaps declared'}</span>}</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function SystemStatus() {
  const h = useApiGet<any>('/api/health');
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [jerr, setJerr] = useState<ApiError | null>(null);
  useEffect(() => {
    apiGet<{ jobs: Job[] }>('/api/jobs', { limit: 5 }, { noCache: true }).then((r) => setJobs(r.data.jobs)).catch((e) => setJerr(e));
  }, []);
  return (
    <div class="grid-2">
      <Card title="System status" actions={<><SourceChip source={h.source} cachedAt={h.cachedAt} /><a class="btn-sm" href="/health">Details</a></>}>
        {h.loading && !h.data && <Loading />}
        <ErrorBox error={h.error} what="reading /api/health" />
        {h.data && (
          <dl class="kv">
            <dt>Status</dt><dd><StatusBadge status={h.data.status} /></dd>
            <dt>Version</dt><dd>{h.data.version}</dd>
            <dt>Jobs</dt><dd>{Object.entries(h.data.jobs ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'none'}</dd>
            <dt>Native C++ kernel</dt><dd>{h.data.native_kernel?.available ? <span class="badge b-ok">available</span> : <span class="badge b-neutral">unavailable</span>}</dd>
          </dl>
        )}
      </Card>
      <Card title="Recent jobs" actions={<a class="btn-sm" href="/jobs">All jobs</a>}>
        <ErrorBox error={jerr} what="listing jobs" />
        {!jobs && !jerr && <Loading />}
        {jobs && jobs.length === 0 && <p class="muted">No jobs yet.</p>}
        {jobs && jobs.length > 0 && (
          <ul class="clean">
            {jobs.map((j) => (
              <li style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <a href={`/jobs?id=${j.id}`}><code>{j.id}</code></a> {j.type} <StatusBadge status={j.status} /> <span class="small muted">{fmtTime(j.created)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default function Page(_props: any) {
  return (
    <div class="stack">
      <section class="hero">
        <h1>QG-DEVS</h1>
        <p><strong>Quantum Gravity Discovery and Experimental Verification System.</strong> A research instrument for computing model-dependent
          predictions of tabletop quantum-gravity experiments (gravity-mediated entanglement and its competitors), designing them in a virtual
          laboratory, quantifying how well competing gravity models can be discriminated, and managing preregistration and evidence with a
          hash-chained ledger. Every number shown is computed from stated models and inputs; <strong>no computation here constitutes physical evidence</strong> about the nature of gravity.</p>
        <div class="row">
          <a class="btn primary" href="/suite/entanglement">Run the flagship prediction</a>
          <a class="btn" href="/builder">Experiment Builder</a>
          <a class="btn" href="/thought-lab">Thought-Experiment Lab</a>
          <a class="btn" href="/suite/lab">Virtual Laboratory</a>
        </div>
      </section>
      <Snapshot />
      <SuitesGrid />
      <SystemStatus />
      <p class="small muted">Provenance badges such as <ProvBadge kind="COMPUTED" /> and <ProvBadge kind="SYNTHETIC" /> are explained in <a href="/help#provenance">Help</a>.</p>
    </div>
  );
}
