/**
 * Drawing back-ends shared by all charts: a Canvas 2D painter (screen and high-resolution PNG export)
 * and an SVG painter (vector export). Charts issue the same primitive calls to either.
 */

export interface TextOpts {
  color: string; size?: number; align?: 'left' | 'center' | 'right'; baseline?: 'top' | 'middle' | 'bottom' | 'alphabetic';
  rotate?: number; weight?: number; family?: string;
}

export interface Painter {
  readonly w: number;
  readonly h: number;
  polyline(pts: ArrayLike<number>, color: string, width?: number, dash?: number[]): void;
  polygon(pts: ArrayLike<number>, fill: string, alpha?: number): void;
  rect(x: number, y: number, w: number, h: number, fill: string | null, stroke?: string | null, sw?: number): void;
  circle(x: number, y: number, r: number, fill: string, stroke?: string): void;
  text(s: string, x: number, y: number, o: TextOpts): void;
  measure(s: string, size?: number): number;
  raster(x: number, y: number, w: number, h: number, cols: number, rows: number, rgba: Uint8ClampedArray): void;
  hatch(x: number, y: number, w: number, h: number, color: string): void;
  clip(x: number, y: number, w: number, h: number): void;
  unclip(): void;
}

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

let measureCtx: CanvasRenderingContext2D | null = null;
function measureText(s: string, size: number, family = FONT): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return s.length * size * 0.55;
  measureCtx.font = `${size}px ${family}`;
  return measureCtx.measureText(s).width;
}

export class CanvasPainter implements Painter {
  constructor(private ctx: CanvasRenderingContext2D, public w: number, public h: number) {}
  polyline(pts: ArrayLike<number>, color: string, width = 1.5, dash: number[] = []) {
    const c = this.ctx;
    c.beginPath();
    let pen = false;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
      if (pen) c.lineTo(x, y); else { c.moveTo(x, y); pen = true; }
    }
    c.setLineDash(dash.map((d) => d * width * 0.9));
    c.strokeStyle = color; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = dash.length ? 'butt' : 'round';
    c.stroke();
    c.setLineDash([]);
  }
  polygon(pts: ArrayLike<number>, fill: string, alpha = 1) {
    const c = this.ctx;
    c.beginPath();
    for (let i = 0; i < pts.length; i += 2) (i ? c.lineTo(pts[i], pts[i + 1]) : c.moveTo(pts[i], pts[i + 1]));
    c.closePath();
    c.globalAlpha = alpha; c.fillStyle = fill; c.fill(); c.globalAlpha = 1;
  }
  rect(x: number, y: number, w: number, h: number, fill: string | null, stroke?: string | null, sw = 1) {
    const c = this.ctx;
    if (fill) { c.fillStyle = fill; c.fillRect(x, y, w, h); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = sw; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
  }
  circle(x: number, y: number, r: number, fill: string, stroke?: string) {
    const c = this.ctx;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = fill; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1.5; c.stroke(); }
  }
  text(s: string, x: number, y: number, o: TextOpts) {
    const c = this.ctx;
    c.save();
    c.font = `${o.weight ?? 400} ${o.size ?? 12}px ${o.family ?? FONT}`;
    c.fillStyle = o.color; c.textAlign = o.align ?? 'left'; c.textBaseline = o.baseline ?? 'alphabetic';
    c.translate(x, y);
    if (o.rotate) c.rotate(o.rotate);
    c.fillText(s, 0, 0);
    c.restore();
  }
  measure(s: string, size = 12) { return measureText(s, size); }
  raster(x: number, y: number, w: number, h: number, cols: number, rows: number, rgba: Uint8ClampedArray) {
    const off = document.createElement('canvas');
    off.width = cols; off.height = rows;
    const oc = off.getContext('2d');
    if (!oc) return;
    const img = oc.createImageData(cols, rows);
    img.data.set(rgba);
    oc.putImageData(img, 0, 0);
    const c = this.ctx;
    c.save(); c.imageSmoothingEnabled = false; c.drawImage(off, x, y, w, h); c.restore();
  }
  hatch(x: number, y: number, w: number, h: number, color: string) {
    const c = this.ctx;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.strokeStyle = color; c.lineWidth = 1; c.beginPath();
    for (let k = -h; k < w; k += 6) { c.moveTo(x + k, y + h); c.lineTo(x + k + h, y); }
    c.stroke(); c.restore();
  }
  clip(x: number, y: number, w: number, h: number) { this.ctx.save(); this.ctx.beginPath(); this.ctx.rect(x, y, w, h); this.ctx.clip(); }
  unclip() { this.ctx.restore(); }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (v: number) => (Math.round(v * 100) / 100).toString();

export class SvgPainter implements Painter {
  parts: string[] = [];
  private clipN = 0;
  private open = 0;
  constructor(public w: number, public h: number, bg: string | null) {
    if (bg) this.parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="${bg}"/>`);
  }
  polyline(pts: ArrayLike<number>, color: string, width = 1.5, dash: number[] = []) {
    let d = '', pen = false;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + f(x) + ' ' + f(y);
      pen = true;
    }
    if (!d) return;
    const da = dash.length ? ` stroke-dasharray="${dash.map((v) => f(v * width * 0.9)).join(' ')}"` : '';
    this.parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"${da}/>`);
  }
  polygon(pts: ArrayLike<number>, fill: string, alpha = 1) {
    let d = '';
    for (let i = 0; i < pts.length; i += 2) d += (i ? 'L' : 'M') + f(pts[i]) + ' ' + f(pts[i + 1]);
    this.parts.push(`<path d="${d}Z" fill="${fill}" fill-opacity="${alpha}"/>`);
  }
  rect(x: number, y: number, w: number, h: number, fill: string | null, stroke?: string | null, sw = 1) {
    this.parts.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill ?? 'none'}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}/>`);
  }
  circle(x: number, y: number, r: number, fill: string, stroke?: string) {
    this.parts.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="1.5"` : ''}/>`);
  }
  text(s: string, x: number, y: number, o: TextOpts) {
    const anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
    const base = o.baseline === 'top' ? 'hanging' : o.baseline === 'middle' ? 'central' : o.baseline === 'bottom' ? 'text-after-edge' : 'alphabetic';
    const rot = o.rotate ? ` transform="rotate(${(o.rotate * 180) / Math.PI} ${f(x)} ${f(y)})"` : '';
    this.parts.push(`<text x="${f(x)}" y="${f(y)}" fill="${o.color}" font-size="${o.size ?? 12}" font-weight="${o.weight ?? 400}" font-family='${FONT}' text-anchor="${anchor}" dominant-baseline="${base}"${rot}>${esc(s)}</text>`);
  }
  measure(s: string, size = 12) { return measureText(s, size); }
  raster(x: number, y: number, w: number, h: number, cols: number, rows: number, rgba: Uint8ClampedArray) {
    const off = document.createElement('canvas');
    off.width = cols; off.height = rows;
    const oc = off.getContext('2d');
    if (!oc) return;
    const img = oc.createImageData(cols, rows);
    img.data.set(rgba);
    oc.putImageData(img, 0, 0);
    this.parts.push(`<image x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="none" style="image-rendering:pixelated" href="${off.toDataURL('image/png')}"/>`);
  }
  hatch(x: number, y: number, w: number, h: number, color: string) {
    const id = `h${this.clipN++}`;
    this.parts.push(`<clipPath id="${id}"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"/></clipPath><g clip-path="url(#${id})">`);
    let d = '';
    for (let k = -h; k < w; k += 6) d += `M${f(x + k)} ${f(y + h)}L${f(x + k + h)} ${f(y)}`;
    this.parts.push(`<path d="${d}" stroke="${color}" stroke-width="1"/></g>`);
  }
  clip(x: number, y: number, w: number, h: number) {
    const id = `c${this.clipN++}`;
    this.parts.push(`<clipPath id="${id}"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"/></clipPath><g clip-path="url(#${id})">`);
    this.open++;
  }
  unclip() { if (this.open > 0) { this.parts.push('</g>'); this.open--; } }
  toString() {
    while (this.open > 0) this.unclip();
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}">${this.parts.join('')}</svg>`;
  }
}

/** Theme colours read from CSS custom properties on the chart's container. */
export interface ChartTheme { fg: string; muted: string; grid: string; bg: string; accent: string; danger: string; ok: string }
export function readTheme(el: Element): ChartTheme {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { fg: v('--fg', '#1a1d2e'), muted: v('--muted', '#5b6075'), grid: v('--grid', 'rgba(127,127,127,0.18)'), bg: v('--bg-elev', '#ffffff'), accent: v('--accent', '#3a47c9'), danger: v('--danger', '#b3261e'), ok: v('--ok', '#1b7f3b') };
}
