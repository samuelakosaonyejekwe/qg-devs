/**
 * Chart renderers: line plots, heat maps and horizontal bar charts. Pure drawing functions over a Painter
 * so the same code produces the on-screen canvas, the 2–4× PNG export and the SVG export.
 * Axis ticks use SI prefixes (µm, ms, fJ …) or a common ×10ⁿ factor; values themselves are never altered.
 */
import { fmtNum, pickPrefix, sup, fmtQ } from '../lib/format';
import type { ChartTheme, Painter } from './painter';

// ----------------------------------------------------------------------------- scales & ticks
export interface Scale { d0: number; d1: number; r0: number; r1: number; log: boolean }
export function map(s: Scale, v: number): number {
  if (s.log) {
    if (!(v > 0)) return NaN;
    const a = Math.log10(s.d0), b = Math.log10(s.d1);
    return s.r0 + ((Math.log10(v) - a) / (b - a)) * (s.r1 - s.r0);
  }
  return s.r0 + ((v - s.d0) / (s.d1 - s.d0)) * (s.r1 - s.r0);
}
export function invert(s: Scale, p: number): number {
  const t = (p - s.r0) / (s.r1 - s.r0);
  if (s.log) { const a = Math.log10(s.d0), b = Math.log10(s.d1); return 10 ** (a + t * (b - a)); }
  return s.d0 + t * (s.d1 - s.d0);
}

export function niceStep(range: number, n: number): number {
  const raw = range / Math.max(1, n);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
export function linTicks(d0: number, d1: number, n: number): number[] {
  if (!(d1 > d0)) return [d0];
  const st = niceStep(d1 - d0, n);
  const out: number[] = [];
  for (let v = Math.ceil(d0 / st - 1e-9) * st; v <= d1 + st * 1e-9; v += st) out.push(Math.abs(v) < st * 1e-9 ? 0 : v);
  return out;
}
export function logTicks(d0: number, d1: number): { major: number[]; minor: number[] } {
  const a = Math.floor(Math.log10(d0)), b = Math.ceil(Math.log10(d1));
  const every = Math.max(1, Math.ceil((b - a) / 8));
  const major: number[] = [], minor: number[] = [];
  for (let e = a; e <= b; e++) {
    const v = 10 ** e;
    if (v >= d0 * 0.999 && v <= d1 * 1.001 && (e - a) % every === 0) major.push(v);
    if (every === 1) for (let k = 2; k < 10; k++) { const m = k * v; if (m > d0 && m < d1) minor.push(m); }
  }
  return { major, minor };
}

const PREFIX_UNITS = new Set(['m', 's', 'Pa', 'K', 'J', 'Hz', 'g', 'T', 'W', 'C', 'N', 'V']);

/** Axis label suffix and tick formatter for a domain + unit. */
export function axisFormat(d0: number, d1: number, unit: string | undefined, log: boolean, step?: number): { unitLabel: string; fmt: (v: number) => string } {
  const u = unit ?? '';
  if (log) {
    return { unitLabel: u && u !== '1' ? u : '', fmt: (v) => { const e = Math.log10(v); return Math.abs(e - Math.round(e)) < 1e-9 ? `10${sup(Math.round(e))}` : fmtNum(v, 2); } };
  }
  const m = Math.max(Math.abs(d0), Math.abs(d1));
  let factor = 1, label = u && u !== '1' ? u : '';
  if (u === 'kg' && m > 0 && m < 1) { const [f, p] = pickPrefix(m * 1e3); factor = f / 1e3; label = `${p}g`; }
  else if (PREFIX_UNITS.has(u) && m > 0) { const [f, p] = pickPrefix(m); factor = f; label = `${p}${u}`; }
  else if (m > 0 && (m >= 1e5 || m < 1e-2)) { const e = Math.floor(Math.log10(m)); factor = 10 ** e; label = `×10${sup(e)}${label ? ' ' + label : ''}`; }
  const st = (step ?? (d1 - d0) / 5) / factor;
  const dec = Math.max(0, Math.min(8, -Math.floor(Math.log10(Math.abs(st) || 1) + 1e-9)));
  return { unitLabel: label, fmt: (v) => { const x = v / factor; return (Math.abs(x) < 1e-12 * Math.abs(st || 1) ? 0 : x).toFixed(dec).replace('-', '−'); } };
}

export interface Rect { x: number; y: number; w: number; h: number }

function drawAxes(p: Painter, th: ChartTheme, plot: Rect, xs: Scale, ys: Scale, xLabel: string, xUnit: string | undefined, yLabel: string, yUnit: string | undefined, fs: number) {
  // grid + ticks: x
  const xt = xs.log ? logTicks(xs.d0, xs.d1) : { major: linTicks(xs.d0, xs.d1, Math.max(2, Math.floor(plot.w / 80))), minor: [] };
  const yt = ys.log ? logTicks(ys.d0, ys.d1) : { major: linTicks(ys.d0, ys.d1, Math.max(2, Math.floor(plot.h / 45))), minor: [] };
  const xf = axisFormat(xs.d0, xs.d1, xUnit, xs.log, xt.major.length > 1 ? xt.major[1] - xt.major[0] : undefined);
  const yf = axisFormat(ys.d0, ys.d1, yUnit, ys.log, yt.major.length > 1 ? yt.major[1] - yt.major[0] : undefined);
  for (const v of xt.minor) { const X = map(xs, v); p.polyline([X, plot.y, X, plot.y + plot.h], th.grid, 0.5); }
  for (const v of yt.minor) { const Y = map(ys, v); p.polyline([plot.x, Y, plot.x + plot.w, Y], th.grid, 0.5); }
  for (const v of xt.major) {
    const X = map(xs, v);
    p.polyline([X, plot.y, X, plot.y + plot.h], th.grid, 1);
    p.text(xf.fmt(v), X, plot.y + plot.h + 4, { color: th.muted, size: fs, align: 'center', baseline: 'top' });
  }
  for (const v of yt.major) {
    const Y = map(ys, v);
    p.polyline([plot.x, Y, plot.x + plot.w, Y], th.grid, 1);
    p.text(yf.fmt(v), plot.x - 5, Y, { color: th.muted, size: fs, align: 'right', baseline: 'middle' });
  }
  p.rect(plot.x, plot.y, plot.w, plot.h, null, th.muted, 1);
  const xl = xf.unitLabel ? `${xLabel} (${xf.unitLabel})` : xLabel;
  const yl = yf.unitLabel ? `${yLabel} (${yf.unitLabel})` : yLabel;
  p.text(xl, plot.x + plot.w / 2, plot.y + plot.h + fs + 10, { color: th.fg, size: fs + 1, align: 'center', baseline: 'top', weight: 500 });
  p.text(yl, 14, plot.y + plot.h / 2, { color: th.fg, size: fs + 1, align: 'center', baseline: 'middle', rotate: -Math.PI / 2, weight: 500 });
}

// ----------------------------------------------------------------------------- line plot
export interface LineSeries {
  name: string; x: ArrayLike<number>; y: ArrayLike<number>; color: string; dash?: number[]; width?: number;
  markers?: boolean; band?: { lo: ArrayLike<number>; hi: ArrayLike<number> };
}
export interface LineOpts {
  series: LineSeries[]; xLabel: string; xUnit?: string; yLabel: string; yUnit?: string; logX?: boolean; logY?: boolean;
  cursorX?: number | null; hlines?: { y: number; label?: string; color?: string }[]; title?: string;
  shadeBelow?: { y: number; label: string; color: string }; // e.g. witness < 0 ⇒ entanglement certified
  xDomain?: [number, number]; yDomain?: [number, number];
}
export interface View { x: [number, number]; y: [number, number] }
export interface LineLayout { plot: Rect; xs: Scale; ys: Scale; legendH: number }

export function dataDomain(o: LineOpts): View {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of o.series) {
    for (let i = 0; i < s.x.length; i++) {
      const x = s.x[i], y = s.y[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (o.logX && !(x > 0)) continue;
      if (o.logY && !(y > 0)) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if (s.band) { const lo = s.band.lo[i], hi = s.band.hi[i]; if (Number.isFinite(lo)) y0 = Math.min(y0, lo); if (Number.isFinite(hi)) y1 = Math.max(y1, hi); }
    }
  }
  for (const h of o.hlines ?? []) if (Number.isFinite(h.y)) { y0 = Math.min(y0, h.y); y1 = Math.max(y1, h.y); }
  if (!Number.isFinite(x0)) { x0 = 0; x1 = 1; }
  if (!Number.isFinite(y0)) { y0 = 0; y1 = 1; }
  if (o.xDomain) [x0, x1] = o.xDomain;
  if (o.yDomain) [y0, y1] = o.yDomain;
  if (x1 === x0) { const d = Math.abs(x0) || 1; x0 -= d * 0.5; x1 += d * 0.5; }
  if (y1 === y0) { const d = Math.abs(y0) || 1; y0 -= d * 0.5; y1 += d * 0.5; }
  if (o.logY) { y0 /= 1.5; y1 *= 1.5; } else if (!o.yDomain) { const pad = (y1 - y0) * 0.06; y0 -= pad; y1 += pad; }
  return { x: [x0, x1], y: [y0, y1] };
}

function legendRows(p: Painter, names: string[], width: number, fs: number): number {
  let rows = 1, x = 0;
  for (const n of names) { const w = p.measure(n, fs) + 34; if (x + w > width && x > 0) { rows++; x = 0; } x += w; }
  return rows;
}

export function drawLine(p: Painter, th: ChartTheme, o: LineOpts, view: View, hoverX?: number | null): LineLayout {
  const fs = p.w < 420 ? 10 : 11;
  const showLegend = o.series.length > 1 || !!o.series[0]?.name;
  const legendH = showLegend ? legendRows(p, o.series.map((s) => s.name), p.w - 60, fs) * (fs + 8) + 6 : 0;
  const titleH = o.title ? fs + 10 : 0;
  // estimate y-tick label width
  const yt = o.logY ? logTicks(view.y[0], view.y[1]).major : linTicks(view.y[0], view.y[1], 5);
  const yf = axisFormat(view.y[0], view.y[1], o.yUnit, !!o.logY, yt.length > 1 ? yt[1] - yt[0] : undefined);
  const yw = Math.max(...yt.map((v) => p.measure(yf.fmt(v), fs)), 20);
  const plot: Rect = { x: yw + 30, y: 10 + titleH, w: 0, h: 0 };
  plot.w = Math.max(40, p.w - plot.x - 14);
  plot.h = Math.max(40, p.h - plot.y - legendH - (2 * fs + 22));
  const xs: Scale = { d0: view.x[0], d1: view.x[1], r0: plot.x, r1: plot.x + plot.w, log: !!o.logX };
  const ys: Scale = { d0: view.y[0], d1: view.y[1], r0: plot.y + plot.h, r1: plot.y, log: !!o.logY };
  if (o.title) p.text(o.title, plot.x, 6, { color: th.fg, size: fs + 2, weight: 600, baseline: 'top' });
  drawAxes(p, th, plot, xs, ys, o.xLabel, o.xUnit, o.yLabel, o.yUnit, fs);
  p.clip(plot.x, plot.y, plot.w, plot.h);
  if (o.shadeBelow && !o.logY) {
    const Y = Math.min(plot.y + plot.h, Math.max(plot.y, map(ys, o.shadeBelow.y)));
    p.rect(plot.x, Y, plot.w, plot.y + plot.h - Y, o.shadeBelow.color);
    p.text(o.shadeBelow.label, plot.x + 6, plot.y + plot.h - 6, { color: th.muted, size: fs, baseline: 'bottom' });
  }
  for (const h of o.hlines ?? []) {
    const Y = map(ys, h.y);
    p.polyline([plot.x, Y, plot.x + plot.w, Y], h.color ?? th.muted, 1, [4, 3]);
    if (h.label) p.text(h.label, plot.x + plot.w - 4, Y - 3, { color: h.color ?? th.muted, size: fs, align: 'right', baseline: 'bottom' });
  }
  for (const s of o.series) {
    const n = Math.min(s.x.length, s.y.length);
    if (s.band) {
      const pts: number[] = [];
      for (let i = 0; i < n; i++) pts.push(map(xs, s.x[i]), map(ys, s.band.hi[i]));
      for (let i = n - 1; i >= 0; i--) pts.push(map(xs, s.x[i]), map(ys, s.band.lo[i]));
      p.polygon(pts, s.color, 0.18);
    }
    const pts = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) { pts[2 * i] = map(xs, s.x[i]); pts[2 * i + 1] = map(ys, s.y[i]); }
    p.polyline(pts, s.color, s.width ?? 2, s.dash ?? []);
    if (s.markers) for (let i = 0; i < n; i++) if (Number.isFinite(pts[2 * i + 1])) p.circle(pts[2 * i], pts[2 * i + 1], 2.6, s.color);
  }
  const cx = hoverX ?? o.cursorX;
  if (cx != null && Number.isFinite(cx)) {
    const X = map(xs, cx);
    p.polyline([X, plot.y, X, plot.y + plot.h], hoverX != null ? th.muted : th.accent, hoverX != null ? 1 : 1.5, hoverX != null ? [3, 3] : []);
    if (hoverX == null) for (const s of o.series) { const i = nearestIndex(s.x, cx); if (i >= 0) { const Y = map(ys, s.y[i]); if (Number.isFinite(Y)) p.circle(X, Y, 4, s.color, th.bg); } }
  }
  p.unclip();
  if (showLegend) {
    let x = plot.x, y = p.h - legendH + 4;
    for (const s of o.series) {
      const w = p.measure(s.name, fs) + 34;
      if (x + w > p.w - 10 && x > plot.x) { x = plot.x; y += fs + 8; }
      p.polyline([x, y + fs / 2 + 1, x + 22, y + fs / 2 + 1], s.color, 2.5, s.dash ?? []);
      p.text(s.name, x + 27, y + fs / 2 + 1, { color: th.fg, size: fs, baseline: 'middle' });
      x += w;
    }
  }
  return { plot, xs, ys, legendH };
}

export function nearestIndex(xs: ArrayLike<number>, x: number): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < xs.length; i++) { const d = Math.abs(xs[i] - x); if (d < bd) { bd = d; best = i; } }
  return best;
}

export function hoverLine(o: LineOpts, L: LineLayout, px: number): { x: number; rows: { name: string; color: string; y: number }[] } | null {
  if (px < L.plot.x || px > L.plot.x + L.plot.w) return null;
  const x = invert(L.xs, px);
  const rows = o.series.map((s) => { const i = nearestIndex(s.x, x); return { name: s.name, color: s.color, y: i >= 0 ? s.y[i] : NaN, xi: i >= 0 ? s.x[i] : NaN }; });
  const xi = rows.find((r) => Number.isFinite(r.xi))?.xi ?? x;
  return { x: xi, rows };
}

// ----------------------------------------------------------------------------- colour maps
const VIRIDIS = ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'];
const MAGMA = ['#000004', '#180f3d', '#440f76', '#721f81', '#9e2f7f', '#cd4071', '#f1605d', '#fd9668', '#feca8d', '#fcfdbf'];
// Blue–white–orange diverging (colour-blind safe): negative values blue.
const DIVERGING = ['#08519c', '#3182bd', '#6baed6', '#bdd7e7', '#f7f7f7', '#fdd0a2', '#fdae6b', '#e6550d', '#a63603'];
export type Palette = 'viridis' | 'magma' | 'diverging';
function hexToRgb(h: string): [number, number, number] { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const PAL: Record<Palette, [number, number, number][]> = { viridis: VIRIDIS.map(hexToRgb), magma: MAGMA.map(hexToRgb), diverging: DIVERGING.map(hexToRgb) };
export function colorAt(pal: Palette, t: number): [number, number, number] {
  const c = PAL[pal];
  const x = Math.min(1, Math.max(0, t)) * (c.length - 1);
  const i = Math.min(c.length - 2, Math.floor(x)), f = x - i;
  return [0, 1, 2].map((k) => Math.round(c[i][k] + (c[i + 1][k] - c[i][k]) * f)) as [number, number, number];
}
export const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;

// ----------------------------------------------------------------------------- heat map
export interface HeatOpts {
  z: (number | null)[][]; // rows = y, cols = x
  x?: number[]; y?: number[]; xCats?: string[]; yCats?: string[];
  xLabel: string; xUnit?: string; yLabel: string; yUnit?: string; zLabel: string; zUnit?: string;
  palette: Palette; symmetric?: boolean; logZ?: boolean; zDomain?: [number, number];
  nullLabel?: string; annotate?: (v: number | null, i: number, j: number) => string | null; title?: string;
  contour0?: boolean; // outline cells where the sign changes (e.g. witness = 0 boundary)
}
export interface HeatLayout { plot: Rect; cols: number; rows: number; zr: [number, number] }

function zRange(o: HeatOpts): [number, number] {
  if (o.zDomain) return o.zDomain;
  let lo = Infinity, hi = -Infinity;
  for (const r of o.z) for (const v of r) if (v != null && Number.isFinite(v) && (!o.logZ || v > 0)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!Number.isFinite(lo)) return [0, 1];
  if (o.symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; return [-m, m]; }
  if (lo === hi) return o.logZ ? [lo / 10, hi * 10] : [lo - 1, hi + 1];
  return [lo, hi];
}
function zNorm(o: HeatOpts, zr: [number, number], v: number) {
  return o.logZ ? (Math.log10(v) - Math.log10(zr[0])) / (Math.log10(zr[1]) - Math.log10(zr[0])) : (v - zr[0]) / (zr[1] - zr[0]);
}

export function drawHeat(p: Painter, th: ChartTheme, o: HeatOpts): HeatLayout {
  const fs = p.w < 420 ? 10 : 11;
  const rows = o.z.length, cols = o.z[0]?.length ?? 0;
  const zr = zRange(o);
  const cats = !!(o.xCats || o.yCats);
  const ylabW = o.yCats ? Math.max(...o.yCats.map((c) => p.measure(c, fs))) + 8 : 44;
  const titleH = o.title ? fs + 10 : 0;
  const cbW = 64;
  const plot: Rect = { x: ylabW + 26, y: 8 + titleH, w: 0, h: 0 };
  plot.w = Math.max(40, p.w - plot.x - cbW - 12);
  plot.h = Math.max(40, p.h - plot.y - (o.xCats ? 2 * fs + 26 : 2 * fs + 22));
  if (o.title) p.text(o.title, plot.x, 6, { color: th.fg, size: fs + 2, weight: 600, baseline: 'top' });
  const cw = plot.w / cols, ch = plot.h / rows;
  const rgba = new Uint8ClampedArray(rows * cols * 4);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const v = o.z[i][j];
    const k = ((rows - 1 - i) * cols + j) * 4;
    if (v == null || !Number.isFinite(v) || (o.logZ && v <= 0)) { rgba[k + 3] = 0; continue; }
    const c = colorAt(o.palette, zNorm(o, zr, v));
    rgba[k] = c[0]; rgba[k + 1] = c[1]; rgba[k + 2] = c[2]; rgba[k + 3] = 255;
  }
  // inadmissible / null cells: hatched
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const v = o.z[i][j];
    if (v == null || !Number.isFinite(v)) {
      const X = plot.x + j * cw, Y = plot.y + (rows - 1 - i) * ch;
      p.rect(X, Y, cw, ch, th.bg); p.hatch(X, Y, cw, ch, th.muted);
    }
  }
  p.raster(plot.x, plot.y, plot.w, plot.h, cols, rows, rgba);
  if (o.contour0) {
    const segs: number[] = [];
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const v = o.z[i][j]; if (v == null) continue;
      const X = plot.x + j * cw, Y = plot.y + (rows - 1 - i) * ch;
      const r = j + 1 < cols ? o.z[i][j + 1] : null, u = i + 1 < rows ? o.z[i + 1][j] : null;
      if (r != null && Math.sign(r) !== Math.sign(v)) segs.push(X + cw, Y, X + cw, Y + ch, NaN, NaN);
      if (u != null && Math.sign(u) !== Math.sign(v)) segs.push(X, Y, X + cw, Y, NaN, NaN);
    }
    p.polyline(segs, th.fg, 2);
  }
  if (o.annotate) for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const s = o.annotate(o.z[i][j], i, j); if (!s) continue;
    const v = o.z[i][j];
    const t = v == null || !Number.isFinite(v) ? 0 : zNorm(o, zr, v);
    const light = o.palette === 'diverging' ? Math.abs(t - 0.5) < 0.3 : t > 0.55;
    p.text(s, plot.x + (j + 0.5) * cw, plot.y + (rows - 1 - i + 0.5) * ch, { color: v == null || !Number.isFinite(v) ? th.fg : light ? '#111' : '#fff', size: Math.min(fs, Math.max(8, cw / 7)), align: 'center', baseline: 'middle', weight: 600 });
  }
  p.rect(plot.x, plot.y, plot.w, plot.h, null, th.muted, 1);
  // axes
  if (o.xCats) o.xCats.forEach((c, j) => p.text(c, plot.x + (j + 0.5) * cw, plot.y + plot.h + 4, { color: th.fg, size: fs, align: 'center', baseline: 'top' }));
  if (o.yCats) o.yCats.forEach((c, i) => p.text(c, plot.x - 6, plot.y + (rows - 1 - i + 0.5) * ch, { color: th.fg, size: fs, align: 'right', baseline: 'middle' }));
  if (!cats && o.x && o.y) {
    const xf = axisFormat(Math.min(...o.x), Math.max(...o.x), o.xUnit, false);
    const yf = axisFormat(Math.min(...o.y), Math.max(...o.y), o.yUnit, false);
    const xEvery = Math.max(1, Math.ceil(cols / Math.max(2, plot.w / 60)));
    const yEvery = Math.max(1, Math.ceil(rows / Math.max(2, plot.h / 30)));
    o.x.forEach((v, j) => { if (j % xEvery === 0) p.text(xf.fmt(v), plot.x + (j + 0.5) * cw, plot.y + plot.h + 4, { color: th.muted, size: fs, align: 'center', baseline: 'top' }); });
    o.y.forEach((v, i) => { if (i % yEvery === 0) p.text(yf.fmt(v), plot.x - 5, plot.y + (rows - 1 - i + 0.5) * ch, { color: th.muted, size: fs, align: 'right', baseline: 'middle' }); });
    p.text(xf.unitLabel ? `${o.xLabel} (${xf.unitLabel})` : o.xLabel, plot.x + plot.w / 2, plot.y + plot.h + fs + 10, { color: th.fg, size: fs + 1, align: 'center', baseline: 'top', weight: 500 });
    p.text(yf.unitLabel ? `${o.yLabel} (${yf.unitLabel})` : o.yLabel, 12, plot.y + plot.h / 2, { color: th.fg, size: fs + 1, align: 'center', baseline: 'middle', rotate: -Math.PI / 2, weight: 500 });
  } else {
    p.text(o.xLabel, plot.x + plot.w / 2, plot.y + plot.h + fs + 12, { color: th.fg, size: fs + 1, align: 'center', baseline: 'top', weight: 500 });
    p.text(o.yLabel, 10, plot.y + plot.h / 2, { color: th.fg, size: fs + 1, align: 'center', baseline: 'middle', rotate: -Math.PI / 2, weight: 500 });
  }
  // colour bar
  const cb: Rect = { x: plot.x + plot.w + 12, y: plot.y, w: 12, h: plot.h };
  const n = 64, bar = new Uint8ClampedArray(n * 4);
  for (let k = 0; k < n; k++) { const c = colorAt(o.palette, 1 - k / (n - 1)); bar.set([c[0], c[1], c[2], 255], k * 4); }
  p.raster(cb.x, cb.y, cb.w, cb.h, 1, n, bar);
  p.rect(cb.x, cb.y, cb.w, cb.h, null, th.muted, 1);
  const zt = o.logZ ? logTicks(zr[0], zr[1]).major : linTicks(zr[0], zr[1], 4);
  const zf = axisFormat(zr[0], zr[1], o.zUnit, !!o.logZ, zt.length > 1 ? zt[1] - zt[0] : undefined);
  for (const v of zt) {
    const t = zNorm(o, zr, v); if (t < -1e-9 || t > 1 + 1e-9) continue;
    const Y = cb.y + cb.h * (1 - t);
    p.polyline([cb.x + cb.w, Y, cb.x + cb.w + 3, Y], th.muted, 1);
    p.text(zf.fmt(v), cb.x + cb.w + 5, Y, { color: th.muted, size: fs - 1, baseline: 'middle' });
  }
  p.text(zf.unitLabel ? `${o.zLabel} (${zf.unitLabel})` : o.zLabel, cb.x + cb.w + 2, plot.y + plot.h + 6, { color: th.fg, size: fs, align: 'right', baseline: 'top' });
  return { plot, cols, rows, zr };
}

export function hoverHeat(o: HeatOpts, L: HeatLayout, px: number, py: number): { i: number; j: number; v: number | null } | null {
  const { plot, cols, rows } = L;
  if (px < plot.x || px > plot.x + plot.w || py < plot.y || py > plot.y + plot.h) return null;
  const j = Math.min(cols - 1, Math.floor(((px - plot.x) / plot.w) * cols));
  const i = rows - 1 - Math.min(rows - 1, Math.floor(((py - plot.y) / plot.h) * rows));
  return { i, j, v: o.z[i][j] };
}

// ----------------------------------------------------------------------------- horizontal bars
export interface BarItem { label: string; value: number; color?: string; note?: string }
export interface BarOpts { items: BarItem[]; xLabel: string; unit?: string; logX?: boolean; title?: string; highlight?: string }
export interface BarLayout { plot: Rect; rowH: number }

export function drawBars(p: Painter, th: ChartTheme, o: BarOpts): BarLayout {
  const fs = p.w < 420 ? 10 : 11;
  const labW = Math.min(p.w * 0.42, Math.max(...o.items.map((it) => p.measure(it.label, fs)), 40) + 10);
  const titleH = o.title ? fs + 10 : 0;
  const plot: Rect = { x: labW + 8, y: 6 + titleH, w: 0, h: 0 };
  plot.w = Math.max(40, p.w - plot.x - 70);
  plot.h = Math.max(20, p.h - plot.y - (2 * fs + 22));
  if (o.title) p.text(o.title, 4, 4, { color: th.fg, size: fs + 2, weight: 600, baseline: 'top' });
  const vals = o.items.map((i) => i.value).filter((v) => Number.isFinite(v) && (!o.logX || v > 0));
  let d0 = Math.min(0, ...vals), d1 = Math.max(0, ...vals);
  if (o.logX) { d0 = Math.min(...vals) / 3; d1 = Math.max(...vals, 1e-300) * 3; if (!(d0 > 0)) d0 = d1 / 1e6; }
  else { const pad = (d1 - d0 || 1) * 0.05; if (d1 > 0) d1 += pad; if (d0 < 0) d0 -= pad; if (d1 === d0) d1 = d0 + 1; }
  const xs: Scale = { d0, d1, r0: plot.x, r1: plot.x + plot.w, log: !!o.logX };
  const ys: Scale = { d0: 0, d1: 1, r0: plot.y + plot.h, r1: plot.y, log: false };
  drawAxes(p, th, plot, xs, ys, o.xLabel, o.unit, '', undefined, fs);
  const rowH = plot.h / Math.max(1, o.items.length);
  o.items.forEach((it, k) => {
    const Y = plot.y + k * rowH;
    const ok = Number.isFinite(it.value) && (!o.logX || it.value > 0);
    const X0 = o.logX ? plot.x : map(xs, 0);
    const X1 = ok ? map(xs, it.value) : X0;
    if (ok) p.rect(Math.min(X0, X1), Y + rowH * 0.18, Math.max(1, Math.abs(X1 - X0)), rowH * 0.64, it.color ?? th.accent, it.label === o.highlight ? th.fg : null, 2);
    p.text(it.label, plot.x - 6, Y + rowH / 2, { color: th.fg, size: fs, align: 'right', baseline: 'middle', weight: it.label === o.highlight ? 700 : 400 });
    p.text(ok ? fmtQ(it.value, o.unit, 3) : it.value === 0 ? '0' : '—', Math.max(X0, X1) + 4, Y + rowH / 2, { color: th.muted, size: fs - 1, baseline: 'middle' });
    if (!o.logX && d0 < 0) p.polyline([X0, plot.y, X0, plot.y + plot.h], th.fg, 1);
  });
  return { plot, rowH };
}
