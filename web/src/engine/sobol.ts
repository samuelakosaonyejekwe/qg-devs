/**
 * Unscrambled Sobol low-discrepancy sequence for up to 4 dimensions (Bratley & Fox, ACM TOMS 14, 88 (1988),
 * Gray-code construction) with the Joe & Kuo (SIAM J. Sci. Comput. 30, 2635 (2008), new-joe-kuo-6.21201)
 * direction numbers. Matches scipy.stats.qmc.Sobol(d, scramble=False) point for point (tested).
 */
const BITS = 32;
// dimensions 2..4: degree s, polynomial coefficients a, initial direction numbers m
const JOE_KUO = [
  { s: 1, a: 0, m: [1] },
  { s: 2, a: 1, m: [1, 3] },
  { s: 3, a: 1, m: [1, 3, 1] },
];

function directions(dim: number): Uint32Array[] {
  const out: Uint32Array[] = [];
  const v0 = new Uint32Array(BITS);
  for (let k = 0; k < BITS; k++) v0[k] = (1 << (BITS - 1 - k)) >>> 0;
  out.push(v0);
  for (let d = 1; d < dim; d++) {
    const { s, a, m } = JOE_KUO[d - 1];
    const v = new Uint32Array(BITS);
    for (let k = 0; k < s; k++) v[k] = (m[k] << (BITS - 1 - k)) >>> 0;
    for (let k = s; k < BITS; k++) {
      let x = (v[k - s] ^ (v[k - s] >>> s)) >>> 0;
      for (let l = 1; l < s; l++) if ((a >>> (s - 1 - l)) & 1) x = (x ^ v[k - l]) >>> 0;
      v[k] = x;
    }
    out.push(v);
  }
  return out;
}

/** First n points of the d-dimensional (d ≤ 4) unscrambled Sobol sequence in [0, 1)^d, starting at the origin. */
export function sobol(n: number, dim = 4): number[][] {
  if (dim < 1 || dim > 4) throw new Error('sobol: 1 ≤ dim ≤ 4');
  const V = directions(dim);
  const X = new Uint32Array(dim);
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      let c = 0, j = i - 1;
      while (j & 1) { j >>>= 1; c++; } // index of the rightmost zero bit of i − 1
      for (let d = 0; d < dim; d++) X[d] = (X[d] ^ V[d][c]) >>> 0;
    }
    pts.push(Array.from(X, (x) => x / 2 ** BITS));
  }
  return pts;
}
