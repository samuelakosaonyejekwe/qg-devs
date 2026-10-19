import { RunBar } from '../../components/Reset';
/** Suite 17 — Scientific data, visualisation and research management. */
import { useState } from 'preact/hooks';
import { SuiteHeader } from '../../components/SuiteHeader';
import { Card, ProvBadge, ErrorBox, Loading, SourceChip, DataTable, Json, Btn, Level, Tip, StatusBadge, KV, InfoBanner } from '../../components/ui';
import { SelectField } from '../../components/fields';
import { JobRunner } from '../../components/JobRunner';
import { useApiGet, apiGet, apiUpload } from '../../lib/api';
import { fmtNum, fmtQ, fmtTime, shortHash } from '../../lib/format';
import { useStore, settings, atLeast } from '../../lib/store';

interface Connector { id: string; name: string; url: string; label: string; licence: string; cadence: string; evidence_scope: string }
interface CatRec {
  id: string; name: string; label: string; role: string; source: string; licence: string; sha256: string; created_utc: string;
  fetched_utc: string; description: string; evidence_scope: string; size_bytes?: number;
}
interface Constant { symbol: string; name: string; value: number; unit: string; std_uncertainty: number; relative_uncertainty: number; source: string }

// Data labels accepted by the platform (qgdevs/evidence.py DATA_LABELS).
const DATA_LABELS = ['REAL', 'SYNTHETIC', 'REFERENCE', 'LITERATURE', 'TRAINING'];

export function LabelBadge({ label }: { label: string }) {
  const cls = label === 'REAL' ? 'b-ok' : label === 'SYNTHETIC' ? 'b-synthetic' : label === 'LITERATURE' ? 'b-literature' : label === 'REFERENCE' ? 'b-requirement' : 'b-neutral';
  return <span class={`badge ${cls}`} title="Data label: what kind of data this is. Only REAL data can ever count as physical evidence.">{label}</span>;
}

function Connectors() {
  const r = useApiGet<Connector[]>('/api/data/connectors');
  return (
    <Card title="Public-source connectors" actions={<SourceChip source={r.source} cachedAt={r.cachedAt} />}>
      <p class="small muted">Connectors fetch public records on a schedule (server-side, while your device is off). Each one states its <em>evidence scope</em>: what the fetched data can and cannot support.</p>
      {r.loading && <Loading />}
      <ErrorBox error={r.error} what="loading connectors" />
      {r.data && (
        <div class="grid-3">
          {r.data.map((c) => (
            <div class="card" style={{ margin: 0 }}>
              <div class="row-between"><strong>{c.name}</strong><LabelBadge label={c.label} /></div>
              <div class="small"><a href={c.url} target="_blank" rel="noopener external">{c.url}</a></div>
              <div class="small muted">Licence: {c.licence} · Cadence: {c.cadence}</div>
              <div class="banner info" style={{ marginTop: '6px', marginBottom: 0 }}><div><strong>Evidence scope:</strong> {c.evidence_scope}</div></div>
              <div class="small muted" style={{ marginTop: '4px' }}>id <code>{c.id}</code></div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Catalogue() {
  const s = useStore(settings);
  const [label, setLabel] = useState('');
  const r = useApiGet<CatRec[]>('/api/data/catalogue', label ? { label } : undefined);
  const [rec, setRec] = useState<{ id: string; data: unknown; source: string | null; cachedAt: string | null } | null>(null);
  const [recErr, setRecErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (id: string) => {
    setBusy(id); setRecErr(null);
    try { const x = await apiGet(`/api/data/records/${encodeURIComponent(id)}`); setRec({ id, data: x.data, source: x.source, cachedAt: x.cachedAt }); }
    catch (e) { setRecErr(e); } finally { setBusy(null); }
  };
  return (
    <Card title="Data catalogue" actions={<><label class="small">Label{' '}
      <select class="input" style={{ padding: '4px 6px' }} value={label} onChange={(e: any) => setLabel(e.currentTarget.value)} aria-label="Filter catalogue by data label">
        <option value="">all</option>{DATA_LABELS.map((l) => <option value={l}>{l}</option>)}
      </select></label><SourceChip source={r.source} cachedAt={r.cachedAt} /><Btn onClick={r.reload}>Refresh</Btn></>}>
      <p class="small muted">Every ingested record with provenance: source, licence, content hash and fetch time. Records labelled REFERENCE or LITERATURE are inputs to calculations, never experimental evidence.</p>
      {r.loading && <Loading />}
      <ErrorBox error={r.error} what="loading the catalogue" />
      {r.data && r.data.length === 0 && <p class="muted">No records{label ? ` with label ${label}` : ''} yet. Queue a fetch job below.</p>}
      {r.data && r.data.length > 0 && (
        <DataTable caption="Catalogue records" head={['Name', 'Label', 'Role', 'Source', 'Licence', 'SHA-256', 'Fetched', 'Size', 'Evidence scope', '']} numeric={[7]}
          hl={(i) => r.data![i].id === rec?.id}
          rows={r.data.map((d) => [
            <span><strong>{d.name}</strong><div class="small muted">{d.description}</div></span>,
            <LabelBadge label={d.label} />, d.role,
            <a href={d.source} target="_blank" rel="noopener external" class="small" style={{ overflowWrap: 'anywhere' }}>{d.source}</a>,
            <span class="small">{d.licence}</span>, <code title={d.sha256}>{shortHash(d.sha256)}</code>,
            <span class="small">{fmtTime(d.fetched_utc || d.created_utc)}</span>,
            d.size_bytes != null ? fmtQ(d.size_bytes, 'B', 3) : '—',
            <span class="small">{d.evidence_scope}</span>,
            <Btn class="btn-sm" busy={busy === d.id} onClick={() => open(d.id)} aria-label={`Inspect record ${d.name}`}>Inspect</Btn>,
          ])} />
      )}
      <ErrorBox error={recErr} what="loading the record" />
      {rec && (
        <div style={{ marginTop: '10px' }}>
          <div class="row-between"><h3 style={{ margin: 0 }}>Record <code>{rec.id}</code></h3><SourceChip source={rec.source as any} cachedAt={rec.cachedAt} /></div>
          {atLeast(s.mode, 'expert') ? <Json data={rec.data} max={420} /> : <p class="small muted">Raw stored record available in Expert mode (header → detail level).</p>}
        </div>
      )}
    </Card>
  );
}

interface Validation {
  filename: string; bytes: number; kind: string; sha256: string; shape?: number[]; columns?: Record<string, number>;
  arrays?: Record<string, number[]>; density_matrix_check?: Record<string, unknown>;
}

function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<Validation | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!file) return;
    setBusy(true); setErr(null); setRes(null);
    const fd = new FormData(); fd.append('file', file);
    try { setRes(await apiUpload<Validation>('/api/data/validate', fd)); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const dm = res?.density_matrix_check as any;
  return (
    <Card title="Upload validation">
      <p class="small muted">Checks a file's format, structure and hash on the server without storing it. Supported: CSV, JSON, NPY, NPZ, HDF5, Parquet, Matrix Market. A square 2-D array is also checked as a density matrix (trace, Hermiticity, positivity). To <em>ingest</em> data with a label and role, use Suite 18.</p>
      <div class="row">
        <label class="field-label" for="s17-file">File <Tip text="The file is sent to the server for parsing only; its SHA-256 identifies it exactly. Validation never changes any catalogue or ledger." /></label>
        <input id="s17-file" type="file" onChange={(e: any) => { setFile(e.currentTarget.files?.[0] ?? null); setRes(null); }} />
        <RunBar label="Validate" busy={busy} disabled={!file} onRun={run} />
      </div>
      <ErrorBox error={err} what="validating the file" />
      {res && (
        <div style={{ marginTop: '10px' }}>
          <KV rows={[
            ['File', res.filename], ['Size', `${res.bytes} bytes`], ['Parsed as', <code>{res.kind}</code>], ['SHA-256', <code style={{ overflowWrap: 'anywhere' }}>{res.sha256}</code>],
            ...(res.shape ? [['Array shape', res.shape.join(' × ')] as [string, string]] : []),
            ...(res.columns ? [['Columns (rows each)', Object.entries(res.columns).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none']] as [string, string][] : []),
            ...(res.arrays ? [['Arrays', Object.entries(res.arrays).map(([k, v]) => `${k} [${v.join('×')}]`).join(', ')]] as [string, string][] : []),
          ]} />
          {res.kind === 'table' && res.columns && Object.values(res.columns).every((v) => v === 0) && <p class="small muted">All columns have zero rows: the first line was read as the header row.</p>}
          {dm && (
            <div style={{ marginTop: '8px' }}>
              <h3>Density-matrix check <StatusBadge status={dm.passed === true ? 'PASSED' : dm.passed === false ? 'FAILED' : 'UNKNOWN'} /></h3>
              <KV rows={Object.entries(dm).filter(([k]) => k !== 'passed').map(([k, v]) => [k.replace(/_/g, ' '), typeof v === 'number' ? fmtNum(v, 6) : JSON.stringify(v)])} />
            </div>
          )}
          {!dm && <p class="small muted">No density-matrix check: the file is not a square 2-D numeric array{res.kind === 'json' ? ' (JSON files are parsed as generic JSON; use .npy or .csv for matrices)' : ''}.</p>}
        </div>
      )}
    </Card>
  );
}

function Constants() {
  const r = useApiGet<Constant[]>('/api/constants');
  return (
    <Card title="Physical constants" actions={<><ProvBadge kind="LITERATURE_REFERENCE" title="CODATA 2022 recommended values (NIST)" /><span class="badge b-literature">CODATA 2022</span><SourceChip source={r.source} cachedAt={r.cachedAt} /></>}>
      <p class="small muted">Exact SI-defining constants have zero uncertainty. G carries the largest relative uncertainty (≈2×10⁻⁵), which propagates directly into every gravitational phase (Δφ ∝ G).</p>
      {r.loading && <Loading />}
      <ErrorBox error={r.error} what="loading constants" />
      {r.data && (
        <DataTable caption="Physical constants" head={['Symbol', 'Name', 'Value', 'Unit', 'Std. uncertainty', 'Relative', 'Source']} numeric={[2, 4, 5]}
          rows={r.data.map((c) => [<code>{c.symbol}</code>, c.name, fmtNum(c.value, 12), <code>{c.unit}</code>,
            c.std_uncertainty === 0 ? 'exact' : fmtNum(c.std_uncertainty, 3), c.relative_uncertainty === 0 ? '0' : fmtNum(c.relative_uncertainty, 3), <span class="small">{c.source}</span>])} />
      )}
    </Card>
  );
}

function FetchJob() {
  const r = useApiGet<Connector[]>('/api/data/connectors');
  const [conn, setConn] = useState('nist-codata');
  const opts = (r.data ?? [{ id: 'nist-codata', name: 'NIST CODATA' } as Connector]).map((c) => ({ v: c.id, label: `${c.name} (${c.id})` }));
  return (
    <Card title="Queue a data fetch">
      <p class="small muted">Submits a durable <code>fetch_source</code> job: the server worker downloads the source, hashes it and adds a catalogue record. The data keep the connector's label and evidence scope.</p>
      <SelectField label="Connector" value={conn} onChange={setConn} options={opts} help="Public source to fetch now (in addition to its scheduled cadence)." />
      <JobRunner type="fetch_source" storeKey="fetch_source.s17" label="Fetch now" params={() => ({ connector: conn })}>
        {(res) => (
          <div>
            <KV rows={[['Dataset id', <code>{res.dataset_id}</code>], ['SHA-256', <code style={{ overflowWrap: 'anywhere' }}>{res.sha256}</code>], ['Records', res.n_records ?? '—'], ['Fetched', fmtTime(res.fetched_utc)]]} />
            <Level min="expert"><Json data={res} /></Level>
          </div>
        )}
      </JobRunner>
    </Card>
  );
}

export default function Page(_props: any) {
  return (
    <div>
      <SuiteHeader n={17} intro="Data I/O, a provenance catalogue, public-source connectors and the constants used by every calculation. Every record carries a label (REAL, SYNTHETIC, REFERENCE, LITERATURE, TRAINING) and an explicit evidence scope." />
      <InfoBanner>No REAL experimental data are produced by this platform. Fetched literature and reference data inform calculations only; synthetic data are always labelled SYNTHETIC.</InfoBanner>
      <div class="stack">
        <Connectors />
        <Catalogue />
        <div class="grid-2"><Upload /><FetchJob /></div>
        <Constants />
      </div>
    </div>
  );
}

