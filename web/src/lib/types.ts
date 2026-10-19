/** Shared data shapes. They mirror the JSON returned by the QG-DEVS API (qgdevs/api.py). */

export type Geometry = 'parallel' | 'linear' | 'angled';
export type BranchKey = 'LL' | 'LR' | 'RL' | 'RR';
export const BRANCHES: BranchKey[] = ['LL', 'LR', 'RL', 'RR'];

/** BMV design (SI units) — qgdevs.bmv.BMVDesign / api.DesignIn. */
export interface Design {
  mass_A: number; // kg
  mass_B: number; // kg
  density: number; // kg m^-3
  separation: number; // m
  dx_A: number; // m
  dx_B: number; // m
  geometry: Geometry;
  angle_deg: number; // deg
  time: number; // s
  gamma_A: number; // s^-1 (extra, user-specified; the API adds environmental rates)
  gamma_B: number; // s^-1
}

/** Environment (SI units) — qgdevs.design.Environment / api.EnvIn. */
export interface Environment {
  pressure: number; // Pa
  T_gas: number; // K
  T_env: number; // K
  T_int: number; // K
  material: string;
  residual_charge_e: number; // elementary charges
  include_casimir: boolean;
  readout_error: number; // probability
  bias_field_T?: number; // T, uniform magnetic field along z during the interaction (default 0)
}

export interface Scenario {
  design: Design;
  environment: Environment;
}

export const DEFAULT_DESIGN: Design = {
  mass_A: 1e-14, mass_B: 1e-14, density: 3510, separation: 450e-6, dx_A: 250e-6, dx_B: 250e-6,
  geometry: 'parallel', angle_deg: 90, time: 2.5, gamma_A: 0, gamma_B: 0,
};

export const DEFAULT_ENV: Environment = {
  pressure: 1e-15, T_gas: 0.15, T_env: 0.15, T_int: 0.15, material: 'diamond',
  residual_charge_e: 0, include_casimir: true, readout_error: 0.01, bias_field_T: 0,
};

export interface DecoMechanism {
  rate: number;
  gamma_t: number;
  coherence_factor: number;
  regime?: string;
  /** set for hypothetical collapse models (Diósi–Penrose, CSL), which are opt-in */
  hypothetical?: boolean;
  [k: string]: unknown;
}

export interface DecoBudget {
  mechanisms: Record<string, DecoMechanism>;
  total_rate: number;
  total_gamma_t: number;
  coherence_factor: number;
  dominant: string | null;
  /** sum over established environmental mechanisms only (excludes hypothetical collapse models) */
  environmental_total_rate?: number;
  includes_hypothetical?: boolean;
  /** ≈ 5 / fastest rate, capped at the interaction time */
  suggested_display_window_s?: number;
}

export interface ModelPrediction {
  id: string;
  negativity: number;
  concurrence: number;
  witness_cpk: number;
  purity: number;
  coherence_A: number;
  coherence_B: number;
  correlators: Record<string, number>;
}

export interface TimeSeries {
  t: number[];
  delta_phi: number[];
  concurrence: number[];
  negativity: number[];
  witness_cpk: number[];
  purity: number[];
}

/** Response of POST /api/bmv/predict (and of the local engine's predictScenario). */
export interface PredictResult {
  design: Design & { radius_A: number; radius_B: number };
  admissibility_issues: string[];
  branch_distances_m: Record<BranchKey, number>;
  gravitational_energies_J: Record<BranchKey, number>;
  total_energies_J: Record<BranchKey, number>;
  phases_rad: Record<BranchKey, number>;
  phase_decomposition: { alpha: number; beta: number; gamma: number; delta_phi: number };
  delta_phi_gravity_rad: number;
  delta_phi_total_rad: number;
  concurrence: number;
  negativity: number;
  log_negativity: number;
  purity: number;
  pure_state_concurrence_bound: number;
  witness_cpk_local_corrected: number;
  witness_ppt: { value: number; certifies_entanglement: boolean; settings_required?: string[]; pauli_coefficients?: Record<string, number> };
  state_check: { trace: number; hermiticity_error: number; min_eigenvalue: number; purity: number; tolerance: number; passed: boolean };
  density_matrix_real: number[][];
  density_matrix_imag: number[][];
  time_series?: TimeSeries;
  models: ModelPrediction[];
  decoherence: DecoBudget;
  nongrav_channels: Record<BranchKey, Record<string, number>>;
  branch_positions: Record<'A_L' | 'A_R' | 'B_L' | 'B_R', [number, number, number]>;
  evidence_status: string;
}

/** Where a number came from. Displayed as a badge next to every result. */
export type Provenance =
  | 'COMPUTED'
  | 'COMPUTED_LOCAL'
  | 'SYNTHETIC'
  | 'CALCULATED_REQUIREMENT'
  | 'LITERATURE_REFERENCE'
  | 'ESTIMATED'
  | 'UNVERIFIED_ASSUMPTION'
  | 'CACHED';
