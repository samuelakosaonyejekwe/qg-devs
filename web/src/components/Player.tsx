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
  // starts at t = 0, loops by default; a new run (n changes) rewinds to t = 0
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const raf = useRef(0);
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const posRef = useRef(pos);
  posRef.current = pos;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const userPaused = useRef(false);
  const autoStarted = useRef(false);
  /** visibility of every control set bound to this player (one player may be shown in several cards) */
  const visibleControls = useRef(new Set<symbol>());
  useEffect(() => { setPos(0); autoStarted.current = false; }, [n]);
  useEffect(() => {
    if (!playing || n < 2) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      let nf = posRef.current + dt * baseFps * speed;
      if (nf >= n - 1) {
        if (loopRef.current) nf = nf % (n - 1);
        else { setPos(n - 1); setPlaying(false); return; }
      }
      setPos(nf);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, n, baseFps]);
  // Play at (or near) the end rewinds to t = 0 and plays
  const play = () => { userPaused.current = false; if (posRef.current >= n - 1 - 1e-6) setPos(0); setPlaying(true); };
  const pause = () => { userPaused.current = true; setPlaying(false); };
  const toggle = () => (playing ? pause() : play());
  const frame = Math.max(0, Math.min(n - 1, Math.round(pos)));
  const setFrame = (f: number | ((x: number) => number)) => setPos((p) => (typeof f === 'function' ? f(Math.round(p)) : f));
  return { pos, setPos, frame, setFrame, playing, setPlaying, toggle, play, pause, speed, setSpeed, loop, setLoop, n, userPaused, autoStarted, visibleControls, playingRef };
}

export type PlayerState = ReturnType<typeof usePlayer>;

/** Linear interpolation of a sampled series at the player's fractional position (display only). */
export function interp(arr: ArrayLike<number>, pos: number): number {
  if (!arr.length) return NaN;
  const x = Math.max(0, Math.min(arr.length - 1, pos));
  const i = Math.floor(x), j = Math.min(arr.length - 1, i + 1), w = x - i;
  return arr[i] * (1 - w) + arr[j] * w;
}

export function PlayerControls({ p, n, t, label, tUnit = 's', autoplay = true, syncNote }: { p: PlayerState; n: number; t?: number[]; label: string; tUnit?: string; autoplay?: boolean; syncNote?: string }) {
  const reduced = prefersReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const i = Math.floor(Math.max(0, Math.min(n - 1, p.pos)));
  const frac = p.pos - i;
  // Auto-play (looping) the first time any control set of this player comes into view; pause only while
  // none of them is visible (the same player may be shown in several cards).
  const me = useRef(Symbol('controls'));
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined' || n < 2) return;
    const set = p.visibleControls.current;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) set.add(me.current); else set.delete(me.current);
      const anyVisible = set.size > 0;
      if (anyVisible && autoplay && !reduced && !p.autoStarted.current && !p.userPaused.current) { p.autoStarted.current = true; p.play(); }
      else if (!anyVisible && p.playingRef.current) p.setPlaying(false);
      else if (anyVisible && !p.playingRef.current && p.autoStarted.current && !p.userPaused.current && !reduced) p.setPlaying(true);
    }, { threshold: 0.2 });
    io.observe(el);
    return () => { io.disconnect(); set.delete(me.current); };
  }, [n]);
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'SELECT') return;
    const m: Record<string, () => void> = {
      ' ': p.toggle, k: p.toggle, ArrowLeft: () => { p.pause(); p.setPos(Math.max(0, Math.ceil(p.pos) - 1)); },
      ArrowRight: () => { p.pause(); p.setPos(Math.min(n - 1, Math.floor(p.pos) + 1)); }, Home: () => p.setPos(0), End: () => p.setPos(n - 1),
      l: () => p.setLoop((x) => !x),
    };
    if (!m[e.key]) return;
    if ((e.target as HTMLElement).tagName === 'INPUT' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); m[e.key]();
  };
  if (n < 2) return <p class="small muted" role="note">Static result: a single computed state, nothing to animate.</p>;
  const tNow = t ? (frac > 1e-3 && i + 1 < n ? t[i] + (t[i + 1] - t[i]) * frac : t[i]) : null;
  const sampleText = t
    ? frac > 1e-3 && i + 1 < n
      ? `between solver samples ${i + 1} and ${i + 2} of ${n} (interpolated for display only)`
      : `solver sample ${i + 1} of ${n}`
    : `sample ${i + 1} of ${n}`;
  return (
    <div class="player" ref={box} role="group" aria-label={`${label} animation controls (Space: play/pause, ←/→: step, Home/End, L: loop)`} tabIndex={0} onKeyDown={onKey as any}>
      <button type="button" class="play-big" onClick={p.toggle} aria-pressed={p.playing} disabled={n < 2} data-play aria-label={p.playing ? `Pause ${label}` : `Play ${label}`}>
        <span aria-hidden="true">{p.playing ? '❚❚' : '▶'}</span><span class="play-big-lbl">{p.playing ? 'Pause' : 'Play'}{syncNote ? ` ${syncNote}` : ''}</span>
      </button>
      <span class="player-time" aria-live="off">{tNow != null ? <>t = <b>{fmtQ(tNow, tUnit)}</b></> : null}</span>
      <button type="button" class="btn-sm" onClick={() => { p.pause(); p.setPos(0); }} aria-label="Go to start">⏮</button>
      <button type="button" class="btn-sm" onClick={() => { p.pause(); p.setPos(Math.max(0, Math.ceil(p.pos) - 1)); }} aria-label="Previous sample">◀</button>
      <input type="range" min={0} max={Math.max(0, n - 1)} step="any" value={p.pos} aria-label={`${label} time`} aria-valuetext={tNow != null ? fmtQ(tNow, tUnit) : String(i)}
        onInput={(e: any) => { p.pause(); p.setPos(Number(e.currentTarget.value)); }} />
      <button type="button" class="btn-sm" onClick={() => { p.pause(); p.setPos(Math.min(n - 1, Math.floor(p.pos) + 1)); }} aria-label="Next sample">▶</button>
      <label class="small">Speed{' '}
        <select class="input" style={{ padding: '3px 6px' }} value={p.speed} onChange={(e: any) => p.setSpeed(Number(e.currentTarget.value))}>
          {[0.1, 0.25, 0.5, 1, 2, 4].map((s) => <option value={s}>{s}×</option>)}
        </select>
      </label>
      <label class="small row" style={{ gap: '4px' }}><input type="checkbox" checked={p.loop} onChange={(e: any) => p.setLoop(e.currentTarget.checked)} /> Loop</label>
      <span class="small mono player-sample" aria-live="off">{sampleText}</span>
      {reduced && <span class="small muted">Reduced motion: press Play to animate.</span>}
    </div>
  );
}
