/**
 * Pure helpers for the evidence pages (Suite 18): request bodies that match the server's identity-bound
 * evidence API, and formatting of external ledger anchors. No free-text reviewer/actor names are ever sent:
 * the server records the identity bound to the access token.
 */

export interface SignoffBody { gate: string; affiliation: string; statement: string; dataset_id?: string }

export const SIGNOFF_LIMITS = { affiliationMin: 2, statementMin: 10 } as const;
export const GATES_WITH_DATASET = ['G6', 'G7'];

export function signoffErrors(affiliation: string, statement: string): { affiliation: string | null; statement: string | null } {
  const a = affiliation.trim(), s = statement.trim();
  return {
    affiliation: a.length < SIGNOFF_LIMITS.affiliationMin ? `At least ${SIGNOFF_LIMITS.affiliationMin} characters.` : null,
    statement: s.length < SIGNOFF_LIMITS.statementMin ? `At least ${SIGNOFF_LIMITS.statementMin} characters (${s.length} so far).` : null,
  };
}

/** Sign-off request body (POST /api/evidence/signoff). dataset_id only for G6/G7 and only when chosen. */
export function signoffBody(gate: string, affiliation: string, statement: string, datasetId?: string | null): SignoffBody {
  const body: SignoffBody = { gate, affiliation: affiliation.trim(), statement: statement.trim() };
  if (GATES_WITH_DATASET.includes(gate) && datasetId && datasetId.trim()) body.dataset_id = datasetId.trim();
  return body;
}

export function unblindBody(datasetId: string, preregId: string) {
  return { dataset_id: datasetId.trim(), prereg_id: preregId.trim() };
}

// ----------------------------------------------------------------------------- datasets for G6/G7
export interface DatasetOption { id: string; label: string; role: string; source: string; index: number }

/** Dataset choices from ledger dataset_ingest entries, REAL data first (only REAL data can support G6/G7). */
export function datasetOptions(entries: { index: number; kind: string; payload: any }[]): DatasetOption[] {
  const seen = new Set<string>();
  const out: DatasetOption[] = [];
  for (const e of entries) {
    if (e.kind !== 'dataset_ingest' || !e.payload?.dataset_id || seen.has(e.payload.dataset_id)) continue;
    seen.add(e.payload.dataset_id);
    out.push({ id: e.payload.dataset_id, label: String(e.payload.label ?? '?'), role: String(e.payload.role ?? '?'), source: String(e.payload.source ?? ''), index: e.index });
  }
  return out.sort((a, b) => (a.label === 'REAL' ? 0 : 1) - (b.label === 'REAL' ? 0 : 1) || b.index - a.index);
}

// ----------------------------------------------------------------------------- anchors
export interface Anchor {
  ledger_index: number; entry_hash: string; created_utc: string; anchor_sha256: string;
  published?: { opentimestamps?: { calendar: string; proof_file: string }[]; object_store?: { bucket: string; key: string } };
  [k: string]: unknown;
}
export interface AnchorVerification { chain_valid: boolean; anchors_checked: number; anchor_problems: { anchor?: string | null; problem: string }[]; valid: boolean; latest_anchor: Anchor | null | Record<string, unknown> }
export interface AnchorsResp { anchors: Anchor[]; verification: AnchorVerification; remote_available: boolean; remote_error?: string | null; how_to_verify: string }

/** Where an anchor was published, as display strings (object store first, then each timestamp calendar). */
export function anchorPlaces(a: Anchor): string[] {
  const out: string[] = [];
  const os = a.published?.object_store;
  if (os) out.push(`object store s3://${os.bucket}/${os.key}`);
  for (const t of a.published?.opentimestamps ?? []) out.push(`OpenTimestamps ${t.calendar.replace(/^https?:\/\//, '')} (${t.proof_file})`);
  return out;
}

/** Overall verdict: VALID only when the chain verifies and no anchor reports a problem. */
export function anchorVerdict(v: AnchorVerification | null | undefined): { ok: boolean; text: string; problems: string[] } {
  if (!v) return { ok: false, text: 'not verified', problems: [] };
  const problems = [
    ...(v.chain_valid ? [] : ['the hash chain itself does not verify']),
    ...(v.anchor_problems ?? []).map((p) => `${p.problem}${p.anchor ? ` (anchor ${String(p.anchor).slice(0, 16)}…)` : ''}`),
  ];
  const ok = !!v.valid && problems.length === 0;
  return { ok, text: ok ? (v.anchors_checked ? `VALID — ${v.anchors_checked} anchor${v.anchors_checked === 1 ? '' : 's'} checked` : 'VALID — chain intact, no anchors yet') : 'PROBLEMS FOUND', problems };
}

/** Accepts either a downloaded anchors file ({anchors:[…]}) or a bare array of anchor records. */
export function parseAnchorFile(text: string): Anchor[] {
  let j: unknown;
  try { j = JSON.parse(text); } catch { throw new Error('the file is not valid JSON'); }
  const arr = Array.isArray(j) ? j : (j as any)?.anchors;
  if (!Array.isArray(arr)) throw new Error('expected a JSON array of anchors or an object with an "anchors" array');
  if (arr.length > 10000) throw new Error('at most 10 000 anchors per verification');
  return arr as Anchor[];
}
