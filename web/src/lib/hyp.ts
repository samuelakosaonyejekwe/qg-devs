/**
 * Consistent, colour-blind-safe colours per hypothesis id (Okabe & Ito 2008 palette), used by every chart.
 * Each hypothesis also has a dash pattern so curves remain distinguishable in greyscale and when they overlap
 * (e.g. QG-EFT1 coincides with QG-COH at laboratory scales).
 */
export interface HypStyle { color: string; dash: number[]; short: string }

export const HYP: Record<string, HypStyle> = {
  'QG-COH': { color: '#0072B2', dash: [], short: 'Quantum-coherent gravity' },
  'QG-EFT1': { color: '#56B4E9', dash: [6, 4], short: 'QG EFT one-loop' },
  'SC-MF': { color: '#E69F00', dash: [2, 3], short: 'Semiclassical mean field' },
  'CC-KTM': { color: '#D55E00', dash: [8, 3, 2, 3], short: 'Classical channel (KTM)' },
  'DP-COLL': { color: '#CC79A7', dash: [4, 2], short: 'Diósi–Penrose collapse' },
  'NULL-NG': { color: '#009E73', dash: [1, 3], short: 'No gravitational coupling' },
  'CSL-COLL': { color: '#999933', dash: [6, 2, 1, 2], short: 'CSL collapse' },
  'CG-QFT-AH': { color: '#AA4499', dash: [2, 2, 6, 2], short: 'Aziz–Howl classical gravity + quantum matter' },
};

export function hypStyle(id: string): HypStyle {
  return HYP[id] ?? { color: '#777', dash: [], short: id };
}

/** Hypotheses implemented by the local engine, in the backend registry order (see src/engine/models.ts). */
export const IMPLEMENTED_IDS = ['QG-COH', 'QG-EFT1', 'SC-MF', 'CC-KTM', 'DP-COLL', 'NULL-NG', 'CSL-COLL', 'CG-QFT-AH'];
