/**
 * Interactive 3-D view of the two-mass (BMV) apparatus.
 *
 * Mass A's two branches (A_L, A_R) and mass B's (B_L, B_R) are drawn at the branch positions computed by
 * the solver. The four A_i–B_j segments are coloured by the magnitude of the interaction energy |U_ij|.
 * A phase dial shows the entangling phase Δφ(t) = φ_LL + φ_RR − φ_LR − φ_RL taken from the computed time
 * series at the frame selected by the UI; sphere glow follows |sin(Δφ/2)| (the pure-state concurrence),
 * so everything that moves is driven by the data, not by a free-running clock.
 */
import * as THREE from 'three';
import { createStage, color, lineSegments, setLineSegments, pbr, roundLength, sampleAt, scaleBar, siFormat, textSprite, SPHERE_SEG, type Handle } from './core';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';

type V3 = [number, number, number];
export interface ApparatusOpts {
  positions: { A_L: V3; A_R: V3; B_L: V3; B_R: V3 };
  radiusA: number;
  radiusB: number;
  energies: { LL: number; LR: number; RL: number; RR: number };
  phases?: { t: number[]; deltaPhi: number[] };
  frame?: number;
  branchColors?: { A: string; B: string };
  dark?: boolean;
}

export interface ApparatusInfo {
  radiiEnlarged: boolean;
  enlargementFactor: number; // displayed radius / true radius (1 when not enlarged)
  metresPerUnit: number; // metres represented by one scene unit
  scaleBarMetres: number; // length of the in-scene scale bar
  energyRamp: { min: number; max: number }; // |U_ij| range in J used for the segment colours
  deltaPhi: number | null; // Δφ at the current frame [rad]
  time: number | null; // t at the current frame [s] (interpolated for display between solver samples)
  /** solver samples behind the displayed frame: indices i, j and weight w (w = 0 → exactly sample i) */
  samples: { i: number; j: number; w: number } | null;
}

const MIN_VISIBLE = 0.015; // minimum displayed radius as a fraction of the layout extent
const BLUE = new THREE.Color('#2b6cb0');
const ORANGE = new THREE.Color('#dd6b20');

export function mountApparatus(el: HTMLElement, opts: ApparatusOpts): Handle & { info: ApparatusInfo } {
  const st = createStage(el);
  const root = new THREE.Group();
  st.scene.add(root);
  let o = opts;
  let spheres: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial }[] = [];
const ARC_SEGMENTS = 96;
  let dial: { hand: LineSegments2; arc: THREE.Mesh; r: number; label: THREE.Object3D } | null = null;
  let dphiMax = 0;

  const info: ApparatusInfo = {
    radiiEnlarged: false, enlargementFactor: 1, metresPerUnit: 1, scaleBarMetres: 0,
    energyRamp: { min: 0, max: 0 }, deltaPhi: null, time: null, samples: null,
  };

  function build() {
    // clear previous objects
    root.traverse((x) => {
      const m = x as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mm) => { (mm as any).map?.dispose?.(); mm.dispose(); });
      if ((x as any).isCSS2DObject) (x as any).element.remove();
    });
    root.clear();
    spheres = [];

    const P = o.positions;
    const pts = [P.A_L, P.A_R, P.B_L, P.B_R].map((p) => new THREE.Vector3(...p));
    const box = new THREE.Box3().setFromPoints(pts);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 1e-30);
    const s = 1 / extent; // scene units per metre
    info.metresPerUnit = extent;
    const toScene = (p: V3) => new THREE.Vector3(...p).sub(centre).multiplyScalar(s);

    // displayed radii: true scale unless invisibly small; never so large that branches overlap
    const minGap = Math.min(...pts.flatMap((a, i) => pts.slice(i + 1).map((b) => a.distanceTo(b)))) * s;
    const trueR = Math.max(o.radiusA, o.radiusB) * s;
    let k = 1;
    if (trueR < MIN_VISIBLE) k = Math.min(MIN_VISIBLE, 0.3 * minGap) / trueR;
    k = Math.max(1, k);
    info.radiiEnlarged = k > 1.0001;
    info.enlargementFactor = k;

    const th = st.theme;
    const cA = color(o.branchColors?.A ?? '#0072B2');
    const cB = color(o.branchColors?.B ?? '#D55E00');
    const placed: Record<string, THREE.Vector3> = {};
    (['A_L', 'A_R', 'B_L', 'B_R'] as const).forEach((key) => {
      const isA = key[0] === 'A';
      const r = (isA ? o.radiusA : o.radiusB) * s * k;
      // physically based glossy dielectric spheres (high tessellation); glow follows the data, see applyFrame
      const mat = pbr(isA ? cA : cB, { roughness: 0.25, metalness: 0.05, opacity: 0.92 });
      mat.emissive = (isA ? cA : cB).clone(); mat.emissiveIntensity = 0.15;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, SPHERE_SEG[0], SPHERE_SEG[1]), mat);
      mesh.castShadow = true;
      const p = toScene(P[key]);
      mesh.position.copy(p);
      placed[key] = p;
      root.add(mesh);
      spheres.push({ mesh, mat });
      const lab = textSprite(key.replace('_', ' '), th.fg, 0.045);
      lab.position.copy(p).add(new THREE.Vector3(r + 0.04, r + 0.03, 0));
      root.add(lab);
    });

    // interaction segments coloured by |U_ij|
    const mags = (['LL', 'LR', 'RL', 'RR'] as const).map((b) => Math.abs(o.energies[b]));
    const lo = Math.min(...mags), hi = Math.max(...mags);
    info.energyRamp = { min: lo, max: hi };
    (['LL', 'LR', 'RL', 'RR'] as const).forEach((b, i) => {
      const a = placed['A_' + b[0]], c = placed['B_' + b[1]];
      const f = hi > lo ? (mags[i] - lo) / (hi - lo) : 0.5;
      const col = BLUE.clone().lerp(ORANGE, f);
      const line = lineSegments([a.x, a.y, a.z, c.x, c.y, c.z], col, 0.95, 2.4);
      root.add(line);
      const lab = textSprite(b, '#' + col.getHexString(), 0.035);
      lab.position.copy(a).lerp(c, b === 'LR' ? 0.3 : b === 'RL' ? 0.7 : 0.5).add(new THREE.Vector3(0, 0.025, 0));
      root.add(lab);
    });

    // scale bar (round SI length) below the layout
    const half = size.clone().multiplyScalar(0.5 * s);
    const L = roundLength(0.5 * extent);
    info.scaleBarMetres = L;
    root.add(scaleBar(L * s, siFormat(L, 'm'), th.fg, new THREE.Vector3(-half.x, -half.y - 0.18, 0), 0.02));

    // axis triad: x along A→B, y along the split axis (parallel geometry)
    const ax = new THREE.Vector3(-half.x - 0.15, -half.y - 0.05, 0);
    root.add(lineSegments([ax.x, ax.y, 0, ax.x + 0.12, ax.y, 0, ax.x, ax.y, 0, ax.x, ax.y + 0.12, 0], th.muted));
    const lx = textSprite('x (A→B)', th.muted, 0.035);
    lx.position.set(ax.x + 0.2, ax.y, 0);
    const ly = textSprite('y (split)', th.muted, 0.035);
    ly.position.set(ax.x, ax.y + 0.16, 0);
    root.add(lx, ly);

    // phase dial for Δφ(t) above the layout
    dial = null;
    if (o.phases && o.phases.deltaPhi.length) {
      dphiMax = Math.max(...o.phases.deltaPhi.map((v) => Math.abs(sinHalf(v))), 1e-300);
      const r = 0.09;
      const c = new THREE.Vector3(0, half.y + 0.2, 0);
      const ring: number[] = [];
      for (let i = 0; i < 64; i++) {
        const a0 = (i / 64) * Math.PI * 2, a1 = ((i + 1) / 64) * Math.PI * 2;
        ring.push(c.x + r * Math.cos(a0), c.y + r * Math.sin(a0), 0, c.x + r * Math.cos(a1), c.y + r * Math.sin(a1), 0);
      }
      root.add(lineSegments(ring, th.muted, 1, 1.4));
      const hand = lineSegments([c.x, c.y, 0.001, c.x + r, c.y, 0.001], th.fg, 1, 2.6);
      const arc = new THREE.Mesh(
        new THREE.RingGeometry(0, r, ARC_SEGMENTS, 1, 0, 2 * Math.PI), // built once; frames only change the drawn range
        new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
      );
      arc.position.copy(c);
      const label = textSprite('Δφ', th.fg, 0.04);
      label.position.copy(c).add(new THREE.Vector3(r + 0.08, 0, 0));
      root.add(hand, arc, label);
      dial = { hand, arc, r, label };
      (dial as any).centre = c;
    }

    const home = new THREE.Vector3(0.15, -0.55, 1.9);
    st.setHome(home, new THREE.Vector3(0, 0, 0));
    st.camera.near = 0.001;
    st.camera.far = 100;
    st.camera.updateProjectionMatrix();
    applyFrame(o.frame ?? (o.phases ? o.phases.deltaPhi.length - 1 : 0));
  }

  function sinHalf(v: number) {
    return Math.sin(v / 2);
  }

  function applyFrame(f: number) {
    const ph = o.phases;
    if (!ph || !ph.deltaPhi.length) {
      info.deltaPhi = null;
      info.time = null;
      st.requestRender();
      return;
    }
    // fractional frame: interpolate between neighbouring solver samples for display only
    const n = ph.deltaPhi.length;
    const x = Math.max(0, Math.min(n - 1, f));
    const i = Math.floor(x), j = Math.min(n - 1, i + 1), w = x - i;
    const dphi = sampleAt(ph.deltaPhi, x);
    info.deltaPhi = dphi;
    info.time = ph.t.length ? sampleAt(ph.t, x) : null;
    info.samples = { i, j, w };
    // glow ∝ |sin(Δφ/2)| normalised to the series maximum (pure-state concurrence profile)
    const g = Math.abs(sinHalf(dphi)) / dphiMax;
    for (const { mat } of spheres) {
      mat.emissiveIntensity = 0.12 + 0.6 * g;
      mat.opacity = 0.7 + 0.3 * g;
    }
    if (dial) {
      const c: THREE.Vector3 = (dial as any).centre;
      const ang = dphi; // dial angle equals Δφ (radians, counter-clockwise)
      setLineSegments(dial.hand.geometry, [c.x, c.y, 0.001, c.x + dial.r * Math.cos(ang), c.y + dial.r * Math.sin(ang), 0.001]);
      // filled sector |Δφ| mod 2π: draw that fraction of the ring's segments (6 indices each), mirrored for Δφ < 0
      const sweep = ((Math.abs(dphi) % (2 * Math.PI)) || (dphi !== 0 ? 2 * Math.PI : 0));
      dial.arc.geometry.setDrawRange(0, 6 * Math.round((ARC_SEGMENTS * sweep) / (2 * Math.PI)));
      dial.arc.scale.y = dphi < 0 ? -1 : 1;
    }
    st.requestRender();
  }

  build();
  st.resetView();

  return {
    info,
    update(next: Partial<ApparatusOpts>) {
      const geomChanged = next.positions || next.radiusA || next.radiusB || next.energies || next.phases || next.branchColors;
      o = { ...o, ...next };
      if (geomChanged) build();
      else applyFrame(o.frame ?? 0);
    },
    setFrame(f: number) {
      o = { ...o, frame: f };
      applyFrame(f);
    },
    resetView: () => st.resetView(),
    toPNG: (scale?: number, transparent?: boolean) => st.toPNG(scale, transparent),
    composite: st.composite,
    canvasSize: st.canvasSize,
    memory: st.memory,
    dispose: () => st.dispose(),
  };
}

