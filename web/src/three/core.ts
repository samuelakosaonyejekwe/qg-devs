/**
 * Shared high-fidelity three.js stage.
 *
 * Rendering: antialiased WebGL, ACES filmic tone mapping, sRGB output, physically based lighting from a
 * procedural studio environment (RoomEnvironment through PMREM — nothing downloaded), key/fill/rim lights
 * and soft shadows. Text is rendered as crisp HTML (CSS2DRenderer); lines are anti-aliased screen-space
 * lines (Line2/LineMaterial). Pixel ratio is min(devicePixelRatio, 2) and is lowered only while the measured
 * frame time exceeds 33 ms, restoring automatically. Quality adaptation never changes positions or values.
 *
 * Export composites the WebGL frame and the HTML labels into one canvas at 1×–8× resolution (optionally with
 * a transparent background), which is also what video capture records.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { mapRgb } from '../lib/colormaps';
import { loadKatex, renderTex } from '../components/Tex';

export interface Handle {
  update(opts: any): void;
  dispose(): void;
  resetView(): void;
  fitView?(): void;
  /** Fractional frame index: modules interpolate between solver samples for display only. */
  setFrame?(f: number): void;
  toPNG?(scale?: number, transparent?: boolean): string;
  /** Composite of WebGL + labels for export/video. */
  composite?(ctx: CanvasRenderingContext2D, scale: number, transparent: boolean): void;
  canvasSize?(): { w: number; h: number };
  memory?(): { geometries: number; textures: number };
  info?: any;
}

/**
 * Minimal devices only (≤ 2 logical cores or ≤ 2 GB memory). Ordinary 4-core laptops and phones with a GPU get
 * the full-quality tier; if their frames are genuinely slow, the runtime safety net in draw() lowers the pixel
 * ratio and then the tier automatically (measured, not guessed).
 */
export const lowEnd: boolean =
  typeof navigator !== 'undefined' &&
  ((navigator.hardwareConcurrency || 8) <= 2 || ((navigator as any).deviceMemory ?? 8) <= 2);

/**
 * Rendering quality tier. 'high' on capable GPUs; 'low' for software renderers (SwiftShader, llvmpipe) and
 * low-end devices: 1× pixels, standard materials, no shadows. Override with localStorage 'qg.gfx' =
 * 'high' | 'low' | 'auto'. Tiers change only rendering cost, never positions or values.
 */
export let tier: 'high' | 'low' = lowEnd ? 'low' : 'high';
function detectTier(gl: WebGLRenderingContext | WebGL2RenderingContext) {
  let pref = 'auto';
  try { pref = localStorage.getItem('qg.gfx') || 'auto'; } catch { /* ignore */ }
  if (pref === 'high' || pref === 'low') { tier = pref; return; }
  try { if (sessionStorage.getItem('qg.gfx.auto') === 'low') { tier = 'low'; return; } } catch { /* ignore */ }
  let name = '';
  try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch { /* ignore */ }
  tier = lowEnd || /swiftshader|llvmpipe|software|basic render/i.test(name) ? 'low' : 'high';
}

export const reducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface Theme { fg: string; bg: string; muted: string; accent: string }

export function readTheme(el: HTMLElement): Theme {
  const cs = getComputedStyle(el);
  const get = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { fg: get('--fg', '#1b1f24'), bg: get('--bg-elev', '#ffffff'), muted: get('--muted', '#6b7280'), accent: get('--accent', '#3442c0') };
}

/** three.Color accepts most CSS colour syntaxes; fall back if it cannot parse (e.g. oklch). */
export function color(css: string, fallback = '#888888'): THREE.Color {
  const c = new THREE.Color();
  try { c.setStyle(css); return c; } catch { return c.set(fallback); }
}

// Line materials need the viewport resolution; the owning stage updates them on resize.
const lineMaterials = new Set<LineMaterial>();

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  theme: Theme;
  labels: CSS2DRenderer;
  requestRender(): void;
  setHome(pos: THREE.Vector3, target: THREE.Vector3): void;
  resetView(): void;
  /** Frame a bounding sphere at the current aspect ratio (re-applied on resize until the user moves the camera). */
  fit(radius: number, center?: THREE.Vector3, dir?: THREE.Vector3): void;
  toPNG(scale?: number, transparent?: boolean): string;
  composite(ctx: CanvasRenderingContext2D, scale: number, transparent: boolean): void;
  canvasSize(): { w: number; h: number };
  memory(): { geometries: number; textures: number };
  /** Enable soft shadows from the key light onto meshes with castShadow/receiveShadow. */
  enableShadows(radius: number): void;
  dispose(): void;
}

export function createStage(el: HTMLElement): Stage {
  const theme = readTheme(el);
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  // Multisampling (MSAA) only below 2× pixel density: on high-density screens the pixels are already small
  // enough, and 4× multisampled colour + depth buffers at 2× resolution cost ~4× the view's video memory
  // (≈70 MB per 1085×518 view), which exhausted the GPU memory of smaller devices.
  const renderer = new THREE.WebGLRenderer({ antialias: (window.devicePixelRatio || 1) < 2, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  detectTier(renderer.getContext());
  const maxPR = tier === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  let pr = maxPR;
  renderer.setPixelRatio(pr);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' });
  el.appendChild(canvas);

  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
  labels.domElement.className = 'qg3d-labels';
  el.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  let envRT: THREE.WebGLRenderTarget | null = null;
  // Studio environment map (generated after the shader-error handler below is installed, so a failed link
  // inside the generator is detected and the map rebuilt).
  let envFailed = false, inEnv = false;
  const buildEnv = () => {
    envRT?.dispose();
    envFailed = false; inEnv = true;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
      scene.environment = envRT.texture;
      pmrem.dispose();
    } finally { inEnv = false; }
  };
  // Key / fill / rim plus hemisphere and ambient light: bright enough that mid-lightness colours read
  // clearly on both the light and the dark theme background.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb4bcd4, 0.9));
  scene.add(new THREE.AmbientLight(0xffffff, tier === 'high' ? 0.25 : 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(2.5, 3.5, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xe6ecff, 0.8); fill.position.set(-3, 1.5, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.7); rim.position.set(0, 2, -4); scene.add(rim);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reducedMotion();
  controls.dampingFactor = 0.1;
  controls.autoRotate = false;

  const home = { pos: new THREE.Vector3(0, 0, 3), target: new THREE.Vector3() };
  let fitSpec: { r: number; c: THREE.Vector3; dir: THREE.Vector3 } | null = null;
  let userMoved = false;
  controls.addEventListener('start', () => { userMoved = true; });
  const applyFit = () => {
    if (!fitSpec) return;
    const v = THREE.MathUtils.degToRad(camera.fov);
    const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
    const d = (fitSpec.r / Math.sin(Math.min(v, h) / 2)) * 1.04;
    home.pos.copy(fitSpec.c).addScaledVector(fitSpec.dir, d);
    home.target.copy(fitSpec.c);
    camera.near = d / 100; camera.far = d * 10; camera.updateProjectionMatrix();
  };
  let pending = false, disposed = false, lost = false, visible = true, dirtyHidden = false;
  let ema = 16, slowFrames = 0, fastFrames = 0, lastDraw = 0;

  const size = () => renderer.getSize(new THREE.Vector2());
  const syncLines = () => { const s = size(); for (const m of lineMaterials) m.resolution.set(s.x, s.y); };

  const draw = (now: number) => {
    pending = false;
    if (disposed || lost) return;
    if (!visible) { dirtyHidden = true; return; } // offscreen: render when scrolled back into view
    // Shaders compile synchronously on first use. (three's compileAsync is deliberately not used: it polls
    // programs across frames, and a scene disposed meanwhile — fast navigation, Reset, data refresh — leaves
    // it reading deleted programs: 'VALIDATE_STATUS false', null info logs, undefined 'isReady'.)
    if (controls.update()) requestRender();
    renderer.render(scene, camera);
    labels.render(scene, camera);
    // Adaptive resolution from the real frame interval during continuous animation: lower the pixel
    // ratio only while frames take > 33 ms, restore when they are fast again (values never change).
    const dt = now - lastDraw; lastDraw = now;
    if (dt > 0 && dt < 1000) {
      ema = 0.8 * ema + 0.2 * dt;
      if (ema > 33 && pr > 1) { if (++slowFrames > 3) { pr = Math.max(1, pr * 0.75); renderer.setPixelRatio(pr); syncLines(); slowFrames = 0; } }
      else if (ema > 40 && pr <= 1 && tier === 'high') {
        // Still too slow at 1× pixels on a GPU we classed as capable: drop the costly effects now and use the
        // lighter tier for the rest of this session (rendering cost only — positions and values are unchanged).
        if (++slowFrames > 90) {
          renderer.shadowMap.enabled = false; scene.environment = null; tier = 'low'; slowFrames = 0;
          try { sessionStorage.setItem('qg.gfx.auto', 'low'); } catch { /* ignore */ }
          el.dataset.gfxDowngraded = '1';
        }
      }
      else if (ema < 18 && pr < maxPR) { if (++fastFrames > 120) { pr = Math.min(maxPR, pr / 0.75); renderer.setPixelRatio(pr); syncLines(); fastFrames = 0; } }
      else slowFrames = 0;
    }
  };
  function requestRender() {
    if (pending || disposed) return;
    pending = true;
    requestAnimationFrame(draw);
  }
  controls.addEventListener('change', requestRender);

  // Shader programs whose link failed although both shaders compiled and the driver gave no diagnostic are
  // rebuilt (bounded retries). Seen on real GPUs (ANGLE/Metal) during the first burst of program links after a
  // page load: the link fails with an empty log and the object would otherwise never be drawn. A genuine
  // shader error (compile failure or a non-empty link log) is reported, never retried.
  let relinkAttempts = 0, relinkTimer = 0;
  const failedTypes = new Set<string>();
  let depthMat: THREE.MeshDepthMaterial | null = null;
  const relink = () => {
    relinkTimer = 0;
    if (disposed) return;
    relinkAttempts++;
    el.dataset.glRelink = String(relinkAttempts);
    const seen = new Set<THREE.Material>();
    scene.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        if (seen.has(m)) continue;
        seen.add(m);
        const prog = (renderer.properties.get(m) as { currentProgram?: { diagnostics?: { runnable: boolean } } }).currentProgram;
        if (prog?.diagnostics && !prog.diagnostics.runnable) m.dispose(); // releases the failed program; rebuilt on next draw
      }
    });
    if (envFailed && tier === 'high') buildEnv(); // a generator program failed: regenerate the environment map
    if (failedTypes.has('MeshDepthMaterial')) {
      // The shadow map's own depth material is internal to three: give shadow casters a fresh one whose
      // program cache key is new, so its program is linked again.
      depthMat?.dispose();
      const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      const key = `qg-relink-${relinkAttempts}`;
      d.customProgramCacheKey = () => key;
      depthMat = d;
      scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.castShadow) (o as THREE.Mesh).customDepthMaterial = d; });
    }
    failedTypes.clear();
    requestRender();
  };
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    if (inEnv) envFailed = true;
    const type = /#define SHADER_TYPE (\w+)/.exec(gl.getShaderSource(vs) ?? '')?.[1];
    if (type) failedTypes.add(type);
    const logs = { programLog: (gl.getProgramInfoLog(program) ?? '').trim(), vertexLog: (gl.getShaderInfoLog(vs) ?? '').trim(), fragmentLog: (gl.getShaderInfoLog(fs) ?? '').trim() };
    if (logs.programLog || logs.vertexLog || logs.fragmentLog) {
      // a genuine shader error always comes with a compiler or linker message: report it, never retry
      console.error('QG-DEVS 3-D: shader program failed to compile or link', { type, ...logs });
      return;
    }
    // No message at all: the GPU or driver failed (out of video memory, context being lost). Rebuild the failed
    // programs a bounded number of times; a lost context is rebuilt by three when the browser restores it.
    if (gl.isContextLost()) return;
    if (relinkAttempts < 3) {
      if (!relinkTimer) {
        console.warn(`QG-DEVS 3-D: the GPU failed to build a shader program without a message; rebuilding (attempt ${relinkAttempts + 1} of 3)`);
        relinkTimer = window.setTimeout(relink, 50 * 2 ** relinkAttempts);
      }
      return;
    }
    if (!el.dataset.glFault) {
      el.dataset.glFault = '1';
      console.warn('QG-DEVS 3-D: the GPU could not build some shader programs after 3 attempts; parts of this view may be missing');
    }
  };
  if (tier === 'high') buildEnv();

  const resize = () => {
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight || Math.round(w * 0.6));
    renderer.setSize(w, h, false);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (fitSpec && !userMoved) { applyFit(); camera.position.copy(home.pos); controls.target.copy(home.target); controls.update(); }
    syncLines();
    requestRender();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting);
    if (visible && dirtyHidden) { dirtyHidden = false; requestRender(); }
  }, { rootMargin: '150px' }) : null;
  io?.observe(el);

  // WebGL context loss (GPU reset, tab backgrounding on mobile): pause and resume on restore.
  const onLost = (e: Event) => { e.preventDefault(); lost = true; el.dataset.glLost = '1'; };
  const onRestored = () => { lost = false; delete el.dataset.glLost; requestRender(); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  /** Draw the current frame (WebGL + HTML labels) into a 2-D context at `scale` × CSS size. */
  function composite(ctx: CanvasRenderingContext2D, scale: number, transparent: boolean) {
    const s = size();
    const prevPR = renderer.getPixelRatio();
    renderer.setPixelRatio(scale);
    renderer.setSize(s.x, s.y, false);
    syncLines();
    renderer.render(scene, camera);
    if (!transparent) { ctx.fillStyle = readTheme(el).bg; ctx.fillRect(0, 0, s.x * scale, s.y * scale); }
    ctx.drawImage(canvas, 0, 0, s.x * scale, s.y * scale);
    // labels: project every CSS2DObject and draw its text
    scene.updateMatrixWorld();
    const v = new THREE.Vector3();
    scene.traverseVisible((o) => {
      if (!(o as any).isCSS2DObject) return;
      const div = (o as CSS2DObject).element as HTMLElement;
      v.setFromMatrixPosition(o.matrixWorld).project(camera);
      if (v.z < -1 || v.z > 1) return;
      const x = ((v.x + 1) / 2) * s.x * scale, y = ((1 - v.y) / 2) * s.y * scale;
      const cs = getComputedStyle(div);
      ctx.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * scale}px ${cs.fontFamily}`;
      ctx.fillStyle = cs.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(div.textContent ?? '', x, y);
    });
    renderer.setPixelRatio(prevPR);
    renderer.setSize(s.x, s.y, false);
    syncLines();
    requestRender();
  }

  return {
    scene, camera, renderer, controls, theme, labels, requestRender,
    setHome(pos, target) { home.pos.copy(pos); home.target.copy(target); },
    fit(radius, center = new THREE.Vector3(), dir = new THREE.Vector3(0.62, 0.45, 0.68)) {
      fitSpec = { r: radius, c: center.clone(), dir: dir.clone().normalize() };
      userMoved = false;
      applyFit();
      camera.position.copy(home.pos); controls.target.copy(home.target); camera.up.set(0, 1, 0); controls.update();
      requestRender();
    },
    resetView() {
      userMoved = false;
      applyFit();
      camera.position.copy(home.pos);
      controls.target.copy(home.target);
      camera.up.set(0, 1, 0);
      controls.update();
      requestRender();
    },
    composite,
    canvasSize() { const s = size(); return { w: s.x, h: s.y }; },
    toPNG(scale = 2, transparent = false) {
      const s = size();
      const k = Math.min(scale, 8192 / Math.max(s.x, s.y)); // cap at 8K on the long side
      const c = document.createElement('canvas');
      c.width = Math.round(s.x * k); c.height = Math.round(s.y * k);
      composite(c.getContext('2d')!, k, transparent);
      return c.toDataURL('image/png');
    },
    memory() { return { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }; },
    enableShadows(radius: number) {
      if (tier !== 'high') return; // soft shadows only on capable GPUs
      renderer.shadowMap.enabled = true;
      key.castShadow = true;
      key.shadow.mapSize.set(lowEnd ? 1024 : 2048, lowEnd ? 1024 : 2048);
      const c = key.shadow.camera as THREE.OrthographicCamera;
      c.left = c.bottom = -radius; c.right = c.top = radius; c.near = 0.01; c.far = 20;
      key.shadow.radius = 4;
      key.shadow.bias = -0.0005;
    },
    dispose() {
      disposed = true;
      if (relinkTimer) clearTimeout(relinkTimer);
      depthMat?.dispose();
      ro.disconnect();
      io?.disconnect();
      controls.dispose();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
          if (mat instanceof LineMaterial) lineMaterials.delete(mat);
          mat.dispose();
        }
        if ((o as any).isCSS2DObject) (o as CSS2DObject).element.remove();
      });
      envRT?.dispose();
      key.shadow.dispose();
      renderer.dispose();
      // Release the WebGL context (drawing buffers, shadow map, environment map) now rather than whenever the
      // canvas is garbage-collected: on GPUs with little memory, contexts left behind by closed views
      // exhausted video memory (Metal GL_OUT_OF_MEMORY), after which shader links failed and contexts were lost.
      renderer.forceContextLoss();
      canvas.remove();
      labels.domElement.remove();
    },
  };
}

/**
 * Crisp HTML text label anchored at a 3-D point. `height` (world units, legacy argument) selects the size
 * class: larger values give larger text.
 */
export function textSprite(text: string, css: string, height: number, cls = ''): CSS2DObject {
  const div = document.createElement('div');
  div.className = `qg3d-label ${cls}`;
  div.textContent = text;
  div.style.color = css;
  div.style.fontSize = `${Math.round(Math.max(11, Math.min(15, 11 + height * 30)))}px`;
  const o = new CSS2DObject(div);
  o.center.set(0.5, 0.5);
  return o;
}
export const label = textSprite;

/** HTML label typeset with KaTeX (falls back to the plain text until KaTeX has loaded). */
export function texLabel(tex: string, plain: string, css: string, cls = ''): CSS2DObject {
  const o = textSprite(plain, css, 0.08, cls);
  loadKatex().then((k) => { const html = renderTex(k, tex, false); if (html) o.element.innerHTML = html; }).catch(() => undefined);
  return o;
}

/** Anti-aliased screen-space line segments (pairs of points), width in CSS pixels. */
export function lineSegments(points: number[], css: string | THREE.Color, opacity = 1, widthPx = 1.6, dashed = false): LineSegments2 {
  const g = new LineSegmentsGeometry();
  g.setPositions(points);
  const m = new LineMaterial({ color: (css instanceof THREE.Color ? css : color(css)).getHex(), linewidth: widthPx, transparent: opacity < 1, opacity, dashed, dashSize: 0.03, gapSize: 0.02 });
  m.resolution.set(window.innerWidth, window.innerHeight);
  lineMaterials.add(m);
  const l = new LineSegments2(g, m);
  if (dashed) l.computeLineDistances();
  return l;
}

/**
 * Replace the segments of an anti-aliased line in place (pairs of points, 6 numbers per segment).
 *
 * LineSegmentsGeometry.setPositions allocates a new GPU buffer on every call and three frees GPU buffers only for
 * attributes still attached when the geometry is disposed, so calling it per animation frame leaked a buffer
 * per frame in the browser's GPU process (≈60/s per animated line; the macOS GPU runner ran out of memory).
 * Here the existing buffer is reused while it is large enough; otherwise the old buffers are released first and
 * a buffer with room for `capacity` numbers is allocated, so growing trails reallocate at most once.
 */
export function setLineSegments(g: LineSegmentsGeometry, seg: ArrayLike<number>, capacity = 0): void {
  const n = seg.length - (seg.length % 6);
  const ib = (g.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute | undefined)?.data;
  if (ib && ib.array.length >= n && n > 0) {
    const a = ib.array as Float32Array;
    for (let i = 0; i < n; i++) a[i] = seg[i];
    ib.needsUpdate = true;
  } else {
    const arr = new Float32Array(Math.max(n, capacity - (capacity % 6), 6));
    for (let i = 0; i < n; i++) arr[i] = seg[i];
    g.dispose(); // release the GPU buffers of the attributes being replaced
    g.setPositions(arr);
  }
  g.instanceCount = n / 6;
  g.computeBoundingSphere();
}

/** Polyline through points [x,y,z,…] as anti-aliased line. */
export function polyline(points: number[], css: string | THREE.Color, widthPx = 2, opacity = 1): LineSegments2 {
  const seg: number[] = [];
  for (let i = 0; i + 5 < points.length; i += 3) seg.push(points[i], points[i + 1], points[i + 2], points[i + 3], points[i + 4], points[i + 5]);
  return lineSegments(seg, css, opacity, widthPx);
}

/** Physically based material for masses / apparatus parts. */
export function pbr(css: string | THREE.Color, opts: { metalness?: number; roughness?: number; opacity?: number; emissive?: string } = {}): THREE.MeshStandardMaterial {
  if (tier !== 'high') {
    return new THREE.MeshStandardMaterial({
      color: css instanceof THREE.Color ? css : color(css), metalness: opts.metalness ?? 0.1, roughness: opts.roughness ?? 0.4,
      transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1, emissive: opts.emissive ? color(opts.emissive) : new THREE.Color(0x000000),
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: css instanceof THREE.Color ? css : color(css), metalness: opts.metalness ?? 0.1, roughness: opts.roughness ?? 0.35,
    clearcoat: 0.4, clearcoatRoughness: 0.25, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1,
    emissive: opts.emissive ? color(opts.emissive) : new THREE.Color(0x000000),
  });
}

/** Sphere tessellation: high definition (64×48) except on low-end devices. */
export const SPHERE_SEG: [number, number] = lowEnd ? [40, 28] : [64, 48];
export const highTier = () => tier === 'high';

const PREFIX: [number, string][] = [
  [1e24, 'Y'], [1e21, 'Z'], [1e18, 'E'], [1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'],
  [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'], [1e-18, 'a'],
];

/** Format a value with an SI prefix, e.g. 5e10 m → "50 Gm". */
export function siFormat(v: number, unit: string): string {
  if (v === 0 || !isFinite(v)) return `${v} ${unit}`;
  const a = Math.abs(v);
  const [f, p] = PREFIX.find(([f]) => a >= f * 0.9999) ?? PREFIX[PREFIX.length - 1];
  return `${+(v / f).toPrecision(3)} ${p}${unit}`;
}

/** Largest "round" length (1, 2 or 5 × 10^k) not exceeding `max`. */
export function roundLength(max: number): number {
  const k = Math.floor(Math.log10(max));
  const base = 10 ** k;
  for (const m of [5, 2, 1]) if (m * base <= max) return m * base;
  return base;
}

/** Scale bar: a line of length L (world units) with end ticks, plus a label. */
export function scaleBar(L: number, text: string, css: string, origin: THREE.Vector3, tick: number): THREE.Group {
  const g = new THREE.Group();
  const { x, y, z } = origin;
  g.add(lineSegments([x, y, z, x + L, y, z, x, y - tick, z, x, y + tick, z, x + L, y - tick, z, x + L, y + tick, z], css, 1, 2));
  const t = textSprite(text, css, 0.06, 'qg3d-scale');
  t.position.set(x + L / 2, y - tick * 2.6, z);
  g.add(t);
  return g;
}

/** Colour maps (stop tables in lib/colormaps.ts, shared with 2-D charts and HTML colour bars). */
export function colormap(name: string, t: number, out: THREE.Color): THREE.Color {
  const c = mapRgb(name, t);
  return out.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
}
export function colormapCss(name: string, t: number): string {
  const c = colormap(name, t, new THREE.Color());
  return `#${c.getHexString(THREE.SRGBColorSpace)}`;
}

/** Linear interpolation into a sampled series at fractional index f (display only). */
export function sampleAt(arr: ArrayLike<number>, f: number): number {
  if (!arr.length) return NaN;
  const x = Math.max(0, Math.min(arr.length - 1, f));
  const i = Math.floor(x), j = Math.min(arr.length - 1, i + 1), w = x - i;
  return arr[i] * (1 - w) + arr[j] * w;
}
