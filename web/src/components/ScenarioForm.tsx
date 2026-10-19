import { MathText } from './Tex';
import { T } from '../pages/formulas-l1';
/** Editor for the BMV design and environment shared by the flagship page, the builder and many suites. */
import { NumberField, SelectField } from './fields';
import { Switch, Level, Tip } from './ui';
import { useStore, settings, atLeast } from '../lib/store';
import { useApiGet } from '../lib/api';
import type { Design, Environment, Geometry, Scenario } from '../lib/types';
import { DEFAULT_DESIGN, DEFAULT_ENV } from '../lib/types';

/** Physics of the bias-field input (qgdevs.em.diamagnetic_branch_energies); exported for the KaTeX strict test. */
export const BIAS_FIELD_HELP = String.raw`Uniform magnetic field applied along $z$ during the interaction (0 T: no field). It induces diamagnetic moments $\mathbf{m} = \chi\,\tfrac{4}{3}\pi R^{3}\,\mathbf{B}/\mu_0$ in each sphere ($\chi$ from the material table), whose dipole–dipole energy $U_{ij} = \frac{\mu_0}{4\pi r_{ij}^{3}}\left[\mathbf{m}_A\cdot\mathbf{m}_B - 3(\mathbf{m}_A\cdot\hat{n})(\mathbf{m}_B\cdot\hat{n})\right]$ depends on the branch and therefore entangles without gravity, with $\Delta\varphi \propto B^{2}$. The spin–spin coupling of the embedded NV electron spins is always included.`;

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
                help={<MathText text={T.sf_mass} />} />
            ) : (<>
              <NumberField name="mass_A" label="Mass A" unit="kg" value={d.mass_A} min={1e-27} max={1e3} minExclusive maxExclusive report={report} onChange={(v) => setD({ mass_A: v })}
                help={<MathText text={T.sf_massA} />} />
              <NumberField name="mass_B" label="Mass B" unit="kg" value={d.mass_B} min={1e-27} max={1e3} minExclusive maxExclusive report={report} onChange={(v) => setD({ mass_B: v })}
                help="Mass of particle B." />
            </>)}
            <NumberField name="separation" label="Centre separation d" unit="m" value={d.separation} min={1e-9} max={10} minExclusive maxExclusive report={report} onChange={(v) => setD({ separation: v })}
              help={<MathText text={T.sf_sep} />} />
            {dxLinked ? (
              <NumberField name="dx" label="Branch separation Δx (each)" unit="m" value={d.dx_A} min={0} max={10} maxExclusive report={report} onChange={(v) => setD({ dx_A: v, dx_B: v })}
                help={<MathText text={T.sf_dx} />} />
            ) : (<>
              <NumberField name="dx_A" label="Branch separation Δx_A" unit="m" value={d.dx_A} min={0} max={10} maxExclusive report={report} onChange={(v) => setD({ dx_A: v })} help="Superposition size of A." />
              <NumberField name="dx_B" label="Branch separation Δx_B" unit="m" value={d.dx_B} min={0} max={10} maxExclusive report={report} onChange={(v) => setD({ dx_B: v })} help="Superposition size of B." />
            </>)}
            <NumberField name="time" label="Interaction time t" unit="s" value={d.time} min={0} max={1e4} minExclusive report={report} onChange={(v) => setD({ time: v })}
              help={<MathText text={T.sf_time} />} />
            <SelectField label="Geometry" value={d.geometry} level="advanced" onChange={(g: Geometry) => setD({ geometry: g })}
              options={[{ v: 'parallel', label: 'Parallel (split ⟂ A–B line)' }, { v: 'linear', label: 'Linear (split along A–B line)' }, { v: 'angled', label: 'Angled' }]}
              help={<MathText text={T.sf_geom} />} />
            {d.geometry === 'angled' && (
              <NumberField name="angle" label="Split angle" unit="deg" value={d.angle_deg} min={0} max={180} report={report} level="advanced" onChange={(v) => setD({ angle_deg: v })}
                help="Angle between the split axis and the A–B line (0° = linear, 90° = parallel)." />
            )}
            <NumberField name="density" label="Density" unit="kg m⁻³" value={d.density} min={100} max={3e4} minExclusive maxExclusive report={report} level="expert" onChange={(v) => setD({ density: v })}
              hint="Set automatically from the material; override only for custom materials."
              help={<MathText text={T.sf_density} />} />
            <NumberField name="gamma_A" label="Extra decoherence Γ_A" unit="s⁻¹" value={d.gamma_A} min={0} max={1e9} report={report} level="expert" onChange={(v) => setD({ gamma_A: v })}
              hint="Note: the server replaces this with the computed environmental rate."
              help={<MathText text={T.sf_gammaA} />} />
            <NumberField name="gamma_B" label="Extra decoherence Γ_B" unit="s⁻¹" value={d.gamma_B} min={0} max={1e9} report={report} level="expert" onChange={(v) => setD({ gamma_B: v })}
              help={<MathText text={T.sf_gammaB} />} />
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
              help={<MathText text={T.sf_material} />} />
            <NumberField name="pressure" label="Gas pressure" unit="Pa" value={e.pressure} min={0} max={2e5} report={report} onChange={(v) => setE({ pressure: v })}
              help={<MathText text={T.sf_pressure} />} />
            {tLinked ? (
              <NumberField name="T" label="Temperature (gas, environment, internal)" unit="K" value={e.T_gas} min={0} max={2000} minExclusive report={report} onChange={(v) => setE({ T_gas: v, T_env: v, T_int: v })}
                help={<MathText text={T.sf_temp} />} />
            ) : (<>
              <NumberField name="T_gas" label="Gas temperature" unit="K" value={e.T_gas} min={0} max={2000} minExclusive report={report} onChange={(v) => setE({ T_gas: v })} help={<MathText text={T.sf_Tgas} />} />
              <NumberField name="T_env" label="Environment temperature" unit="K" value={e.T_env} min={0} max={2000} report={report} onChange={(v) => setE({ T_env: v })} help={<MathText text={T.sf_Tenv} />} />
              <NumberField name="T_int" label="Internal temperature" unit="K" value={e.T_int} min={0} max={2000} report={report} onChange={(v) => setE({ T_int: v })} help={<MathText text={T.sf_Tint} />} />
            </>)}
            <NumberField name="charge" label="Residual charge (each)" unit="e" value={e.residual_charge_e} min={0} max={1e9} report={report} level="advanced" onChange={(v) => setE({ residual_charge_e: v })}
              help="Net charge left on each particle in elementary charges. Coulomb and charge–induced-dipole forces create branch-dependent phases that mimic gravitational entanglement." />
            <NumberField name="readout" label="Readout error ε" unit="1" value={e.readout_error} min={0} max={0.5} maxExclusive report={report} level="advanced" onChange={(v) => setE({ readout_error: v })}
              help={<MathText text={T.sf_readout} />} />
            <NumberField name="bias_field" label="Bias field B (along z)" unit="T" value={e.bias_field_T ?? 0} min={-20} max={20} report={report} level="advanced" onChange={(v) => setE({ bias_field_T: v })}
              help={<MathText text={BIAS_FIELD_HELP} />} />
          </div>
          <Level min="beginner">
            <div class="row" style={{ marginBottom: '8px' }}>
              <Switch checked={e.include_casimir} onChange={(v) => setE({ include_casimir: v })} label="Include Casimir–Polder interaction" />
              <Tip text={<MathText text={T.sf_casimir} />} />
            </div>
          </Level>
        </fieldset>
      )}
      <button type="button" class="btn-link small" onClick={() => onChange({ design: { ...DEFAULT_DESIGN }, environment: { ...DEFAULT_ENV } })}>Reset to the reference design (Bose et al. 2017)</button>
    </div>
  );
}
