/**
 * 3-D N-body trajectories. Positions (metres) from the integrator are rescaled uniformly to fit the view;
 * a scale bar gives the true length in SI units. Body markers sit at the saved sample `frame`.
 */
import * as THREE from 'three';
import { createStage, color, lineSegments, pbr, polyline, roundLength, scaleBar, siFormat, textSprite, SPHERE_SEG, type Handle } from './core';

type V3 = [number, number, number];
export interface TrajOpts { series: { name: string; color: string; points: V3[] }[]; unit: string; frame?: number }

export function mountTrajectories(el: HTMLElement, opts: TrajOpts): Handle & { info: { metresPerUnit: number; scaleBarLength: number; frame: number } } {
  const st = createStage(el);
  const root = new THREE.Group();
  st.scene.add(root);
  const info = { metresPerUnit: 1, scaleBarLength: 0, frame: 0, samples: null as { i: number; j: number; w: number } | null };
  let o = opts;
  let markers: THREE.Mesh[] = [];
  let toScene = (p: V3) => new THREE.Vector3(...p);

  function build() {
    root.traverse((x) => {
      const m = x as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mm) => { (mm as any).map?.dispose?.(); mm.dispose(); });
      if ((x as any).isCSS2DObject) (x as any).element.remove();
    });
    root.clear();
    markers = [];
    const all = o.series.flatMap((s) => s.points).filter((p) => p.every(Number.isFinite));
    if (!all.length) { st.requestRender(); return; }
    const box = new THREE.Box3().setFromPoints(all.map((p) => new THREE.Vector3(...p)));
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const ext = Math.max(size.x, size.y, size.z, 1e-30);
    const s = 2 / ext; // fit into a 2-unit cube
    info.metresPerUnit = 1 / s;
    toScene = (p: V3) => new THREE.Vector3(p[0] - c.x, p[2] - c.z, -(p[1] - c.y)).multiplyScalar(s); // physics z → up

    const th = st.theme;
    for (const ser of o.series) {
      // anti-aliased screen-space trajectory line
      root.add(polyline(ser.points.flatMap((p) => toScene(p).toArray()), ser.color, 2, 0.95));
      const mat = pbr(ser.color, { roughness: 0.3 });
      mat.emissive = color(ser.color); mat.emissiveIntensity = 0.25;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, SPHERE_SEG[0], SPHERE_SEG[1]), mat);
      m.castShadow = true;
      root.add(m);
      markers.push(m);
      const lab = textSprite(ser.name, ser.color, 0.08);
      m.add(lab);
      lab.position.set(0.09, 0.06, 0);
    }
    // reference grid in the orbital (x–y) plane and scale bar
    const gl: number[] = [];
    for (let k = -6; k <= 6; k++) { const v = k * 0.2; gl.push(-1.2, 0, v, 1.2, 0, v, v, 0, -1.2, v, 0, 1.2); }
    root.add(lineSegments(gl, th.muted, 0.25, 1));
    const L = roundLength(0.5 * ext);
    info.scaleBarLength = L;
    root.add(scaleBar(L * s, siFormat(L, o.unit || 'm'), th.fg, new THREE.Vector3(-1.1, 0, 1.35), 0.04));
    root.add(lineSegments([-1.3, 0, 1.15, -1.05, 0, 1.15, -1.3, 0, 1.15, -1.3, 0, 0.9, -1.3, 0, 1.15, -1.3, 0.25, 1.15], th.muted));
    const lx = textSprite('x', th.muted, 0.07); lx.position.set(-0.98, 0, 1.15);
    const ly = textSprite('y', th.muted, 0.07); ly.position.set(-1.3, 0, 0.83);
    const lz = textSprite('z', th.muted, 0.07); lz.position.set(-1.3, 0.32, 1.15);
    root.add(lx, ly, lz);
    setFrame(o.frame ?? Math.max(0, ...o.series.map((x) => x.points.length - 1)));
  }

  function setFrame(f: number) {
    // fractional frame: markers interpolated between saved samples for display only
    o.series.forEach((ser, i) => {
      const n = ser.points.length; if (!n || !markers[i]) return;
      const x = Math.max(0, Math.min(n - 1, f)), a = Math.floor(x), b = Math.min(n - 1, a + 1), w = x - a;
      markers[i].position.copy(toScene(ser.points[a]).lerp(toScene(ser.points[b]), w));
      info.samples = { i: a, j: b, w };
    });
    info.frame = Math.round(f);
    st.requestRender();
  }

  st.setHome(new THREE.Vector3(0, 2.2, 2.6), new THREE.Vector3());
  build();
  st.resetView();

  return {
    info,
    update(next: Partial<TrajOpts>) {
      const rebuild = !!(next.series || next.unit);
      o = { ...o, ...next };
      if (rebuild) build(); else setFrame(o.frame ?? 0);
    },
    setFrame(f: number) { o = { ...o, frame: f }; setFrame(f); },
    resetView: () => st.resetView(),
    toPNG: (s?: number, tr?: boolean) => st.toPNG(s, tr),
    composite: st.composite,
    canvasSize: st.canvasSize,
    memory: st.memory,
    dispose: () => st.dispose(),
  };
}
