/**
 * Minimal dense complex linear algebra for small (4×4) matrices, row-major.
 * Hermitian eigenproblems use the cyclic complex Jacobi method; singular values use one-sided
 * (Hestenes) Jacobi, which keeps tiny singular values accurate in absolute terms (no squaring).
 */
export interface CMat {
  n: number;
  re: Float64Array;
  im: Float64Array;
}

export function zeros(n: number): CMat {
  return { n, re: new Float64Array(n * n), im: new Float64Array(n * n) };
}

export function clone(a: CMat): CMat {
  return { n: a.n, re: a.re.slice(), im: a.im.slice() };
}

export function eye(n: number): CMat {
  const m = zeros(n);
  for (let i = 0; i < n; i++) m.re[i * n + i] = 1;
  return m;
}

export function fromArrays(re: number[][], im?: number[][]): CMat {
  const n = re.length;
  const m = zeros(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    m.re[i * n + j] = re[i][j];
    m.im[i * n + j] = im ? im[i][j] : 0;
  }
  return m;
}

export function toArrays(a: CMat): { re: number[][]; im: number[][] } {
  const re: number[][] = [], im: number[][] = [];
  for (let i = 0; i < a.n; i++) {
    re.push(Array.from(a.re.subarray(i * a.n, (i + 1) * a.n)));
    im.push(Array.from(a.im.subarray(i * a.n, (i + 1) * a.n)));
  }
  return { re, im };
}

export function matmul(a: CMat, b: CMat): CMat {
  const n = a.n, out = zeros(n);
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
    const ar = a.re[i * n + k], ai = a.im[i * n + k];
    if (ar === 0 && ai === 0) continue;
    for (let j = 0; j < n; j++) {
      const br = b.re[k * n + j], bi = b.im[k * n + j];
      out.re[i * n + j] += ar * br - ai * bi;
      out.im[i * n + j] += ar * bi + ai * br;
    }
  }
  return out;
}

export function adjoint(a: CMat): CMat {
  const n = a.n, out = zeros(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    out.re[j * n + i] = a.re[i * n + j];
    out.im[j * n + i] = -a.im[i * n + j];
  }
  return out;
}

export function conj(a: CMat): CMat {
  const out = clone(a);
  for (let i = 0; i < out.im.length; i++) out.im[i] = -out.im[i];
  return out;
}

export function kron(a: CMat, b: CMat): CMat {
  const n = a.n * b.n, out = zeros(n);
  for (let i = 0; i < a.n; i++) for (let j = 0; j < a.n; j++) {
    const ar = a.re[i * a.n + j], ai = a.im[i * a.n + j];
    for (let k = 0; k < b.n; k++) for (let l = 0; l < b.n; l++) {
      const br = b.re[k * b.n + l], bi = b.im[k * b.n + l];
      const idx = (i * b.n + k) * n + (j * b.n + l);
      out.re[idx] = ar * br - ai * bi;
      out.im[idx] = ar * bi + ai * br;
    }
  }
  return out;
}

/** Real part of tr(A B). */
export function traceProdRe(a: CMat, b: CMat): number {
  const n = a.n;
  let s = 0;
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++)
    s += a.re[i * n + k] * b.re[k * n + i] - a.im[i * n + k] * b.im[k * n + i];
  return s;
}

/** ½(A + A†). */
export function hermitianPart(a: CMat): CMat {
  const n = a.n, out = zeros(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    out.re[i * n + j] = 0.5 * (a.re[i * n + j] + a.re[j * n + i]);
    out.im[i * n + j] = 0.5 * (a.im[i * n + j] - a.im[j * n + i]);
  }
  return out;
}

/**
 * Eigen-decomposition of a Hermitian matrix by cyclic complex Jacobi rotations.
 * Each step removes the phase of a_pq with a diagonal unitary, then applies the real
 * Jacobi rotation (Numerical Recipes §11.1 formulation) that annihilates |a_pq|.
 * Returns eigenvalues ascending and eigenvectors as columns of V (A = V diag(w) V†).
 */
export function eigh(a0: CMat, wantVectors = true): { w: number[]; V: CMat } {
  const n = a0.n;
  const a = hermitianPart(a0);
  const V = eye(n);
  const R = a.re, I = a.im;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0, scale = 0;
    for (let p = 0; p < n; p++) {
      scale += R[p * n + p] ** 2;
      for (let q = p + 1; q < n; q++) off += R[p * n + q] ** 2 + I[p * n + q] ** 2;
    }
    if (off === 0 || off <= 1e-36 * (scale + off)) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      const xr = R[p * n + q], xi = I[p * n + q];
      const b = Math.hypot(xr, xi);
      if (b === 0) continue;
      const app = R[p * n + p], aqq = R[q * n + q];
      if (b < 1e-300 || (Math.abs(app) + b === Math.abs(app) && Math.abs(aqq) + b === Math.abs(aqq) && sweep > 3)) {
        R[p * n + q] = I[p * n + q] = R[q * n + p] = I[q * n + p] = 0;
        continue;
      }
      // phase e^{iφ} = a_pq / |a_pq|; column q is multiplied by e^{-iφ} so that a_pq becomes real (= b)
      const er = xr / b, ei = xi / b; // e^{iφ}
      const theta = (aqq - app) / (2 * b);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      // U = D P, with D = diag(1,..,e^{-iφ} at q) and P the real rotation (P_pp=P_qq=c, P_pq=s, P_qp=-s).
      // Column action on any matrix M (M ← M U):  col_p' = c col_p − s e^{-iφ} col_q ; col_q' = s col_p + c e^{-iφ} col_q
      const applyCols = (Mr: Float64Array, Mi: Float64Array) => {
        for (let k = 0; k < n; k++) {
          const pr = Mr[k * n + p], pi = Mi[k * n + p];
          const qr0 = Mr[k * n + q], qi0 = Mi[k * n + q];
          // e^{-iφ} col_q
          const qr = qr0 * er + qi0 * ei, qi = qi0 * er - qr0 * ei;
          Mr[k * n + p] = cs * pr - sn * qr; Mi[k * n + p] = cs * pi - sn * qi;
          Mr[k * n + q] = sn * pr + cs * qr; Mi[k * n + q] = sn * pi + cs * qi;
        }
      };
      // Row action (M ← U† M):  row_p' = c row_p − s e^{iφ} row_q ; row_q' = s row_p + c e^{iφ} row_q
      const applyRows = (Mr: Float64Array, Mi: Float64Array) => {
        for (let k = 0; k < n; k++) {
          const pr = Mr[p * n + k], pi = Mi[p * n + k];
          const qr0 = Mr[q * n + k], qi0 = Mi[q * n + k];
          const qr = qr0 * er - qi0 * ei, qi = qi0 * er + qr0 * ei; // e^{iφ} row_q
          Mr[p * n + k] = cs * pr - sn * qr; Mi[p * n + k] = cs * pi - sn * qi;
          Mr[q * n + k] = sn * pr + cs * qr; Mi[q * n + k] = sn * pi + cs * qi;
        }
      };
      applyCols(R, I);
      applyRows(R, I);
      // enforce exact structure
      R[p * n + q] = I[p * n + q] = R[q * n + p] = I[q * n + p] = 0;
      I[p * n + p] = 0; I[q * n + q] = 0;
      if (wantVectors) applyCols(V.re, V.im);
    }
  }
  const w = Array.from({ length: n }, (_, i) => R[i * n + i]);
  const order = w.map((_, i) => i).sort((i, j) => w[i] - w[j]);
  const ws = order.map((i) => w[i]);
  if (!wantVectors) return { w: ws, V };
  const Vs = zeros(n);
  order.forEach((src, dst) => {
    for (let k = 0; k < n; k++) {
      Vs.re[k * n + dst] = V.re[k * n + src];
      Vs.im[k * n + dst] = V.im[k * n + src];
    }
  });
  return { w: ws, V: Vs };
}

export function eigvalsh(a: CMat): number[] {
  return eigh(a, false).w;
}

/**
 * Singular values of a complex square matrix by one-sided Jacobi (Hestenes 1958):
 * orthogonalise column pairs with complex plane rotations; singular values are the final column norms.
 * Returned in descending order.
 */
export function singularValues(a0: CMat): number[] {
  const n = a0.n;
  const R = a0.re.slice(), I = a0.im.slice();
  for (let sweep = 0; sweep < 80; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      let al = 0, be = 0, gr = 0, gi = 0;
      for (let k = 0; k < n; k++) {
        const pr = R[k * n + p], pi = I[k * n + p], qr = R[k * n + q], qi = I[k * n + q];
        al += pr * pr + pi * pi;
        be += qr * qr + qi * qi;
        // γ = <col_p, col_q> = Σ conj(a_p) a_q
        gr += pr * qr + pi * qi;
        gi += pr * qi - pi * qr;
      }
      const g = Math.hypot(gr, gi);
      if (g === 0 || g <= 1e-16 * Math.sqrt(al * be)) continue;
      rotated = true;
      const er = gr / g, ei = gi / g; // e^{iφ}
      const zeta = (be - al) / (2 * g);
      const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
      const cs = 1 / Math.sqrt(1 + t * t), sn = cs * t;
      for (let k = 0; k < n; k++) {
        const pr = R[k * n + p], pi = I[k * n + p];
        const qr0 = R[k * n + q], qi0 = I[k * n + q];
        // a_q' = e^{-iφ} a_q makes <a_p, a_q'> real positive
        const qr = qr0 * er + qi0 * ei, qi = qi0 * er - qr0 * ei;
        R[k * n + p] = cs * pr - sn * qr; I[k * n + p] = cs * pi - sn * qi;
        R[k * n + q] = sn * pr + cs * qr; I[k * n + q] = sn * pi + cs * qi;
      }
    }
    if (!rotated) break;
  }
  const s: number[] = [];
  for (let j = 0; j < n; j++) {
    let acc = 0;
    for (let k = 0; k < n; k++) acc += R[k * n + j] ** 2 + I[k * n + j] ** 2;
    s.push(Math.sqrt(acc));
  }
  return s.sort((x, y) => y - x);
}
