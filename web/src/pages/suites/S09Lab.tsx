import { RunBar, useAfterReset } from '../../components/Reset';
/** Suite 9 — Virtual Laboratory: experiment dossier (protocol + engineering specification), exports, 3-D model, instruments. */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, Out, ProvBadge, StatusBadge, EvidenceBanner, ErrorBox, Btn, DataTable, Json, Level, InfoBanner, Tabs, TabPanel, KV, SourceChip, Seg } from '../../components/ui';
import { Tex } from '../../components/Tex';
import { useValidity } from '../../components/fields';
import { ScenarioForm } from '../../components/ScenarioForm';
import { View3D } from '../../components/View3D';
import { usePlayer, PlayerControls } from '../../components/Player';
import { useStore, scenario, settings, atLeast } from '../../lib/store';
import { apiPost, apiPostBlob, downloadBlob, useApiGet } from '../../lib/api';
import { fmtQ, fmtNum, fmtTime, humanKey, shortHash } from '../../lib/format';
import type { PredictResult } from '../../lib/types';
import { useRun, body } from './f2-shared';

const STATUS_RE = /^(CALCULATED_REQUIREMENT|LITERATURE_REFERENCE|ESTIMATED|UNVERIFIED_ASSUMPTION|SUPPLIER_CONFIRMED)$/;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** Generic, provenance-aware renderer for dossier values (strings, lists, {value, unit, status, basis} records, nested dicts). */
function Val({ v, unit }: { v: unknown; unit?: string }): any {
  if (v == null) return <span class="muted">— (not computed)</span>;
  if (typeof v === 'number') return <span class="mono">{unit ? fmtQ(v, unit, 5) : fmtNum(v, 5)}</span>;
  if (typeof v === 'boolean') return v ? <span class="badge b-ok">yes</span> : <span class="badge b-bad">no</span>;
  if (typeof v === 'string') return STATUS_RE.test(v) ? <ProvBadge kind={v} /> : <span>{v}</span>;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x == null)) return <ul class="tight">{v.map((x) => <li><Val v={x} /></li>)}</ul>;
    return <ul class="tight">{v.map((x) => <li><Val v={x} /></li>)}</ul>;
  }
  const o = v as Record<string, unknown>;
  if ('value' in o && ('status' in o || 'unit' in o)) {
    const rest = Object.entries(o).filter(([k]) => !['value', 'unit', 'status'].includes(k));
    return (
      <span>
        <b class="mono">{o.value == null ? '— (not computable)' : typeof o.value === 'number' ? fmtQ(o.value as number, (o.unit as string) || '', 5) : String(o.value)}</b>
        {typeof o.status === 'string' && <> <ProvBadge kind={o.status} /></>}
        {rest.map(([k, x]) => <div class="small muted">{humanKey(k)}: <Val v={x} /></div>)}
      </span>
    );
  }
  return <KV rows={Object.entries(o).map(([k, x]) => [humanKey(k), <Val v={x} />])} />;
}

function goTo(id: string, setTab: (t: string) => void, tab: string) {
  setTab(tab);
  setTimeout(() => { const el = document.getElementById(id); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); (el as HTMLElement).focus?.({ preventScroll: true }); } }, 60);
}

function ToleranceTable({ tol, prefix, link }: { tol: Record<string, any>; prefix: string; link?: (k: string) => ComponentChildren }) {
  return (
    <DataTable caption="Tolerances for a 0.05 rad error budget" head={['Parameter', 'Sensitivity ∂Δφ/∂x', 'Tolerance', 'Relative', 'Status', 'Basis', ...(link ? [''] : [])]} numeric={[1, 2, 3]}
      rows={Object.entries(tol).map(([k, t]) => [
        <span id={`${prefix}-${slug(k)}`} tabIndex={-1}>{k}</span>,
        `${fmtNum(t.sensitivity_rad_per_unit, 4)} rad/${t.unit}`, fmtQ(t.tolerance, t.unit, 4), fmtNum(t.relative_tolerance, 3),
        <StatusBadge status={t.status} />, <span class="small">{t.basis}</span>, ...(link ? [link(k)] : [])])} />
  );
}

export default function Page(_props: { suite?: number }) {
  const sc = useStore(scenario);
  const st = useStore(settings);
  const v = useValidity();
  const [tab, setTab] = useState('protocol');
  const r = useRun(() => apiPost<any>('/api/lab/dossier', body(sc)));
  const afterReset = useAfterReset();
  // auto-run once on arrival, but never right after a Reset (the user asked for a clean page)
  useEffect(() => { if (afterReset) return; r.run(); }, []);
  const d = r.data;
  return (
    <div>
      <SuiteHeader n={9} intro="Generates a complete experiment dossier for the current design: a Scientific Laboratory Protocol and an Engineering Apparatus Specification whose tolerances and environmental requirements are computed from the physics. Every entry carries its provenance status. This is a design document — nothing here has been built or run." />
      <div class="split">
        <div class="sticky-side card">
          <h2>Design</h2>
          <ScenarioForm value={sc} onChange={(s) => scenario.set(s)} report={v.report} />
          <RunBar label="Generate dossier" scenario busy={r.busy} disabled={!v.ok} onRun={r.run} />
          <Exports />
        </div>
        <div class="stack">
          <EvidenceBanner classification={d ? { classification: d.protocol?.classification, statement: d.engineering?.classification } : null} />
          <ErrorBox error={r.error} what="generating the dossier" />
          {r.offline && <p class="small muted">No fresh dossier was fetched{d ? '; the dossier below is the last one generated in this session' : ''}.</p>}
          {d && (
            <>
              <Card title="Consistency check" actions={<ProvBadge kind="COMPUTED" />}>
                {d.consistency_check?.passed
                  ? <InfoBanner kind="ok"><strong>Passed.</strong> No internal inconsistencies were detected between protocol, specification and computed requirements.</InfoBanner>
                  : <div class="banner danger" role="alert"><div><strong>Consistency check NOT passed.</strong><ul class="tight">{(d.consistency_check?.problems ?? []).map((p: string) => <li>{p}</li>)}</ul></div></div>}
                <KV rows={[
                  ['Generated', fmtTime(d.generated_utc)], ['Software version', d.software_version], ['Dossier SHA-256', <code title={d.sha256}>{shortHash(d.sha256, 16)}…</code>],
                  ['Constraints', <div>{Object.entries(d.constraints ?? {}).map(([k, c]: [string, any]) => <div><StatusBadge status={c.ok ? 'PASSED' : 'FAILED'} /> {humanKey(k)} {c.value_m != null ? `— gap ${fmtQ(c.value_m, 'm', 4)} (required ≥ ${fmtQ(c.required_m, 'm', 3)})` : c.value != null ? `— ${fmtNum(c.value, 3)} (allowed ≤ ${fmtNum(c.allowed)})` : ''}</div>)}</div>],
                  ['Status legend', <div class="row">{(d.status_legend ?? []).map((s: string) => <StatusBadge status={s} />)}</div>],
                ]} />
              </Card>
              <section class="card tabs" aria-label="Experiment dossier">
                <Tabs label="Dossier documents" active={tab} onChange={setTab} tabs={[{ id: 'protocol', label: 'Scientific Laboratory Protocol' }, { id: 'engineering', label: 'Engineering Apparatus Specification' }]} />
                <TabPanel id="protocol" active={tab}><Protocol p={d.protocol} setTab={setTab} /></TabPanel>
                <TabPanel id="engineering" active={tab}><Engineering e={d.engineering} setTab={setTab} /></TabPanel>
              </section>
              <Apparatus3D stamp={d.generated_utc} />
              {atLeast(st.mode, 'expert') && <Card title="Raw dossier (expert)"><Json data={d} max={500} /></Card>}
            </>
          )}
          <Instruments />
        </div>
      </div>
    </div>
  );
}

function Protocol({ p, setTab }: { p: any; setTab: (t: string) => void }) {
  if (!p) return <p class="muted">No protocol in the response.</p>;
  const sections = Object.keys(p).filter((k) => /^\d+_/.test(k) && !k.endsWith('_tex')).sort((a, b) => parseInt(a) - parseInt(b));
  return (
    <div>
      <h2>{p.title}</h2>
      <p><span class="badge b-warn">{p.classification}</span></p>
      {sections.map((k) => (
        <section key={k} style={{ marginTop: '14px' }} aria-label={humanKey(k)}>
          <h3>{parseInt(k)}. {humanKey(k).replace(/^\w/, (c) => c.toUpperCase())}</h3>
          {k === '4_predictions' ? (
            <DataTable caption="Predictions" head={['Quantity', 'Value', 'Status', 'Notes']} numeric={[1]}
              rows={Object.entries(p[k]).map(([q, x]: [string, any]) => [humanKey(q),
                x == null ? <span class="muted">— (not included in this dossier)</span> : typeof x === 'object' && 'value' in x ? <span class="mono">{fmtNum(x.value, 6)}</span> : <Val v={x} />,
                x && x.status ? <StatusBadge status={x.status} /> : null,
                x && typeof x === 'object' ? <span class="small">{[x.dominant && `dominant: ${x.dominant}`, x.basis, x.note].filter(Boolean).join(' · ')}</span> : null])} />
          ) : k === '8_uncertainty_budget' ? (
            <>
              {p[k].tolerances_for_0_05_rad || p[k]['tolerances_for_0.05_rad'] ? (
                <ToleranceTable tol={p[k]['tolerances_for_0.05_rad'] ?? p[k].tolerances_for_0_05_rad} prefix="prot-tol"
                  link={(t) => <button type="button" class="btn-link small" onClick={() => goTo(`eng-tol-${slug(t)}`, setTab, 'engineering')}>engineering spec →</button>} />
              ) : null}
              {p[k].decoherence_mechanisms && (
                <DataTable caption="Decoherence mechanisms" head={['Mechanism', 'Rate (s⁻¹)', <Tex tex="\Gamma t" />, 'Regime']} numeric={[1, 2]}
                  rows={Object.entries(p[k].decoherence_mechanisms).map(([m, x]: [string, any]) => [humanKey(m), fmtNum(x.rate_s), fmtNum(x.gamma_t), <span class="small">{x.regime}</span>])} />
              )}
            </>
          ) : k === '3_equations' ? (
            p['3_equations_tex'] && typeof p['3_equations_tex'] === 'object' ? (
              <dl class="eq-list">
                {Object.entries(p['3_equations_tex'] as Record<string, string>).map(([name, tex]) => (
                  <div class="eq-item"><dt>{humanKey(name).replace(/^\w/, (c) => c.toUpperCase())}</dt>
                    <dd><Tex tex={tex} display alt={typeof p[k]?.[name] === 'string' ? p[k][name] : undefined} /></dd></div>
                ))}
              </dl>
            ) : <Val v={p[k]} />
          ) : k === '6_procedure' ? (
            <>
              <ol class="tight">{(p[k] as string[]).map((s) => <li>{s}</li>)}</ol>
              <button type="button" class="btn-link small" onClick={() => goTo('eng-env-req', setTab, 'engineering')}>Environmental requirements table (engineering spec) →</button>
            </>
          ) : <Val v={p[k]} />}
        </section>
      ))}
    </div>
  );
}

function Engineering({ e, setTab }: { e: any; setTab: (t: string) => void }) {
  if (!e) return <p class="muted">No engineering specification in the response.</p>;
  const tr = e.technological_readiness;
  return (
    <div>
      <h2>{e.title}</h2>
      <p><span class="badge b-warn">{e.classification}</span></p>
      <h3>Architecture</h3>
      <ul class="tight">{(e.architecture ?? []).map((a: string) => <li>{a}</li>)}</ul>
      <h3>Coordinate system</h3><p>{e.coordinate_system}</p>
      <h3>Geometry</h3>
      {e.geometry && (
        <>
          <DataTable caption="Branch positions" head={['Branch', 'x', 'y', 'z']} numeric={[1, 2, 3]}
            rows={Object.entries(e.geometry.branch_positions_m ?? {}).map(([k, p]: [string, any]) => [k, ...p.map((c: number) => fmtQ(c, 'm', 5))])} />
          <KV rows={[['Sphere radius', fmtQ(e.geometry.radius_m, 'm', 5)], ['Closest surface gap', fmtQ(e.geometry.closest_surface_gap_m, 'm', 5)]]} />
        </>
      )}
      <h3>Tolerances</h3>
      {e.tolerances && <ToleranceTable tol={e.tolerances} prefix="eng-tol" link={(t) => <button type="button" class="btn-link small" onClick={() => goTo(`prot-tol-${slug(t)}`, setTab, 'protocol')}>← protocol budget</button>} />}
      <h3 id="eng-env-req" tabIndex={-1}>Environmental requirements</h3>
      {e.environmental_requirements && (
        <DataTable caption="Environmental requirements" head={['Requirement', 'Value', 'Status', 'Basis']} numeric={[1]}
          rows={Object.entries(e.environmental_requirements).map(([k, x]: [string, any]) => [humanKey(k), x.value == null ? <span class="muted">not computable</span> : fmtQ(x.value, x.unit, 4), <StatusBadge status={x.status} />, <span class="small">{x.basis}</span>])} />
      )}
      <h3>Bill of materials</h3>
      {e.bill_of_materials && (
        <DataTable caption="Bill of materials" head={['Item', 'Specification', 'Qty', 'Status', 'Rationale', 'Cost']} numeric={[2]}
          rows={e.bill_of_materials.map((b: any) => [b.item, <span class="small">{b.spec}</span>, b.quantity ?? '', <StatusBadge status={b.status} />, <span class="small">{b.selection_rationale ?? ''}</span>, <span class="small">{b.cost ?? ''}</span>])} />
      )}
      <h3>Engineering analyses</h3>
      {e.engineering_analyses && (
        <DataTable caption="Engineering analyses" head={['Analysis', 'Result', 'Status']}
          rows={Object.entries(e.engineering_analyses).map(([k, x]: [string, any]) => [humanKey(k),
            <Val v={Object.fromEntries(Object.entries(x).filter(([kk]) => kk !== 'status'))} />, <StatusBadge status={x.status} />])} />
      )}
      <h3>Safety</h3><ul class="tight">{(e.safety ?? []).map((s: string) => <li>{s}</li>)}</ul>
      <h3>Commissioning</h3><ol class="tight">{(e.commissioning ?? []).map((s: string) => <li>{s}</li>)}</ol>
      <h3>Technological readiness</h3>
      {tr && (
        <>
          <div class="outs" style={{ marginBottom: '8px' }}>
            <Out label="Overall TRL" value={String(tr.overall_trl)} prov="LITERATURE_REFERENCE" tone={tr.overall_trl < 4 ? 'bad' : null}
              interp="Lowest readiness level among the required capabilities (1 = basic principles observed, 9 = proven in operation)." />
          </div>
          <DataTable caption="Technological readiness" head={['Capability', 'Required', 'Demonstrated (literature)', 'Gap factor (mass)', 'TRL']} numeric={[3, 4]}
            rows={(tr.items ?? []).map((i: any) => [i.capability, i.required, <span class="small">{i.demonstrated}</span>, i.gap_factor_mass != null ? fmtNum(i.gap_factor_mass, 3) : '—', String(i.trl)])} />
          <p><strong>Conclusion:</strong> {tr.conclusion}</p>
        </>
      )}
      <h3>Exports</h3><ul class="tight">{(e.exports ?? []).map((s: string) => <li>{s}</li>)}</ul>
    </div>
  );
}

function Exports() {
  const sc = useStore(scenario);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  useEffect(() => () => { if (svgUrl) URL.revokeObjectURL(svgUrl); }, [svgUrl]);
  const dl = async (fmt: 'stl' | 'svg' | 'json') => {
    setBusy(fmt); setErr(null);
    try {
      const b = await apiPostBlob(`/api/lab/export/${fmt}`, body(sc));
      if (fmt === 'svg') setSvgUrl(URL.createObjectURL(b));
      downloadBlob(b, fmt === 'stl' ? 'qgdevs-apparatus.stl' : fmt === 'svg' ? 'qgdevs-layout.svg' : 'qgdevs-dossier.json');
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  return (
    <div style={{ marginTop: '12px' }}>
      <h3>Downloads</h3>
      <div class="row">
        <Btn busy={busy === 'stl'} onClick={() => dl('stl')}>STL model</Btn>
        <Btn busy={busy === 'svg'} onClick={() => dl('svg')}>SVG layout</Btn>
        <Btn busy={busy === 'json'} onClick={() => dl('json')}>Dossier JSON</Btn>
      </div>
      <p class="small muted">Generated by the server from the current design (POST /api/lab/export/…). STEP export is not implemented.</p>
      <ErrorBox error={err} what="exporting" />
      {svgUrl && <figure style={{ margin: '8px 0' }}><img src={svgUrl} alt="2-D engineering layout of the apparatus generated by the server" style={{ width: '100%', background: '#fff', borderRadius: '6px', border: '1px solid var(--border)' }} /><figcaption class="small muted">Layout drawing (server-generated SVG)</figcaption></figure>}
    </div>
  );
}

interface Scene { units: string; kind: string; objects: { id: string; type: string; center: number[]; radius: number; height?: number; role: string }[] }

function Apparatus3D({ stamp }: { stamp: string }) {
  const sc = useStore(scenario);
  const scene = useRun(() => apiPost<Scene>('/api/lab/export/scene', body(sc)));
  const pred = useRun(() => apiPost<PredictResult>('/api/bmv/predict', body(sc), { n_times: 60 }));
  useEffect(() => { scene.run(); pred.run(); }, [stamp]); // refresh with each generated dossier
  const s = scene.data, p = pred.data && 'total_energies_J' in pred.data ? pred.data : null;
  const opts = useMemo(() => {
    if (!s || !p) return null;
    const pos: any = {};
    for (const o of s.objects) if (o.role === 'branch') pos[o.id] = o.center;
    if (!pos.A_L || !pos.A_R || !pos.B_L || !pos.B_R) return null;
    const rA = s.objects.find((o) => o.id === 'A_L')!.radius, rB = s.objects.find((o) => o.id === 'B_L')!.radius;
    return { positions: pos, radiusA: rA, radiusB: rB, energies: p.total_energies_J, phases: p.time_series ? { t: p.time_series.t, deltaPhi: p.time_series.delta_phi } : undefined };
  }, [s, p]);
  const chamber = s?.objects.find((o) => o.type === 'cylinder');
  const ts = p?.time_series;
  const player = usePlayer(ts?.t.length ?? 0, 20);
  const [view, setView] = useState<'3d' | '2d'>('3d');
  return (
    <Card title="3-D apparatus model" actions={<><ProvBadge kind="COMPUTED" /><SourceChip source={null} /><Seg label="Apparatus view" value={view} onChange={setView} options={[{ v: '3d', label: '3-D' }, { v: '2d', label: '2-D top view' }]} /></>}>
      <ErrorBox error={scene.error || pred.error} what="loading the scene" />
      {opts && view === '2d' && <TopView2D s={s!} />}
      {opts && view === '3d' ? (
        <View3D kind="apparatus" opts={opts} frame={player.pos} label="Branch spheres at the computed positions with interaction lines coloured by energy"
          title="Apparatus geometry and Δφ(t)" badge="COMPUTED" name="lab-apparatus"
          legend={[{ label: 'Mass A branches', color: '#0072B2' }, { label: 'Mass B branches', color: '#D55E00' }, { label: 'weak |U_ij|', color: '#2b6cb0' }, { label: 'strong |U_ij|', color: '#dd6b20' }]}
          onRecordStart={() => { player.setPos(0); player.setPlaying(true); }} playing={player.playing}
          change={ts ? { rel: Math.abs(ts.delta_phi[ts.delta_phi.length - 1] - ts.delta_phi[0]) / (2 * Math.PI), what: 'phase-dial angle Δφ relative to a full turn' } : undefined}
          frameData={() => ({ nearest_sample: player.frame, t_s: ts?.t[player.frame], delta_phi_rad: ts?.delta_phi[player.frame], scene: s, source: 'COMPUTED (server: /api/lab/export/scene, /api/bmv/predict)' })}
          fallback={<TopView2D s={s!} />}
          overlay={(info) => info && <>
            {info.time != null && <span>t = {fmtQ(info.time, 's')} · Δφ = {fmtNum(info.deltaPhi, 4)} rad</span>}
            <span>Scale bar: {fmtQ(info.scaleBarMetres, 'm', 3)}{info.radiiEnlarged ? ` · radii enlarged ×${fmtNum(info.enlargementFactor, 3)} for visibility` : ' · radii to scale'}</span>
            {info.energyRamp && <span>|U_ij| <span class="energy-ramp" /> {fmtQ(info.energyRamp.min, 'J', 3)} → {fmtQ(info.energyRamp.max, 'J', 3)}</span>}
          </>} />
      ) : opts ? null : (scene.busy || pred.busy) ? <p class="muted">Loading scene…</p> : !scene.error && !pred.error ? <p class="muted">Scene unavailable for this design (inadmissible geometry?).</p> : null}
      {opts && ts && <PlayerControls p={player} n={ts.t.length} t={ts.t} label="Apparatus Δφ(t)" />}
      <p class="small muted">Sphere positions and radii come from POST /api/lab/export/scene; line colours use the total branch energies from POST /api/bmv/predict.{chamber ? ` The vacuum chamber (radius ${fmtQ(chamber.radius, 'm', 3)}) is listed by the server as “${chamber.role}” and is not drawn.` : ''}</p>
    </Card>
  );
}

/** 2-D top view (x–y plane) of the scene for browsers without WebGL. Radii are enlarged when too small to see. */
function TopView2D({ s }: { s: Scene }) {
  const br = s.objects.filter((o) => o.role === 'branch');
  const xs = br.map((o) => o.center[0]), ys = br.map((o) => o.center[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const ext = Math.max(maxX - minX, maxY - minY) || 1;
  const W = 500, H = 320, pad = 50, k = (Math.min(W, H) - 2 * pad) / ext;
  const cx = (x: number) => W / 2 + (x - (minX + maxX) / 2) * k, cy = (y: number) => H / 2 - (y - (minY + maxY) / 2) * k;
  const R = br[0]?.radius ?? 0, rPx = R * k, shown = Math.max(rPx, 5), enlarged = shown > rPx * 1.0001;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: '640px' }} role="img" aria-label="Top view of branch positions">
        {br.map((o) => <g><circle cx={cx(o.center[0])} cy={cy(o.center[1])} r={shown} fill={o.id.startsWith('A') ? '#0072B2' : '#E69F00'} /><text x={cx(o.center[0]) + shown + 4} y={cy(o.center[1]) + 4} font-size="12" fill="currentColor">{o.id}</text></g>)}
      </svg>
      <figcaption class="small muted">Extent {fmtQ(ext, 'm', 3)} across. {enlarged ? `Radii enlarged ×${fmtNum(shown / rPx, 3)} for visibility.` : 'Radii to scale.'}</figcaption>
    </figure>
  );
}

function Instruments() {
  const r = useApiGet<{ connected_physical_devices: unknown[]; simulated: { device_id: string; label: string }[]; note: string }>('/api/instruments');
  const d = r.data;
  return (
    <Card title="Instruments" actions={<SourceChip source={r.source} cachedAt={r.cachedAt} />}>
      <ErrorBox error={r.error} what="reading the instrument registry" />
      {d && (
        <>
          {d.connected_physical_devices.length === 0 ? (
            <div class="banner danger" role="note"><div><strong>No physical instrument is connected.</strong> {d.note}</div></div>
          ) : (
            <InfoBanner>{d.connected_physical_devices.length} physical device(s) reported by the server: <Json data={d.connected_physical_devices} /></InfoBanner>
          )}
          <DataTable caption="Simulated devices" head={['Simulated device', 'Data label']} rows={d.simulated.map((s) => [<code>{s.device_id}</code>, <ProvBadge kind={s.label} />])} />
          <Level min="advanced"><p class="small muted">Simulated devices produce SYNTHETIC records only (see Suite 10). Connecting real hardware requires an authorised laboratory adapter with limits, e-stop and audit logging on the server.</p></Level>
        </>
      )}
    </Card>
  );
}
