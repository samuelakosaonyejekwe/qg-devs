/**
 * Colour-map stop tables shared by 2-D charts, 3-D views and HTML colour bars (no three.js dependency).
 *
 * viridis / magma / cividis: perceptually uniform sequential maps (matplotlib).
 * phase: cyclic, lightness-balanced map for angles (after cmocean "phase", Thyng et al., Oceanography 29(3),
 *   2016). Every hue has similar mid lightness, so no angle maps to near-black or near-white: bars and
 *   surfaces stay visible on both light and dark backgrounds (contrast ≥ 3:1 against either).
 * diverging: blue–white–orange for signed quantities centred on zero.
 */
export const MAP_STOPS: Record<string, [number, number, number][]> = {
  viridis: [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [110, 206, 88], [181, 222, 43], [253, 231, 37]],
  magma: [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]],
  cividis: [[0, 34, 78], [18, 53, 112], [59, 73, 108], [87, 92, 109], [112, 113, 115], [138, 134, 120], [165, 156, 116], [195, 179, 105], [225, 204, 85], [254, 232, 56]],
  phase: [[178, 120, 20], [205, 96, 40], [214, 70, 72], [204, 58, 118], [176, 64, 168], [128, 86, 204], [78, 112, 214], [46, 138, 196], [36, 156, 160], [56, 164, 112], [112, 158, 58], [158, 138, 30], [178, 120, 20]],
  twilight: [[226, 217, 226], [166, 191, 203], [109, 148, 196], [95, 94, 176], [79, 40, 113], [47, 20, 52], [96, 31, 76], [158, 54, 81], [196, 112, 103], [214, 175, 162], [226, 217, 226]],
  diverging: [[8, 81, 156], [49, 130, 189], [107, 174, 214], [189, 215, 231], [247, 247, 247], [253, 208, 162], [253, 174, 107], [230, 85, 13], [166, 54, 3]],
};

/** RGB 0–255 at t ∈ [0, 1] (cyclic maps wrap). */
export function mapRgb(name: string, t: number): [number, number, number] {
  const s = MAP_STOPS[name] ?? MAP_STOPS.viridis;
  let x = Number.isFinite(t) ? t : 0;
  if (name === 'phase' || name === 'twilight') x = ((x % 1) + 1) % 1; else x = Math.min(1, Math.max(0, x));
  const u = x * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(u)), f = u - i;
  return [0, 1, 2].map((k) => Math.round(s[i][k] + (s[i + 1][k] - s[i][k]) * f)) as [number, number, number];
}

export const mapCss = (name: string, t: number) => { const c = mapRgb(name, t); return `rgb(${c[0]},${c[1]},${c[2]})`; };

/** CSS linear-gradient for an HTML colour bar. */
export function mapGradient(name: string, dir = 'to right'): string {
  const n = 24;
  return `linear-gradient(${dir}, ${Array.from({ length: n + 1 }, (_, i) => `${mapCss(name, i / n)} ${(100 * i) / n}%`).join(', ')})`;
}

/** Phase angle (rad, −π…π) → [0, 1) position on a cyclic map. */
export const phaseT = (phi: number) => (phi + Math.PI) / (2 * Math.PI);
