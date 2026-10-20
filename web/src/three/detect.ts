/**
 * WebGL capability and renderer checks that do not pull in three.js (safe to import statically).
 *
 * The whole app uses ONE WebGL context (see three/core.ts: every 3-D view renders through a single shared
 * renderer). The capability probe creates that context with the attributes the renderer needs and hands it
 * over to the renderer later, so a page never holds more than one WebGL context — browsers allow only a few
 * per page (Chrome: 16) and low-memory GPUs (phones, small VMs) run out of video memory long before that.
 */
const DPR = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

/**
 * Context attributes of the shared renderer (multisampling only below 2× pixel density — see core.ts). The shared
 * canvas is never displayed: every frame is read back into a view's canvas with drawImage, so its drawing buffer
 * is preserved — with preserveDrawingBuffer false the browser may discard it at any frame boundary, which on real
 * GPUs left views blank after a context restore.
 */
export const GL_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true, depth: true, stencil: false, antialias: DPR < 2, premultipliedAlpha: true,
  preserveDrawingBuffer: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false,
};

interface Probe { available: boolean; renderer: string; canvas: HTMLCanvasElement | null; gl: WebGL2RenderingContext | null }
let probe: Probe | null = null;

function runProbe(): Probe {
  if (probe) return probe;
  let available = false, renderer = 'WebGL unavailable';
  let canvas: HTMLCanvasElement | null = null, gl2: WebGL2RenderingContext | null = null;
  try {
    canvas = document.createElement('canvas');
    gl2 = canvas.getContext('webgl2', GL_ATTRIBUTES) as WebGL2RenderingContext | null;
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = gl2;
    if (!gl) {
      // WebGL 1 only: report it (the 3-D views then explain that they need WebGL 2) and release it at once
      gl = canvas.getContext('webgl', GL_ATTRIBUTES) as WebGLRenderingContext | null;
    }
    if (gl) {
      available = true;
      try {
        const e = gl.getExtension('WEBGL_debug_renderer_info');
        renderer = String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      } catch { renderer = 'unknown'; }
      if (!gl2) gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* no WebGL */ }
  probe = { available, renderer, canvas: gl2 ? canvas : null, gl: gl2 };
  return probe;
}

export function webglAvailable(): boolean { return runProbe().available; }

/** GPU / renderer name reported by WebGL (cached). */
export function webglRenderer(): string { return runProbe().renderer; }

/**
 * The page's single WebGL 2 context, for the shared renderer. Returns the probe's context (created once per page
 * load); null when WebGL 2 is unavailable.
 */
export function sharedWebGL2(): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  const p = runProbe();
  return p.canvas && p.gl ? { canvas: p.canvas, gl: p.gl } : null;
}
