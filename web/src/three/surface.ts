/**
 * Height-field surface for a 2-D scalar field such as the matter-wave probability density |ψ(x,y)|².
 * z[row][col] with rows along y and columns along x. Heights are normalised to the field maximum of the
 * frame (the server already normalises each frame to max = 1); vertex colours follow the same value.
 * update({ z }) rewrites the position/colour attributes in place, so animation is cheap.
 */
import * as THREE from 'three';
import { colormap, createStage, lineSegments, textSprite, type Handle } from './core';
import * as CORE from './core';

export interface SurfaceOpts { z: number[][]; xLabel: string; yLabel: string; zLabel: string; colormap?: 'viridis' | 'magma' | 'cividis' }

const HEIGHT = 0.8; // scene height of the maximum value

export function mountSurface(el: HTMLElement, opts: SurfaceOpts): Handle & { info: { zMax: number; nx: number; ny: number } } {
  const st = createStage(el);
  const root = new THREE.Group();
  st.scene.add(root);
  const info = { zMax: 0, nx: 0, ny: 0, colormap: opts.colormap ?? 'viridis', colorbar: [] as string[] };
  let o = opts;
  let mesh: THREE.Mesh | null = null;
  const tmp = new THREE.Color();

  function build() {
    root.traverse((x) => {
      const m = x as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mm) => { (mm as any).map?.dispose?.(); mm.dispose(); });
      if ((x as any).isCSS2DObject) (x as any).element.remove();
    });
    root.clear();
    const ny = o.z.length, nx = o.z[0]?.length ?? 0;
    info.nx = nx; info.ny = ny;
    if (nx < 2 || ny < 2) { mesh = null; st.requestRender(); return; }
    // plane in x–z (scene), height along scene y
    const g = new THREE.PlaneGeometry(2, 2, nx - 1, ny - 1);
    g.rotateX(-Math.PI / 2);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(nx * ny * 3), 3));
    // physically based, smooth-shaded (per-vertex normals recomputed every frame)
    mesh = new THREE.Mesh(g, CORE.highTier() ? new THREE.MeshPhysicalMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.45, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4 }) : new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.5, metalness: 0 }));
    mesh.receiveShadow = true;
    root.add(mesh);
    const th = st.theme;
    root.add(lineSegments([-1, 0, 1, 1, 0, 1, -1, 0, 1, -1, 0, -1, -1, 0, 1, -1, HEIGHT, 1], th.muted, 1, 1.4));
    const gl: number[] = [];
    for (let k = -4; k <= 4; k++) { const v = k * 0.25; gl.push(-1, 0, v, 1, 0, v, v, 0, -1, v, 0, 1); }
    root.add(lineSegments(gl, th.muted, 0.2, 1));
    info.colormap = o.colormap ?? 'viridis';
    info.colorbar = [0, 0.25, 0.5, 0.75, 1].map((t) => CORE.colormapCss(info.colormap, t));
    const lx = textSprite(o.xLabel, th.fg, 0.08); lx.position.set(0, 0, 1.2);
    const ly = textSprite(o.yLabel, th.fg, 0.08); ly.position.set(-1.25, 0, 0);
    const lz = textSprite(o.zLabel, th.fg, 0.08); lz.position.set(-1.1, HEIGHT + 0.12, 1);
    root.add(lx, ly, lz);
    fill();
  }

  function fill() {
    if (!mesh) return;
    const ny = o.z.length, nx = o.z[0].length;
    if (nx !== info.nx || ny !== info.ny) { build(); return; }
    let max = 0;
    for (const row of o.z) for (const v of row) if (Number.isFinite(v) && v > max) max = v;
    info.zMax = max;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    // PlaneGeometry vertex order: rows from +y (scene −z after rotation) downward; flip so row 0 = smallest y
    for (let r = 0; r < ny; r++) {
      const row = o.z[ny - 1 - r];
      for (let c = 0; c < nx; c++) {
        const i = r * nx + c;
        const v = Number.isFinite(row[c]) ? row[c] / (max || 1) : 0;
        pos.setY(i, v * HEIGHT);
        colormap(o.colormap ?? 'viridis', v, tmp);
        col.setXYZ(i, tmp.r, tmp.g, tmp.b);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    st.requestRender();
  }

  st.setHome(new THREE.Vector3(1.9, 1.7, 2.1), new THREE.Vector3(0, 0.2, 0));
  build();
  st.resetView();

  return {
    info,
    update(next: Partial<SurfaceOpts>) {
      const relabel = next.xLabel !== undefined || next.yLabel !== undefined || next.zLabel !== undefined || next.colormap !== undefined;
      o = { ...o, ...next };
      if (relabel) build(); else fill();
    },
    resetView: () => st.resetView(),
    toPNG: (s?: number, tr?: boolean) => st.toPNG(s, tr),
    composite: st.composite,
    canvasSize: st.canvasSize,
    memory: st.memory,
    dispose: () => st.dispose(),
  };
}
