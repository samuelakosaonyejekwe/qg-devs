/** Editor for the BMV design and environment shared by the flagship page, the builder and many suites. */
import { NumberField, SelectField } from './fields';
import { Switch, Level, Tip } from './ui';
import { useStore, settings, atLeast } from '../lib/store';
import { useApiGet } from '../lib/api';
import type { Design, Environment, Geometry, Scenario } from '../lib/types';
import { DEFAULT_DESIGN, DEFAULT_ENV } from '../lib/types';

/** Offline fallback for the material list (same values as qgdevs/materials.py; the live list comes from GET /api/materials). */
const FALLBACK_MATERIALS: Record<string, { name: string; density: number }> = {
  diamond: { name: 'Diamond (single-crystal, NV centre)', density: 3510 },
  silica: { name: 'Fused silica (SiO2)', density: 2200 },
  silicon: { name: 'Silicon (intrinsic)', density: 2329 },
  osmium: { name: 'Osmium (metallic)', density: 22590 },
  gold: { name: 'Gold', density: 19300 },
};

export function useMaterials(): Record<string, { name: string; density: number; status?: Record<string, string>; notes?: string }> {
  const r = useApiGet<Record<string, { name: string; density: number; status: Record<string, string>; notes: string }>>('/api/materials');
  return r.data ?? FALLBACK_MATERIALS;
}

interface Props {
  value: Scenario; onChange: (s: Scenario) => void; report: (name: string, err: string | null) => void;
  showEnv?: boolean; showDesign?: boolean;
}

export function ScenarioForm({ value, onChange, report, showEnv = true, showDesign = true }: Props) {
  const s = useStore(settings);
  const mats = useMaterials();
  const d = value.design, e = value.environment;
  const setD = (p: Partial<Design>) => onChange({ ...value, design: { ...d, ...p } });
  const setE = (p: Partial<Environment>) => onChange({ ...value, environment: { ...e, ...p } });
  const adv = atLeast(s.mode, 'advanced');
  const massLinked = !adv && d.mass_A === d.mass_B;
  const dxLinked = !adv && d.dx_A === d.dx_B;
  const tLinked = !adv && e.T_gas === e.T_env && e.T_env === e.T_int;
  return (
    <div>
      {showDesign && (
        <fieldset class="fieldset">
          <legend>Design</legend>
          <div class="form-grid">
            {massLinked ? (
              <NumberField name="mass" label="Mass (each)" unit="kg" value={d.mass_A} min={1e-27} max={1e3} minExclusive maxExclusive report={report}
                onChange={(v) => setD({ mass_A: v, mass_B: v })}
                help="Mass of each test particle. The entangling phase grows as m_A·m_B, so heavier masses entangle faster — but decoherence from gas collisions and black-body radiation also grows with size." />
            ) : (<>
              <NumberField name="mass_A" label="Mass A" unit="kg" value={d.mass_A} min={1e-27} max={1e3} minExclusive maxExclusive report={report} onChange={(v) => setD({ mass_A: v })}
                help="Mass of particle A (uniform sphere of the chosen density). Δφ ∝ m_A m_B." />
              <NumberField name="mass_B" label="Mass B" unit="kg" value={d.mass_B} min={1e-27} max={1e3} minExclusive maxExclusive report={report} onChange={(v) => setD({ mass_B: v })}
                help="Mass of particle B." />
            </>)}
            <NumberField name="separation" label="Centre separation d" unit="m" value={d.separation} min={1e-9} max={10} minExclusive maxExclusive report={report} onChange={(v) => setD({ separation: v })}
              help="Distance between the centres of the two interferometers (A at the origin, B on the +x axis). Gravity falls as 1/r, Casimir–Polder as 1/r⁷, so too small a separation lets electromagnetic forces dominate." />
            {dxLinked ? (
              <NumberField name="dx" label="Branch separation Δx (each)" unit="m" value={d.dx_A} min={0} max={10} maxExclusive report={report} onChange={(v) => setD({ dx_A: v, dx_B: v })}
                help="Spatial size of each superposition (distance between the L and R branches). Larger Δx increases the entangling phase but also the which-path information leaked to the environment." />
            ) : (<>
              <NumberField name="dx_A" label="Branch separation Δx_A" unit="m" value={d.dx_A} min={0} max={10} maxExclusive report={report} onChange={(v) => setD({ dx_A: v })} help="Superposition size of A." />
              <NumberField name="dx_B" label="Branch separation Δx_B" unit="m" value={d.dx_B} min={0} max={10} maxExclusive report={report} onChange={(v) => setD({ dx_B: v })} help="Superposition size of B." />
            </>)}
            <NumberField name="time" label="Interaction time t" unit="s" value={d.time} min={0} max={1e4} minExclusive report={report} onChange={(v) => setD({ time: v })}
              help="Time during which the branches are held apart and interact. In the static model phases grow linearly: φ_ij = −U_ij t/ħ; decoherence grows as e^{−Γt}." />
            <SelectField label="Geometry" value={d.geometry} level="advanced" onChange={(g: Geometry) => setD({ geometry: g })}
              options={[{ v: 'parallel', label: 'Parallel (split ⟂ A–B line)' }, { v: 'linear', label: 'Linear (split along A–B line)' }, { v: 'angled', label: 'Angled' }]}
              help="Orientation of the split axis relative to the A–B line. Linear geometry gives a larger Δφ for the same d and Δx but brings the inner branches closer (stronger Casimir–Polder)." />
            {d.geometry === 'angled' && (
              <NumberField name="angle" label="Split angle" unit="deg" value={d.angle_deg} min={0} max={180} report={report} level="advanced" onChange={(v) => setD({ angle_deg: v })}
                help="Angle between the split axis and the A–B line (0° = linear, 90° = parallel)." />
            )}
            <NumberField name="density" label="Density" unit="kg m⁻³" value={d.density} min={100} max={3e4} minExclusive maxExclusive report={report} level="expert" onChange={(v) => setD({ density: v })}
              hint="Set automatically from the material; override only for custom materials."
              help="Mass density used to compute the sphere radius R = (3m/4πρ)^{1/3}; it sets the Casimir–Polder strength (∝ R⁶) and black-body cross-sections." />
            <NumberField name="gamma_A" label="Extra decoherence Γ_A" unit="s⁻¹" value={d.gamma_A} min={0} max={1e9} report={report} level="expert" onChange={(v) => setD({ gamma_A: v })}
              hint="Note: the server replaces this with the computed environmental rate."
              help="Additional single-mass coherence decay rate. In POST /api/bmv/predict the server overwrites Γ with the environmental budget (gas + black-body), so this input only matters for custom job payloads." />
            <NumberField name="gamma_B" label="Extra decoherence Γ_B" unit="s⁻¹" value={d.gamma_B} min={0} max={1e9} report={report} level="expert" onChange={(v) => setD({ gamma_B: v })}
              help="Additional single-mass coherence decay rate for B (see Γ_A)." />
          </div>
          {!adv && (d.mass_A !== d.mass_B || d.dx_A !== d.dx_B || d.geometry !== 'parallel') && (
            <p class="small muted">This design has settings that are only editable in Advanced mode (geometry: {d.geometry}{d.mass_A !== d.mass_B ? ', unequal masses' : ''}{d.dx_A !== d.dx_B ? ', unequal branch separations' : ''}). They are still used in every calculation.</p>
          )}
        </fieldset>
      )}
      {showEnv && (
        <fieldset class="fieldset">
          <legend>Environment</legend>
          <div class="form-grid">
            <SelectField label="Material" value={e.material} onChange={(m) => onChange({ design: mats[m] ? { ...d, density: mats[m].density } : d, environment: { ...e, material: m } })}
              options={Object.entries(mats).map(([k, m]) => ({ v: k, label: `${k} — ${m.density} kg/m³` }))}
              help="Test-mass material. Sets density and the Clausius–Mossotti factor (ε−1)/(ε+2) that controls Casimir–Polder coupling and black-body decoherence. Thermal-IR absorption (Im ε) values are estimates — see the Virtual Laboratory." />
            <NumberField name="pressure" label="Gas pressure" unit="Pa" value={e.pressure} min={0} max={2e5} report={report} onChange={(v) => setE({ pressure: v })}
              help="Residual-gas pressure. Each gas collision resolves which-path information (saturated regime), so the decoherence rate Γ = n σ v̄ is proportional to pressure. BMV needs extreme-high vacuum (~10⁻¹⁵ Pa)." />
            {tLinked ? (
              <NumberField name="T" label="Temperature (gas, environment, internal)" unit="K" value={e.T_gas} min={0} max={2000} minExclusive report={report} onChange={(v) => setE({ T_gas: v, T_env: v, T_int: v })}
                help="Temperature of the residual gas, the black-body environment and the particles' interior. Black-body scattering scales as T⁹, absorption/emission as T⁶." />
            ) : (<>
              <NumberField name="T_gas" label="Gas temperature" unit="K" value={e.T_gas} min={0} max={2000} minExclusive report={report} onChange={(v) => setE({ T_gas: v })} help="Sets the gas number density n = P/(k_B T) and mean speed v̄ ∝ √T." />
              <NumberField name="T_env" label="Environment temperature" unit="K" value={e.T_env} min={0} max={2000} report={report} onChange={(v) => setE({ T_env: v })} help="Temperature of the surrounding black-body radiation: scattering ∝ T⁹, absorption ∝ T⁶." />
              <NumberField name="T_int" label="Internal temperature" unit="K" value={e.T_int} min={0} max={2000} report={report} onChange={(v) => setE({ T_int: v })} help="Internal temperature of the particles: thermal emission ∝ T⁶ · Im[(ε−1)/(ε+2)]." />
            </>)}
            <NumberField name="charge" label="Residual charge (each)" unit="e" value={e.residual_charge_e} min={0} max={1e9} report={report} level="advanced" onChange={(v) => setE({ residual_charge_e: v })}
              help="Net charge left on each particle in elementary charges. Coulomb and charge–induced-dipole forces create branch-dependent phases that mimic gravitational entanglement." />
            <NumberField name="readout" label="Readout error ε" unit="1" value={e.readout_error} min={0} max={0.5} maxExclusive report={report} level="advanced" onChange={(v) => setE({ readout_error: v })}
              help="Probability that a spin readout returns the wrong outcome (symmetric bit flip, independent per mass). Shrinks measured correlators by (1−2ε)²." />
          </div>
          <Level min="beginner">
            <div class="row" style={{ marginBottom: '8px' }}>
              <Switch checked={e.include_casimir} onChange={(v) => setE({ include_casimir: v })} label="Include Casimir–Polder interaction" />
              <Tip text="Retarded Casimir–Polder interaction U = −(23ħc/4π) R_A³R_B³ cm_A cm_B / r⁷ between the dielectric spheres. Turning it off isolates the gravitational contribution (for analysis only — nature cannot switch it off)." />
            </div>
          </Level>
        </fieldset>
      )}
      <button type="button" class="btn-link small" onClick={() => onChange({ design: { ...DEFAULT_DESIGN }, environment: { ...DEFAULT_ENV } })}>Reset to the reference design (Bose et al. 2017)</button>
    </div>
  );
}
