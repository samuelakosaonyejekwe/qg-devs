import { useResultFlag } from '../../components/Reset';
/** Small helpers shared by suite pages 7–11. */
import { useCallback, useRef, useState } from 'preact/hooks';
import { isOfflineError, useApiGet } from '../../lib/api';
import { DataTable } from '../../components/ui';
import { fmtNum } from '../../lib/format';
import { IMPLEMENTED_IDS } from '../../lib/hyp';
import type { Scenario } from '../../lib/types';

export interface RunState<T> { data: T | null; error: unknown; busy: boolean; at: string | null; run: () => Promise<void>; offline: boolean }

/** Run an async request with busy/error state; keeps the last good result while re-running. */
export function useRun<T>(fn: () => Promise<T>): RunState<T> {
  const [st, setSt] = useState<{ data: T | null; error: unknown; busy: boolean; at: string | null }>({ data: null, error: null, busy: false, at: null });
  const ref = useRef(fn);
  ref.current = fn;
  const seq = useRef(0);
  const run = useCallback(async () => {
    const id = ++seq.current;
    setSt((s) => ({ ...s, busy: true, error: null }));
    try {
      const d = await ref.current();
      if (id === seq.current) setSt({ data: d, error: null, busy: false, at: new Date().toISOString() });
    } catch (e) {
      if (id === seq.current) setSt((s) => ({ ...s, error: e, busy: false }));
    }
  }, []);
  useResultFlag(st.data != null);
  return { ...st, run, offline: isOfflineError(st.error) };
}

/** JSON body for endpoints taking a ScenarioIn. */
export const body = (s: Scenario) => ({ design: s.design, environment: s.environment });

export const BRANCH_PAIRS = ['LL', 'LR', 'RL', 'RR'] as const;

/** Entangling combination of a per-branch quantity: X_LL + X_RR − X_LR − X_RL. */
export const entComb = (x: Record<string, number>) => x.LL + x.RR - x.LR - x.RL;

export function logspace(a: number, b: number, n: number): number[] {
  const la = Math.log10(a), lb = Math.log10(b);
  return Array.from({ length: n }, (_, i) => 10 ** (la + ((lb - la) * i) / (n - 1)));
}

export const MECH_LABEL: Record<string, string> = {
  gas_collisions: 'Gas collisions',
  blackbody_scattering: 'Black-body scattering',
  blackbody_absorption: 'Black-body absorption',
  blackbody_emission: 'Black-body emission',
  diosi_penrose_collapse: 'Diósi–Penrose collapse',
};
export const MECH_COLOR: Record<string, string> = {
  gas_collisions: '#0072B2',
  blackbody_scattering: '#E69F00',
  blackbody_absorption: '#D55E00',
  blackbody_emission: '#CC79A7',
  diosi_penrose_collapse: '#009E73',
};

export const PAULI_SETTINGS = ['XX', 'XY', 'XZ', 'YX', 'YY', 'YZ', 'ZX', 'ZY', 'ZZ'];

export interface SimRecord {
  data_label: string; generator: { model_id: string; seed: number; shots_per_setting: number; detector: Record<string, number>; config: unknown };
  assumptions: string[]; counts: Record<string, number[]>; outcome_order: string[]; sha256: string;
  witness_estimate?: { witness: number; stderr: number; bootstrap_ci95: [number, number]; z_score: number; p_value_one_sided: number; sign_variant: number; readout_correction_factor: number };
}

/** Correlator E = p(++) − p(+−) − p(−+) + p(−−) from raw counts (outcome order ++, +−, −+, −−). */
export const correlator = (n: number[]) => { const s = n.reduce((a, b) => a + b, 0); return s ? (n[0] - n[1] - n[2] + n[3]) / s : NaN; };

/** Implemented hypothesis ids from the live registry, falling back to the static list offline. */
export function useImplementedModels(): string[] {
  const r = useApiGet<{ id: string; implemented: boolean }[]>('/api/models');
  return r.data ? r.data.filter((m) => m.implemented).map((m) => m.id) : IMPLEMENTED_IDS;
}

export function CountsTable({ rec }: { rec: SimRecord }) {
  const order = rec.outcome_order;
  return (
    <DataTable caption="Synthetic outcome counts per setting" head={['Setting', ...order.map((o) => `n(${o})`), 'Total', 'Correlator E']} numeric={[1, 2, 3, 4, 5, 6]}
      rows={Object.entries(rec.counts).map(([s, n]) => [<code>{s}</code>, ...n.map(String), String(n.reduce((a, b) => a + b, 0)), fmtNum(correlator(n), 5)])} />
  );
}

