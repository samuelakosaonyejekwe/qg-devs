/**
 * WebGL capability and renderer checks that do not pull in three.js (safe to import statically).
 *
 * Each probe needs a WebGL context, and browsers allow only a few (Chrome: 16) per page — creating more
 * forcibly loses the oldest, including live 3-D views, and creating them in bursts can make the browser reset
 * the GPU and block WebGL for the page. So the probe runs once per page load, its result is cached, and its
 * context is released immediately.
 */
let probe: { available: boolean; renderer: string } | null = null;

function runProbe(): { available: boolean; renderer: string } {
  if (probe) return probe;
  let available = false, renderer = 'WebGL unavailable';
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      available = true;
      try {
        const e = gl.getExtension('WEBGL_debug_renderer_info');
        renderer = String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      } catch { renderer = 'unknown'; }
      gl.getExtension('WEBGL_lose_context')?.loseContext(); // release the probe context straight away
    }
  } catch { /* no WebGL */ }
  probe = { available, renderer };
  return probe;
}

export function webglAvailable(): boolean { return runProbe().available; }

/** GPU / renderer name reported by WebGL (cached; see above). */
export function webglRenderer(): string { return runProbe().renderer; }

