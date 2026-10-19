/** Number and SI-unit formatting. Values are always stored in SI; prefixes are display-only. */

const SUPER: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
export const sup = (s: string | number) => String(s).split('').map((c) => SUPER[c] ?? c).join('');

export const PREFIXES: [number, string][] = [
  [1e24, 'Y'], [1e21, 'Z'], [1e18, 'E'], [1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
  [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'], [1e-18, 'a'], [1e-21, 'z'], [1e-24, 'y'],
];

/** Units that accept SI prefixes. 'kg' is handled via grams. */
const PREFIXABLE = new Set(['m', 's', 'Pa', 'K', 'J', 'Hz', 'g', 'T', 'W', 'C', 'N', 'V', 'B', 'eV']);

/** Plain number: fixed for moderate magnitudes, ×10ⁿ otherwise. */
export function fmtNum(v: number | null | undefined, sig = 4): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '−∞';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e5) {
    const s = Number(v.toPrecision(sig)).toString();
    return s.replace('-', '−');
  }
  const e = Math.floor(Math.log10(a));
  let m = v / 10 ** e;
  if (Math.abs(Number(m.toPrecision(sig))) >= 10) { m /= 10; return `${Number(m.toPrecision(sig))} × 10${sup(e + 1)}`.replace(/^-/, '−'); }
  return `${Number(m.toPrecision(sig))} × 10${sup(e)}`.replace(/^-/, '−');
}

/** Pick a prefix so the mantissa is in [1, 1000). */
export function pickPrefix(v: number): [number, string] {
  const a = Math.abs(v);
  if (!Number.isFinite(a) || a === 0) return [1, ''];
  for (const p of PREFIXES) if (a >= p[0] * 0.9999999) return p;
  return PREFIXES[PREFIXES.length - 1];
}

/** Format a value with its unit, using an SI prefix where meaningful (kg → g-based prefixes). */
export function fmtQ(v: number | null | undefined, unit = '', sig = 4): string {
  if (v == null || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return `${fmtNum(v)}${unit && unit !== '1' ? ' ' + unit : ''}`;
  if (unit === 'kg') {
    if (Math.abs(v) >= 1) return `${fmtNum(v, sig)} kg`;
    return fmtQ(v * 1e3, 'g', sig);
  }
  if (PREFIXABLE.has(unit) && v !== 0) {
    const [f, p] = pickPrefix(v);
    const m = v / f;
    if (Math.abs(v) >= 1e-24 && Math.abs(v) < 1e27) return `${Number(m.toPrecision(sig)).toString().replace('-', '−')} ${p}${unit}`;
  }
  if (!unit || unit === '1') return fmtNum(v, sig);
  return `${fmtNum(v, sig)} ${unit}`;
}

export function fmtPct(v: number, digits = 1): string {
  return Number.isFinite(v) ? `${(v * 100).toFixed(digits)} %` : '—';
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDuration(s: number): string {
  if (!Number.isFinite(s)) return '∞';
  if (s < 60) return `${s.toPrecision(3)} s`;
  if (s < 3600) return `${(s / 60).toPrecision(3)} min`;
  if (s < 86400) return `${(s / 3600).toPrecision(3)} h`;
  if (s < 3.156e7) return `${(s / 86400).toPrecision(3)} d`;
  return `${(s / 3.156e7).toPrecision(3)} yr`;
}

/** Display units offered by numeric inputs: [label, factor to SI]. */
export const UNIT_CHOICES: Record<string, [string, number][]> = {
  kg: [['kg', 1], ['g', 1e-3], ['mg', 1e-6], ['µg', 1e-9], ['ng', 1e-12], ['pg', 1e-15], ['fg', 1e-18], ['ag', 1e-21]],
  m: [['m', 1], ['mm', 1e-3], ['µm', 1e-6], ['nm', 1e-9]],
  s: [['s', 1], ['ms', 1e-3], ['µs', 1e-6]],
  Pa: [['Pa', 1], ['mbar', 100], ['Torr', 133.322368]],
  K: [['K', 1], ['mK', 1e-3], ['µK', 1e-6]],
};

/** Choose the display unit so that the SI value shows as a convenient number. */
export function autoUnit(si: number, unit: string): [string, number] {
  const choices = UNIT_CHOICES[unit];
  if (!choices) return [unit, 1];
  if (unit === 'Pa' || unit === 'K') return [unit, 1];
  const a = Math.abs(si);
  if (!a) return choices[0];
  for (const c of choices) if (a >= c[1] * 0.9999999) return c;
  return choices[choices.length - 1];
}

export function shortHash(h: string | null | undefined, n = 12): string {
  return h ? h.slice(0, n) : '—';
}

export function humanKey(k: string): string {
  return k.replace(/^\d+_/, '').replace(/_/g, ' ').replace(/\b(Qg|Coh)\b/g, (s) => s.toUpperCase());
}
