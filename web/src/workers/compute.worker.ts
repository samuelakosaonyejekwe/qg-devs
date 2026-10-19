/// <reference lib="webworker" />
/**
 * Opt-in browser compute: a 2-D design sweep (negativity and CPK witness of one hypothesis) evaluated with the
 * local engine, mirroring qgdevs.design.sweep_2d: the swept values replace the design entries (mass_A → mass_B
 * and dx_A → dx_B as well), inadmissible geometries yield null, and the witness is taken in the protocol frame
 * fixed from the nominal gravitational local phases (engine predictionsTable). Nothing leaves the device.
 */
import { cell } from './compute-cell';
import type { Design, Environment } from '../lib/types';

export interface SweepJob {
  type: 'start'; design: Design; environment: Environment; px: keyof Design; xs: number[]; py: keyof Design; ys: number[];
  rows: number[]; // indices into ys handled by this worker
  hypothesis: string; deadline: number; // epoch ms after which the worker stops
}
export type WorkerMsg =
  | { type: 'progress'; done: number; total: number }
  | { type: 'row'; i: number; negativity: (number | null)[]; witness: (number | null)[] }
  | { type: 'done'; reason: 'complete' | 'stopped' | 'time-limit'; elapsedMs: number }
  | { type: 'error'; message: string };

let stop = false;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = async (e: MessageEvent<SweepJob | { type: 'stop' }>) => {
  const m = e.data;
  if (m.type === 'stop') { stop = true; return; }
  if (m.type !== 'start') return;
  stop = false;
  const t0 = performance.now();
  const total = m.rows.length * m.xs.length;
  let done = 0;
  try {
    for (const i of m.rows) {
      const neg: (number | null)[] = [], wit: (number | null)[] = [];
      for (const x of m.xs) {
        const [n, w] = cell(m.design, m.environment, m.px, x, m.py, m.ys[i], m.hypothesis);
        neg.push(n); wit.push(w); done++;
      }
      ctx.postMessage({ type: 'row', i, negativity: neg, witness: wit } satisfies WorkerMsg);
      ctx.postMessage({ type: 'progress', done, total } satisfies WorkerMsg);
      await new Promise((r) => setTimeout(r, 0)); // let a stop message in
      if (stop) { ctx.postMessage({ type: 'done', reason: 'stopped', elapsedMs: performance.now() - t0 } satisfies WorkerMsg); return; }
      if (Date.now() > m.deadline) { ctx.postMessage({ type: 'done', reason: 'time-limit', elapsedMs: performance.now() - t0 } satisfies WorkerMsg); return; }
    }
    ctx.postMessage({ type: 'done', reason: 'complete', elapsedMs: performance.now() - t0 } satisfies WorkerMsg);
  } catch (err) {
    ctx.postMessage({ type: 'error', message: String((err as Error)?.message ?? err) } satisfies WorkerMsg);
  }
};
