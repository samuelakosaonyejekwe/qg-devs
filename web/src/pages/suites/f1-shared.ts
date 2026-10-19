/** Small helpers shared by the Suite 1/2/3/5/6 pages. */
import { useState } from 'preact/hooks';

/** State for one explicit "Run" action that POSTs to the server. */
export function useRun<T>() {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const run = async (fn: () => Promise<T>) => {
    setBusy(true); setErr(null);
    try { const d = await fn(); setData(d); setAt(new Date().toISOString()); return d; }
    catch (e) { setErr(e); return null; }
    finally { setBusy(false); }
  };
  return { data, err, busy, at, run, setData };
}

/** Colour-blind-safe series colours (Okabe & Ito 2008), for bodies / curves that are not hypotheses. */
export const SERIES_COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#D55E00', '#56B4E9', '#F0E442', '#7f7f7f'];

export const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, k) => a + ((b - a) * k) / Math.max(1, n - 1));
export const logspace = (a: number, b: number, n: number) => linspace(Math.log10(a), Math.log10(b), n).map((e) => 10 ** e);

/** Run async tasks with at most `limit` in flight, reporting progress. */
export async function pool<T>(tasks: (() => Promise<T>)[], limit: number, onProgress: (done: number) => void): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const k = next++;
      out[k] = await tasks[k]();
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}
