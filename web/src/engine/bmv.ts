/**
 * Gravity-mediated entanglement of two spatially superposed masses (mirror of qgdevs/bmv.py).
 * Bose et al., PRL 119, 240401 (2017); Marletto & Vedral, PRL 119, 240402 (2017).
 *
 * Branch pair (i,j) acquires φ_ij = −U_ij t/ħ. With z_L = +1, z_R = −1:
 *   φ_ij = α + β z_i + γ z_j + (Δφ/4) z_i z_j,   Δφ = φ_LL + φ_RR − φ_LR − φ_RL  (only Δφ entangles).
 * With independent branch dephasing the joint state is exactly
 *   ρ_{ij,kl} = ¼ e^{i(φ_ij − φ_kl)} e^{−Γ_A t (1−δ_ik)} e^{−Γ_B t (1−δ_jl)}.
 */
import type { BranchKey, Design } from '../lib/types';
import { BRANCHES } from '../lib/types';
import { G, hbar } from './constants';
import { CMat, zeros } from './linalg';
import { pauliExpectations } from './quantum';

export type Vec3 = [number, number, number];
export type Phases = Record<BranchKey, number>;
export const Z_SIGN: Record<'L' | 'R', number> = { L: 1, R: -1 };

export function radiusOf(mass: number, density: number): number {
  return Math.cbrt((3 * mass) / (4 * Math.PI * density));
}

export function splitAxis(geometry: string, angleDeg = 90): Vec3 {
  if (geometry === 'linear') return [1, 0, 0];
  if (geometry === 'parallel') return [0, 1, 0];
  if (geometry === 'angled') {
    const a = (angleDeg * Math.PI) / 180;
    return [Math.cos(a), Math.sin(a), 0];
  }
  throw new Error(`unknown geometry '${geometry}'`);
}

/** Branch centres of mass. A is centred at the origin, B at (separation, 0, 0). */
export function branchPositions(d: Design): Record<'A_L' | 'A_R' | 'B_L' | 'B_R', Vec3> {
  const n = splitAxis(d.geometry, d.angle_deg);
  const s = (c: Vec3, k: number): Vec3 => [c[0] + k * n[0], c[1] + k * n[1], c[2] + k * n[2]];
  const cA: Vec3 = [0, 0, 0], cB: Vec3 = [d.separation, 0, 0];
  return { A_L: s(cA, 0.5 * d.dx_A), A_R: s(cA, -0.5 * d.dx_A), B_L: s(cB, 0.5 * d.dx_B), B_R: s(cB, -0.5 * d.dx_B) };
}

export function branchDistances(d: Design): Record<BranchKey, number> {
  const p = branchPositions(d);
  const out = {} as Record<BranchKey, number>;
  for (const i of 'LR') for (const j of 'LR') {
    const a = p[`A_${i}` as 'A_L'], b = p[`B_${j}` as 'B_L'];
    out[(i + j) as BranchKey] = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  return out;
}

/** Python-style exponent formatting ('{:.3e}'): 4.500e-04. */
export function fmtE3(x: number): string {
  return x.toExponential(3).replace(/e([+-])(\d)$/, 'e$10$2');
}

/** Physical-admissibility problems (empty = admissible); messages identical to the Python reference. */
export function checkGeometry(d: Design): string[] {
  const issues: string[] = [];
  const RA = radiusOf(d.mass_A, d.density), RB = radiusOf(d.mass_B, d.density);
  const fields: [string, number][] = [
    ['mass_A', d.mass_A], ['mass_B', d.mass_B], ['density', d.density], ['separation', d.separation],
    ['dx_A', d.dx_A], ['dx_B', d.dx_B], ['time', d.time], ['gamma_A', d.gamma_A], ['gamma_B', d.gamma_B],
    ['radius_A', RA], ['radius_B', RB],
  ];
  for (const [k, v] of fields) if (v < 0) issues.push(`${k} must be non-negative`);
  if (d.mass_A <= 0 || d.mass_B <= 0) issues.push('masses must be positive');
  if (d.time <= 0) issues.push('interaction time must be positive');
  const dist = branchDistances(d);
  const rmin = Math.min(...Object.values(dist));
  if (rmin <= RA + RB)
    issues.push(`branches overlap or touch: closest branch distance ${fmtE3(rmin)} m <= sum of radii ${fmtE3(RA + RB)} m`);
  if (d.dx_A <= 2 * RA || d.dx_B <= 2 * RB)
    issues.push('branch separation not larger than particle diameter (branches spatially overlap)');
  return issues;
}

/**
 * Mutual gravitational energy of uniform spheres. For centre distance ≥ R1 + R2 the shell theorem makes
 * it exactly −G m1 m2 / d; overlapping spheres (inadmissible designs) are outside this engine's scope and
 * fall back to the point-mass value (flagged by checkGeometry).
 */
export function sphereMutualEnergy(m1: number, m2: number, d: number): number {
  return (-G * m1 * m2) / d;
}

export function gravitationalBranchEnergies(d: Design, massScale = 1): Record<BranchKey, number> {
  const dist = branchDistances(d);
  const out = {} as Record<BranchKey, number>;
  for (const k of BRANCHES) out[k] = sphereMutualEnergy(d.mass_A, d.mass_B, dist[k]) * massScale ** 2;
  return out;
}

export function phasesFromEnergies(E: Record<BranchKey, number>, t: number): Phases {
  const out = {} as Phases;
  for (const k of BRANCHES) out[k] = (-E[k] * t) / hbar;
  return out;
}

export function entanglingPhase(p: Phases): number {
  return p.LL + p.RR - p.LR - p.RL;
}

export function decomposePhases(p: Phases) {
  return {
    alpha: (p.LL + p.LR + p.RL + p.RR) / 4,
    beta: (p.LL + p.LR - p.RL - p.RR) / 4,
    gamma: (p.LL - p.LR + p.RL - p.RR) / 4,
    delta_phi: entanglingPhase(p),
  };
}

/** Closed form for the parallel geometry with equal branch separations (point masses). */
export function parallelDeltaPhiAnalytic(mA: number, mB: number, d: number, dx: number, t: number): number {
  return ((2 * G * mA * mB * t) / hbar) * (1 / d - 1 / Math.sqrt(d * d + dx * dx));
}

/** Joint branch state for initial |+>|+>; decayA/B are the integrated exponents ∫Γ dt. */
export function jointState(p: Phases, decayA = 0, decayB = 0): CMat {
  const ph = BRANCHES.map((k) => p[k]);
  const a = [0, 0, 1, 1], b = [0, 1, 0, 1];
  const rho = zeros(4);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const amp = 0.25 * Math.exp(-decayA * (a[i] !== a[j] ? 1 : 0)) * Math.exp(-decayB * (b[i] !== b[j] ? 1 : 0));
    const d = ph[i] - ph[j];
    rho.re[i * 4 + j] = amp * Math.cos(d);
    rho.im[i * 4 + j] = amp * Math.sin(d);
  }
  return rho;
}

/**
 * Apply the local unitary R_z(β) ⊗ R_z(γ) that removes the non-entangling phases β, γ of `ref`:
 * U = diag(e^{−iβ z_i − iγ z_j}); returns U ρ U†.
 */
export function applyLocalCorrection(rho: CMat, ref: Phases): CMat {
  const dec = decomposePhases(ref);
  const zA = [1, 1, -1, -1], zB = [1, -1, 1, -1];
  const th = [0, 1, 2, 3].map((k) => -(dec.beta * zA[k] + dec.gamma * zB[k]));
  const out = zeros(4);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const d = th[i] - th[j];
    const cr = Math.cos(d), ci = Math.sin(d);
    const r = rho.re[i * 4 + j], im = rho.im[i * 4 + j];
    out.re[i * 4 + j] = r * cr - im * ci;
    out.im[i * 4 + j] = r * ci + im * cr;
  }
  return out;
}

/** CPK witness W = 1 − X⊗X − Y⊗Z − Z⊗Y (Chevalier, Paige & Kim, PRA 102, 022428 (2020)). */
export function cpkWitnessValue(rho: CMat): number {
  const e = pauliExpectations(rho);
  return 1 - e.XX - e.YZ - e.ZY;
}

/** min over the two valid sign variants W± = 1 − X⊗X ∓ (Y⊗Z + Z⊗Y); both are ≥ 0 on separable states. */
export function cpkWitnessBestSign(rho: CMat): number {
  const e = pauliExpectations(rho);
  return Math.min(1 - e.XX - e.YZ - e.ZY, 1 - e.XX + e.YZ + e.ZY);
}

/** Classical-channel threshold Γ* = |dΔφ/dt|/2 (above it a ZZ-coupled pair from |+>|+> never entangles). */
export function entanglementDephasingThreshold(deltaPhiRate: number): number {
  return Math.abs(deltaPhiRate) / 2;
}
