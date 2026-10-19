/**
 * Interactive chart components: LinePlot (wheel/pinch zoom, drag pan, keyboard, double-click reset, hover
 * readout), HeatMap (hover readout) and BarChart. All export PNG at 3× and SVG.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { CanvasPainter, SvgPainter, readTheme, type Painter } from './painter';
import { drawLine, hoverLine, dataDomain, drawHeat, hoverHeat, drawBars, invert, type LineOpts, type View, type LineLayout, type HeatOpts, type HeatLayout, type BarOpts } from './charts';
import { fmtQ } from '../lib/format';

function useSize(ref: { current: HTMLElement | null }, aspect: number, minH: number, maxH: number) {
  const [size, setSize] = useState({ w: 600, h: 320 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.max(240, Math.floor(el.clientWidth));
      setSize({ w, h: Math.round(Math.min(maxH, Math.max(minH, w * aspect))) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect, minH, maxH]);
  return size;
}

function paint(canvas: HTMLCanvasElement, w: number, h: number, draw: (p: Painter) => void) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  draw(new CanvasPainter(ctx, w, h));
}

function exportPNG(el: Element, w: number, h: number, scale: number, draw: (p: Painter) => void, name: string) {
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  ctx.fillStyle = readTheme(el).bg; ctx.fillRect(0, 0, w, h);
  draw(new CanvasPainter(ctx, w, h));
  c.toBlob((b) => b && save(b, `${name}.png`), 'image/png');
}
function exportSVG(el: Element, w: number, h: number, draw: (p: Painter) => void, name: string) {
  const sp = new SvgPainter(w, h, readTheme(el).bg);
  draw(sp);
  save(new Blob([sp.toString()], { type: 'image/svg+xml' }), `${name}.svg`);
}
function save(b: Blob, name: string) {
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = name; a.rel = 'external';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

/** Re-render charts when the colour theme changes. */
function useThemeTick() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setT((x) => x + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const f = () => setT((x) => x + 1);
    mq.addEventListener?.('change', f);
    return () => { mo.disconnect(); mq.removeEventListener?.('change', f); };
  }, []);
  return t;
}

interface Frame { title?: string; desc: string; name: string; aspect?: number; minH?: number; maxH?: number; toolbar?: ComponentChildren }

function Toolbar({ onReset, onPNG, onSVG, extra, zoom }: { onReset?: () => void; onPNG: () => void; onSVG: () => void; extra?: ComponentChildren; zoom?: (f: number) => void }) {
  return (
    <div class="chart-toolbar" role="toolbar" aria-label="Chart tools">
      {extra}
      {zoom && <button type="button" class="btn-icon" onClick={() => zoom(0.8)} aria-label="Zoom in" title="Zoom in (+)">+</button>}
      {zoom && <button type="button" class="btn-icon" onClick={() => zoom(1.25)} aria-label="Zoom out" title="Zoom out (−)">−</button>}
      {onReset && <button type="button" class="btn-icon" onClick={onReset} title="Reset view (0 or double-click)" aria-label="Reset view">⟲</button>}
      <button type="button" class="btn-sm" onClick={onPNG} title="Download PNG at 3× resolution">PNG</button>
      <button type="button" class="btn-sm" onClick={onSVG} title="Download vector SVG">SVG</button>
    </div>
  );
}

// ----------------------------------------------------------------------------- line plot
export function LinePlot(props: LineOpts & Frame) {
  const { title, desc, name, aspect = 0.55, minH = 220, maxH = 460, toolbar, ...opts } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const size = useSize(wrap, aspect, minH, maxH);
  const themeTick = useThemeTick();
  // The data domain is keyed by value, so parent re-renders (e.g. animation frames) do not reset zoom/pan.
  const dom = dataDomain(opts);
  const domKey = `${dom.x[0]},${dom.x[1]},${dom.y[0]},${dom.y[1]},${opts.logX},${opts.logY}`;
  const base = useMemo(() => dom, [domKey]);
  const [view, setView] = useState<View>(base);
  useEffect(() => setView(base), [domKey]);
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const layout = useRef<LineLayout | null>(null);

  const hv = hover && layout.current ? hoverLine(opts, layout.current, hover.px) : null;
  useEffect(() => {
    if (!cv.current || !wrap.current) return;
    const th = readTheme(wrap.current);
    paint(cv.current, size.w, size.h, (p) => { layout.current = drawLine(p, th, opts, view, hv?.x ?? null); });
  });
  void themeTick;

  const zoomAt = (fx: number, fy: number, k: number, axis: 'xy' | 'x' | 'y' = 'xy') => {
    setView((v) => {
      const L = layout.current; if (!L) return v;
      const zx = (a: number, b: number, c: number, log: boolean) => log
        ? [10 ** (Math.log10(c) + (Math.log10(a) - Math.log10(c)) * k), 10 ** (Math.log10(c) + (Math.log10(b) - Math.log10(c)) * k)]
        : [c + (a - c) * k, c + (b - c) * k];
      const cx = invert(L.xs, fx), cy = invert(L.ys, fy);
      return {
        x: axis === 'y' ? v.x : (zx(v.x[0], v.x[1], cx, !!opts.logX) as [number, number]),
        y: axis === 'x' ? v.y : (zx(v.y[0], v.y[1], cy, !!opts.logY) as [number, number]),
      };
    });
  };
  const panBy = (dx: number, dy: number) => {
    setView((v) => {
      const L = layout.current; if (!L) return v;
      const sh = (d0: number, d1: number, s: typeof L.xs, dp: number) => {
        if (s.log) { const f = (Math.log10(d1) - Math.log10(d0)) * dp / (s.r1 - s.r0); return [d0 * 10 ** -f, d1 * 10 ** -f]; }
        const f = (d1 - d0) * dp / (s.r1 - s.r0); return [d0 - f, d1 - f];
      };
      return { x: sh(v.x[0], v.x[1], L.xs, dx) as [number, number], y: sh(v.y[0], v.y[1], L.ys, dy) as [number, number] };
    });
  };

  // pointer interactions: drag = pan, two pointers = pinch zoom
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const onDown = (e: PointerEvent) => { (e.target as Element).setPointerCapture?.(e.pointerId); ptrs.current.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); };
  const onMove = (e: PointerEvent) => {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev) { setHover({ px: e.offsetX, py: e.offsetY }); return; }
    if (ptrs.current.size === 2) {
      const others = [...ptrs.current.entries()].filter(([k]) => k !== e.pointerId)[0][1];
      const d0 = Math.hypot(prev.x - others.x, prev.y - others.y), d1 = Math.hypot(e.offsetX - others.x, e.offsetY - others.y);
      if (d0 > 0 && d1 > 0) zoomAt((e.offsetX + others.x) / 2, (e.offsetY + others.y) / 2, d0 / d1);
    } else panBy(e.offsetX - prev.x, e.offsetY - prev.y);
    ptrs.current.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  };
  const onUp = (e: PointerEvent) => { ptrs.current.delete(e.pointerId); };
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.shiftKey && !e.altKey && !(document.activeElement === cv.current)) return; // don't hijack page scroll
    e.preventDefault();
    zoomAt(e.offsetX, e.offsetY, e.deltaY > 0 ? 1.15 : 1 / 1.15, e.shiftKey ? 'x' : e.altKey ? 'y' : 'xy');
  };
  const onKey = (e: KeyboardEvent) => {
    const L = layout.current; if (!L) return;
    const cx = L.plot.x + L.plot.w / 2, cy = L.plot.y + L.plot.h / 2;
    const m: Record<string, () => void> = {
      '+': () => zoomAt(cx, cy, 0.8), '=': () => zoomAt(cx, cy, 0.8), '-': () => zoomAt(cx, cy, 1.25), '0': () => setView(base),
      ArrowLeft: () => panBy(30, 0), ArrowRight: () => panBy(-30, 0), ArrowUp: () => panBy(0, 30), ArrowDown: () => panBy(0, -30),
    };
    if (m[e.key]) { e.preventDefault(); m[e.key](); }
  };
  useEffect(() => {
    const c = cv.current; if (!c) return;
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  });

  const drawAll = (p: Painter) => { drawLine(p, readTheme(wrap.current!), opts, view); };
  return (
    <figure class="chart" ref={wrap}>
      <div class="chart-head">
        {title && <figcaption class="chart-title">{title}</figcaption>}
        <Toolbar extra={toolbar} zoom={(k) => { const L = layout.current; if (L) zoomAt(L.plot.x + L.plot.w / 2, L.plot.y + L.plot.h / 2, k); }} onReset={() => setView(base)}
          onPNG={() => exportPNG(wrap.current!, size.w, size.h, 3, drawAll, name)} onSVG={() => exportSVG(wrap.current!, size.w, size.h, drawAll, name)} />
      </div>
      <div class="chart-canvas-wrap">
        <canvas ref={cv} tabIndex={0} role="img" aria-label={`${title ?? name}: ${desc}. Focus and use +/− to zoom, arrow keys to pan, 0 to reset; Ctrl+wheel zooms.`}
          onPointerDown={onDown as any} onPointerMove={onMove as any} onPointerUp={onUp as any} onPointerCancel={onUp as any}
          onPointerLeave={() => { setHover(null); }} onDblClick={() => setView(base)} onKeyDown={onKey as any} style={{ touchAction: 'pan-y' }} />
        {hv && hover && (
          <div class="chart-tip" style={{ left: `${Math.min(hover.px + 14, size.w - 190)}px`, top: `${Math.max(4, hover.py - 10)}px` }} role="status">
            <div class="tip-x">{opts.xLabel}: {fmtQ(hv.x, opts.xUnit)}</div>
            {hv.rows.map((r) => <div key={r.name}><span class="swatch" style={{ background: r.color }} /> {r.name}: <b>{fmtQ(r.y, opts.yUnit, 5)}</b></div>)}
          </div>
        )}
      </div>
    </figure>
  );
}

// ----------------------------------------------------------------------------- heat map
export function HeatMap(props: HeatOpts & Frame & { cellLabel?: (i: number, j: number, v: number | null) => string }) {
  const { title, desc, name, aspect = 0.62, minH = 240, maxH = 520, toolbar, cellLabel, ...opts } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const size = useSize(wrap, aspect, minH, maxH);
  const themeTick = useThemeTick();
  const layout = useRef<HeatLayout | null>(null);
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  useEffect(() => {
    if (!cv.current || !wrap.current) return;
    const th = readTheme(wrap.current);
    paint(cv.current, size.w, size.h, (p) => { layout.current = drawHeat(p, th, opts); });
  });
  void themeTick;
  const hh = hover && layout.current ? hoverHeat(opts, layout.current, hover.px, hover.py) : null;
  const drawAll = (p: Painter) => { drawHeat(p, readTheme(wrap.current!), opts); };
  const label = (i: number, j: number, v: number | null) => cellLabel ? cellLabel(i, j, v) : (
    `${opts.xLabel}: ${opts.xCats ? opts.xCats[j] : fmtQ(opts.x![j], opts.xUnit)} · ${opts.yLabel}: ${opts.yCats ? opts.yCats[i] : fmtQ(opts.y![i], opts.yUnit)} · ${opts.zLabel}: ${v == null || !Number.isFinite(v) ? (opts.nullLabel ?? 'no value') : fmtQ(v, opts.zUnit, 5)}`);
  return (
    <figure class="chart" ref={wrap}>
      <div class="chart-head">
        {title && <figcaption class="chart-title">{title}</figcaption>}
        <Toolbar extra={toolbar} onPNG={() => exportPNG(wrap.current!, size.w, size.h, 3, drawAll, name)} onSVG={() => exportSVG(wrap.current!, size.w, size.h, drawAll, name)} />
      </div>
      <div class="chart-canvas-wrap">
        <canvas ref={cv} tabIndex={0} role="img" aria-label={`${title ?? name}: ${desc}`}
          onPointerMove={(e: any) => setHover({ px: e.offsetX, py: e.offsetY })} onPointerLeave={() => setHover(null)} />
        {hh && hover && (
          <div class="chart-tip" style={{ left: `${Math.min(hover.px + 14, size.w - 220)}px`, top: `${Math.max(4, hover.py - 10)}px` }} role="status">{label(hh.i, hh.j, hh.v)}</div>
        )}
      </div>
    </figure>
  );
}

// ----------------------------------------------------------------------------- bars
export function BarChart(props: BarOpts & Frame) {
  const { title, desc, name, toolbar, minH, maxH = 420, aspect, ...opts } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const h0 = Math.max(minH ?? 140, opts.items.length * 30 + 60);
  const size = useSize(wrap, aspect ?? 0, h0, Math.max(h0, maxH));
  const themeTick = useThemeTick();
  useEffect(() => {
    if (!cv.current || !wrap.current) return;
    const th = readTheme(wrap.current);
    paint(cv.current, size.w, size.h, (p) => { drawBars(p, th, opts); });
  });
  void themeTick;
  const drawAll = (p: Painter) => { drawBars(p, readTheme(wrap.current!), opts); };
  return (
    <figure class="chart" ref={wrap}>
      <div class="chart-head">
        {title && <figcaption class="chart-title">{title}</figcaption>}
        <Toolbar extra={toolbar} onPNG={() => exportPNG(wrap.current!, size.w, size.h, 3, drawAll, name)} onSVG={() => exportSVG(wrap.current!, size.w, size.h, drawAll, name)} />
      </div>
      <div class="chart-canvas-wrap"><canvas ref={cv} role="img" aria-label={`${title ?? name}: ${desc}`} /></div>
    </figure>
  );
}
