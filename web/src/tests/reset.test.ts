/**
 * Every page that runs an analysis must offer Reset next to its Run action (RunBar, or JobRunner which
 * renders a RunBar), and the reset machinery must be wired into the app shell.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isSavedInputKey } from '../lib/resetAll';

const SRC = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
function pages(dir = 'pages'): string[] {
  return fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? pages(path.join(dir, e.name)) : e.name.endsWith('.tsx') ? [path.join(dir, e.name)] : []);
}
// A page "runs" something if it calls a compute/state-changing API, submits jobs, or starts a worker.
const RUN_ACTION = /\bapiPost(Blob)?\s*[<(]|\bapiUpload\s*[<(]|\bsubmitJob\s*\(|<JobRunner\b|runLocalSweep\s*\(/;
// Pages that compute without any user Run control (read-only snapshot of the shared scenario).
const NO_RUN_CONTROL = [path.join('pages', 'Dashboard.tsx')];
// Primary buttons that are not analysis runs (navigation / preference saving).
const ALLOWED_PRIMARY = [/Virtual Laboratory →/, /settings\.set\(\{ apiBase/];

describe('Reset next to every Run', () => {
  const files = pages();
  const runners = files.filter((f) => RUN_ACTION.test(read(f)));
  it('finds the analysis pages', () => {
    // sanity: the flagship, the thought lab and most suites run computations
    expect(runners).toContain(path.join('pages', 'Flagship.tsx'));
    expect(runners).toContain(path.join('pages', 'ThoughtLab.tsx'));
    expect(runners.filter((f) => f.includes('suites')).length).toBeGreaterThanOrEqual(14);
  });
  for (const f of files) {
    const s = read(f);
    if (!RUN_ACTION.test(s)) continue;
    if (NO_RUN_CONTROL.includes(f)) {
      it(`${f} has no Run control at all (so it needs no Reset)`, () => {
        expect(/<RunBar\b|<JobRunner\b|kind="primary"|data-run/.test(s)).toBe(false);
      });
      continue;
    }
    it(`${f} renders RunBar or JobRunner (both include Reset)`, () => {
      expect(/<RunBar\b|<JobRunner\b/.test(s)).toBe(true);
    });
    it(`${f} has no primary run button without Reset`, () => {
      const prim = s.match(/<Btn kind="primary"[^]*?<\/Btn>/g) ?? [];
      const bad = prim.filter((b) => !ALLOWED_PRIMARY.some((re) => re.test(b)));
      expect(bad).toEqual([]);
    });
  }
  it('pages that edit the shared scenario offer the scenario reset option', () => {
    for (const f of files) {
      const s = read(f);
      if (!s.includes('<ScenarioForm')) continue;
      if (!/<RunBar\b/.test(s)) continue;
      expect(/<RunBar[^>]*\bscenario\b/.test(s), f).toBe(true);
    }
  });
});

describe('reset infrastructure', () => {
  it('App wraps every routed page in a ResetScope keyed by route', () => {
    expect(read('App.tsx')).toMatch(/<ResetScope key=\{r\.path\}>\s*<Comp/);
  });
  it('JobRunner uses RunBar and forgets its remembered job on reset', () => {
    const s = read('components/JobRunner.tsx');
    expect(s).toMatch(/<RunBar\b/);
    expect(s).toMatch(/useResetKey\(lastKey\(key\)\)/);
  });
  it('Reset asks for confirmation when results are shown or jobs are running, and can cancel running jobs', () => {
    const s = read('components/Reset.tsx');
    expect(s).toMatch(/ctx\?\.hasResults\(\) \|\| \(ctx\?\.running\(\)\.length \?\? 0\) > 0/);
    expect(s).toMatch(/data-reset-cancel-jobs/);
    expect(s).toMatch(/aria-labelledby="reset-dlg-title"/);
    expect(s).toMatch(/Reset shared scenario to defaults/);
    expect(read('components/JobRunner.tsx')).toMatch(/useRunningJob\(/);
  });
  it('a reset page behaves exactly like a first visit (default computations are not suppressed)', () => {
    expect(read('components/Reset.tsx')).toMatch(/export function useAfterReset\(\): boolean \{[\s\S]*?return false;/);
  });
  it('Settings offers a global reset of saved inputs', () => {
    expect(read('pages/Settings.tsx')).toMatch(/resetAllSavedInputs\(\)/);
  });
});

describe('isSavedInputKey', () => {
  it('selects inputs and bindings, never preferences', () => {
    expect(isSavedInputKey('qg.scenario')).toBe(true);
    expect(isSavedInputKey('qg.lastJob.discrimination_matrix')).toBe(true);
    expect(isSavedInputKey('qg.lastPrereg')).toBe(true);
    expect(isSavedInputKey('qg.lastDataset')).toBe(true);
    expect(isSavedInputKey('qg.settings')).toBe(false);
    expect(isSavedInputKey('qg.theme')).toBe(false);
    expect(isSavedInputKey('qg.lastSeenVersion')).toBe(false);
    expect(isSavedInputKey('qg.maxIdx')).toBe(false);
  });
});

describe('page-scoped default scenario (Reset this page)', async () => {
  const { scenario } = await import('../lib/store');
  const { DEFAULT_DESIGN, DEFAULT_ENV } = await import('../lib/types');
  it('override shows defaults without changing the shared scenario; first edit writes through', () => {
    scenario.set({ design: { ...DEFAULT_DESIGN, mass_A: 2e-14, mass_B: 2e-14 }, environment: { ...DEFAULT_ENV } });
    scenario.override({ design: { ...DEFAULT_DESIGN }, environment: { ...DEFAULT_ENV } });
    expect(scenario.get().design.mass_A).toBe(DEFAULT_DESIGN.mass_A);
    expect(scenario.hasOverride()).toBe(true);
    scenario.override(null); // leaving the page
    expect(scenario.get().design.mass_A).toBe(2e-14); // other suites still see the shared value
    scenario.override({ design: { ...DEFAULT_DESIGN }, environment: { ...DEFAULT_ENV } });
    scenario.set((s) => ({ ...s, design: { ...s.design, time: 3 } })); // first edit on the reset page
    expect(scenario.hasOverride()).toBe(false);
    expect(scenario.get().design.time).toBe(3);
    expect(scenario.get().design.mass_A).toBe(DEFAULT_DESIGN.mass_A); // edit applied on top of the page defaults
  });
  it('subscribers are notified when an override is applied or dropped', () => {
    const seen: number[] = [];
    const un = scenario.subscribe((v) => seen.push(v.design.time));
    scenario.override({ design: { ...DEFAULT_DESIGN, time: 7 }, environment: { ...DEFAULT_ENV } });
    scenario.override(null);
    un();
    expect(seen).toEqual([7, 3]);
  });
});
