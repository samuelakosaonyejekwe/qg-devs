/**
 * Lazy high-fidelity 3-D view: loads three.js only when mounted and WebGL is available, otherwise shows the
 * provided 2-D fallback. Always shows a title and a provenance badge (COMPUTED / COMPUTED LOCALLY /
 * SYNTHETIC / CONCEPTUAL), an optional legend, and a toolbar: reset view, fullscreen, still export at
 * 1×/2×/4×/8K (optionally transparent), video export (WebM/MP4) and data export of the displayed frame.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { webglAvailable } from '../three/detect';
import { startRecording, saveBlob, videoSupported, type Recording } from '../lib/video';
import { prefersReducedMotion } from '../lib/store';
import '../three/three.css';
import { Tex } from './Tex';
import { mapGradient } from '../lib/colormaps';

const fmtFactor = (k: number) => { if (!Number.isFinite(k)) return String(k); const e = Math.floor(Math.log10(Math.abs(k) || 1)); return Math.abs(e) < 4 ? String(+k.toPrecision(3)) : `${+(k / 10 ** e).toPrecision(2)}×10${String(e).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d])}`; };

type Kind = 'apparatus' | 'bloch' | 'trajectories' | 'surface' | 'plot3d';
export type Badge3D = 'COMPUTED' | 'COMPUTED LOCALLY' | 'SYNTHETIC' | 'CONCEPTUAL';
export interface Handle3D {
  update(o: any): void; dispose(): void; resetView(): void; setFrame?(f: number): void; toPNG?(s?: number, transparent?: boolean): string;
  composite?(ctx: CanvasRenderingContext2D, scale: number, transparent: boolean): void; canvasSize?(): { w: number; h: number };
  memory?(): { geometries: number; textures: number }; info?: any; fitView?(): void;
}

const BADGE_CLASS: Record<Badge3D, string> = { COMPUTED: 'b-computed', 'COMPUTED LOCALLY': 'b-local', SYNTHETIC: 'b-synthetic', CONCEPTUAL: 'b-estimated' };

export interface ColorBar { map: string; ticks: { at: number; tex: string }[]; titleTex?: string; title?: string }
export interface Magnify { on: boolean; factor: number; onToggle: (v: boolean) => void; reference?: string }

export function View3D({ kind, opts, frame, fallback, label, overlay, onInfo, title, badge = 'COMPUTED', legend, frameData, onRecordStart, playing, name, colorbar, change, magnify, isStatic, sweepOf }: {
  kind: Kind; opts: any; frame?: number; fallback: ComponentChildren; label: string; overlay?: (info: any) => ComponentChildren; onInfo?: (info: any) => void;
  title?: string; badge?: Badge3D; legend?: { label: string; color: string }[]; frameData?: () => unknown;
  /** called when video recording starts (e.g. rewind and play); recording stops when `playing` turns false */
  onRecordStart?: () => void; playing?: boolean; name?: string;
  /** continuous colour scale legend (e.g. phase −π…π) */
  colorbar?: ColorBar;
  /** relative change of the displayed geometry over the run; below ~0.5 % a "below display resolution" notice is shown */
  change?: { rel: number; what?: string };
  /** optional magnified-deviation display (default off) */
  magnify?: Magnify;
  /** the view has no time dependence */
  isStatic?: boolean;
  /** the animation sweeps a parameter (not physical time), e.g. 'separation d' */
  sweepOf?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const h = useRef<Handle3D | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'nogl' | 'error'>(() => (webglAvailable() ? 'loading' : 'nogl'));
  const [info, setInfo] = useState<any>(null);
  const [errMsg, setErrMsg] = useState('');
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [rec, setRec] = useState<Recording | null>(null);
  const [fps, setFps] = useState<30 | 60>(60);
  const [fs, setFs] = useState(false);
  const fname = `qgdevs-${name ?? kind}`;

  useEffect(() => {
    if (state === 'nogl') return;
    let alive = true;
    import('../three/index').then((m) => {
      if (!alive || !el.current) return;
      const mount = { apparatus: m.mountApparatus, bloch: m.mountBloch, trajectories: m.mountTrajectories, surface: m.mountSurface, plot3d: m.mountPlot3D }[kind] as (e: HTMLElement, o: any) => Handle3D;
      try {
        h.current = mount(el.current, { ...opts, frame });
        setInfo({ ...(h.current.info ?? {}) }); onInfo?.(h.current.info);
        (el.current as any).__qgHandle = h.current; // exposed for automated leak checks
        setState('ready');
      } catch (e) { setErrMsg(String((e as Error).message)); setState('error'); }
    }).catch((e) => { if (alive) { setErrMsg(String(e?.message ?? e)); setState('error'); } });
    return () => { alive = false; h.current?.dispose(); h.current = null; };
  }, [kind]);

  useEffect(() => {
    if (!h.current) return;
    h.current.update({ ...opts, frame });
    setInfo({ ...(h.current.info ?? {}) }); onInfo?.(h.current.info);
  }, [opts]);
  useEffect(() => {
    if (!h.current || frame == null) return;
    if (h.current.setFrame) h.current.setFrame(frame); else h.current.update({ ...opts, frame });
    if (overlay) setInfo({ ...(h.current.info ?? {}) });
  }, [frame]);
  // stop a recording when playback ends
  useEffect(() => { if (rec && playing === false) stopRec(); }, [playing]);
  useEffect(() => {
    const f = () => setFs(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);

  const magOn = !!magnify?.on;
  const stampLines = () => [title ?? '', `${magOn ? 'MAGNIFIED · ' : ''}${badge}`, magOn ? `DEVIATION ×${fmtFactor(magnify!.factor)} — not to scale` : ''].filter(Boolean);
  /** title, provenance badge and magnification note are burned into every export */
  const stamp = (ctx: CanvasRenderingContext2D, scale: number) => {
    ctx.save();
    ctx.font = `600 ${13 * scale}px system-ui, sans-serif`; ctx.textBaseline = 'top';
    stampLines().forEach((l, k) => {
      const y = (8 + k * 18) * scale, w = ctx.measureText(l).width;
      ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fillRect(6 * scale, y - 2 * scale, w + 8 * scale, 17 * scale);
      ctx.fillStyle = k === 2 ? '#b3261e' : '#111'; ctx.fillText(l, 10 * scale, y);
    });
    ctx.restore();
  };
  const exportPNG = () => {
    const H = h.current; if (!H?.composite || !H.canvasSize) return;
    const { w, h: hh } = H.canvasSize();
    const k = Math.min(scale, 8192 / Math.max(w, hh));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k);
    const ctx = c.getContext('2d')!;
    H.composite(ctx, k, transparent); stamp(ctx, k);
    c.toBlob((b) => b && saveBlob(b, `${fname}-${scale}x.png`), 'image/png');
  };
  const startRec = () => {
    const H = h.current; if (!H?.composite || !H.canvasSize) return;
    const { w, h: hh } = H.canvasSize();
    const r = startRecording((ctx, s) => { H.composite!(ctx, s, false); stamp(ctx, s); }, w, hh, fps, Math.min(2, window.devicePixelRatio || 1));
    setRec(r);
    onRecordStart?.();
  };
  const stopRec = async () => {
    if (!rec) return;
    const r = rec; setRec(null);
    const { blob, ext } = await r.stop();
    saveBlob(blob, `${fname}.${ext}`);
  };

  if (state === 'nogl' || state === 'error') {
    return (
      <div>
        <p class="small muted" role="note">{state === 'nogl' ? 'WebGL is not available in this browser, so the high-quality 2-D view is shown instead.' : `3-D view failed to load (${errMsg}); showing the 2-D view.`}</p>
        {fallback}
      </div>
    );
  }
  return (
    <div ref={box} class={`view3d-box ${fs ? 'is-fs' : ''}`}>
      <div class="view3d" ref={el} role="img" aria-label={`${title ? title + ': ' : ''}${label}. Drag to rotate, scroll or pinch to zoom, right-drag or two-finger drag to pan.`}>
        <div class="view3d-head">
          {title && <span class="view3d-title">{title}</span>}
          <span class={`badge ${BADGE_CLASS[badge]}`} title={badge === 'CONCEPTUAL' ? 'Conceptual visualisation: illustrates relationships; positions are not physical space.' : 'Values come from the stated computation.'}>{badge}</span>
          {magOn && <span class="badge b-bad" data-magnified>MAGNIFIED</span>}
          {sweepOf ? <span class="badge b-neutral view3d-static" title="The animation steps through a parameter, not through physical time">parameter sweep: {sweepOf} (not time evolution)</span>
              : (isStatic ?? (frame === undefined && playing === undefined)) && <span class="badge b-neutral view3d-static" title="This view has no time dependence">static: no time evolution in this view</span>}
        </div>
        {magOn && <div class="view3d-magnote" role="note">DEVIATION ×{fmtFactor(magnify!.factor)} from {magnify!.reference ?? 'the reference'} — not to scale</div>}
        {(legend && legend.length > 0) || colorbar ? (
          <div class="view3d-legend" aria-label="Legend">
            {legend && legend.length > 0 && <ul>{legend.map((l) => <li title={l.label}><span class="swatch" style={{ background: l.color }} /><span class="lg-text">{l.label}</span></li>)}</ul>}
            {colorbar && (
              <div class="cbar">
                {(colorbar.titleTex || colorbar.title) && <div class="cbar-title">{colorbar.titleTex ? <Tex tex={colorbar.titleTex} alt={colorbar.title} /> : colorbar.title}</div>}
                <div class="cbar-bar" style={{ background: mapGradient(colorbar.map) }} />
                <div class="cbar-ticks">{colorbar.ticks.map((t) => <span style={{ left: `${t.at * 100}%` }}><Tex tex={t.tex} /></span>)}</div>
              </div>
            )}
          </div>
        ) : null}
        {change && !magOn && Math.abs(change.rel) < 5e-3 && (
          <div class="view3d-below" role="note" data-below-resolution>Change over this run{change.what ? ` (${change.what})` : ''}: {fmtFactor(Math.abs(change.rel))} — below display resolution{magnify ? '; use “Show deviation ×k” to see it' : ''}.</div>
        )}
        {state === 'loading' && <div class="row muted" style={{ position: 'absolute', inset: 0, justifyContent: 'center' }}><span class="spinner" /> Loading 3-D view…</div>}
        {state === 'ready' && overlay && <div class="view3d-overlay">{overlay(info)}</div>}
        {rec && <span class="view3d-rec" role="status">● REC</span>}
      </div>
      <div class="row view3d-tools" role="toolbar" aria-label="3-D view tools">
        <button type="button" class="btn-sm" onClick={() => (h.current?.fitView ?? h.current?.resetView)?.call(h.current)} title="Frame all data and labels">Fit view</button>
        {magnify && (
          <label class="small row" style={{ gap: '4px' }} title="Display (state − reference) multiplied by the factor shown; values in exports and frame data stay physical">
            <input type="checkbox" checked={magnify.on} onChange={(e: any) => magnify.onToggle(e.currentTarget.checked)} data-magnify /> Show deviation ×{fmtFactor(magnify.factor)}
          </label>
        )}
        <button type="button" class="btn-sm" onClick={() => (fs ? document.exitFullscreen() : box.current?.requestFullscreen?.())} aria-pressed={fs}>{fs ? 'Exit fullscreen' : 'Fullscreen'}</button>
        <label class="small">Still{' '}
          <select class="input" style={{ padding: '2px 4px' }} value={scale} onChange={(e: any) => setScale(Number(e.currentTarget.value))} aria-label="Export resolution">
            <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option><option value={8}>8× (≤8K)</option>
          </select></label>
        <label class="small row" style={{ gap: '3px' }}><input type="checkbox" checked={transparent} onChange={(e: any) => setTransparent(e.currentTarget.checked)} />transparent</label>
        <button type="button" class="btn-sm" onClick={exportPNG}>PNG</button>
        {videoSupported() && (
          <>
            <select class="input" style={{ padding: '2px 4px' }} value={fps} onChange={(e: any) => setFps(Number(e.currentTarget.value) as 30 | 60)} aria-label="Video frame rate"><option value={30}>30 fps</option><option value={60}>60 fps</option></select>
            {rec ? <button type="button" class="btn-sm" onClick={stopRec}>■ Stop video</button> : <button type="button" class="btn-sm" onClick={startRec}>● Video</button>}
          </>
        )}
        {frameData && <button type="button" class="btn-sm" onClick={() => saveBlob(new Blob([JSON.stringify(frameData(), null, 2)], { type: 'application/json' }), `${fname}-frame.json`)}>Frame data</button>}
        <span class="small muted hide-sm">Drag: rotate · wheel/pinch: zoom · right-drag: pan{prefersReducedMotion() ? ' · reduced motion: starts paused' : ''}</span>
      </div>
    </div>
  );
}
