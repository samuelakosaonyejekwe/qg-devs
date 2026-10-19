/**
 * Lazy 3-D view: loads three.js only when this component mounts and WebGL is available; otherwise shows the
 * provided 2-D fallback. Device quality adapts inside the 3-D module; values and positions never change.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { webglAvailable } from '../three/detect';

type Kind = 'apparatus' | 'bloch' | 'trajectories' | 'surface';
export interface Handle3D { update(o: any): void; dispose(): void; resetView(): void; setFrame?(f: number): void; toPNG?(s?: number): string; info?: any }

export function View3D({ kind, opts, frame, fallback, label, overlay, onInfo }: {
  kind: Kind; opts: any; frame?: number; fallback: ComponentChildren; label: string; overlay?: (info: any) => ComponentChildren; onInfo?: (info: any) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const h = useRef<Handle3D | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'nogl' | 'error'>(() => (webglAvailable() ? 'loading' : 'nogl'));
  const [info, setInfo] = useState<any>(null);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    if (state === 'nogl') return;
    let alive = true;
    import('../three/index').then((m) => {
      if (!alive || !el.current) return;
      const mount = { apparatus: m.mountApparatus, bloch: m.mountBloch, trajectories: m.mountTrajectories, surface: m.mountSurface }[kind] as (e: HTMLElement, o: any) => Handle3D;
      try {
        h.current = mount(el.current, { ...opts, frame });
        setInfo({ ...(h.current.info ?? {}) }); onInfo?.(h.current.info);
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

  if (state === 'nogl' || state === 'error') {
    return (
      <div>
        <p class="small muted" role="note">{state === 'nogl' ? 'WebGL is not available in this browser, so the 2-D view is shown instead.' : `3-D view failed to load (${errMsg}); showing the 2-D view.`}</p>
        {fallback}
      </div>
    );
  }
  return (
    <div>
      <div class="view3d" ref={el} role="img" aria-label={`${label}. Drag to rotate, scroll or pinch to zoom, right-drag or two-finger drag to pan.`}>
        {state === 'loading' && <div class="row muted" style={{ position: 'absolute', inset: 0, justifyContent: 'center' }}><span class="spinner" /> Loading 3-D view…</div>}
        {state === 'ready' && overlay && <div class="view3d-overlay">{overlay(info)}</div>}
      </div>
      <div class="row" style={{ marginTop: '6px' }}>
        <button type="button" class="btn-sm" onClick={() => h.current?.resetView()}>Reset view</button>
        <button type="button" class="btn-sm" onClick={() => {
          const url = h.current?.toPNG?.(3); if (!url) return;
          const a = document.createElement('a'); a.href = url; a.download = `qgdevs-${kind}.png`; a.rel = 'external'; document.body.appendChild(a); a.click(); a.remove();
        }}>PNG (3×)</button>
        <span class="small muted">Drag: rotate · wheel/pinch: zoom · right-drag: pan</span>
      </div>
    </div>
  );
}
