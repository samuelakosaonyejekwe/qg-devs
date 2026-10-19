import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_DESIGN, DEFAULT_ENV, type Scenario } from './types';

type Listener<T> = (v: T) => void;

export interface Store<T> {
  get(): T;
  set(next: Partial<T> | ((prev: T) => T)): void;
  subscribe(fn: Listener<T>): () => void;
}

function safeLoad<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return typeof fallback === 'object' && fallback && !Array.isArray(fallback) ? { ...fallback, ...v } : v;
  } catch {
    return fallback;
  }
}

/** Minimal observable store; optionally persisted to localStorage (wrapped in try/catch). */
export function createStore<T extends object>(initial: T, persistKey?: string): Store<T> {
  let value: T = persistKey ? safeLoad(persistKey, initial) : initial;
  const listeners = new Set<Listener<T>>();
  return {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? (next as (p: T) => T)(value) : { ...value, ...next };
      if (persistKey) {
        try { localStorage.setItem(persistKey, JSON.stringify(value)); } catch { /* storage unavailable */ }
      }
      listeners.forEach((l) => l(value));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  const [v, setV] = useState(store.get());
  useEffect(() => {
    setV(store.get());
    return store.subscribe(setV);
  }, [store]);
  return v;
}

export type Mode = 'beginner' | 'advanced' | 'expert';
export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  mode: Mode;
  theme: Theme;
  apiBase: string; // '' = same origin (or VITE_API_BASE)
  apiToken: string; // optional bearer token for state-changing endpoints
  browserCompute: boolean; // opt-in Web Worker compute (off by default)
  computeTimeLimitS: number;
  computeMaxCells: number;
  reducedMotion: 'system' | 'on' | 'off';
}

const SETTINGS_DEFAULTS: Settings = {
  mode: 'beginner', theme: 'system', apiBase: '', apiToken: '', browserCompute: false,
  computeTimeLimitS: 20, computeMaxCells: 2500, reducedMotion: 'system',
};

/** Repair persisted settings (older versions, manual edits or corruption must never break the app). */
export function sanitizeSettings(v: Partial<Settings> & Record<string, unknown>): Settings {
  const d = SETTINGS_DEFAULTS;
  const pick = <T,>(x: unknown, ok: (y: unknown) => boolean, def: T): T => (ok(x) ? (x as T) : def);
  const num = (x: unknown, lo: number, hi: number, def: number) => (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : def);
  return {
    mode: pick(v.mode, (y) => y === 'beginner' || y === 'advanced' || y === 'expert', d.mode),
    theme: pick(v.theme, (y) => y === 'system' || y === 'light' || y === 'dark', d.theme),
    apiBase: pick(v.apiBase, (y) => typeof y === 'string', d.apiBase),
    apiToken: pick(v.apiToken, (y) => typeof y === 'string', d.apiToken),
    browserCompute: pick(v.browserCompute, (y) => typeof y === 'boolean', d.browserCompute),
    computeTimeLimitS: num(v.computeTimeLimitS, 1, 600, d.computeTimeLimitS),
    computeMaxCells: num(v.computeMaxCells, 100, 10000, d.computeMaxCells),
    reducedMotion: pick(v.reducedMotion, (y) => y === 'system' || y === 'on' || y === 'off', d.reducedMotion),
  };
}

export const settings = createStore<Settings>({
  mode: 'beginner', theme: 'system', apiBase: '', apiToken: '', browserCompute: false,
  computeTimeLimitS: 20, computeMaxCells: 2500, reducedMotion: 'system',
}, 'qg.settings');
settings.set(sanitizeSettings(settings.get() as Settings & Record<string, unknown>));

/** The working scenario shared by the flagship page, builder and all suite pages. */
const sharedScenario = createStore<Scenario>({ design: { ...DEFAULT_DESIGN }, environment: { ...DEFAULT_ENV } }, 'qg.scenario');

/**
 * The working scenario shared by all suites. A page Reset puts a page-scoped override in front of it
 * (the suite's default scenario) so the page looks exactly as on a first visit without touching other
 * suites; the first edit on that page writes through to the shared scenario, and leaving the page drops
 * the override.
 */
let scenarioOverride: Scenario | null = null;
const overrideListeners = new Set<(v: Scenario) => void>();
export const scenario: Store<Scenario> & { override(v: Scenario | null): void; hasOverride(): boolean } = {
  get: () => scenarioOverride ?? sharedScenario.get(),
  set(next) {
    const cur = scenarioOverride ?? sharedScenario.get();
    const v = typeof next === 'function' ? (next as (p: Scenario) => Scenario)(cur) : { ...cur, ...next };
    scenarioOverride = null;
    try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k?.startsWith('qg.pageDefaults:')) sessionStorage.removeItem(k); } } catch { /* ignore */ }
    sharedScenario.set(v);
  },
  subscribe(fn) {
    overrideListeners.add(fn);
    const un = sharedScenario.subscribe((v) => { if (!scenarioOverride) fn(v); });
    return () => { overrideListeners.delete(fn); un(); };
  },
  override(v) {
    scenarioOverride = v ? { design: { ...v.design }, environment: { ...v.environment } } : null;
    const cur = scenarioOverride ?? sharedScenario.get();
    overrideListeners.forEach((l) => l(cur));
  },
  hasOverride: () => scenarioOverride != null,
};

export const MODE_RANK: Record<Mode, number> = { beginner: 0, advanced: 1, expert: 2 };
export function atLeast(mode: Mode, level: Mode): boolean {
  return MODE_RANK[mode] >= MODE_RANK[level];
}

export function prefersReducedMotion(): boolean {
  const s = settings.get().reducedMotion;
  if (s === 'on') return true;
  if (s === 'off') return false;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Applies the theme to <html data-theme>; 'system' removes the attribute so CSS media queries decide. */
export function applyTheme(t: Theme) {
  const el = document.documentElement;
  if (t === 'system') delete el.dataset.theme; else el.dataset.theme = t;
  try { localStorage.setItem('qg.theme', t); } catch { /* ignore */ }
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1226' : '#1b1f4b');
}

export function isDarkTheme(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  try { return matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
}

/** Online/offline state as an observable. */
export const net = createStore<{ online: boolean }>({ online: typeof navigator === 'undefined' ? true : navigator.onLine });
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => net.set({ online: true }));
  window.addEventListener('offline', () => net.set({ online: false }));
}
