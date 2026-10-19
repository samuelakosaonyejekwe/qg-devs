import type { ComponentType } from 'preact';
import { SUITES, suiteBySlug } from './lib/nav';

type Loader = () => Promise<{ default: ComponentType<any> }>;
export interface RouteDef { title: string; load: Loader; crumbs: [string, string | null][]; props?: Record<string, unknown> }

// One dynamic import per page so every suite is its own chunk.
const SUITE_LOADERS: Record<string, Loader> = {
  quantum: () => import('./pages/suites/S01Quantum'),
  gravity: () => import('./pages/suites/S02Gravity'),
  'qg-eft': () => import('./pages/suites/S03Eft'),
  entanglement: () => import('./pages/Flagship'),
  interferometry: () => import('./pages/suites/S05Interferometry'),
  optomechanics: () => import('./pages/suites/S06Optomech'),
  decoherence: () => import('./pages/suites/S07Decoherence'),
  environment: () => import('./pages/suites/S08Environment'),
  lab: () => import('./pages/suites/S09Lab'),
  signal: () => import('./pages/suites/S10Signal'),
  inference: () => import('./pages/suites/S11Inference'),
  falsification: () => import('./pages/suites/S12Models'),
  design: () => import('./pages/suites/S13Design'),
  discovery: () => import('./pages/suites/S14Discovery'),
  hpc: () => import('./pages/suites/S15Hpc'),
  verification: () => import('./pages/suites/S16Verification'),
  data: () => import('./pages/suites/S17Data'),
  evidence: () => import('./pages/suites/S18Evidence'),
};

const PAGES: Record<string, RouteDef> = {
  '/': { title: 'Dashboard', load: () => import('./pages/Dashboard'), crumbs: [['Dashboard', null]] },
  '/thought-lab': { title: 'Thought-Experiment Lab', load: () => import('./pages/ThoughtLab'), crumbs: [['Dashboard', '/'], ['Thought-Experiment Lab', null]] },
  '/builder': { title: 'Experiment Builder', load: () => import('./pages/Flagship'), crumbs: [['Dashboard', '/'], ['Experiment Builder', null]], props: { variant: 'builder' } },
  '/jobs': { title: 'Jobs & simulation history', load: () => import('./pages/Jobs'), crumbs: [['Dashboard', '/'], ['Jobs & history', null]] },
  '/health': { title: 'System health', load: () => import('./pages/Health'), crumbs: [['Dashboard', '/'], ['System health', null]] },
  '/settings': { title: 'Settings', load: () => import('./pages/Settings'), crumbs: [['Dashboard', '/'], ['Settings', null]] },
  '/help': { title: 'Help & tutorials', load: () => import('./pages/Help'), crumbs: [['Dashboard', '/'], ['Help & tutorials', null]] },
};

export function resolve(path: string): RouteDef | null {
  const p = path.replace(/\/+$/, '') || '/';
  if (PAGES[p]) return PAGES[p];
  const m = /^\/suite\/([a-z0-9-]+)$/.exec(p);
  if (m && SUITE_LOADERS[m[1]]) {
    const s = suiteBySlug(m[1])!;
    return { title: `Suite ${s.n} · ${s.short}`, load: SUITE_LOADERS[m[1]], crumbs: [['Dashboard', '/'], ['Suites', '/#suites'], [`${s.n}. ${s.short}`, null]], props: { suite: s.n, variant: 'suite' } };
  }
  return null;
}

export const ALL_PATHS = [...Object.keys(PAGES), ...SUITES.map((s) => `/suite/${s.slug}`)];
