/**
 * Number entry and unit conversion for inputs.
 *
 * Conversions by powers of ten shift the decimal exponent of the value's shortest round-trip
 * representation instead of multiplying floats, so SI → display → SI is exact (450e-6 m ↔ "450" µm, never
 * 449.99999999999994). Non-decimal factors (Torr) multiply.
 */

/** Exact decimal shift: x · 10^k computed on the shortest decimal representation of x. */
export function shiftDecimal(x: number, k: number): number {
  if (!Number.isFinite(x) || x === 0 || k === 0) return x;
  const [m, e] = x.toExponential().split('e');
  return Number(`${m}e${Number(e) + k}`);
}

function pow10Exponent(f: number): number | null {
  if (!(f > 0)) return null;
  const k = Math.round(Math.log10(f));
  return Number(`1e${k}`) === f ? k : null;
}

/** SI value → value in a display unit whose SI factor is `factor`. */
export function toDisplay(si: number, factor: number): number {
  const k = pow10Exponent(factor);
  return k == null ? si / factor : shiftDecimal(si, -k);
}

/** Value in a display unit → SI. */
export function toSI(v: number, factor: number): number {
  const k = pow10Exponent(factor);
  return k == null ? v * factor : shiftDecimal(v, k);
}

const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };

export type Parsed = { ok: true; value: number } | { ok: false; error: string };

/**
 * Parse user input. Accepts 12, -0.5, .5, 1e-14, 1E+3, 1.5×10^-5, 1.5x10^-5, 1.5*10^-5, 1.5×10⁻⁵, 1.5 × 10 ^ -5,
 * the Unicode minus. Rejects empty input, commas (ambiguous: decimal or thousands separator), incomplete
 * exponents ("1e"), doubled signs, and anything else that is not a single number.
 */
export function parseNumber(text: string): Parsed {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Required.' };
  if (t.includes(',')) return { ok: false, error: 'Use “.” as the decimal separator (commas are ambiguous).' };
  let s = t.replace(/[−–]/g, '-').replace(/\s+/g, '');
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => `^${m.split('').map((c) => SUP[c]).join('')}`);
  const sci = /^([-+]?(?:\d+\.?\d*|\.\d+))(?:[×x*·]10\^?([-+]?\d+))$/i.exec(s);
  if (sci) s = `${sci[1]}e${sci[2]}`;
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(s)) {
    if (/e[-+]?$/i.test(s)) return { ok: false, error: 'Incomplete exponent (e.g. write 1e-6).' };
    return { ok: false, error: 'Not a number. Examples: 450, 2.5e-14, 1.5×10^-5.' };
  }
  const v = Number(s);
  if (!Number.isFinite(v)) return { ok: false, error: 'Number is too large.' };
  return { ok: true, value: v };
}

/** Text shown in an input for a value (shortest exact representation; exponent form outside 1e-3…1e6). */
export function fmtInput(v: number): string {
  if (!Number.isFinite(v)) return '';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) return String(v);
  return v.toExponential().replace('e+', 'e');
}
