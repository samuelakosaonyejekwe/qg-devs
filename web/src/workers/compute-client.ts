/** Runs the local 2-D sweep across N module workers; rows of the grid are dealt round-robin. */
import type { Design, Environment } from '../lib/types';
import type { SweepJob, WorkerMsg } from './compute.worker';

export interface SweepSpec { design: Design; environment: Environment; px: keyof Design; xs: number[]; py: keyof Design; ys: number[]; hypothesis: string; workers: number; timeLimitS: number }
export interface SweepState { negativity: (number | null | undefined)[][]; witness: (number | null | undefined)[][]; done: number; total: number; finished: boolean; reason?: string; elapsedMs?: number; error?: string }

export function runLocalSweep(spec: SweepSpec, onUpdate: (s: SweepState) => void): { stop: () => void } {
  const nW = Math.max(1, spec.workers);
  const st: SweepState = {
    negativity: spec.ys.map(() => spec.xs.map(() => undefined)), witness: spec.ys.map(() => spec.xs.map(() => undefined)),
    done: 0, total: spec.xs.length * spec.ys.length, finished: false,
  };
  const deadline = Date.now() + spec.timeLimitS * 1000;
  const t0 = performance.now();
  const ws: Worker[] = [];
  const doneCount = new Array(nW).fill(0);
  let finishedWorkers = 0;
  const reasons: string[] = [];
  const finish = (reason: string) => {
    if (st.finished) return;
    st.finished = true; st.reason = reason; st.elapsedMs = performance.now() - t0;
    ws.forEach((w) => w.terminate());
    onUpdate({ ...st });
  };
  // hard stop if a worker ignores the deadline (e.g. a single very slow cell)
  const guard = setTimeout(() => finish('time-limit'), spec.timeLimitS * 1000 + 2000);
  for (let k = 0; k < nW; k++) {
    const rows = spec.ys.map((_, i) => i).filter((i) => i % nW === k);
    if (!rows.length) { finishedWorkers++; continue; }
    const w = new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });
    ws.push(w);
    w.onmessage = (e: MessageEvent<WorkerMsg>) => {
      const m = e.data;
      if (m.type === 'row') { st.negativity[m.i] = m.negativity; st.witness[m.i] = m.witness; }
      else if (m.type === 'progress') { doneCount[k] = m.done; st.done = doneCount.reduce((a, b) => a + b, 0); onUpdate({ ...st }); }
      else if (m.type === 'error') { st.error = m.message; clearTimeout(guard); finish('error'); }
      else if (m.type === 'done') { reasons.push(m.reason); finishedWorkers++; if (finishedWorkers >= nW) { clearTimeout(guard); finish(reasons.find((r) => r !== 'complete') ?? 'complete'); } }
    };
    w.onerror = (e) => { st.error = e.message || 'worker failed to start'; clearTimeout(guard); finish('error'); };
    const job: SweepJob = { type: 'start', design: spec.design, environment: spec.environment, px: spec.px, xs: spec.xs, py: spec.py, ys: spec.ys, rows, hypothesis: spec.hypothesis, deadline };
    w.postMessage(job);
  }
  if (finishedWorkers >= nW) { clearTimeout(guard); finish('complete'); }
  return { stop: () => { ws.forEach((w) => w.postMessage({ type: 'stop' })); setTimeout(() => { clearTimeout(guard); finish('stopped'); }, 300); } };
}
