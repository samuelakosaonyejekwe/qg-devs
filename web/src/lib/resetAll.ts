import { scenario } from './store';
import { DEFAULT_DESIGN, DEFAULT_ENV } from './types';

/** localStorage keys that hold page inputs or result bindings (not preferences). */
export function isSavedInputKey(k: string): boolean {
  return k.startsWith('qg.lastJob.') || k === 'qg.lastPrereg' || k === 'qg.lastDataset' || k === 'qg.scenario';
}

/** Restore the shared scenario to defaults and forget every remembered job / preregistration / dataset binding. */
export function resetAllSavedInputs(): number {
  let n = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && isSavedInputKey(k)) keys.push(k); }
    for (const k of keys) { localStorage.removeItem(k); n++; }
  } catch { /* storage unavailable */ }
  scenario.set({ design: { ...DEFAULT_DESIGN }, environment: { ...DEFAULT_ENV } });
  return n;
}
