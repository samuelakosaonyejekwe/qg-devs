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

export const settings = createStore<Settings>({
  mode: 'beginner', theme: 'system', apiBase: '', apiToken: '', browserCompute: false,
  computeTimeLimitS: 20, computeMaxCells: 2500, reducedMotion: 'system',
}, 'qg.settings');

/** The working scenario shared by the flagship page, builder and all suite pages. */
export const scenario = createStore<Scenario>({ design: { ...DEFAULT_DESIGN }, environment: { ...DEFAULT_ENV } }, 'qg.scenario');

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
