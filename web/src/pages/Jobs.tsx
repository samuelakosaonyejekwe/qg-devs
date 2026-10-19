/** Jobs & simulation history: server job queue, job details, the offline POST queue and data saved on this device. */
import { useEffect, useState } from 'preact/hooks';
import { apiGet, getJob, cancelJob, ApiError, type Job } from '../lib/api';
import { useRoute, navigate } from '../lib/router';
import { listQueue, removeQueued, replayQueue, onQueueChange, type QueuedRequest } from '../lib/queue';
import { idbAll, idbDelete } from '../lib/idb';
import { useStore, net } from '../lib/store';
import { Card, ErrorBox, Loading, StatusBadge, Progress, KV, Json, Btn, PageHead, ProvBadge } from '../components/ui';
import { fmtTime, fmtDuration } from '../lib/format';
import { sendQueuedRequest, downloadJSON } from './f5-shared';
import type { Scenario } from '../lib/types';

const ACTIVE = (j: Job) => j.status === 'queued' || j.status === 'running';

function dur(a: string | null, b: string | null): string {
  if (!a) return '—';
  const t0 = Date.parse(a), t1 = b ? Date.parse(b) : Date.now();
  return Number.isFinite(t0) && Number.isFinite(t1) ? fmtDuration((t1 - t0) / 1000) + (b ? '' : ' (so far)') : '—';
}

function JobTable({ selected }: { selected: string | null }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [err, setErr] = useState<ApiError | null>(null);
  const [ft, setFt] = useState('');
  const [fs, setFs] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    apiGet<{ jobs: Job[]; types: string[] }>('/api/jobs', { limit: 200 }, { noCache: true })
      .then((r) => { if (alive) { setJobs(r.data.jobs); setTypes(r.data.types); setErr(null); } })
      .catch((e) => alive && setErr(e));
    return () => { alive = false; };
  }, [tick]);
  const anyActive = !!jobs?.some(ACTIVE);
  useEffect(() => {
    if (!anyActive) return;
    const t = setTimeout(() => setTick((x) => x + 1), 3000);
    return () => clearTimeout(t);
  }, [anyActive, jobs]);
  const shown = (jobs ?? []).filter((j) => (!ft || j.type === ft) && (!fs || j.status === fs));
  return (
    <Card title="Server jobs" actions={<><span class="small muted">{anyActive ? 'Auto-refreshing every 3 s' : ''}</span><button type="button" class="btn-sm" onClick={() => setTick((x) => x + 1)}>Refresh</button></>}>
      <div class="row" style={{ marginBottom: '8px' }}>
        <label class="small">Type <select class="input" value={ft} onChange={(e: any) => setFt(e.currentTarget.value)}><option value="">all</option>{types.map((t) => <option value={t}>{t}</option>)}</select></label>
        <label class="small">Status <select class="input" value={fs} onChange={(e: any) => setFs(e.currentTarget.value)}><option value="">all</option>{['queued', 'running', 'succeeded', 'failed', 'cancelled'].map((s) => <option value={s}>{s}</option>)}</select></label>
        <span class="small muted">{jobs ? `${shown.length} of ${jobs.length} shown` : ''}</span>
      </div>
      <ErrorBox error={err} what="listing jobs (job history is only available from the server)" />
      {!jobs && !err && <Loading />}
      {jobs && (
        <div class="table-wrap">
          <table class="data">
            <caption class="sr-only">Server jobs</caption>
            <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Progress</th><th>Created</th><th>Duration</th><th class="num">Attempts</th><th>Message</th></tr></thead>
            <tbody>
              {shown.map((j) => (
                <tr class={j.id === selected ? 'hl' : ''}>
                  <td><a href={`/jobs?id=${j.id}`}><code>{j.id}</code></a></td>
                  <td>{j.type}</td>
                  <td><StatusBadge status={j.status} /></td>
                  <td style={{ minWidth: '90px' }}>{ACTIVE(j) ? <Progress value={j.progress} label={`job ${j.id} progress`} /> : j.progress != null ? `${Math.round(j.progress * 100)} %` : '—'}</td>
                  <td>{fmtTime(j.created)}</td>
                  <td>{dur(j.started, j.finished)}</td>
                  <td class="num">{j.attempts}</td>
                  <td class="small">{j.error ? <span style={{ color: 'var(--danger)' }}>error</span> : j.message}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={8} class="muted">No jobs match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function JobDetail({ id }: { id: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    getJob(id).then((j) => { if (alive) { setJob(j); setErr(null); } }).catch((e) => alive && setErr(e));
    return () => { alive = false; };
  }, [id, tick]);
  useEffect(() => {
    if (!job || !ACTIVE(job)) return;
    const t = setTimeout(() => setTick((x) => x + 1), 2000);
    return () => clearTimeout(t);
  }, [job]);
  return (
    <Card title={<h2>Job <code>{id}</code></h2>} actions={<button type="button" class="btn-sm" onClick={() => navigate('/jobs')}>Close</button>}>
      <ErrorBox error={err} what="loading the job" />
      {!job && !err && <Loading />}
      {job && (
        <div class="stack">
          <KV rows={[
            ['Type', job.type], ['Status', <StatusBadge status={job.status} />],
            ['Progress', job.progress != null ? `${Math.round(job.progress * 100)} %${job.message ? ` — ${job.message}` : ''}` : '—'],
            ['Created', fmtTime(job.created)], ['Started', fmtTime(job.started)], ['Finished', fmtTime(job.finished)],
            ['Run time', dur(job.started, job.finished)], ['Attempts', String(job.attempts)],
          ]} />
          {ACTIVE(job) && <div class="row"><Progress value={job.progress} label="job progress" /><Btn kind="danger" onClick={async () => { try { await cancelJob(id); setTick((x) => x + 1); } catch (e) { setErr(e); } }}>Cancel job</Btn></div>}
          {job.error && <div class="error-box" role="alert"><strong>Error</strong><pre class="code">{job.error}</pre></div>}
          <details><summary>Parameters</summary><Json data={job.params ?? {}} /></details>
          {job.status === 'succeeded' && job.result != null && (
            <div>
              <div class="row-between"><h3>Result <ProvBadge kind="COMPUTED" /></h3><button type="button" class="btn-sm" onClick={() => downloadJSON(job.result, `qgdevs-job-${id}.json`)}>Download JSON</button></div>
              <Json data={job.result} max={480} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function OfflineQueue() {
  const n = useStore(net);
  const [items, setItems] = useState<QueuedRequest[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => listQueue().then((q) => { setItems(q); setErr(null); }).catch((e) => { setErr(e); setItems([]); });
  useEffect(() => { load(); return onQueueChange(load); }, []);
  return (
    <section class="card" id="queue" aria-labelledby="queue-h">
      <div class="card-head"><h2 id="queue-h">Offline queue</h2>
        <div class="row">
          <Btn busy={busy} disabled={!n.online || !items?.some((q) => q.status !== 'sent')} onClick={async () => {
            setBusy(true); setMsg('');
            try { const r = await replayQueue(sendQueuedRequest); setMsg(`${r.sent} sent, ${r.failed} failed.`); } catch (e) { setErr(e); } finally { setBusy(false); load(); }
          }}>Retry all</Btn>
        </div>
      </div>
      <p class="small muted">Job submissions and preregistrations made while the server is unreachable are stored on this device (IndexedDB) and sent automatically when the connection returns. {n.online ? '' : 'You are offline: nothing can be sent now.'}</p>
      {msg && <p class="small" role="status">{msg}</p>}
      {err ? <ErrorBox error={err} what="reading the offline queue (IndexedDB may be unavailable in this browser mode)" /> : null}
      {items && items.length === 0 && <p class="muted">The queue is empty.</p>}
      {items && items.length > 0 && (
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Label</th><th>Endpoint</th><th>Created</th><th>Status</th><th class="num">Attempts</th><th>Error / response</th><th /></tr></thead>
            <tbody>{items.map((q) => (
              <tr>
                <td>{q.label}</td><td><code>POST {q.path}</code></td><td>{fmtTime(q.created)}</td><td><StatusBadge status={q.status} /></td><td class="num">{q.attempts}</td>
                <td class="small">{q.error ?? (q.response ? <code>{JSON.stringify(q.response).slice(0, 120)}</code> : '')}</td>
                <td><button type="button" class="btn-sm" onClick={() => removeQueued(q.id).then(load)} aria-label={`Remove ${q.label}`}>Remove</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface SavedProject { id: string; name: string; created: string; updated: string; scenario: Scenario; notes?: string }
interface SavedResult { id: string; kind: string; created: string; label: string; source: string; payload: unknown }

function Saved() {
  const [projects, setProjects] = useState<SavedProject[] | null>(null);
  const [results, setResults] = useState<SavedResult[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = () => {
    idbAll<SavedProject>('projects').then(setProjects).catch((e) => { setErr(e); setProjects([]); });
    idbAll<SavedResult>('results').then(setResults).catch((e) => { setErr(e); setResults([]); });
  };
  useEffect(load, []);
  return (
    <Card title="Saved on this device">
      <p class="small muted">Projects and results saved from the Experiment Builder and other pages live only in this browser (IndexedDB) and are not sent to the server.</p>
      {err ? <ErrorBox error={err} what="reading local storage" /> : null}
      <h3>Projects</h3>
      {projects && projects.length === 0 && <p class="muted">No saved projects. Save one from the <a href="/builder">Experiment Builder</a>.</p>}
      {projects && projects.length > 0 && (
        <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Updated</th><th>Design</th><th /></tr></thead><tbody>
          {projects.map((p) => (
            <tr><td>{p.name}</td><td>{fmtTime(p.updated)}</td>
              <td class="small">{p.scenario?.design ? `${p.scenario.design.geometry}, t = ${p.scenario.design.time} s, ${p.scenario.environment?.material}` : '—'}</td>
              <td class="row"><a class="btn-sm" href={`/builder?project=${encodeURIComponent(p.id)}`}>Open</a>
                <button type="button" class="btn-sm" onClick={() => downloadJSON(p, `qgdevs-project-${p.name.replace(/\W+/g, '_')}.json`)}>JSON</button>
                <button type="button" class="btn-sm" onClick={() => { if (confirm(`Delete project “${p.name}”?`)) idbDelete('projects', p.id).then(load); }}>Delete</button></td></tr>
          ))}
        </tbody></table></div>
      )}
      <h3 style={{ marginTop: '12px' }}>Results</h3>
      {results && results.length === 0 && <p class="muted">No saved results.</p>}
      {results && results.length > 0 && (
        <div class="table-wrap"><table class="data"><thead><tr><th>Label</th><th>Kind</th><th>Source</th><th>Saved</th><th /></tr></thead><tbody>
          {results.map((r) => (
            <tr><td>{r.label}</td><td>{r.kind}</td><td>{r.source === 'local' ? <ProvBadge kind="COMPUTED_LOCAL" /> : r.source === 'synthetic' ? <ProvBadge kind="SYNTHETIC" /> : <ProvBadge kind="COMPUTED" />}</td><td>{fmtTime(r.created)}</td>
              <td class="row"><button type="button" class="btn-sm" onClick={() => downloadJSON(r, `qgdevs-result-${r.id}.json`)}>JSON</button>
                <button type="button" class="btn-sm" onClick={() => { if (confirm(`Delete result “${r.label}”?`)) idbDelete('results', r.id).then(load); }}>Delete</button></td></tr>
          ))}
        </tbody></table></div>
      )}
    </Card>
  );
}

export default function Page(_props: any) {
  const r = useRoute();
  const id = new URLSearchParams(r.search).get('id');
  useEffect(() => {
    if (location.hash === '#queue') setTimeout(() => document.getElementById('queue')?.scrollIntoView(), 50);
  }, []);
  return (
    <div class="stack">
      <PageHead title="Jobs & simulation history" sub="Durable server jobs (they keep running when this device is off), the offline request queue of this device, and projects/results saved locally." />
      {id && <JobDetail id={id} />}
      <JobTable selected={id} />
      <OfflineQueue />
      <Saved />
    </div>
  );
}
