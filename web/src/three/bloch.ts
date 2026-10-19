/**
 * Bloch-sphere view for a single qubit. The Bloch vector r = (⟨X⟩, ⟨Y⟩, ⟨Z⟩) is supplied by the caller
 * (computed from the Lindblad solution); |r| < 1 for mixed states, so the arrow shrinks under decoherence.
 * Physics axes are mapped to scene axes as x→x, y→−z, z→y so that |0⟩ is at the top.
 */
import * as THREE from 'three';
import { createStage, color, lineSegments, lowEnd, textSprite, type Handle } from './core';

type V3 = [number, number, number];
export interface BlochOpts { path: V3[]; index: number; labels?: boolean }

const toScene = (p: V3) => new THREE.Vector3(p[0], p[2], -p[1]);

export function mountBloch(el: HTMLElement, opts: BlochOpts): Handle & { info: { r: V3 | null; length: number } } {
  const st = createStage(el);
  const th = st.theme;
  const fixed = new THREE.Group();
  const dyn = new THREE.Group();
  st.scene.add(fixed, dyn);
  const info = { r: null as V3 | null, length: 0 };
  let o = opts;

  // translucent unit sphere, equator and meridians
  const seg = lowEnd ? 24 : 48;
  fixed.add(new THREE.Mesh(new THREE.SphereGeometry(1, seg, seg),
    new THREE.MeshStandardMaterial({ color: color(th.muted), transparent: true, opacity: 0.08, depthWrite: false })));
  const circle = (f: (a: number) => V3) => {
    const pts: number[] = [];
    for (let i = 0; i < 96; i++) {
      const a = f((i / 96) * 2 * Math.PI), b = f(((i + 1) / 96) * 2 * Math.PI);
      pts.push(...a, ...b);
    }
    return lineSegments(pts, th.muted, 0.5);
  };
  fixed.add(circle((a) => [Math.cos(a), 0, Math.sin(a)]));
  fixed.add(circle((a) => [Math.cos(a), Math.sin(a), 0]));
  fixed.add(circle((a) => [0, Math.sin(a), Math.cos(a)]));
  fixed.add(lineSegments([-1.15, 0, 0, 1.15, 0, 0, 0, -1.15, 0, 0, 1.15, 0, 0, 0, -1.15, 0, 0, 1.15], th.muted, 0.7));
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
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, accent, 0.12, 0.07);
  st.scene.add(arrow);

  function buildPath() {
    dyn.traverse((x) => { const m = x as THREE.Mesh; m.geometry?.dispose?.(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    dyn.clear();
    if (o.path.length > 1) {
      const g = new THREE.BufferGeometry().setFromPoints(o.path.map(toScene));
      dyn.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.6 })));
    }
  }

  function setFrame(i: number) {
    const k = Math.max(0, Math.min(o.path.length - 1, Math.round(i)));
    const p = o.path[k];
    if (!p) { arrow.visible = false; info.r = null; st.requestRender(); return; }
    const v = toScene(p);
    const len = v.length();
    info.r = p;
    info.length = len;
    arrow.visible = len > 1e-9;
    if (arrow.visible) {
      arrow.setDirection(v.clone().normalize());
      arrow.setLength(len, Math.min(0.12, len * 0.4), Math.min(0.07, len * 0.25));
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
    toPNG: (s?: number) => st.toPNG(s),
    dispose: () => { arrow.dispose(); st.dispose(); },
  };
}
