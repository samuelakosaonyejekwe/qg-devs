/**
 * General 3-D data plot used by the suite visualisations: an axis box with SI-formatted tick labels and
 * titles, smooth-shaded surfaces (null cells masked, never interpolated across), scatter points (instanced
 * spheres), anti-aliased polylines/trails, categorical bars (density-matrix "city" plots, count histograms,
 * conceptual matrices) and covariance ellipsoids. All geometry is placed from the supplied data; the
 * module only normalises each axis into the box for display.
 */
import * as THREE from 'three';
import { createStage, color, colormap, lineSegments, pbr, polyline, textSprite, texLabel, SPHERE_SEG, lowEnd, highTier, type Handle } from './core';

export interface Axis3 { label: string; unit?: string; log?: boolean; min?: number; max?: number; cats?: string[]; /** LaTeX title (typeset) */ tex?: string; /** LaTeX category labels */ catsTex?: string[] }
export interface Surface3 { name: string; xs: number[]; ys: number[]; z: (number | null)[][]; color?: string; colormap?: string; cmin?: number; cmax?: number; opacity?: number; wire?: boolean }
export interface Points3 { name: string; pts: [number, number, number][]; color: string | string[]; size?: number; count?: number; line?: boolean; lineWidth?: number; highlightLast?: boolean }
export interface Bar3 { xi: number; yi: number; h: number; color: string; label?: string }
export interface Ellipsoid3 { name: string; center: [number, number, number]; cov: number[][]; color: string; nsigma?: number }
export interface Plot3Spec {
  x: Axis3; y: Axis3; z: Axis3;
  surfaces?: Surface3[]; points?: Points3[]; bars?: Bar3[]; barWidth?: number; ellipsoids?: Ellipsoid3[];
  /** fixed annotation labels at data coordinates */
  notes?: { at: [number, number, number]; text: string; color?: string }[];
}

const BOX = 1; // half-size of the plot box in scene units
const fmtTick = (v: number, unit?: string) => {
  const a = Math.abs(v);
  if (v === 0) return '0';
  if (unit && ['m', 's', 'J', 'K', 'Pa', 'Hz'].includes(unit)) {
    const P: [number, string][] = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'], [1e-18, 'a'], [1e-21, 'z'], [1e-24, 'y'], [1e-27, 'r'], [1e-30, 'q']];
    const [f, p] = P.find(([f]) => a >= f * 0.9999) ?? P[P.length - 1];
    return `${+(v / f).toPrecision(3)} ${p}${unit}`;
  }
  if (a >= 1e4 || a < 1e-3) return v.toExponential(1).replace('e', '×10^').replace('+', '');
  return `${+v.toPrecision(3)}`;
};

function niceTicks(lo: number, hi: number, n = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  const st = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / st - 1e-9) * st; v <= hi + st * 1e-9; v += st) out.push(Math.abs(v) < st * 1e-9 ? 0 : v);
  return out;
}

interface Mapper { f(v: number): number; lo: number; hi: number; ticks: number[]; fmt(v: number): string }
function mapper(ax: Axis3, values: number[]): Mapper {
  if (ax.cats) {
    const n = ax.cats.length;
    return { lo: 0, hi: n - 1, ticks: ax.cats.map((_, i) => i), fmt: (i) => ax.cats![i] ?? '', f: (i) => (n <= 1 ? 0 : -BOX + ((i + 0.5) / n) * 2 * BOX) };
  }
  const fin = values.filter((v) => Number.isFinite(v) && (!ax.log || v > 0));
  let lo = ax.min ?? (fin.length ? Math.min(...fin) : 0), hi = ax.max ?? (fin.length ? Math.max(...fin) : 1);
  if (hi === lo) { const d = Math.abs(lo) || 1; lo -= d / 2; hi += d / 2; }
  if (ax.log) {
    const a = Math.log10(lo), b = Math.log10(hi);
    const ticks: number[] = [];
    for (let e = Math.ceil(a); e <= Math.floor(b); e++) ticks.push(10 ** e);
    return { lo, hi, ticks, fmt: (v) => `10^${Math.round(Math.log10(v))}`, f: (v) => -BOX + ((Math.log10(v) - a) / (b - a)) * 2 * BOX };
  }
  return { lo, hi, ticks: niceTicks(lo, hi), fmt: (v) => fmtTick(v, ax.unit), f: (v) => -BOX + ((v - lo) / (hi - lo)) * 2 * BOX };
}

function collect(spec: Plot3Spec, k: 0 | 1 | 2): number[] {
  const out: number[] = [];
  for (const s of spec.surfaces ?? []) {
    if (k === 0) out.push(...s.xs); else if (k === 1) out.push(...s.ys);
    else for (const r of s.z) for (const v of r) if (v != null) out.push(v);
  }
  for (const p of spec.points ?? []) for (const q of p.pts) out.push(q[k]);
  for (const e of spec.ellipsoids ?? []) { const s = 2 * Math.sqrt(Math.max(e.cov[k][k], 0)) * (e.nsigma ?? 1); out.push(e.center[k] - s, e.center[k] + s); }
  if (k === 2) for (const b of spec.bars ?? []) out.push(b.h, 0);
  return out;
}

/** Eigen-decomposition of a symmetric 3×3 matrix (Jacobi), for ellipsoid axes. */
function eigSym3(a: number[][]): { w: number[]; v: number[][] } {
  const A = a.map((r) => [...r]);
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += A[p][q] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { w: [A[0][0], A[1][1], A[2][2]], v: V };
}

export function mountPlot3D(el: HTMLElement, spec0: Plot3Spec): Handle & { info: { axes: { x: [number, number]; y: [number, number]; z: [number, number] } } } {
  const st = createStage(el);
  const th = st.theme;
  st.fit(Math.sqrt(3) * BOX + 0.45, new THREE.Vector3(0, 0.05, 0));
  // data axes (x, y, z) → scene (x, z, -y) so that the data z axis points up
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);
  const frame = new THREE.Group(); st.scene.add(frame);
  const dyn = new THREE.Group(); st.scene.add(dyn);
  const info = { axes: { x: [0, 1] as [number, number], y: [0, 1] as [number, number], z: [0, 1] as [number, number] } };
  let axesKey = '';
  let M: [Mapper, Mapper, Mapper];

  const clearGroup = (g: THREE.Group) => {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((x) => x.dispose());
      if ((o as any).isCSS2DObject) (o as any).element.remove();
    });
    g.clear();
  };

  function buildAxes(spec: Plot3Spec) {
    clearGroup(frame);
    M = [mapper(spec.x, collect(spec, 0)), mapper(spec.y, collect(spec, 1)), mapper(spec.z, collect(spec, 2))];
    info.axes = { x: [M[0].lo, M[0].hi], y: [M[1].lo, M[1].hi], z: [M[2].lo, M[2].hi] };
    const B = BOX, g: number[] = [];
    // floor grid and back walls (minimal)
    const push = (a: THREE.Vector3, b: THREE.Vector3) => g.push(a.x, a.y, a.z, b.x, b.y, b.z);
    for (const t of M[0].ticks) { const x = M[0].f(t); push(P(x, -B, -B), P(x, B, -B)); push(P(x, B, -B), P(x, B, B)); }
    for (const t of M[1].ticks) { const y = M[1].f(t); push(P(-B, y, -B), P(B, y, -B)); push(P(-B, y, -B), P(-B, y, B)); }
    for (const t of M[2].ticks) { const z = M[2].f(t); push(P(-B, B, z), P(B, B, z)); push(P(-B, -B, z), P(-B, B, z)); }
    frame.add(lineSegments(g, th.muted, 0.28, 1));
    const edges: number[] = [];
    const E = (a: THREE.Vector3, b: THREE.Vector3) => edges.push(a.x, a.y, a.z, b.x, b.y, b.z);
    E(P(-B, -B, -B), P(B, -B, -B)); E(P(-B, -B, -B), P(-B, B, -B)); E(P(-B, -B, -B), P(-B, -B, B));
    E(P(B, -B, -B), P(B, B, -B)); E(P(-B, B, -B), P(B, B, -B)); E(P(-B, B, -B), P(-B, B, B)); E(P(B, B, -B), P(B, B, B)); E(P(-B, B, B), P(B, B, B)); E(P(-B, -B, B), P(-B, B, B));
    frame.add(lineSegments(edges, th.muted, 0.85, 1.4));
    // tick labels
    const tick = (ax: Axis3, m: Mapper, t: number) => (ax.catsTex?.[t] ? texLabel(ax.catsTex[t], m.fmt(t), th.fg, 'qg3d-tick') : textSprite(m.fmt(t), th.muted, 0.02, 'qg3d-tick'));
    for (const t of M[0].ticks) { const s = tick(spec.x, M[0], t); s.position.copy(P(M[0].f(t), -B - 0.14, -B)); frame.add(s); }
    for (const t of M[1].ticks) { const s = tick(spec.y, M[1], t); s.position.copy(P(B + 0.16, M[1].f(t), -B)); frame.add(s); }
    for (const t of M[2].ticks) { const s = textSprite(M[2].fmt(t), th.muted, 0.02, 'qg3d-tick'); s.position.copy(P(-B - 0.12, -B - 0.04, M[2].f(t))); frame.add(s); }
    const title = (a: Axis3) => `${a.label}${a.unit && !a.cats ? ` (${a.log ? 'log, ' : ''}${a.unit})` : a.log ? ' (log)' : ''}`;
    const ttl = (a: Axis3) => (a.tex ? texLabel(a.tex + (a.unit && !a.cats ? String.raw`\;(\text{${a.unit.replace(/[{}\\$]/g, '')}})` : ''), title(a), th.fg, 'qg3d-axis') : textSprite(title(a), th.fg, 0.08, 'qg3d-axis'));
    const tx = ttl(spec.x); tx.position.copy(P(0, -B - (spec.x.cats ? 0.52 : 0.36), -B)); frame.add(tx);
    const ty = ttl(spec.y); ty.position.copy(P(B + (spec.y.cats ? 0.62 : 0.46), 0, -B)); frame.add(ty);
    const tz = ttl(spec.z); tz.position.copy(P(-B, -B, B + 0.2)); frame.add(tz);
    // frame the box plus its label margin at every aspect ratio (re-fitted on resize)
    st.fit(Math.sqrt(3) * B + 0.45, new THREE.Vector3(0, 0.05, 0));
  }

  const tmp = new THREE.Color();
  // Persistent objects so that animation frames with an unchanged structure update in place
  // (no new geometries, materials or DOM nodes per frame).
  interface SurfObj { mesh: THREE.Mesh; wire: THREE.Object3D | null; marks: THREE.Object3D | null; nx: number; ny: number; mask: string }
  interface PtsObj { inst: THREE.InstancedMesh; trail: ReturnType<typeof polyline> | null; cap: number }
  interface BarObj { mesh: THREE.Mesh; lab: ReturnType<typeof textSprite> | null }
  let surfs: SurfObj[] = [], ptsObjs: PtsObj[] = [], bars: BarObj[] = [], ells: THREE.Mesh[] = [], notes: ReturnType<typeof textSprite>[] = [];
  let structKey = '';
  const structOf = (s: Plot3Spec) => JSON.stringify([
    (s.surfaces ?? []).map((x) => [x.xs.length, x.ys.length, !!x.wire, x.opacity ?? 1]),
    (s.points ?? []).map((x) => [x.pts.length, !!x.line, x.size ?? 0, x.lineWidth ?? 0]),
    (s.bars ?? []).map((x) => [x.xi, x.yi, !!x.label]), s.barWidth ?? 0,
    (s.ellipsoids ?? []).length, (s.notes ?? []).length]);

  const surfaceData = (sf: Surface3) => {
    const [mx, my, mz] = M;
    const zc = (v: number) => Math.max(-BOX, Math.min(BOX, mz.f(v)));
    const nx = sf.xs.length, ny = sf.ys.length;
    const pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 3);
    const fin = sf.z.flat().filter((v): v is number => v != null && Number.isFinite(v));
    const cmin = sf.cmin ?? Math.min(...fin), cmax = sf.cmax ?? Math.max(...fin);
    const ok = (j: number, i: number) => sf.z[j][i] != null && Number.isFinite(sf.z[j][i] as number);
    let mask = '';
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = sf.z[j][i];
      mask += ok(j, i) ? '1' : '0';
      const p = P(mx.f(sf.xs[i]), my.f(sf.ys[j]), v == null || !Number.isFinite(v) ? -BOX : zc(v));
      const k = (j * nx + i) * 3;
      pos[k] = p.x; pos[k + 1] = p.y; pos[k + 2] = p.z;
      if (sf.colormap) colormap(sf.colormap, cmax > cmin ? ((v ?? cmin) - cmin) / (cmax - cmin) : 0.5, tmp); else tmp.copy(color(sf.color ?? th.accent));
      col[k] = tmp.r; col[k + 1] = tmp.g; col[k + 2] = tmp.b;
    }
    const idx: number[] = [];
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
      if (!(ok(j, i) && ok(j, i + 1) && ok(j + 1, i) && ok(j + 1, i + 1))) continue;
      const a0 = j * nx + i, b0 = a0 + 1, c0 = a0 + nx, d0 = c0 + 1;
      idx.push(a0, c0, b0, b0, c0, d0);
    }
    const wire: number[] = [];
    if (sf.wire) {
      const stepI = Math.max(1, Math.round(nx / 16)), stepJ = Math.max(1, Math.round(ny / 16));
      for (let j = 0; j < ny; j += stepJ) for (let i = 0; i + 1 < nx; i++) if (ok(j, i) && ok(j, i + 1)) { const q = (j * nx + i) * 3, r = q + 3; wire.push(pos[q], pos[q + 1], pos[q + 2], pos[r], pos[r + 1], pos[r + 2]); }
      for (let i = 0; i < nx; i += stepI) for (let j = 0; j + 1 < ny; j++) if (ok(j, i) && ok(j + 1, i)) { const q = (j * nx + i) * 3, r = q + nx * 3; wire.push(pos[q], pos[q + 1], pos[q + 2], pos[r], pos[r + 1], pos[r + 2]); }
    }
    const marks: number[] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!ok(j, i)) {
      const q = P(mx.f(sf.xs[i]), my.f(sf.ys[j]), -BOX), d = 0.02;
      marks.push(q.x - d, q.y + 0.001, q.z - d, q.x + d, q.y + 0.001, q.z + d, q.x - d, q.y + 0.001, q.z + d, q.x + d, q.y + 0.001, q.z - d);
    }
    return { pos, col, idx, wire, marks, mask, nx, ny };
  };

  const ellMatrix = (e: Ellipsoid3) => {
    const { w, v } = eigSym3(e.cov);
    const k = e.nsigma ?? 1;
    const sx = (2 * BOX) / (M[0].hi - M[0].lo), sy = (2 * BOX) / (M[1].hi - M[1].lo), sz = (2 * BOX) / (M[2].hi - M[2].lo);
    const r = (n: number) => Math.sqrt(Math.max(w[n], 0)) * k;
    // ellipsoid axes in data units scaled into the box, then data→scene axis permutation
    const D = new THREE.Matrix4().set(
      v[0][0] * r(0) * sx, v[0][1] * r(1) * sx, v[0][2] * r(2) * sx, 0,
      v[1][0] * r(0) * sy, v[1][1] * r(1) * sy, v[1][2] * r(2) * sy, 0,
      v[2][0] * r(0) * sz, v[2][1] * r(1) * sz, v[2][2] * r(2) * sz, 0,
      0, 0, 0, 1);
    const perm = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
    const c = P(M[0].f(e.center[0]), M[1].f(e.center[1]), M[2].f(e.center[2]));
    return new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(perm).multiply(D);
  };

  function create(spec: Plot3Spec) {
    clearGroup(dyn);
    surfs = []; ptsObjs = []; bars = []; ells = []; notes = [];
    for (const sf of spec.surfaces ?? []) {
      const geo = new THREE.BufferGeometry();
      const mat = new (highTier() ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({ vertexColors: true, roughness: 0.55, metalness: 0.0, ...(highTier() ? { clearcoat: 0.2 } : {}), side: THREE.DoubleSide, transparent: (sf.opacity ?? 1) < 1, opacity: sf.opacity ?? 1, depthWrite: (sf.opacity ?? 1) >= 1 });
      const mesh = new THREE.Mesh(geo, mat);
      dyn.add(mesh);
      surfs.push({ mesh, wire: null, marks: null, nx: -1, ny: -1, mask: '' });
    }
    for (const p of spec.points ?? []) {
      const cap = Math.max(1, p.pts.length);
      const geo = new THREE.SphereGeometry(p.size ?? 0.018, lowEnd ? 10 : 16, lowEnd ? 8 : 12);
      const inst = new THREE.InstancedMesh(geo, pbr('#ffffff', { roughness: 0.4 }), cap);
      inst.count = 0;
      dyn.add(inst);
      ptsObjs.push({ inst, trail: null, cap });
    }
    const nxC = spec.x.cats?.length ?? 1, nyC = spec.y.cats?.length ?? 1;
    const bw = (spec.barWidth ?? 0.7) * (2 * BOX) / Math.max(nxC, nyC);
    for (const b of spec.bars ?? []) {
      const bm = pbr(b.color, { roughness: 0.5, metalness: 0.0 });
      bm.emissive.copy(color(b.color)).multiplyScalar(0.18); // self-light keeps faces readable on dark backgrounds
      const box = new THREE.BoxGeometry(bw, 1, bw);
      const mesh = new THREE.Mesh(box, bm);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: color(th.fg), transparent: true, opacity: 0.45 }));
      mesh.add(edges);
      dyn.add(mesh);
      let lab = null;
      if (b.label != null) { lab = textSprite(b.label, th.fg, 0.01, 'qg3d-tick'); dyn.add(lab); }
      bars.push({ mesh, lab });
    }
    for (const e of spec.ellipsoids ?? []) {
      const em = pbr(e.color, { opacity: 0.55, roughness: 0.3 });
      em.depthWrite = false; // translucent shells blend instead of z-fighting when they coincide (e.g. state ≈ vacuum)
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, SPHERE_SEG[0], SPHERE_SEG[1]), em);
      mesh.matrixAutoUpdate = false;
      dyn.add(mesh); ells.push(mesh);
    }
    for (const n of spec.notes ?? []) { const t = textSprite(n.text, n.color ?? th.fg, 0.03); dyn.add(t); notes.push(t); }
  }

  function refresh(spec: Plot3Spec) {
    const [mx, my, mz] = M;
    const zc = (v: number) => Math.max(-BOX, Math.min(BOX, mz.f(v)));
    (spec.surfaces ?? []).forEach((sf, k) => {
      const o = surfs[k], d = surfaceData(sf);
      const g = o.mesh.geometry as THREE.BufferGeometry;
      if (o.nx !== d.nx || o.ny !== d.ny) {
        g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(d.col, 3));
        o.nx = d.nx; o.ny = d.ny;
      } else {
        (g.attributes.position as THREE.BufferAttribute).copyArray(d.pos).needsUpdate = true;
        (g.attributes.color as THREE.BufferAttribute).copyArray(d.col).needsUpdate = true;
      }
      if (d.mask !== o.mask) {
        g.setIndex(d.idx); o.mask = d.mask;
        if (o.marks) { dyn.remove(o.marks); disposeObj(o.marks); o.marks = null; }
        if (d.marks.length) { o.marks = lineSegments(d.marks, th.muted, 0.8, 1.2); dyn.add(o.marks); }
      }
      g.computeVertexNormals();
      if (sf.wire) {
        if (o.wire) { (o.wire as any).geometry.setPositions(d.wire.length ? d.wire : [0, 0, 0, 0, 0, 0]); }
        else if (d.wire.length) { o.wire = lineSegments(d.wire, th.fg, 0.25, 0.8); dyn.add(o.wire); }
      }
    });
    (spec.points ?? []).forEach((p, k) => {
      const o = ptsObjs[k];
      const n = Math.min(p.count ?? p.pts.length, p.pts.length, o.cap);
      const m4 = new THREE.Matrix4();
      const scenePts: number[] = [];
      for (let i = 0; i < n; i++) {
        const q = p.pts[i];
        const v = P(mx.f(q[0]), my.f(q[1]), zc(q[2]));
        scenePts.push(v.x, v.y, v.z);
        m4.makeTranslation(v.x, v.y, v.z);
        if (p.highlightLast && i === n - 1) m4.scale(new THREE.Vector3(2, 2, 2));
        o.inst.setMatrixAt(i, m4);
        o.inst.setColorAt(i, color(Array.isArray(p.color) ? p.color[i] ?? p.color[0] : p.color));
      }
      o.inst.count = n;
      o.inst.instanceMatrix.needsUpdate = true;
      if (o.inst.instanceColor) o.inst.instanceColor.needsUpdate = true;
      if (p.line) {
        const seg: number[] = [];
        for (let i = 0; i + 5 < scenePts.length; i += 3) seg.push(scenePts[i], scenePts[i + 1], scenePts[i + 2], scenePts[i + 3], scenePts[i + 4], scenePts[i + 5]);
        if (!o.trail && seg.length) { o.trail = polyline(scenePts, Array.isArray(p.color) ? p.color[0] : p.color, p.lineWidth ?? 1.6, 0.85); dyn.add(o.trail); }
        else if (o.trail) { o.trail.geometry.setPositions(seg.length ? seg : [0, 0, 0, 0, 0, 0]); o.trail.visible = seg.length > 0; }
      }
    });
    if (bars.length) {
      const base = mz.f(Math.max(0, mz.lo));
      (spec.bars ?? []).forEach((b, k) => {
        const o = bars[k];
        const top = zc(b.h);
        const hgt = Math.max(1e-4, Math.abs(top - base));
        o.mesh.scale.set(1, hgt, 1);
        o.mesh.position.copy(P(mx.f(b.xi), my.f(b.yi), (top + base) / 2));
        const bmat = o.mesh.material as THREE.MeshStandardMaterial;
        bmat.color.copy(color(b.color)); bmat.emissive.copy(bmat.color).multiplyScalar(0.18);
        if (o.lab) { o.lab.element.textContent = b.label ?? ''; o.lab.position.copy(P(mx.f(b.xi), my.f(b.yi), Math.max(top, base) + 0.08)); }
      });
    }
    (spec.ellipsoids ?? []).forEach((e, k) => { ells[k].matrix.copy(ellMatrix(e)); (ells[k].material as THREE.MeshPhysicalMaterial).color.copy(color(e.color)); });
    (spec.notes ?? []).forEach((n, k) => { notes[k].element.textContent = n.text; notes[k].position.copy(P(mx.f(n.at[0]), my.f(n.at[1]), zc(n.at[2]))); });
  }

  const disposeObj = (o: THREE.Object3D) => {
    o.traverse((x) => {
      const m = x as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((q) => q.dispose());
    });
  };

  const keyOf = (s: Plot3Spec) => JSON.stringify([s.x, s.y, s.z]);
  const apply = (spec: Plot3Spec) => {
    const k = keyOf(spec);
    const axesChanged = k !== axesKey;
    if (axesChanged) { buildAxes(spec); axesKey = k; }
    const sk = structOf(spec);
    if (sk !== structKey || axesChanged) { create(spec); structKey = sk; }
    refresh(spec);
    st.requestRender();
  };
  if (spec0.bars?.length) st.enableShadows(2);
  apply(spec0);

  return {
    info,
    update(spec: Plot3Spec) { apply(spec); },
    resetView: st.resetView,
    fitView: st.resetView,
    toPNG: st.toPNG,
    composite: st.composite,
    canvasSize: st.canvasSize,
    memory: st.memory,
    dispose() { clearGroup(dyn); clearGroup(frame); st.dispose(); },
  };
}
