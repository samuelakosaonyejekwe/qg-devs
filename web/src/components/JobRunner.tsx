/** Submit a durable server job, poll its progress, allow cancellation and render its result. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { submitJob, pollJob, cancelJob, getJob, ApiError, isOfflineError, type Job } from '../lib/api';
import { enqueue } from '../lib/queue';
import { ErrorBox, Progress, StatusBadge, InfoBanner } from './ui';
import { RunBar, useResetKey, useResultFlag, useRunningJob } from './Reset';
import { fmtTime } from '../lib/format';

function lastKey(k: string) { return `qg.lastJob.${k}`; }
function loadLast(k: string): string | null { try { return localStorage.getItem(lastKey(k)); } catch { return null; } }
function saveLast(k: string, id: string) { try { localStorage.setItem(lastKey(k), id); } catch { /* ignore */ } }

export function JobRunner({ type, params, label, storeKey, children, disabled, note, scenario: usesScenario }: {
  type: string; params: () => Record<string, unknown>; label: string; storeKey?: string; disabled?: boolean; note?: ComponentChildren; scenario?: boolean;
  children: (result: any, job: Job) => ComponentChildren;
}) {
  const key = storeKey ?? type;
  const [jobId, setJobId] = useState<string | null>(() => loadLast(key));
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const retryTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const attempt = useRef(0);
  useEffect(() => () => { if (retryTimer.current) clearInterval(retryTimer.current); }, []);
  useResetKey(lastKey(key));
  useResultFlag(!!job && job.status === 'succeeded');

  useEffect(() => {
    if (!jobId) return;
    setErr(null);
    return pollJob(jobId, (j) => setJob(j), (e) => setErr(e));
  }, [jobId]);

  const submit = async (isRetry = false) => {
    if (retryTimer.current) { clearInterval(retryTimer.current); retryTimer.current = null; }
    setRetryIn(null);
    if (!isRetry) attempt.current = 0;
    setBusy(true); setErr(null); setQueued(null);
    const p = params();
    try {
      const r = await submitJob(type, p);
      saveLast(key, r.id);
      setJob(null);
      setJobId(r.id);
    } catch (e) {
      if (isOfflineError(e)) {
        try {
          await enqueue('/api/jobs', JSON.stringify({ type, params: p }), `${label} (${type})`);
          setQueued('The server is unreachable, so this job was queued on this device and will be submitted automatically when the connection returns (see Jobs → Offline queue).');
        } catch (qe) { setErr(qe); }
      } else {
        setErr(e);
        // server busy (queue full): retry automatically with exponential backoff, up to 4 attempts
        if (e instanceof ApiError && e.status === 503 && attempt.current < 4) {
          let left = 5 * 2 ** attempt.current;
          attempt.current++;
          setRetryIn(left);
          retryTimer.current = setInterval(() => {
            left -= 1;
            if (left <= 0) { clearInterval(retryTimer.current!); retryTimer.current = null; submit(true); } else setRetryIn(left);
          }, 1000);
        }
      }
    } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!jobId) return;
    try { await cancelJob(jobId); setJob(await getJob(jobId)); } catch (e) { setErr(e); }
  };
  const running = job && (job.status === 'queued' || job.status === 'running');
  useRunningJob(jobId, !!running, () => (jobId ? cancelJob(jobId) : Promise.resolve()));
  return (
    <div class="stack">
      <div class="row">
        <RunBar label={label} busy={busy} disabled={disabled || !!running} onRun={() => submit()} scenario={usesScenario} onCancel={running ? cancel : undefined} cancelLabel="Cancel job">
          {jobId && <span class="small muted">Job <code>{jobId}</code> {job && <StatusBadge status={job.status} />}</span>}
        </RunBar>
      </div>
      {note && <div class="small muted">{note}</div>}
      {queued && <InfoBanner>{queued}</InfoBanner>}
      {running && (
        <div>
          <Progress value={job!.progress} label={`${type} progress`} />
          <div class="small muted" aria-live="polite">{job!.status === 'queued' ? 'Waiting for a worker (the job queue runs in the server’s worker process)…' : `${Math.round((job!.progress ?? 0) * 100)} % — ${job!.message || 'running'}`}</div>
        </div>
      )}
      {job?.status === 'failed' && <div class="error-box" role="alert"><strong>Job failed.</strong><pre class="code">{job.error}</pre></div>}
      {job?.status === 'cancelled' && <div class="small muted">Job cancelled{job.finished ? ` at ${fmtTime(job.finished)}` : ''}.</div>}
      <ErrorBox error={err instanceof ApiError || err ? err : null} what={`submitting the ${label.toLowerCase()} job`} retryInS={retryIn} onRetry={() => submit(true)} />
      {job?.status === 'succeeded' && job.result != null && (
        <div>
          <div class="small muted">Finished {fmtTime(job.finished)} · result stored server-side ({job.type}).</div>
          {children(job.result, job)}
        </div>
      )}
    </div>
  );
}
