/**
 * "Graphics performance on this device": animates a real 3-D scene (the flagship apparatus, driven by the
 * entangling-phase time series computed by the local engine for the reference design) for a fixed time and
 * reports the frame rate the device actually achieves, the GPU/renderer, the quality tier and pixel ratio.
 * Nothing is estimated; numbers are measured in this browser.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { View3D } from './View3D';
import { webglRenderer } from '../three/detect';
import { KV } from './ui';
import { RunBar, useResultFlag } from './Reset';
import type { PredictResult } from '../lib/types';
import { DEFAULT_DESIGN, DEFAULT_ENV } from '../lib/types';

interface Result { medianFps: number; p95Ms: number; worstMs: number; frames: number; seconds: number; renderer: string; tier: string; dpr: number; size: string }

const DURATION_MS = 8000, WARMUP_MS = 1000;

export function PerfTest() {
  const [d, setD] = useState<PredictResult | null>(null);
  const [frame, setFrame] = useState(0);
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useResultFlag(res != null);

  const start = async () => {
    setErr(''); setRes(null);
    try {
      const eng = await import('../engine/index');
      const p = eng.predictScenario(DEFAULT_DESIGN, DEFAULT_ENV, 240);
      if (!('models' in p)) throw new Error('reference design not admissible');
      setD(p as PredictResult); setFrame(0); setRunning(true);
    } catch (e) { setErr(String((e as Error).message)); }
  };

  useEffect(() => {
    if (!running || !d) return;
    const n = d.time_series!.t.length;
    const times: number[] = [];
    let raf = 0, t0 = 0, last = 0, f = 0;
    const step = (now: number) => {
      // the clock starts only once the lazily loaded 3-D scene is on screen, so loading is never counted as a frame
      if (!box.current?.querySelector('.view3d canvas')) { t0 = 0; raf = requestAnimationFrame(step); return; }
      if (!t0) { t0 = now; last = now; }
      const el = now - t0;
      if (el > WARMUP_MS) times.push(now - last);
      last = now;
      f = (f + 1) % n; setFrame(f);
      if (el < WARMUP_MS + DURATION_MS) { raf = requestAnimationFrame(step); return; }
      const s = [...times].sort((a, b) => a - b);
      const med = s[Math.floor(s.length / 2)] || 0;
      import('../three/core').then((core) => {
        const c = box.current?.querySelector('canvas');
        setRes({
          medianFps: med ? 1000 / med : 0, p95Ms: s[Math.floor(s.length * 0.95)] || 0, worstMs: s[s.length - 1] || 0,
          frames: s.length, seconds: DURATION_MS / 1000, renderer: webglRenderer(), tier: core.tier,
          dpr: window.devicePixelRatio || 1, size: c ? `${c.width}×${c.height} px` : '—',
        });
        setRunning(false);
      });
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [running, d]);

  const ts = d?.time_series;
  // stable scene description: only the frame changes during the test (as in the flagship page)
  const opts = useMemo(() => (d && ts ? { positions: d.branch_positions, radiusA: d.design.radius_A, radiusB: d.design.radius_B, energies: d.total_energies_J, phases: { t: ts.t, deltaPhi: ts.delta_phi } } : null), [d]);
  return (
    <div>
      <p class="small muted">Animates the flagship apparatus view (phases from the reference design, computed in this browser) for {DURATION_MS / 1000} s after a {WARMUP_MS / 1000} s warm-up and measures every frame. Use it on any phone or computer to see how smoothly the 3-D views run there.</p>
      <RunBar label={running ? 'Measuring…' : 'Run 8-second graphics test'} busy={running} onRun={start}><span class="small muted">GPU: {webglRenderer()}</span></RunBar>
      {err && <p class="field-error">{err}</p>}
      {d && ts && (running || res) && (
        <div ref={box} style={{ marginTop: '8px' }}>
          <View3D kind="apparatus" title="Graphics test" badge="COMPUTED LOCALLY" label="Graphics performance test scene" frame={frame} playing={running}
            opts={opts}
            fallback={<p class="small muted">WebGL is not available, so 3-D views use their 2-D fallbacks on this device.</p>} />
        </div>
      )}
      {res && (
        <div style={{ marginTop: '8px' }} role="status">
          <KV rows={[
            ['Median frame rate', <b>{res.medianFps.toFixed(1)} fps</b>],
            ['95th-percentile frame time', `${res.p95Ms.toFixed(1)} ms`],
            ['Slowest frame', `${res.worstMs.toFixed(0)} ms`],
            ['Frames measured', `${res.frames} in ${res.seconds} s`],
            ['Renderer (GPU)', res.renderer],
            ['Quality tier', `${res.tier}${/swiftshader|llvmpipe|software|basic render/i.test(res.renderer) ? ' (software renderer detected: lighter tier used automatically)' : ''}`],
            ['Device pixel ratio · canvas', `${res.dpr} · ${res.size}`],
          ]} />
          <p class="small muted">{res.medianFps >= 55 ? 'Smooth: the display refresh rate is reached.' : res.medianFps >= 30 ? 'Usable: animations run, but below the display refresh rate.' : 'Slow on this device: consider Settings → reduced motion, or the 2-D views.'}</p>
        </div>
      )}
    </div>
  );
}
