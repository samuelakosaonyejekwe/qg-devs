/**
 * Environmental decoherence budget for one superposed mass (mirror of qgdevs/decoherence.py).
 * All rates are single-mass branch-coherence decay rates Γ [s^-1]: |ρ_LR(t)| = |ρ_LR(0)| e^{−Γt}.
 *
 * References: Joos & Zeh, Z. Phys. B 59, 223 (1985); Schlosshauer (2007) ch. 3; Romero-Isart,
 * PRA 84, 052121 (2011); Diósi, PRA 40, 1165 (1989); Penrose, GRG 28, 581 (1996).
 */
import type { DecoBudget, DecoMechanism } from '../lib/types';
import { G, ZETA9, amu, c, hbar, k_B } from './constants';

export const M_N2 = 28.0134 * amu; // default residual gas: nitrogen

export function meanSpeed(T: number, mGas = M_N2): number {
  return Math.sqrt((8 * k_B * T) / (Math.PI * mGas));
}

/** Saturated collisional decoherence Γ = n σ v̄, n = P/(k_B T), σ = πR² (every collision resolves which-path). */
export function gasCollisionRate(R: number, pressure: number, T_gas: number, mGas = M_N2): DecoMechanism {
  const n = pressure / (k_B * T_gas);
  const v = meanSpeed(T_gas, mGas);
  const lamGas = (2 * Math.PI * hbar) / Math.sqrt(2 * Math.PI * mGas * k_B * T_gas);
  return {
    rate: n * Math.PI * R * R * v, number_density_m3: n, mean_speed_m_s: v, gas_thermal_wavelength_m: lamGas,
    regime: 'saturated (Δx >> λ_gas)', gamma_t: 0, coherence_factor: 1,
  };
}

/**
 * Black-body scattering, absorption and emission (long-wavelength limit, Δx << λ_th):
 *  Λ_sc  = 8!·8ζ(9) c R⁶/(9π) (k_B T_env/ħc)⁹ Re(cm)²
 *  Λ_abs = 16π⁵ c R³/189 (k_B T_env/ħc)⁶ Im(cm);  Λ_em the same with T_int
 *  Γ = Λ Δx²,  capped at Λ λ_th² when Δx ≥ λ_th (saturation).
 */
export function blackbodyRates(R: number, dx: number, T_env: number, T_int: number, cm: { re: number; im: number }) {
  const lamTh = (T: number) => (T > 0 ? (2 * Math.PI * hbar * c) / (k_B * T) : Infinity);
  const a = (T: number) => (k_B * T) / (hbar * c);
  const defs: [string, number, (T: number) => number][] = [
    ['scattering', T_env, (T) => ((40320 * 8 * ZETA9 * c * R ** 6) / (9 * Math.PI)) * a(T) ** 9 * cm.re ** 2],
    ['absorption', T_env, (T) => ((16 * Math.PI ** 5 * c * R ** 3) / 189) * a(T) ** 6 * cm.im],
    ['emission', T_int, (T) => ((16 * Math.PI ** 5 * c * R ** 3) / 189) * a(T) ** 6 * cm.im],
  ];
  const out: Record<string, DecoMechanism> = {};
  for (const [name, T, L] of defs) {
    if (T <= 0) {
      out[name] = { rate: 0, Lambda_m2_s: 0, regime: 'T = 0', gamma_t: 0, coherence_factor: 1 };
      continue;
    }
    const Lv = L(T), lt = lamTh(T), eff = Math.min(dx, lt);
    out[name] = {
      rate: Lv * eff * eff, Lambda_m2_s: Lv, thermal_wavelength_m: lt,
      regime: dx < lt ? 'long-wavelength (Δx << λ_th)' : 'saturated (Δx >= λ_th): rate capped at Λ λ_th²',
      gamma_t: 0, coherence_factor: 1,
    };
  }
  return out;
}

/**
 * Diósi–Penrose rate Γ_DP = κ E_Δ/ħ, E_Δ = U(Δx) − U(0) for a uniform sphere. For Δx ≥ 2R (non-overlapping
 * branch copies) E_Δ = G m² (6/(5R) − 1/Δx). The overlapping case needs a numerical overlap integral and is
 * outside this engine's closed-form domain: NaN is returned and the regime says so.
 */
export function diosiPenroseRate(m: number, R: number, dx: number, kappa = 1.0): DecoMechanism {
  if (dx < 2 * R) {
    return { rate: NaN, E_delta_J: NaN, convention_factor: kappa, regime: 'outside closed-form domain (Δx < 2R)', gamma_t: NaN, coherence_factor: NaN };
  }
  const E = G * m * m * (6 / (5 * R) - 1 / dx);
  return {
    rate: (kappa * E) / hbar, E_delta_J: E, convention_factor: kappa,
    regime: 'uniform-sphere mass density smeared at the particle radius', gamma_t: 0, coherence_factor: 1,
  };
}

// ----------------------------------------------------------------------------- CSL collapse
/** Ghirardi–Pearle–Rimini reference parameters (qgdevs.decoherence.CSL_DEFAULTS). */
export const CSL_DEFAULTS = { lambda_s: 1e-16, r_C_m: 1e-7 } as const;

/** Normalised Fourier transform of a uniform ball: f(q) = 3 (sin q − q cos q)/q³, f(0) = 1. */
function sphereFormFactor(q: number): number {
  if (q < 1e-4) return 1.0 - (q * q) / 10.0;
  return (3.0 * (Math.sin(q) - q * Math.cos(q))) / q ** 3;
}

// 32-point Gauss–Legendre nodes/weights on [−1, 1] (Newton iteration on P_n).
const GL_N = 32;
const GL_X = new Float64Array(GL_N), GL_W = new Float64Array(GL_N);
(() => {
  for (let i = 0; i < GL_N; i++) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (GL_N + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = x;
      for (let k = 2; k <= GL_N; k++) { const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      dp = (GL_N * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-16) break;
    }
    GL_X[i] = x; GL_W[i] = 2 / ((1 - x * x) * dp * dp);
  }
})();

const cslCache = new Map<string, number>();

/**
 * Mass-proportional CSL decoherence rate of a uniform sphere superposed over Δx (Bassi et al., RMP 85, 471 (2013)):
 *   Γ = λ (m/m0)² (4π r_C²)^{3/2} (4π/(2π)³) ∫₀^∞ k² e^{−k² r_C²} f(kR)² (1 − sin(kΔx)/(kΔx)) dk.
 * The integral is evaluated on the same oscillation-aligned subintervals as the reference (k ≤ 8/r_C), each
 * subdivided and integrated with 32-point Gauss–Legendre (the integrand is smooth on every piece).
 */
export function cslRate(m: number, R: number, dx: number, lambda_s: number = CSL_DEFAULTS.lambda_s, r_C: number = CSL_DEFAULTS.r_C_m, m0: number = amu): DecoMechanism {
  const pref = lambda_s * (m / m0) ** 2 * (4 * Math.PI * r_C * r_C) ** 1.5 * (4 * Math.PI) / (2 * Math.PI) ** 3;
  const key = `${m}|${R}|${dx}|${r_C}|${m0}`;
  let val = cslCache.get(key);
  if (val === undefined) {
    const g = (k: number) => {
      const kx = k * dx;
      const sinc = kx < 1e-4 ? 1.0 - (kx * kx) / 6.0 : Math.sin(kx) / kx;
      const f = sphereFormFactor(k * R);
      return k * k * Math.exp(-((k * r_C) ** 2)) * f * f * (1.0 - sinc);
    };
    const kmax = 8.0 / r_C;
    const nOsc = Math.max(1, Math.floor((kmax * Math.max(R, dx)) / Math.PI));
    const nInt = Math.min(nOsc, 4000);
    const sub = Math.max(1, Math.ceil(1024 / nInt));
    const h = kmax / (nInt * sub);
    let acc = 0;
    for (let p = 0; p < nInt * sub; p++) {
      const a = p * h, mid = a + h / 2;
      let s = 0;
      for (let i = 0; i < GL_N; i++) s += GL_W[i] * g(mid + (h / 2) * GL_X[i]);
      acc += (s * h) / 2;
    }
    val = acc;
    if (cslCache.size > 4096) cslCache.clear();
    cslCache.set(key, val);
  }
  return {
    rate: pref * val, lambda_s, r_C_m: r_C, gamma_t: 0, coherence_factor: 1,
    regime: R < 0.1 * r_C ? 'point-like (R ≪ r_C)' : 'extended body (form factor included)',
  };
}

export interface BudgetOpts {
  pressure: number; T_gas: number; T_env: number; T_int: number;
  cm: { re: number; im: number }; t: number; include_dp?: boolean; dp_convention?: number; m_gas?: number;
  include_csl?: boolean; csl_lambda?: number;
}

/**
 * Total decoherence budget for one superposed mass over interaction time t. Established environmental
 * mechanisms only by default; the hypothetical collapse models (Diósi–Penrose, CSL) are opt-in and flagged
 * "hypothetical" so they are never mixed silently into the environmental total.
 */
export function decoherenceBudget(m: number, R: number, dx: number, o: BudgetOpts): DecoBudget {
  const items: Record<string, DecoMechanism> = {};
  items.gas_collisions = gasCollisionRate(R, o.pressure, o.T_gas, o.m_gas ?? M_N2);
  const bb = blackbodyRates(R, dx, o.T_env, o.T_int, o.cm);
  for (const k of Object.keys(bb)) items[`blackbody_${k}`] = bb[k];
  if (o.include_dp) items.diosi_penrose_collapse = { ...diosiPenroseRate(m, R, dx, o.dp_convention ?? 1), hypothetical: true };
  if (o.include_csl) items.csl_collapse = { ...cslRate(m, R, dx, o.csl_lambda ?? CSL_DEFAULTS.lambda_s), hypothetical: true };
  let total = 0, envTotal = 0, fastest = 0;
  let dominant: string | null = null;
  for (const k of Object.keys(items)) {
    const v = items[k];
    total += v.rate;
    if (!v.hypothetical) envTotal += v.rate;
    fastest = Math.max(fastest, v.rate);
    v.gamma_t = v.rate * o.t;
    v.coherence_factor = Math.exp(-v.rate * o.t);
    if (dominant === null || v.rate > items[dominant].rate) dominant = k;
  }
  return {
    mechanisms: items, total_rate: total, total_gamma_t: total * o.t, coherence_factor: Math.exp(-total * o.t), dominant,
    environmental_total_rate: envTotal, includes_hypothetical: envTotal !== total,
    suggested_display_window_s: fastest > 0 ? Math.min(o.t, 5.0 / fastest) : o.t,
  };
}
