/**
 * Suite 6 — gravitationally coupled harmonic oscillators, Gaussian covariance dynamics (independent
 * TypeScript implementation of qgdevs/optomech.py).
 *
 * Quadratures (X_A, P_A, X_B, P_B) with X = (a+a†)/√2, P = −i(a−a†)/√2 (vacuum V = I/2).
 *   g = 2 G m_A m_B x_zpfA x_zpfB / (ħ d³),  x_zpf = √(ħ / 2mω)
 *   A = drift matrix with damping γ/2, trap ω, coupling −2g between X_A and X_B and self-shift ω → ω − 2g
 *   D = γ (n_th + ½) I,  n_th = 1/(e^{ħω/k_BT} − 1)
 *   dV/dt = A V + V Aᵀ + D   (Ferraro, Olivares & Paris 2005)
 * The linear ODE is solved exactly: with v = vec(V) it reads dv/dt = L v + vec(D), L = A⊗I + I⊗A, and the
 * augmented system [[L, vec D],[0, 0]] is propagated by its matrix exponential (scaling and squaring with a
 * Taylor series), stepping between equally spaced output times.
 */
import { G, hbar, k_B } from './constants';

export function thermalOccupation(omega: number, T: number): number {
  return T <= 0 ? 0 : 1 / Math.expm1((hbar * omega) / (k_B * T));
}

export function gravitationalCouplingRate(mA: number, mB: number, d: number, omega: number): number {
  const xA = Math.sqrt(hbar / (2 * mA * omega)), xB = Math.sqrt(hbar / (2 * mB * omega));
  return (2 * G * mA * mB * xA * xB) / (hbar * d ** 3);
}

export function drift(omega: number, g: number, gamma: number, omegaShift: number): number[][] {
  const w = omega;
  return [
    [-gamma / 2, w, 0, 0],
    [-(w - 2 * omegaShift), -gamma / 2, -2 * g, 0],
    [0, 0, -gamma / 2, w],
    [-2 * g, 0, -(w - 2 * omegaShift), -gamma / 2],
  ];
}

const det2 = (m: number[][]) => m[0][0] * m[1][1] - m[0][1] * m[1][0];
function det4(a: number[][]): number {
  // Gaussian elimination with partial pivoting
  const m = a.map((r) => [...r]);
  let d = 1;
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (m[p][c] === 0) return 0;
    if (p !== c) { [m[p], m[c]] = [m[c], m[p]]; d = -d; }
    d *= m[c][c];
    for (let r = c + 1; r < 4; r++) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; }
  }
  return d;
}

/** E_N = max(0, −ln 2ν̃₋) for a two-mode Gaussian covariance matrix (vacuum = I/2). */
export function logNegativityGaussian(V: number[][]): number {
  const A = [[V[0][0], V[0][1]], [V[1][0], V[1][1]]];
  const B = [[V[2][2], V[2][3]], [V[3][2], V[3][3]]];
  const C = [[V[0][2], V[0][3]], [V[1][2], V[1][3]]];
  const dt = det2(A) + det2(B) - 2 * det2(C);
  const disc = dt * dt - 4 * det4(V);
  const nu = Math.sqrt(Math.max((dt - Math.sqrt(Math.max(disc, 0))) / 2, 0));
  return Math.max(0, -Math.log(2 * nu));
}

type Mat = Float64Array; // row-major n×n
function matmul(a: Mat, b: Mat, n: number): Mat {
  const c = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
    const aik = a[i * n + k]; if (aik === 0) continue;
    for (let j = 0; j < n; j++) c[i * n + j] += aik * b[k * n + j];
  }
  return c;
}
/** exp(M) by scaling and squaring with a 24-term Taylor series (‖M/2^s‖∞ ≤ 0.25). */
function expm(M: Mat, n: number): Mat {
  let norm = 0;
  for (let i = 0; i < n; i++) { let r = 0; for (let j = 0; j < n; j++) r += Math.abs(M[i * n + j]); norm = Math.max(norm, r); }
  const s = Math.max(0, Math.ceil(Math.log2(norm / 0.25)));
  const X = M.map((v) => v / 2 ** s) as Mat;
  let E = new Float64Array(n * n); for (let i = 0; i < n; i++) E[i * n + i] = 1;
  let term = new Float64Array(E);
  for (let k = 1; k <= 24; k++) {
    term = matmul(term, X, n).map((v) => v / k) as Mat;
    for (let i = 0; i < n * n; i++) E[i] += term[i];
  }
  for (let i = 0; i < s; i++) E = matmul(E, E, n);
  return E;
}

export interface OptoParams { m: number; d: number; omega: number; T: number; gamma: number; n_init: number; t_final: number; squeeze_r?: number; coupling_scale?: number; n_out?: number }
export interface OptoResult { t: number[]; V: number[][][]; log_negativity: number[]; coupling_rate_rad_s: number; thermal_occupation_bath: number }

/** Covariance-matrix dynamics of the two oscillators (same inputs/outputs as POST /api/optomech/evolve, plus V(t)). */
export function evolveCoupledOscillators(p: OptoParams): OptoResult {
  const nOut = p.n_out ?? 200;
  const g = (p.coupling_scale ?? 1) * gravitationalCouplingRate(p.m, p.m, p.d, p.omega);
  const A = drift(p.omega, g, p.gamma, g);
  const nth = thermalOccupation(p.omega, p.T);
  const Dd = p.gamma * (nth + 0.5);
  const s = (2 * p.n_init + 1) / 2, r = p.squeeze_r ?? 0;
  const V0 = [[s * Math.exp(-2 * r), 0, 0, 0], [0, s * Math.exp(2 * r), 0, 0], [0, 0, s * Math.exp(-2 * r), 0], [0, 0, 0, s * Math.exp(2 * r)]];
  // augmented generator on [vec(V) (row-major, 16); 1]
  const N = 17;
  const dt = p.t_final / (nOut - 1);
  const M = new Float64Array(N * N);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const row = i * 4 + j;
    // (A V)_ij = Σ_k A_ik V_kj ; (V Aᵀ)_ij = Σ_k V_ik A_jk
    for (let k = 0; k < 4; k++) { M[row * N + (k * 4 + j)] += A[i][k] * dt; M[row * N + (i * 4 + k)] += A[j][k] * dt; }
    if (i === j) M[row * N + 16] = Dd * dt;
  }
  const P = expm(M, N);
  let v = new Float64Array(N);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) v[i * 4 + j] = V0[i][j];
  v[16] = 1;
  const t: number[] = [], Vs: number[][][] = [], EN: number[] = [];
  for (let k = 0; k < nOut; k++) {
    const V = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => 0.5 * (v[i * 4 + j] + v[j * 4 + i])));
    t.push(k * dt); Vs.push(V); EN.push(logNegativityGaussian(V));
    const nv = new Float64Array(N);
    for (let i = 0; i < N; i++) { let acc = 0; for (let j = 0; j < N; j++) acc += P[i * N + j] * v[j]; nv[i] = acc; }
    v = nv;
  }
  return { t, V: Vs, log_negativity: EN, coupling_rate_rad_s: g, thermal_occupation_bath: nth };
}
