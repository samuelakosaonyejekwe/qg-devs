/**
 * Playback for animations driven by solver output.
 *
 * The player advances a continuous position `pos` (fractional sample index) at the display refresh rate
 * (~60 fps); views may interpolate between neighbouring solver samples for smooth display. The controls
 * always state which solver sample(s) are being shown, and interpolated values are never reported as
 * solver output. `frame` is the nearest sample index for views that show discrete samples only.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { prefersReducedMotion } from '../lib/store';
import { fmtQ } from '../lib/format';

export function usePlayer(n: number, baseFps = 24) {
  const [pos, setPos] = useState(Math.max(0, n - 1));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const raf = useRef(0);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  useEffect(() => { setPos((f) => Math.min(f, Math.max(0, n - 1))); }, [n]);
  useEffect(() => {
    if (!playing || n < 2) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      let ended = false;
      setPos((f) => {
        let nf = f + dt * baseFps * speed;
        if (nf >= n - 1) { if (loopRef.current) nf = nf - (n - 1); else { nf = n - 1; ended = true; } }
        return nf;
      });
      if (ended) { setPlaying(false); return; }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, n, baseFps]);
  const toggle = () => { if (!playing && pos >= n - 1) setPos(0); setPlaying((p) => !p); };
  const frame = Math.max(0, Math.min(n - 1, Math.round(pos)));
  const setFrame = (f: number | ((x: number) => number)) => setPos((p) => (typeof f === 'function' ? f(Math.round(p)) : f));
  return { pos, setPos, frame, setFrame, playing, setPlaying, toggle, speed, setSpeed, loop, setLoop, n };
}

export type PlayerState = ReturnType<typeof usePlayer>;

/** Linear interpolation of a sampled series at the player's fractional position (display only). */
export function interp(arr: ArrayLike<number>, pos: number): number {
  if (!arr.length) return NaN;
  const x = Math.max(0, Math.min(arr.length - 1, pos));
  const i = Math.floor(x), j = Math.min(arr.length - 1, i + 1), w = x - i;
  return arr[i] * (1 - w) + arr[j] * w;
}

export function PlayerControls({ p, n, t, label, tUnit = 's' }: { p: PlayerState; n: number; t?: number[]; label: string; tUnit?: string }) {
  const reduced = prefersReducedMotion();
  const i = Math.floor(Math.max(0, Math.min(n - 1, p.pos)));
  const frac = p.pos - i;
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    const m: Record<string, () => void> = {
      ' ': p.toggle, k: p.toggle, ArrowLeft: () => { p.setPlaying(false); p.setPos(Math.max(0, Math.ceil(p.pos) - 1)); },
      ArrowRight: () => { p.setPlaying(false); p.setPos(Math.min(n - 1, Math.floor(p.pos) + 1)); }, Home: () => p.setPos(0), End: () => p.setPos(n - 1),
      l: () => p.setLoop((x) => !x),
    };
    if (!m[e.key]) return;
    if ((e.target as HTMLElement).tagName === 'INPUT' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; // native range handling
    e.preventDefault(); m[e.key]();
  };
  const sampleText = t
    ? frac > 1e-3 && i + 1 < n
      ? `display between solver samples ${i + 1}/${n} (t = ${fmtQ(t[i], tUnit)}) and ${i + 2} (t = ${fmtQ(t[i + 1], tUnit)}), interpolated for display only`
      : `solver sample ${i + 1}/${n}: t = ${fmtQ(t[i], tUnit)}`
    : `sample ${i + 1}/${n}`;
  return (
    <div class="player" role="group" aria-label={`${label} animation controls (Space: play/pause, ←/→: step, Home/End, L: loop)`} tabIndex={0} onKeyDown={onKey as any}>
      <button type="button" class="btn" onClick={p.toggle} aria-pressed={p.playing} disabled={n < 2} data-play>{p.playing ? '❚❚ Pause' : '▶ Play'}</button>
      <button type="button" class="btn-sm" onClick={() => { p.setPlaying(false); p.setPos(0); }} aria-label="Go to start">⏮</button>
      <button type="button" class="btn-sm" onClick={() => { p.setPlaying(false); p.setPos(Math.max(0, Math.ceil(p.pos) - 1)); }} aria-label="Previous sample">◀</button>
      <input type="range" min={0} max={Math.max(0, n - 1)} step="any" value={p.pos} aria-label={`${label} time`} aria-valuetext={t ? fmtQ(t[i], tUnit) : String(i)}
        onInput={(e: any) => { p.setPlaying(false); p.setPos(Number(e.currentTarget.value)); }} />
      <button type="button" class="btn-sm" onClick={() => { p.setPlaying(false); p.setPos(Math.min(n - 1, Math.floor(p.pos) + 1)); }} aria-label="Next sample">▶</button>
      <label class="small">Speed{' '}
        <select class="input" style={{ padding: '3px 6px' }} value={p.speed} onChange={(e: any) => p.setSpeed(Number(e.currentTarget.value))}>
          {[0.1, 0.25, 0.5, 1, 2, 4].map((s) => <option value={s}>{s}×</option>)}
        </select>
      </label>
      <label class="small row" style={{ gap: '4px' }}><input type="checkbox" checked={p.loop} onChange={(e: any) => p.setLoop(e.currentTarget.checked)} /> Loop</label>
      <span class="small mono player-sample" aria-live="off">{sampleText}</span>
      {reduced && <span class="small muted">Reduced motion: animation starts paused and runs only when you press Play.</span>}
    </div>
  );
}
