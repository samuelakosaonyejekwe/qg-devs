/** Suite 3 — Quantum gravity EFT: registry entries for QG-COH / QG-EFT1 and the locally computed one-loop correction. */
import { useMemo, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, Out, EvidenceBanner, ErrorBox, Loading, SourceChip, DataTable, Json, Level, AssuranceBadge, KV, InfoBanner } from '../../components/ui';
import { ScenarioForm } from '../../components/ScenarioForm';
import { useValidity } from '../../components/fields';
import { LinePlot } from '../../plot/Chart';
import { useApiGet } from '../../lib/api';
import { useStore, scenario } from '../../lib/store';
import { fmtNum, fmtQ } from '../../lib/format';
import { eftPotentialTerms, branchDistances, checkGeometry, CONSTANTS } from '../../engine/index';
import { hypStyle } from '../../lib/hyp';
import { BRANCHES } from '../../lib/types';
import { logspace } from './f1-shared';

interface ModelEntry { id: string; name: string; family: string; implemented: boolean; dynamics: string; assumptions: string[]; approximations: string[]; admissible_domain: string; known_limits: string[]; references: string[]; assurance: string; status_note: string; entangling_by_gravity: boolean }

export default function Page(_props: { suite?: number }) {
  const models = useApiGet<ModelEntry[]>('/api/models');
  const sc = useStore(scenario);
  const v = useValidity();
  const [showForm, setShowForm] = useState(false);
  const d = sc.design;
  const issues = useMemo(() => checkGeometry(d), [d]);

  const calc = useMemo(() => {
    if (issues.length) return null;
    const { G, hbar, c, l_P } = CONSTANTS;
    const dist = branchDistances(d);
    const rows = BRANCHES.map((k) => {
      const t = eftPotentialTerms(d.mass_A, d.mass_B, dist[k]);
      return { k, r: dist[k], ...t, phase_q: (-t.quantum_one_loop_correction_J * d.time) / hbar, phase_n: (-t.newtonian_J * d.time) / hbar };
    });
    const by = Object.fromEntries(rows.map((r) => [r.k, r])) as Record<string, typeof rows[number]>;
    const dphiQ = by.LL.phase_q + by.RR.phase_q - by.LR.phase_q - by.RL.phase_q;
    const dphiN = by.LL.phase_n + by.RR.phase_n - by.LR.phase_n - by.RL.phase_n;
    const r = d.separation, m = Math.max(d.mass_A, d.mass_B);
    const regime = { retardation: r / c / d.time, potential: (G * m) / (r * c * c), geom: Math.max(d.dx_A, d.dx_B) < r };
    const rs = logspace(1e-9, 1, 200);
    return { rows, dphiQ, dphiN, regime, rs, rel: rs.map((x) => (41 / (10 * Math.PI)) * l_P ** 2 / x ** 2), l_P };
  }, [d, issues.length]);

  const show = (models.data ?? []).filter((m) => m.id === 'QG-COH' || m.id === 'QG-EFT1');
  return (
    <div>
      <SuiteHeader n={3} intro="Controlled low-energy quantum gravity: linearised gravity in the Newtonian limit (the operator-valued potential used by QG-COH) and the one-loop effective-field-theory correction of Bjerrum-Bohr, Donoghue & Holstein (2003). No complete, experimentally established theory of quantum gravity exists; these are explicitly scoped approximations." />
      <Card title="Model registry entries" actions={<SourceChip source={models.source === 'cache' ? 'cache' : null} cachedAt={models.cachedAt} />}>
        {models.loading && <Loading />}
        <ErrorBox error={models.error} what="loading the model registry" />
        <div class="grid-2">
          {show.map((m) => (
            <section class="card" aria-label={m.id}>
              <div class="card-head"><h3><span class="dot" style={{ background: hypStyle(m.id).color }} /> {m.id}</h3><AssuranceBadge status={m.assurance} raw={m.assurance} /></div>
              <p class="small">{m.name}</p>
              <KV rows={[
                ['Dynamics', <code>{m.dynamics}</code>],
                ['Assumptions', <ul class="tight">{m.assumptions.map((a) => <li>{a}</li>)}</ul>],
                ['Approximations', <ul class="tight">{m.approximations.map((a) => <li>{a}</li>)}</ul>],
                ['Admissible domain', m.admissible_domain],
                ['Known limits', <ul class="tight">{m.known_limits.map((a) => <li>{a}</li>)}</ul>],
                ['Entangling by gravity', m.entangling_by_gravity ? 'yes' : 'no'],
                ['References', <ul class="tight">{m.references.map((a) => <li>{a}</li>)}</ul>],
                ['Status note', m.status_note],
              ]} />
            </section>
          ))}
        </div>
      </Card>

      <Card title="One-loop EFT correction for the current design" actions={<button type="button" class="btn-sm" onClick={() => setShowForm((s) => !s)} aria-expanded={showForm}>{showForm ? 'Hide design' : 'Edit design'}</button>}>
        <EvidenceBanner />
        <p class="small muted">V(r) = −G m₁m₂/r [1 + 3G(m₁+m₂)/(rc²) + 41Għ/(10π r²c³)]. The second term is a classical post-Newtonian (gauge-dependent) correction; only the third is the genuine quantum correction. Every number below is computed in this browser from that formula and the current design (CODATA 2022 constants).</p>
        {showForm && <ScenarioForm value={sc} onChange={(s) => scenario.set(s)} report={v.report} showEnv={false} />}
        {issues.length > 0 && <div class="error-box" role="alert"><strong>Inadmissible design:</strong> {issues.join('; ')}</div>}
        {calc && (<>
          <div class="outs">
            <Out label="Quantum relative size at d" value={calc.rows.find((r) => r.k === 'LL')!.quantum_relative_size} prov="COMPUTED_LOCAL"
              interp={`41 l_P²/(10π r²) with l_P = ${fmtQ(calc.l_P, 'm')}: the quantum term relative to Newtonian gravity. Far below any conceivable laboratory resolution.`} />
            <Out label="Δφ from quantum correction" value={calc.dphiQ} unit="rad" prov="COMPUTED_LOCAL" interp="Contribution to the entangling phase, Δφ_q = φ_LL + φ_RR − φ_LR − φ_RL with φ_ij = −U_q t/ħ." />
            <Out label="Newtonian Δφ (point masses)" value={calc.dphiN} unit="rad" prov="COMPUTED_LOCAL" interp="Same combination for −Gm₁m₂/r: the tree-level QG-COH prediction (no Casimir, no decoherence)." />
            <Out label="Ratio Δφ_q / Δφ_N" value={calc.dphiN !== 0 ? calc.dphiQ / calc.dphiN : NaN} prov="COMPUTED_LOCAL" interp="Why QG-EFT1 is experimentally indistinguishable from QG-COH at laboratory scales (computed, not asserted)." />
          </div>
          <h3 style={{ marginTop: '14px' }}>Per branch pair</h3>
          <DataTable caption="EFT potential terms per branch pair" head={['Pair', 'r', 'Newtonian U', 'classical PN term', 'quantum term', 'relative size', 'φ_q = −U_q t/ħ']} numeric={[1, 2, 3, 4, 5, 6]}
            rows={calc.rows.map((r) => [r.k, fmtQ(r.r, 'm'), fmtQ(r.newtonian_J, 'J'), fmtQ(r.classical_pn_correction_J, 'J'), fmtQ(r.quantum_one_loop_correction_J, 'J'), fmtNum(r.quantum_relative_size, 3), `${fmtNum(r.phase_q, 3)} rad`])} />
          <h3 style={{ marginTop: '14px' }}>Domain-of-validity checks (static Newtonian-limit approximation)</h3>
          <div class="outs">
            <Out label="Retardation ratio (r/c)/t" value={calc.regime.retardation} prov="COMPUTED_LOCAL" tone={calc.regime.retardation < 1e-6 ? 'good' : 'bad'} interp="Light-crossing time over interaction time; must be ≪ 1 (threshold 10⁻⁶ in qgdevs.qg_eft)." />
            <Out label="|Φ|/c² = Gm/(rc²)" value={calc.regime.potential} prov="COMPUTED_LOCAL" tone={calc.regime.potential < 1e-6 ? 'good' : 'bad'} interp="Weak-field condition; must be ≪ 1 (threshold 10⁻⁶)." />
            <Out label="Branch geometry Δx < r" value={calc.regime.geom ? 'satisfied' : 'violated'} prov="COMPUTED_LOCAL" tone={calc.regime.geom ? 'good' : 'bad'} interp="Branches must be distinct and closer to each other than the masses are apart." />
          </div>
          <LinePlot name="eft-relative-size" title="Quantum one-loop relative size vs distance" desc="41 l_P squared over 10 pi r squared, log-log, with the current separation marked" xLabel="Distance r" xUnit="m" yLabel="Relative size" yUnit="1" logX logY
            cursorX={d.separation} series={[{ name: '41 l_P²/(10π r²)', x: calc.rs, y: calc.rel, color: hypStyle('QG-EFT1').color }]} />
          <p class="small muted">Vertical line: current centre separation d = {fmtQ(d.separation, 'm')}.</p>
        </>)}
        {!calc && issues.length === 0 && <InfoBanner>Enter a design to compute the correction.</InfoBanner>}
        <Level min="expert">{calc && <Json data={calc.rows} />}</Level>
      </Card>
    </div>
  );
}
