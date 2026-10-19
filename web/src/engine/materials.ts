/**
 * Material properties (mirror of qgdevs/materials.py). The thermal-IR imaginary permittivity values are
 * estimates and must be replaced by measured values for a real apparatus.
 */
export interface Material {
  key: string;
  name: string;
  density: number; // kg m^-3
  eps_real: number;
  eps_imag: number;
  magnetic_susceptibility: number; // SI volume susceptibility (dimensionless)
}

export const MATERIALS: Record<string, Material> = {
  diamond: { key: 'diamond', name: 'Diamond (single-crystal, with NV centre for spin readout)', density: 3510.0, eps_real: 5.7, eps_imag: 0.0, magnetic_susceptibility: -2.2e-5 },
  silica: { key: 'silica', name: 'Fused silica (SiO2)', density: 2200.0, eps_real: 3.8, eps_imag: 0.1, magnetic_susceptibility: -1.1e-5 },
  silicon: { key: 'silicon', name: 'Silicon (intrinsic)', density: 2329.0, eps_real: 11.7, eps_imag: 0.0, magnetic_susceptibility: -4.2e-6 },
  osmium: { key: 'osmium', name: 'Osmium (densest stable element; metallic)', density: 22590.0, eps_real: 1e6, eps_imag: 0.0, magnetic_susceptibility: 1.5e-5 },
  gold: { key: 'gold', name: 'Gold', density: 19300.0, eps_real: 1e6, eps_imag: 0.0, magnetic_susceptibility: -3.4e-5 },
};

/** Clausius–Mossotti factor cm = (ε − 1)/(ε + 2) for complex ε = ε' + iε''. */
export function clausiusMossotti(m: Material): { re: number; im: number } {
  const a = m.eps_real, b = m.eps_imag;
  const den = (a + 2) ** 2 + b * b;
  return { re: ((a - 1) * (a + 2) + b * b) / den, im: (3 * b) / den };
}

export function getMaterial(key: string): Material {
  const m = MATERIALS[key];
  if (!m) throw new Error(`unknown material '${key}'; available: ${Object.keys(MATERIALS).sort().join(', ')}`);
  return m;
}
