/**
 * 3-D N-body trajectories. Positions (metres) from the integrator are rescaled uniformly to fit the view;
 * a scale bar gives the true length in SI units. Body markers sit at the saved sample `frame`.
 */
import * as THREE from 'three';
import { createStage, color, lineSegments, lowEnd, roundLength, scaleBar, siFormat, textSprite, type Handle } from './core';

type V3 = [number, number, number];
export interface TrajOpts { series: { name: string; color: string; points: V3[] }[]; unit: string; frame?: number }

export function mountTrajectories(el: HTMLElement, opts: TrajOpts): Handle & { info: { metresPerUnit: number; scaleBarLength: number; frame: number } } {
  const st = createStage(el);
  const root = new THREE.Group();
  st.scene.add(root);
  const info = { metresPerUnit: 1, scaleBarLength: 0, frame: 0 };
  let o = opts;
  let markers: THREE.Mesh[] = [];
  let toScene = (p: V3) => new THREE.Vector3(...p);

  function build() {
    root.traverse((x) => {
      const m = x as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mm) => { (mm as any).map?.dispose?.(); mm.dispose(); });
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
    const seg = lowEnd ? 12 : 24;
    for (const ser of o.series) {
      const g = new THREE.BufferGeometry().setFromPoints(ser.points.map(toScene));
      root.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: color(ser.color) })));
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, seg, seg),
        new THREE.MeshStandardMaterial({ color: color(ser.color), emissive: color(ser.color), emissiveIntensity: 0.3 }));
      root.add(m);
      markers.push(m);
      const lab = textSprite(ser.name, ser.color, 0.08);
      m.add(lab);
      lab.position.set(0.09, 0.06, 0);
    }
    // reference grid in the orbital (x–y) plane and scale bar
    const grid = new THREE.GridHelper(2.4, 12, color(th.muted), color(th.muted));
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.25;
    root.add(grid);
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
    o.series.forEach((ser, i) => {
      const k = Math.max(0, Math.min(ser.points.length - 1, Math.round(f)));
      if (markers[i] && ser.points[k]) markers[i].position.copy(toScene(ser.points[k]));
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
    toPNG: (s?: number) => st.toPNG(s),
    dispose: () => st.dispose(),
  };
}
