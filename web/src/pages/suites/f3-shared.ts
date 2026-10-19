/** Helpers shared by suite pages 12–16. */
import { num } from '../../lib/api';

export function logspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  const la = Math.log10(a), lb = Math.log10(b);
  return Array.from({ length: n }, (_, i) => 10 ** (la + ((lb - la) * i) / (n - 1)));
}
export function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a];
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? b : a + ((b - a) * i) / (n - 1)));
}

/** Units for the sweepable design parameters (qgdevs.design sweep_2d / api allowed set). */
export const SWEEP_PARAMS: { v: 'separation' | 'dx_A' | 'mass_A' | 'time'; label: string; unit: string; min: number; max: number }[] = [
  { v: 'separation', label: 'Centre separation d', unit: 'm', min: 1e-9, max: 10 },
  { v: 'dx_A', label: 'Branch separation Δx (both masses)', unit: 'm', min: 0, max: 10 },
  { v: 'mass_A', label: 'Mass (both masses)', unit: 'kg', min: 1e-27, max: 1e3 },
  { v: 'time', label: 'Interaction time t', unit: 's', min: 1e-9, max: 1e4 },
];
export const paramInfo = (p: string) => SWEEP_PARAMS.find((x) => x.v === p) ?? { v: p, label: p, unit: '', min: 0, max: Infinity };

/** Convert an API matrix with null for inadmissible cells. */
export function nullableMatrix(z: unknown): (number | null)[][] {
  return (z as unknown[][]).map((r) => r.map((v) => (v == null ? null : num(v))));
}

export function relDiff(a: number, b: number): number {
  const d = Math.abs(a - b);
  const s = Math.max(Math.abs(a), Math.abs(b));
  return s === 0 ? 0 : d / s;
}
