/** Play / pause / scrub / speed controls for animations driven by computed frames. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { prefersReducedMotion } from '../lib/store';
import { fmtQ } from '../lib/format';

export function usePlayer(n: number, baseFps = 24) {
  const [frame, setFrame] = useState(Math.max(0, n - 1));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const raf = useRef(0);
  useEffect(() => { setFrame((f) => Math.min(f, Math.max(0, n - 1))); }, [n]);
  useEffect(() => {
    if (!playing || n < 2) return;
    let last = performance.now(), acc = 0;
    const step = (now: number) => {
      acc += ((now - last) / 1000) * baseFps * speed; last = now;
      if (acc >= 1) {
        const k = Math.floor(acc); acc -= k;
        setFrame((f) => { const nf = f + k; if (nf >= n - 1) { setPlaying(false); return n - 1; } return nf; });
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, n, baseFps]);
  const toggle = () => { if (!playing && frame >= n - 1) setFrame(0); setPlaying((p) => !p); };
  return { frame, setFrame, playing, setPlaying, toggle, speed, setSpeed };
}

export function PlayerControls({ p, n, t, label, tUnit = 's' }: { p: ReturnType<typeof usePlayer>; n: number; t?: number[]; label: string; tUnit?: string }) {
  const reduced = prefersReducedMotion();
  return (
    <div class="player" role="group" aria-label={`${label} animation controls`}>
      <button type="button" class="btn" onClick={p.toggle} aria-pressed={p.playing} disabled={n < 2}>{p.playing ? '❚❚ Pause' : '▶ Play'}</button>
      <button type="button" class="btn-sm" onClick={() => { p.setPlaying(false); p.setFrame(0); }} aria-label="Go to start">⏮</button>
      <button type="button" class="btn-sm" onClick={() => p.setFrame(Math.max(0, p.frame - 1))} aria-label="Previous frame">◀</button>
      <input type="range" min={0} max={Math.max(0, n - 1)} value={p.frame} aria-label={`${label} time`} aria-valuetext={t ? fmtQ(t[p.frame], tUnit) : String(p.frame)}
        onInput={(e: any) => { p.setPlaying(false); p.setFrame(Number(e.currentTarget.value)); }} />
      <button type="button" class="btn-sm" onClick={() => p.setFrame(Math.min(n - 1, p.frame + 1))} aria-label="Next frame">▶</button>
      <label class="small">Speed{' '}
        <select class="input" style={{ padding: '3px 6px' }} value={p.speed} onChange={(e: any) => p.setSpeed(Number(e.currentTarget.value))}>
          {[0.25, 0.5, 1, 2, 4].map((s) => <option value={s}>{s}×</option>)}
        </select>
      </label>
      <span class="small mono" aria-live="off">{t ? `t = ${fmtQ(t[p.frame], tUnit)}` : `frame ${p.frame + 1}/${n}`}</span>
      {reduced && <span class="small muted">Reduced motion: animation runs only when you press Play.</span>}
    </div>
  );
}
