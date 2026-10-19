/**
 * Shared three.js stage: renderer, camera, orbit controls, on-demand rendering, resize handling,
 * theme colours from CSS custom properties, PNG export and text sprites.
 * Rendering quality adapts to the device (pixel ratio, tessellation) — never positions or values.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface Handle {
  update(opts: any): void;
  dispose(): void;
  resetView(): void;
  setFrame?(f: number): void;
  toPNG?(scale?: number): string;
}

export const lowEnd: boolean =
  typeof navigator !== 'undefined' &&
  ((navigator.hardwareConcurrency || 8) <= 4 || ((navigator as any).deviceMemory ?? 8) <= 4);

export const reducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface Theme { fg: string; bg: string; muted: string }

export function readTheme(el: HTMLElement): Theme {
  const cs = getComputedStyle(el);
  const get = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { fg: get('--fg', '#1b1f24'), bg: get('--bg', '#ffffff'), muted: get('--muted', '#6b7280') };
}

/** three.Color accepts most CSS colour syntaxes; fall back if it cannot parse (e.g. oklch). */
export function color(css: string, fallback = '#888888'): THREE.Color {
  const c = new THREE.Color();
  try {
    c.setStyle(css);
    return c;
  } catch {
    return c.set(fallback);
  }
}

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  theme: Theme;
  requestRender(): void;
  setHome(pos: THREE.Vector3, target: THREE.Vector3): void;
  resetView(): void;
  toPNG(scale?: number): string;
  dispose(): void;
}

export function createStage(el: HTMLElement): Stage {
  const theme = readTheme(el);
  const renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, alpha: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('role', 'img');
  el.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(2, 3, 4);
  scene.add(dir);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reducedMotion();
  controls.dampingFactor = 0.12;
  controls.autoRotate = false;

  const home = { pos: new THREE.Vector3(0, 0, 3), target: new THREE.Vector3() };
  let pending = false;
  let disposed = false;

  const draw = () => {
    pending = false;
    if (disposed) return;
    // damping needs a few extra frames to settle; controls.update() returns true while moving
    if (controls.update()) requestRender();
    renderer.render(scene, camera);
  };
  function requestRender() {
    if (pending || disposed) return;
    pending = true;
    requestAnimationFrame(draw);
  }
  controls.addEventListener('change', requestRender);

  const resize = () => {
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight || Math.round(w * 0.6));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  return {
    scene, camera, renderer, controls, theme, requestRender,
    setHome(pos, target) {
      home.pos.copy(pos);
      home.target.copy(target);
    },
    resetView() {
      camera.position.copy(home.pos);
      controls.target.copy(home.target);
      camera.up.set(0, 1, 0);
      controls.update();
      requestRender();
    },
    toPNG(scale = 3) {
      const size = renderer.getSize(new THREE.Vector2());
      const pr = renderer.getPixelRatio();
      renderer.setPixelRatio(scale);
      renderer.setSize(size.x, size.y, false);
      renderer.render(scene, camera);
      const url = canvas.toDataURL('image/png'); // read immediately after render: buffer still valid
      renderer.setPixelRatio(pr);
      renderer.setSize(size.x, size.y, false);
      requestRender();
      return url;
    },
    dispose() {
      disposed = true;
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        for (const mat of mats) {
          (mat as any).map?.dispose?.();
          mat.dispose();
        }
      });
      renderer.dispose();
      canvas.remove();
    },
  };
}

/** Camera-facing text label (canvas texture sprite). `height` is in world units. */
export function textSprite(text: string, css: string, height: number): THREE.Sprite {
  const px = 48;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `600 ${px}px system-ui, sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  c.width = w;
  c.height = px + 16;
  ctx.font = `600 ${px}px system-ui, sans-serif`;
  ctx.fillStyle = css;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set((height * c.width) / c.height, height, 1);
  sp.renderOrder = 10;
  return sp;
}

export function lineSegments(points: number[], css: string | THREE.Color, opacity = 1): THREE.LineSegments {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(
    g,
    new THREE.LineBasicMaterial({ color: css instanceof THREE.Color ? css : color(css), transparent: opacity < 1, opacity }),
  );
}

const PREFIX: [number, string][] = [
  [1e24, 'Y'], [1e21, 'Z'], [1e18, 'E'], [1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'],
  [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'], [1e-18, 'a'],
];

/** Format a value with an SI prefix, e.g. 5e10 m → "50 Gm". */
export function siFormat(v: number, unit: string): string {
  if (v === 0 || !isFinite(v)) return `${v} ${unit}`;
  const a = Math.abs(v);
  const [f, p] = PREFIX.find(([f]) => a >= f * 0.9999) ?? PREFIX[PREFIX.length - 1];
  const x = v / f;
  return `${+x.toPrecision(3)} ${p}${unit}`;
}

/** Largest "round" length (1, 2 or 5 × 10^k) not exceeding `max`. */
export function roundLength(max: number): number {
  const k = Math.floor(Math.log10(max));
  const base = 10 ** k;
  for (const m of [5, 2, 1]) if (m * base <= max) return m * base;
  return base;
}

/** Scale bar: a line of length L (world units) with end ticks, plus a label. */
export function scaleBar(L: number, label: string, css: string, origin: THREE.Vector3, tick: number): THREE.Group {
  const g = new THREE.Group();
  const { x, y, z } = origin;
  g.add(lineSegments([x, y, z, x + L, y, z, x, y - tick, z, x, y + tick, z, x + L, y - tick, z, x + L, y + tick, z], css));
  const t = textSprite(label, css, tick * 2.2);
  t.position.set(x + L / 2, y - tick * 2.6, z);
  g.add(t);
  return g;
}

/** Small RGB colour maps sampled at 5 stops (perceptually uniform matplotlib maps). */
const MAPS: Record<string, number[][]> = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  magma: [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]],
};

export function colormap(name: string, t: number, out: THREE.Color): THREE.Color {
  const s = MAPS[name] ?? MAPS.viridis;
  const u = Math.min(1, Math.max(0, isFinite(t) ? t : 0)) * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(u));
  const f = u - i;
  const a = s[i], b = s[i + 1];
  return out.setRGB(
    (a[0] + (b[0] - a[0]) * f) / 255, (a[1] + (b[1] - a[1]) * f) / 255, (a[2] + (b[2] - a[2]) * f) / 255,
    THREE.SRGBColorSpace,
  );
}
