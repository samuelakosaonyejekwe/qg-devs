/**
 * Two-qubit quantum-information measures (mirror of qgdevs/quantum.py).
 * Basis ordering |00>,|01>,|10>,|11> (Kronecker ordering, qubit A first).
 */
import { CMat, adjoint, conj, eigh, eigvalsh, fromArrays, hermitianPart, kron, matmul, singularValues, traceProdRe, zeros } from './linalg';

const S = Math.SQRT1_2;
export const PAULI: Record<'I' | 'X' | 'Y' | 'Z', CMat> = {
  I: fromArrays([[1, 0], [0, 1]]),
  X: fromArrays([[0, 1], [1, 0]]),
  Y: fromArrays([[0, 0], [0, 0]], [[0, -1], [1, 0]]),
  Z: fromArrays([[1, 0], [0, -1]]),
};
export const PAULI_SETTINGS = ['XX', 'XY', 'XZ', 'YX', 'YY', 'YZ', 'ZX', 'ZY', 'ZZ'];
const YY = kron(PAULI.Y, PAULI.Y);
const PAULI2: Record<string, CMat> = {};
for (const a of 'IXYZ') for (const b of 'IXYZ') PAULI2[a + b] = kron(PAULI[a as 'I'], PAULI[b as 'I']);

/** ρ^{T_B}: partial transpose on qubit B. */
export function partialTransposeB(rho: CMat): CMat {
  const out = zeros(4);
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) for (let d = 0; d < 2; d++) {
    // <a b| ρ |c d>  →  <a d| ρ^{T_B} |c b>
    const src = (a * 2 + b) * 4 + (c * 2 + d), dst = (a * 2 + d) * 4 + (c * 2 + b);
    out.re[dst] = rho.re[src];
    out.im[dst] = rho.im[src];
  }
  return out;
}

export function purity(rho: CMat): number {
  return traceProdRe(rho, rho);
}

/** N(ρ) = (‖ρ^{T_B}‖₁ − 1)/2 = −Σ negative eigenvalues of ρ^{T_B} (Vidal & Werner 2002). */
export function negativity(rho: CMat): number {
  const ev = eigvalsh(partialTransposeB(rho));
  let s = 0;
  for (const x of ev) if (x < 0) s += x;
  return Math.max(0, -s);
}

export function logNegativity(rho: CMat): number {
  return Math.log2(2 * negativity(rho) + 1);
}

/**
 * Wootters concurrence (PRL 80, 2245 (1998)) in the singular-value form: with ρ = V diag(w) V†,
 * √eig(ρ ρ̃) are the singular values of diag(√w) V† (Y⊗Y) V* diag(√w).
 */
export function concurrence(rho: CMat): number {
  const { w, V } = eigh(hermitianPart(rho));
  const sw = w.map((x) => Math.sqrt(Math.max(x, 0)));
  const M = matmul(matmul(adjoint(V), YY), conj(V));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    M.re[i * 4 + j] *= sw[i] * sw[j];
    M.im[i * 4 + j] *= sw[i] * sw[j];
  }
  const s = singularValues(M);
  return Math.max(0, s[0] - s[1] - s[2] - s[3]);
}

/** All 16 two-qubit Pauli expectation values <σ_a ⊗ σ_b>. */
export function pauliExpectations(rho: CMat): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k in PAULI2) out[k] = traceProdRe(rho, PAULI2[k]);
  return out;
}

/** Single-qubit Pauli eigenbases, outcome +1 first (columns). */
const EIG: Record<string, { re: number[][]; im: number[][] }> = {
  Z: { re: [[1, 0], [0, 1]], im: [[0, 0], [0, 0]] },
  X: { re: [[S, S], [S, -S]], im: [[0, 0], [0, 0]] },
  Y: { re: [[S, S], [0, 0]], im: [[0, 0], [S, -S]] },
};

/** Born probabilities of the outcomes (++, +−, −+, −−) of a two-qubit Pauli setting. */
export function outcomeProbabilities(rho: CMat, setting: string): number[] {
  const A = EIG[setting[0]], B = EIG[setting[1]];
  const p: number[] = [];
  for (const [a, b] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    const vr: number[] = [], vi: number[] = [];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const xr = A.re[i][a], xi = A.im[i][a], yr = B.re[j][b], yi = B.im[j][b];
      vr.push(xr * yr - xi * yi);
      vi.push(xr * yi + xi * yr);
    }
    // <v|ρ|v>
    let s = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const rr = rho.re[i * 4 + j], ri = rho.im[i * 4 + j];
      // conj(v_i) ρ_ij v_j
      const tr = rr * vr[j] - ri * vi[j], ti = rr * vi[j] + ri * vr[j];
      s += vr[i] * tr + vi[i] * ti;
    }
    p.push(Math.max(s, 0));
  }
  const tot = p[0] + p[1] + p[2] + p[3];
  return p.map((x) => x / tot);
}

export function correlatorFromProbs(p: number[]): number {
  return p[0] - p[1] - p[2] + p[3];
}

/** Coherence 2|ρ_A[0,1]| and 2|ρ_B[0,1]| of the reduced single-qubit states. */
export function reducedCoherences(rho: CMat): { A: number; B: number } {
  const ar = rho.re[0 * 4 + 2] + rho.re[1 * 4 + 3], ai = rho.im[0 * 4 + 2] + rho.im[1 * 4 + 3];
  const br = rho.re[0 * 4 + 1] + rho.re[2 * 4 + 3], bi = rho.im[0 * 4 + 1] + rho.im[2 * 4 + 3];
  return { A: 2 * Math.hypot(ar, ai), B: 2 * Math.hypot(br, bi) };
}

/** Physical admissibility of a density matrix (trace, Hermiticity, positivity), tol 1e-9 as in Python. */
export function checkDensityMatrix(rho: CMat, tol = 1e-9) {
  const n = rho.n;
  let trace = 0, herm = 0;
  for (let i = 0; i < n; i++) {
    trace += rho.re[i * n + i];
    for (let j = 0; j < n; j++) {
      const dr = rho.re[i * n + j] - rho.re[j * n + i], di = rho.im[i * n + j] + rho.im[j * n + i];
      herm = Math.max(herm, Math.hypot(dr, di));
    }
  }
  const ev = eigvalsh(hermitianPart(rho));
  const p = purity(rho);
  const minEv = ev[0];
  return {
    trace, hermiticity_error: herm, min_eigenvalue: minEv, purity: p, tolerance: tol,
    passed: Math.abs(trace - 1) <= tol && herm <= tol && minEv >= -tol,
  };
}

/**
 * Optimal decomposable witness W = (|v><v|)^{T_B} for the most negative eigenvector v of ρ^{T_B};
 * <W>_ρ equals that eigenvalue. Pauli coefficients tr(W σ_a⊗σ_b)/4 give the settings needed.
 */
export function pptWitness(rho: CMat) {
  const { w, V } = eigh(partialTransposeB(rho));
  const v = { re: [0, 1, 2, 3].map((k) => V.re[k * 4]), im: [0, 1, 2, 3].map((k) => V.im[k * 4]) };
  const P = zeros(4);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    P.re[i * 4 + j] = v.re[i] * v.re[j] + v.im[i] * v.im[j];
    P.im[i * 4 + j] = v.im[i] * v.re[j] - v.re[i] * v.im[j];
  }
  const W = partialTransposeB(P);
  const coeffs: Record<string, number> = {};
  for (const k in PAULI2) {
    const c = traceProdRe(W, PAULI2[k]) / 4;
    if (Math.abs(c) > 1e-12) coeffs[k] = c;
  }
  const settings = Object.keys(coeffs).filter((k) => !k.includes('I')).sort();
  return { value: w[0], pauli_coefficients: coeffs, settings_required: settings, certifies_entanglement: w[0] < 0 };
}
