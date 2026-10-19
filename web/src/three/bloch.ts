/**
 * Bloch-sphere view for a single qubit. The Bloch vector r = (⟨X⟩, ⟨Y⟩, ⟨Z⟩) is supplied by the caller
 * (computed from the Lindblad solution); |r| < 1 for mixed states, so the arrow shrinks under decoherence.
 * Physics axes are mapped to scene axes as x→x, y→−z, z→y so that |0⟩ is at the top.
 */
import * as THREE from 'three';
import { createStage, color, lineSegments, pbr, polyline, textSprite, SPHERE_SEG, type Handle } from './core';

type V3 = [number, number, number];
export interface BlochOpts { path: V3[]; index: number; labels?: boolean }

/** Interpolated Bloch vector at fractional index f (display only). */
function at(path: V3[], f: number): V3 | null {
  if (!path.length) return null;
  const x = Math.max(0, Math.min(path.length - 1, f)), i = Math.floor(x), j = Math.min(path.length - 1, i + 1), w = x - i;
  return [0, 1, 2].map((k) => path[i][k] * (1 - w) + path[j][k] * w) as V3;
}

const toScene = (p: V3) => new THREE.Vector3(p[0], p[2], -p[1]);

export function mountBloch(el: HTMLElement, opts: BlochOpts): Handle & { info: { r: V3 | null; length: number } } {
  const st = createStage(el);
  const th = st.theme;
  const fixed = new THREE.Group();
  const dyn = new THREE.Group();
  st.scene.add(fixed, dyn);
  const info = { r: null as V3 | null, length: 0, samples: null as { i: number; j: number; w: number } | null };
  let o = opts;

  // translucent unit sphere, equator and meridians
  // glossy translucent PBR sphere
  const sm = pbr(th.muted, { opacity: 0.12, roughness: 0.15 });
  sm.depthWrite = false;
  fixed.add(new THREE.Mesh(new THREE.SphereGeometry(1, SPHERE_SEG[0], SPHERE_SEG[1]), sm));
  const circle = (f: (a: number) => V3) => {
    const pts: number[] = [];
    for (let i = 0; i < 96; i++) {
      const a = f((i / 96) * 2 * Math.PI), b = f(((i + 1) / 96) * 2 * Math.PI);
      pts.push(...a, ...b);
    }
    return lineSegments(pts, th.muted, 0.55, 1.2);
  };
  fixed.add(circle((a) => [Math.cos(a), 0, Math.sin(a)]));
  fixed.add(circle((a) => [Math.cos(a), Math.sin(a), 0]));
  fixed.add(circle((a) => [0, Math.sin(a), Math.cos(a)]));
  fixed.add(lineSegments([-1.15, 0, 0, 1.15, 0, 0, 0, -1.15, 0, 0, 1.15, 0, 0, 0, -1.15, 0, 0, 1.15], th.muted, 0.8, 1.4));
  const lab = (t: string, p: V3) => {
    const s = textSprite(t, th.fg, 0.11);
    s.position.copy(toScene(p).multiplyScalar(1.3));
    fixed.add(s);
  };
  if (o.labels !== false) {
    lab('|0⟩', [0, 0, 1]); lab('|1⟩', [0, 0, -1]); lab('|+⟩', [1, 0, 0]); lab('|−⟩', [-1, 0, 0]);
    lab('|+i⟩', [0, 1, 0]); lab('|−i⟩', [0, -1, 0]);
  }

  const accent = color(getComputedStyle(el).getPropertyValue('--accent').trim() || '#0072B2');
  // Bloch-vector arrow: PBR cylinder shaft + cone head (unit length along +y, scaled/oriented per frame)
  const arrow = new THREE.Group();
  const amat = pbr(accent, { roughness: 0.3, metalness: 0.1 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 32), amat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 32), amat);
  arrow.add(shaft, head);
  st.scene.add(arrow);
  const up = new THREE.Vector3(0, 1, 0);

  function buildPath() {
    dyn.traverse((x) => { const m = x as THREE.Mesh; m.geometry?.dispose?.(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    dyn.clear();
    if (o.path.length > 1) dyn.add(polyline(o.path.flatMap((p) => toScene(p).toArray()), accent, 2.2, 0.75));
  }

  function setFrame(i: number) {
    const p = at(o.path, i);
    if (!p) { arrow.visible = false; info.r = null; info.samples = null; st.requestRender(); return; }
    const x = Math.max(0, Math.min(o.path.length - 1, i)), k = Math.floor(x);
    info.samples = { i: k, j: Math.min(o.path.length - 1, k + 1), w: x - k };
    const v = toScene(p);
    const len = v.length();
    info.r = p;
    info.length = len;
    arrow.visible = len > 1e-9;
    if (arrow.visible) {
      const hl = Math.min(0.12, len * 0.4);
      shaft.scale.set(1, Math.max(1e-4, len - hl), 1);
      shaft.position.set(0, (len - hl) / 2, 0);
      head.scale.setScalar(hl / 0.12);
      head.position.set(0, len - hl / 2, 0);
      arrow.quaternion.setFromUnitVectors(up, v.clone().normalize());
    }
    st.requestRender();
  }

  st.setHome(new THREE.Vector3(2.2, 1.5, 2.6), new THREE.Vector3());
  st.resetView();
  buildPath();
  setFrame(o.index);

  return {
    info,
    update(next: Partial<BlochOpts>) {
      const rebuild = !!next.path;
      o = { ...o, ...next };
      if (rebuild) buildPath();
      setFrame(o.index);
    },
    setFrame(i: number) { o = { ...o, index: i }; setFrame(i); },
    resetView: () => st.resetView(),
    toPNG: (s?: number, tr?: boolean) => st.toPNG(s, tr),
    composite: st.composite,
    canvasSize: st.canvasSize,
    memory: st.memory,
    dispose: () => st.dispose(),
  };
}
