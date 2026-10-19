#!/usr/bin/env node
/**
 * Headless smoke check of the QG-DEVS deployment: exercises the API endpoints the web pages call (same
 * payload shapes) and verifies that the built front end (index.html, manifest, service worker, icons,
 * hashed assets, SPA deep links) is served by the FastAPI app.
 *
 *   node scripts/api-smoke.mjs [baseUrl]      (default http://127.0.0.1:8777)
 *
 * Jobs are submitted and polled until they finish (requires a running worker: python -m qgdevs.jobs).
 */
const BASE = (process.argv[2] || process.env.QG_BASE || 'http://127.0.0.1:8777').replace(/\/$/, '');
const results = [];
let failures = 0;

async function req(method, path, body, { form, expect = 200, raw = false } = {}) {
  const init = { method, headers: {} };
  if (form) init.body = form;
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const t0 = performance.now();
  const res = await fetch(BASE + path, init);
  const ms = performance.now() - t0;
  const buf = Buffer.from(await res.arrayBuffer());
  let data = buf;
  if (!raw) { try { data = JSON.parse(buf.toString('utf8')); } catch { data = buf.toString('utf8'); } }
  return { status: res.status, data, ms, headers: res.headers, ok: res.status === expect };
}

async function check(name, fn) {
  try {
    const note = await fn();
    results.push({ name, ok: true, note: note ?? '' });
  } catch (e) {
    failures++;
    results.push({ name, ok: false, note: String(e?.message ?? e).slice(0, 300) });
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

const SC = { design: {}, environment: {} };

async function job(type, params, timeoutS = 300) {
  const s = await req('POST', '/api/jobs', { type, params });
  assert(s.ok && s.data.id, `submit ${type}: ${s.status} ${JSON.stringify(s.data).slice(0, 200)}`);
  const t0 = Date.now();
  for (;;) {
    const j = await req('GET', `/api/jobs/${s.data.id}`);
    if (['succeeded', 'failed', 'cancelled'].includes(j.data.status)) return j.data;
    if (Date.now() - t0 > timeoutS * 1000) throw new Error(`${type} job ${s.data.id} still ${j.data.status} after ${timeoutS}s`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ---------------------------------------------------------------- front end served
await check('GET / serves index.html', async () => {
  const r = await req('GET', '/', undefined, { raw: true });
  const html = r.data.toString();
  assert(r.status === 200 && html.includes('<div id="app">'), `status ${r.status}`);
  const js = [...html.matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  assert(js.length > 0, 'no module script in index.html');
  for (const a of js) { const x = await req('GET', a, undefined, { raw: true }); assert(x.status === 200, `${a} → ${x.status}`); }
  return `${js.length} entry script(s) served`;
});
await check('SPA deep link /suite/lab', async () => {
  const r = await req('GET', '/suite/lab', undefined, { raw: true });
  assert(r.status === 200 && r.data.toString().includes('<div id="app">'), `status ${r.status}`);
});
await check('manifest.webmanifest', async () => {
  const r = await req('GET', '/manifest.webmanifest');
  assert(r.status === 200 && r.data.name === 'QG-DEVS' && r.data.short_name === 'QG-DEVS', JSON.stringify(r.data).slice(0, 120));
  assert(r.data.icons.some((i) => (i.purpose || '').includes('maskable')), 'no maskable icon');
  return `${r.data.icons.length} icons, theme ${r.data.theme_color}`;
});
await check('service worker /sw.js', async () => {
  const r = await req('GET', '/sw.js', undefined, { raw: true });
  const s = r.data.toString();
  assert(r.status === 200 && s.includes('qg-shell-') && !s.includes('__QG_SHELL__'), 'sw.js missing or placeholders not injected');
  const shell = /const SHELL = (\[.*?\]);/s.exec(s);
  return shell ? `${JSON.parse(shell[1]).length} shell URLs precached` : 'served';
});
await check('icons', async () => {
  for (const p of ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/icon.svg']) {
    const r = await req('GET', p, undefined, { raw: true }); assert(r.status === 200, `${p} → ${r.status}`);
  }
});

// ---------------------------------------------------------------- read endpoints
for (const p of ['/api/health', '/api/suites', '/api/constants', '/api/materials', '/api/models', '/api/jobs', '/api/vv/registry', '/api/vv/latest', '/api/lean/status',
  '/api/discovery/hypotheses', '/api/data/connectors', '/api/data/catalogue', '/api/evidence/ledger', '/api/thought/lm-status', '/api/instruments', '/api/release']) {
  await check(`GET ${p}`, async () => { const r = await req('GET', p); assert(r.ok, `status ${r.status}`); return `${Math.round(r.ms)} ms`; });
}
await check('release notes for update dialog', async () => {
  const r = await req('GET', '/api/release');
  assert(r.ok && r.data.version && r.data.releases?.[0]?.version === r.data.version, JSON.stringify(r.data).slice(0, 120));
  return `server ${r.data.version}, ${r.data.releases.length} releases`;
});
await check('suites: 18 with maturity', async () => {
  const r = await req('GET', '/api/suites');
  assert(r.data.length === 18 && r.data.every((s) => s.maturity), 'bad suite list');
});

// ---------------------------------------------------------------- flagship + suites
await check('POST /api/bmv/predict (flagship)', async () => {
  const r = await req('POST', '/api/bmv/predict?n_times=120', SC);
  assert(r.ok && r.data.models?.length >= 6 && r.data.time_series?.t.length === 120 && r.data.branch_positions?.A_L, 'missing fields');
  return `Δφ = ${r.data.delta_phi_total_rad.toExponential(4)} rad, N = ${r.data.negativity.toExponential(4)}, W = ${r.data.witness_cpk_local_corrected.toExponential(4)}`;
});
await check('predict: inadmissible design returns issues', async () => {
  const r = await req('POST', '/api/bmv/predict', { design: { separation: 1e-6, dx_A: 1e-6, dx_B: 1e-6 }, environment: {} });
  assert(r.ok && r.data.admissibility_issues?.length > 0 && !r.data.models, JSON.stringify(r.data).slice(0, 200));
  return r.data.admissibility_issues[0].slice(0, 80);
});
await check('POST /api/quantum/lindblad', async () => {
  const r = await req('POST', '/api/quantum/lindblad', { H_re: [[0, 1], [1, 0]], L_re: [[[0, 0.3], [0, 0]]], rho0_re: [[1, 0], [0, 0]], t_final: 10, n_times: 20 });
  assert(r.ok && r.data.populations.length === 20, `status ${r.status}`);
});
await check('POST /api/gravity/orbit', async () => { const r = await req('POST', '/api/gravity/orbit'); assert(r.ok && r.data.precession_numeric_rad > 0, 'bad'); return `Mercury Δϖ = ${r.data.precession_numeric_rad.toExponential(4)} rad/orbit`; });
await check('POST /api/gravity/nbody', async () => {
  const r = await req('POST', '/api/gravity/nbody', { masses: [1.989e30, 5.972e24], positions: [[0, 0, 0], [1.496e11, 0, 0]], velocities: [[0, 0, 0], [0, 29780, 0]], dt: 3600, steps: 8766, save_every: 100 });
  assert(r.ok && r.data.positions.length > 10, `status ${r.status}`);
});
await check('POST /api/interferometry/sg', async () => { const r = await req('POST', '/api/interferometry/sg?tau=0.25', SC); assert(r.ok && Number.isFinite(r.data.delta_phi), `status ${r.status}`); });
await check('POST /api/interferometry/wavepacket2d', async () => { const r = await req('POST', '/api/interferometry/wavepacket2d?n=64&frames=20'); assert(r.ok && r.data.frames.length > 1, `status ${r.status}`); return `${r.data.frames.length} frames`; });
await check('POST /api/optomech/evolve', async () => { const r = await req('POST', '/api/optomech/evolve'); assert(r.ok && r.data.log_negativity.length === 200, `status ${r.status}`); });
await check('POST /api/decoherence/budget', async () => { const r = await req('POST', '/api/decoherence/budget?include_dp=true', SC); assert(r.ok && r.data.mechanisms.diosi_penrose_collapse, 'no DP'); return `dominant ${r.data.dominant}`; });
await check('POST /api/lab/dossier', async () => { const r = await req('POST', '/api/lab/dossier', SC); assert(r.ok && r.data.protocol && r.data.engineering?.bill_of_materials, 'bad dossier'); return `BOM ${r.data.engineering.bill_of_materials.length} items, TRL ${r.data.engineering.technological_readiness.overall_trl}`; });
for (const f of ['stl', 'svg', 'json', 'scene']) await check(`POST /api/lab/export/${f}`, async () => { const r = await req('POST', `/api/lab/export/${f}`, SC, { raw: true }); assert(r.status === 200 && r.data.length > 100, `status ${r.status}`); return `${r.data.length} bytes`; });
let counts = null;
await check('POST /api/signal/simulate (SYNTHETIC)', async () => {
  const r = await req('POST', '/api/signal/simulate', { ...SC, model: 'QG-COH', shots: 5000, seed: 1 });
  assert(r.ok && r.data.data_label === 'SYNTHETIC' && r.data.witness_estimate, 'bad');
  counts = r.data.counts;
  return `W = ${r.data.witness_estimate.witness.toFixed(4)} ± ${r.data.witness_estimate.stderr.toFixed(4)}`;
});
await check('POST /api/signal/tomography', async () => { const r = await req('POST', '/api/signal/tomography', { counts }); assert(r.ok, `status ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); });
await check('POST /api/signal/injection', async () => { const r = await req('POST', '/api/signal/injection?trials=50'); assert(r.ok && r.data.data_label === 'SYNTHETIC', 'bad'); });
await check('POST /api/falsification/predictions', async () => { const r = await req('POST', '/api/falsification/predictions', SC); assert(r.ok && r.data.predictions.length >= 6 && Array.isArray(r.data.registered_not_implemented), 'bad'); return `${r.data.predictions.length} implemented hypotheses, ${r.data.registered_not_implemented.length} registered-not-implemented`; });
await check('POST /api/bmv/sweep2d', async () => {
  const xs = Array.from({ length: 12 }, (_, i) => 1e-4 + i * 1e-4), ys = Array.from({ length: 10 }, (_, i) => 1e-5 + i * 3e-5);
  const r = await req('POST', '/api/bmv/sweep2d', { ...SC, px: 'separation', xs, py: 'dx_A', ys, hypothesis: 'QG-COH' });
  assert(r.ok && r.data.negativity.length === 10, 'bad');
  const nulls = r.data.negativity.flat().filter((v) => v === null).length;
  return `${nulls} inadmissible cells of 120`;
});
await check('POST /api/bmv/sweep1d', async () => { const r = await req('POST', '/api/bmv/sweep1d?param=separation&start=0.0002&stop=0.001&n=10', SC); assert(r.ok && r.data.rows.length === 10, 'bad'); });
await check('POST /api/discovery/scaling', async () => { const r = await req('POST', '/api/discovery/scaling?n=64'); assert(r.ok && r.data.law.dimensionally_consistent, 'bad'); return r.data.law.expression; });
await check('POST /api/data/validate (multipart)', async () => {
  const fd = new FormData(); fd.append('file', new Blob(['[[0.5,0],[0,0.5]]'], { type: 'application/json' }), 'rho.json');
  const r = await req('POST', '/api/data/validate', undefined, { form: fd }); assert(r.ok, `status ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); return `kind ${r.data.kind}`;
});
await check('POST /api/thought/interpret + execute', async () => {
  const i = await req('POST', '/api/thought/interpret', { prompt: 'Two 10 fg diamond spheres 450 um apart each in a 250 um superposition for 2.5 s', language_model: 'off' });
  assert(i.ok && i.data.family === 'bmv', 'interpret failed');
  const refused = await req('POST', '/api/thought/execute', { config: i.data, approved: false });
  assert(refused.status === 403, `unapproved execute returned ${refused.status}`);
  const x = await req('POST', '/api/thought/execute', { config: i.data, approved: true });
  assert(x.ok && x.data.prediction && x.data.competing_models, 'execute failed');
  return `Δφ = ${x.data.prediction.delta_phi_total_rad.toExponential(4)} rad; unapproved → 403`;
});
let preregId = null;
await check('POST /api/evidence/preregister', async () => {
  const r = await req('POST', '/api/evidence/preregister', { title: 'smoke-test preregistration', hypotheses: ['QG-COH', 'CC-KTM'], scenario: SC, decision_rules: { entanglement_claim: 'z >= 5' }, analysis_plan: 'witness test', seeds: [1, 2], sample_size: { shots_per_setting: 100000 } });
  assert(r.ok && r.data.payload?.prereg_id, `status ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  preregId = r.data.payload.prereg_id;
  return `prereg ${preregId}`;
});
let dsId = null;
await check('POST /api/evidence/datasets (multipart)', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([JSON.stringify({ counts, generated_utc: new Date().toISOString() })], { type: 'application/json' }), 'synthetic-counts.json');
  fd.append('label', 'SYNTHETIC'); fd.append('role', 'blind_test'); fd.append('source', 'api-smoke'); fd.append('description', 'smoke test'); fd.append('prereg_id', preregId ?? '');
  const r = await req('POST', '/api/evidence/datasets', undefined, { form: fd });
  assert(r.ok, `status ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  dsId = r.data.dataset_id ?? r.data.id;
  return `dataset ${dsId}`;
});
const notes = [];
{ // informational: re-ingesting byte-identical data (backend vault file is read-only after the first write)
  const mk = () => { const fd = new FormData(); fd.append('file', new Blob(['qgdevs duplicate-ingest probe'], { type: 'text/plain' }), 'dup.txt'); fd.append('label', 'SYNTHETIC'); fd.append('role', 'exploratory'); fd.append('source', 'api-smoke'); return fd; };
  await req('POST', '/api/evidence/datasets', undefined, { form: mk() });
  const r2 = await req('POST', '/api/evidence/datasets', undefined, { form: mk() });
  notes.push(`re-ingesting identical bytes → HTTP ${r2.status}${r2.status >= 500 ? ' (BACKEND ISSUE: BlindVault.ingest rewrites a 0440 file)' : ''}`);
}
await check('POST /api/evidence/unblind', async () => { const r = await req('POST', '/api/evidence/unblind', { dataset_id: dsId, prereg_id: preregId }); assert(r.ok, `status ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`); });
await check('POST /api/evidence/gates', async () => { const r = await req('POST', '/api/evidence/gates?hypothesis=QG-COH', SC); assert(r.ok && r.data.gates.length === 7, 'bad'); return `level ${r.data.classification.level}: ${r.data.classification.classification}`; });
await check('GET /api/evidence/ledger chain', async () => { const r = await req('GET', '/api/evidence/ledger'); assert(r.ok && r.data.verification.valid, JSON.stringify(r.data.verification)); return `${r.data.verification.length} entries, chain valid`; });
await check('POST /api/evidence/package (zip)', async () => { const r = await req('POST', '/api/evidence/package', SC, { raw: true }); assert(r.status === 200 && r.data.subarray(0, 2).toString() === 'PK', 'not a zip'); return `${r.data.length} bytes`; });

// ---------------------------------------------------------------- durable jobs
await check('job discrimination_matrix', async () => {
  const j = await job('discrimination_matrix', { design: {}, environment: {}, hypotheses: ['QG-COH', 'SC-MF', 'CC-KTM'] });
  assert(j.status === 'succeeded', `${j.status}: ${j.error}`);
  const inf = j.result.pairs.filter((p) => p.shots_per_setting === 'Infinity' || p.shots_per_setting === null).length;
  return `${j.result.pairs.length} pairs, ${inf} indistinguishable`;
});
await check('job inference', async () => {
  const j = await job('inference', { design: {}, counts, readout_error: 0.01, n_steps: 3000, seed: 0 });
  assert(j.status === 'succeeded', `${j.status}: ${j.error}`);
  return `λ = ${j.result.posterior.summary.lambda.mean.toFixed(3)} ± ${j.result.posterior.summary.lambda.std.toFixed(3)}, ln B = ${j.result.bayes_factor.ln_B.toFixed(2)}`;
});
await check('job vv_run (subset)', async () => {
  const reg = (await req('GET', '/api/vv/registry')).data;
  const j = await job('vv_run', { ids: reg.filter((b) => !b.slow).slice(0, 4).map((b) => b.id) });
  assert(j.status === 'succeeded', `${j.status}: ${j.error}`);
  return `${j.result.summary.passed}/${j.result.summary.total} passed`;
});

// ---------------------------------------------------------------- report
const w = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.note}`);
for (const n of notes) console.log(`NOTE  ${n}`);
console.log(`\n${results.length - failures}/${results.length} checks passed against ${BASE}`);
process.exit(failures ? 1 : 0);
