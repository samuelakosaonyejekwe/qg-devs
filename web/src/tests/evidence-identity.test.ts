/** Suite 18 identity-bound evidence: request bodies, identity classification and anchor helpers. */
import { describe, expect, it } from 'vitest';
import { anchorPlaces, anchorVerdict, datasetOptions, parseAnchorFile, signoffBody, signoffErrors, unblindBody } from '../lib/evidence';
import { canAct, identityKind, tokenTail, type Whoami } from '../components/Identity';
import { ApiError } from '../lib/api';

describe('sign-off request body', () => {
  it('never sends a reviewer or actor name (the server binds the token identity)', () => {
    const b = signoffBody('G1', '  Univ. X ', ' I checked the derivation. ');
    expect(b).toEqual({ gate: 'G1', affiliation: 'Univ. X', statement: 'I checked the derivation.' });
    expect(Object.keys(b)).not.toContain('reviewer');
    expect(Object.keys(b)).not.toContain('actor');
  });
  it('includes dataset_id only for G6/G7 and only when chosen', () => {
    expect(signoffBody('G6', 'ab', 'x'.repeat(10), 'ds1').dataset_id).toBe('ds1');
    expect(signoffBody('G7', 'ab', 'x'.repeat(10), '').dataset_id).toBeUndefined();
    expect(signoffBody('G3', 'ab', 'x'.repeat(10), 'ds1').dataset_id).toBeUndefined();
  });
  it('validates the server limits (affiliation ≥ 2, statement ≥ 10 characters, trimmed)', () => {
    expect(signoffErrors('a', 'short').affiliation).toBeTruthy();
    expect(signoffErrors('ab', '   123456789  ').statement).toBeTruthy();
    expect(signoffErrors('ab', '1234567890')).toEqual({ affiliation: null, statement: null });
  });
  it('unblinding body carries no actor', () => {
    expect(unblindBody(' d ', ' p ')).toEqual({ dataset_id: 'd', prereg_id: 'p' });
  });
});

describe('identity classification', () => {
  const w = (o: Partial<Whoami>): Whoami => ({ role: 'researcher', name: 'Dr A', token_id: 'abc123def456', verified: true, can_write_evidence: true, ...o });
  it('distinguishes verified, development-mode, public and rejected tokens', () => {
    expect(identityKind(w({}), null, false)).toBe('verified');
    expect(identityKind(w({ verified: false, token_id: null, name: 'development user' }), null, false)).toBe('unverified');
    expect(identityKind(w({ role: 'public', name: 'anonymous', token_id: null, verified: false, can_write_evidence: false }), null, false)).toBe('public');
    expect(identityKind(null, new ApiError(403, 'invalid access token'), false)).toBe('invalid');
    expect(identityKind(null, new ApiError(0, 'network', true), false)).toBe('offline');
    expect(identityKind(null, null, true)).toBe('loading');
  });
  it('only researcher (or admin) identities may write evidence; operators may ingest', () => {
    expect(canAct('verified', w({}))).toBe(true);
    expect(canAct('public', w({ role: 'public' }))).toBe(false);
    expect(canAct('invalid', null)).toBe(false);
    expect(canAct('verified', w({ role: 'operator' }))).toBe(false);
    expect(canAct('verified', w({ role: 'operator' }), ['researcher', 'operator'])).toBe(true);
    expect(canAct('verified', w({ role: 'admin' }))).toBe(true);
    expect(canAct('offline', null)).toBe(true); // server decides when the request is sent / replayed
  });
  it('shows only the token fingerprint', () => {
    expect(tokenTail('abc123def456')).toBe('…abc123def456');
    expect(tokenTail(null)).toBe('');
  });
});

describe('anchors', () => {
  const a = { ledger_index: 7, entry_hash: 'e'.repeat(64), created_utc: '2026-10-20T10:00:00+00:00', anchor_sha256: 'a'.repeat(64),
    published: { object_store: { bucket: 'b', key: 'anchors/00000007-aaaa.json' }, opentimestamps: [{ calendar: 'https://a.pool.opentimestamps.org', proof_file: 'x.ots' }] } };
  it('lists where an anchor was published', () => {
    expect(anchorPlaces(a)).toEqual(['object store s3://b/anchors/00000007-aaaa.json', 'OpenTimestamps a.pool.opentimestamps.org (x.ots)']);
    expect(anchorPlaces({ ...a, published: undefined })).toEqual([]);
  });
  it('is VALID only with an intact chain and no anchor problems', () => {
    expect(anchorVerdict({ chain_valid: true, anchors_checked: 3, anchor_problems: [], valid: true, latest_anchor: a }).ok).toBe(true);
    const bad = anchorVerdict({ chain_valid: true, anchors_checked: 3, anchor_problems: [{ anchor: 'x', problem: 'anchored entry missing (ledger truncated?)' }], valid: false, latest_anchor: a });
    expect(bad.ok).toBe(false);
    expect(bad.problems[0]).toMatch(/truncated/);
    expect(anchorVerdict({ chain_valid: false, anchors_checked: 0, anchor_problems: [], valid: false, latest_anchor: null }).problems).toContain('the hash chain itself does not verify');
  });
  it('accepts the downloaded file or a bare array; rejects other JSON', () => {
    expect(parseAnchorFile(JSON.stringify({ anchors: [a] }))).toHaveLength(1);
    expect(parseAnchorFile(JSON.stringify([a, a]))).toHaveLength(2);
    expect(() => parseAnchorFile('{"x":1}')).toThrow(/anchors/);
    expect(() => parseAnchorFile('not json')).toThrow(/JSON/);
  });
  it('dataset choices list REAL data first and de-duplicate', () => {
    const e = (i: number, id: string, label: string) => ({ index: i, kind: 'dataset_ingest', payload: { dataset_id: id, label, role: 'blind_test', source: 's' } });
    const o = datasetOptions([e(1, 'syn', 'SYNTHETIC'), e(2, 'real', 'REAL'), e(3, 'syn', 'SYNTHETIC'), { index: 4, kind: 'preregistration', payload: {} }]);
    expect(o.map((x) => x.id)).toEqual(['real', 'syn']);
  });
});
