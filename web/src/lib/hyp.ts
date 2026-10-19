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
  'CG-QFT-AH': { color: '#8a8a8a', dash: [3, 3], short: 'Aziz–Howl (not implemented)' },
};

export function hypStyle(id: string): HypStyle {
  return HYP[id] ?? { color: '#777', dash: [], short: id };
}

export const IMPLEMENTED_IDS = ['QG-COH', 'QG-EFT1', 'SC-MF', 'CC-KTM', 'DP-COLL', 'NULL-NG'];
