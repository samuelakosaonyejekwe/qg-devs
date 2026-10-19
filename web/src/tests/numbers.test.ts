import { describe, expect, it, vi } from 'vitest';
import { fmtNum, fmtQ } from '../lib/format';
import { parseNumber, toDisplay, toSI, fmtInput, shiftDecimal } from '../lib/numparse';
import { UNIT_CHOICES } from '../lib/format';

describe('fmtNum edge cases', () => {
  it.each([
    [NaN, '—'], [Infinity, '∞'], [-Infinity, '−∞'], [0, '0'], [-0, '0'],
    [1e-300, '1 × 10⁻³⁰⁰'], [5e-324, '4.941 × 10⁻³²⁴'], [1.7976931348623157e308, '1.798 × 10³⁰⁸'],
    [9.99996e-4, '0.001'], [99999.6, '1 × 10⁵'], [123456, '1.235 × 10⁵'], [-0.0123456, '−0.01235'], [0.001, '0.001'],
    [9.9999e-5, '1 × 10⁻⁴'], [-2.5e-14, '−2.5 × 10⁻¹⁴'],
  ])('%s → %s', (v, out) => { expect(fmtNum(v as number)).toBe(out); });
  it('never produces "10 × 10ⁿ" or NaN/undefined text', () => {
    for (let k = 0; k < 5000; k++) {
      const v = (Math.random() < 0.5 ? -1 : 1) * 10 ** (Math.random() * 600 - 300) * (9.9995 + Math.random() * 0.001) / 10;
      const s = fmtNum(v);
      expect(s).not.toMatch(/^−?10 ×|NaN|undefined|Infinity/);
    }
  });
});

describe('fmtQ', () => {
  it('rounds before choosing the SI prefix', () => {
    expect(fmtQ(999.96e-6, 'm')).toBe('1 mm');
    expect(fmtQ(450e-6, 'm')).toBe('450 µm');
    expect(fmtQ(1e-14, 'kg')).toBe('10 pg');
    expect(fmtQ(1e-17, 'kg')).toBe('10 fg');
    expect(fmtQ(2.5, 's')).toBe('2.5 s');
  });
  it('handles non-finite and tiny values', () => {
    expect(fmtQ(NaN, 'm')).toBe('—');
    expect(fmtQ(Infinity, 'm')).toBe('∞ m');
    expect(fmtQ(1e-300, 'm')).toBe('1 × 10⁻³⁰⁰ m');
    expect(fmtQ(-0, 'J')).toBe('0 J');
  });
});

describe('parseNumber', () => {
  it.each([
    ['450', 450], [' 2.5e-14 ', 2.5e-14], ['-0.5', -0.5], ['.5', 0.5], ['1E+3', 1000], ['1.5×10^-5', 1.5e-5], ['1.5x10^-5', 1.5e-5],
    ['1.5*10^-5', 1.5e-5], ['1.5 × 10 ^ -5', 1.5e-5], ['1.5×10⁻⁵', 1.5e-5], ['−3', -3], ['+7', 7], ['0', 0],
  ])('accepts %j', (t, v) => { const r = parseNumber(t as string); expect(r.ok && r.value).toBe(v); });
  it.each(['', '   ', '1e', '1e-', '--1', '+-1', '.', '1.2.3', 'abc', '1,5', '1,000', '1e999', '0x10', 'Infinity', 'NaN'])('rejects %j with a message', (t) => {
    const r = parseNumber(t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(3);
  });
});

describe('unit conversion round-trips exactly (SI → display → SI)', () => {
  const values = [450e-6, 250e-6, 1e-14, 2.5, 0.15, 1e-15, 3510, 6.283185307, 1.0545718e-34, 0.1 + 0.2, 1 / 3, 7.77e-21, 9.81];
  for (const [unit, choices] of Object.entries(UNIT_CHOICES)) {
    it(`${unit}: every display unit`, () => {
      for (const [, f] of choices) for (const v of values) {
        const shown = fmtInput(toDisplay(v, f));
        const parsed = parseNumber(shown);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(toSI(parsed.value, f)).toBe(v);
      }
    });
  }
  it('power-of-ten conversions are decimal-exact', () => {
    expect(toDisplay(450e-6, 1e-6)).toBe(450);
    expect(toSI(450, 1e-6)).toBe(450e-6);
    expect(toSI(10, 1e-18)).toBe(1e-17);
    expect(shiftDecimal(0.1 + 0.2, 1)).toBe(3.0000000000000004);
  });
});

describe('queued request sender', async () => {
  const { sendQueuedRequest, PermanentQueueError } = await import('../lib/queue');
  const q = { id: 'x', created: '', method: 'POST' as const, path: '/api/jobs', body: '{}', contentType: 'application/json', label: 't', status: 'pending' as const, attempts: 0, idem: 'idem-1' };
  const respond = (status: number, body: unknown) => vi.fn(async (_u: string, init: RequestInit) => {
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('idem-1');
    return new Response(JSON.stringify(body), { status });
  });
  it('sends an Idempotency-Key and returns the parsed body', async () => {
    vi.stubGlobal('fetch', respond(200, { id: 'job1' }));
    await expect(sendQueuedRequest(q)).resolves.toEqual({ id: 'job1' });
  });
  it('treats 401/403/422 as permanent and 429/503 as retryable', async () => {
    for (const s of [401, 403, 422]) { vi.stubGlobal('fetch', respond(s, { detail: 'no' })); await expect(sendQueuedRequest(q)).rejects.toBeInstanceOf(PermanentQueueError); }
    for (const s of [429, 503]) {
      vi.stubGlobal('fetch', respond(s, { detail: 'busy' }));
      const err: Error = await sendQueuedRequest(q).then(() => new Error("resolved"), (e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(PermanentQueueError);
      expect(String(err.message)).toContain('busy');
    }
    vi.unstubAllGlobals();
  });
});
