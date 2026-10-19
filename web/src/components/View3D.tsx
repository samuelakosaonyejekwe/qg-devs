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

type Kind = 'apparatus' | 'bloch' | 'trajectories' | 'surface' | 'plot3d';
export type Badge3D = 'COMPUTED' | 'COMPUTED LOCALLY' | 'SYNTHETIC' | 'CONCEPTUAL';
export interface Handle3D {
  update(o: any): void; dispose(): void; resetView(): void; setFrame?(f: number): void; toPNG?(s?: number, transparent?: boolean): string;
  composite?(ctx: CanvasRenderingContext2D, scale: number, transparent: boolean): void; canvasSize?(): { w: number; h: number };
  memory?(): { geometries: number; textures: number }; info?: any;
}

const BADGE_CLASS: Record<Badge3D, string> = { COMPUTED: 'b-computed', 'COMPUTED LOCALLY': 'b-local', SYNTHETIC: 'b-synthetic', CONCEPTUAL: 'b-estimated' };

export function View3D({ kind, opts, frame, fallback, label, overlay, onInfo, title, badge = 'COMPUTED', legend, frameData, onRecordStart, playing, name }: {
  kind: Kind; opts: any; frame?: number; fallback: ComponentChildren; label: string; overlay?: (info: any) => ComponentChildren; onInfo?: (info: any) => void;
  title?: string; badge?: Badge3D; legend?: { label: string; color: string }[]; frameData?: () => unknown;
  /** called when video recording starts (e.g. rewind and play); recording stops when `playing` turns false */
  onRecordStart?: () => void; playing?: boolean; name?: string;
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

  const exportPNG = () => {
    const url = h.current?.toPNG?.(scale, transparent); if (!url) return;
    const a = document.createElement('a'); a.href = url; a.download = `${fname}-${scale}x.png`; a.rel = 'external'; document.body.appendChild(a); a.click(); a.remove();
  };
  const startRec = () => {
    const H = h.current; if (!H?.composite || !H.canvasSize) return;
    const { w, h: hh } = H.canvasSize();
    const r = startRecording((ctx, s) => H.composite!(ctx, s, false), w, hh, fps, Math.min(2, window.devicePixelRatio || 1));
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
        </div>
        {legend && legend.length > 0 && <ul class="view3d-legend" aria-label="Legend">{legend.map((l) => <li><span class="swatch" style={{ background: l.color }} />{l.label}</li>)}</ul>}
        {state === 'loading' && <div class="row muted" style={{ position: 'absolute', inset: 0, justifyContent: 'center' }}><span class="spinner" /> Loading 3-D view…</div>}
        {state === 'ready' && overlay && <div class="view3d-overlay">{overlay(info)}</div>}
        {rec && <span class="view3d-rec" role="status">● REC</span>}
      </div>
      <div class="row view3d-tools" role="toolbar" aria-label="3-D view tools">
        <button type="button" class="btn-sm" onClick={() => h.current?.resetView()}>Reset view</button>
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
