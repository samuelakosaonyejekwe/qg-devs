import { describe, expect, it } from 'vitest';
import { compareVersions, releasesBetween, decideWhatsNew, type Release } from './version';

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
  it('treats missing parts as zero and tolerates a v prefix', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('v2', '1.9.9')).toBe(1);
  });
  it('sorts a pre-release before its release', () => {
    expect(compareVersions('0.2.0-rc.1', '0.2.0')).toBe(-1);
    expect(compareVersions('0.2.0', '0.2.0-beta')).toBe(1);
  });
});

const R = (v: string): Release => ({ version: v, title: v, highlights: [], fixes: [] });
const notes = [R('0.3.0'), R('0.2.0'), R('0.1.1'), R('0.1.0')];

describe('releasesBetween', () => {
  it('returns releases newer than last seen up to the running version, newest first', () => {
    expect(releasesBetween(notes, '0.1.0', '0.2.0').map((r) => r.version)).toEqual(['0.2.0', '0.1.1']);
  });
  it('never lists releases newer than the running version', () => {
    expect(releasesBetween(notes, '0.1.0', '0.1.1').map((r) => r.version)).toEqual(['0.1.1']);
  });
  it('lists everything up to current when nothing was seen', () => {
    expect(releasesBetween(notes, null, '0.2.0').map((r) => r.version)).toEqual(['0.2.0', '0.1.1', '0.1.0']);
  });
});

describe('decideWhatsNew (show once)', () => {
  it('first-ever visit stores silently', () => {
    expect(decideWhatsNew(null, '0.2.0')).toBe('store-silently');
    expect(decideWhatsNew('', '0.2.0')).toBe('store-silently');
  });
  it('shows after an upgrade', () => { expect(decideWhatsNew('0.1.0', '0.2.0')).toBe('show'); });
  it('does nothing when already seen (so it does not reappear on reload)', () => {
    expect(decideWhatsNew('0.2.0', '0.2.0')).toBe('nothing');
    expect(decideWhatsNew('0.3.0', '0.2.0')).toBe('nothing');
  });
  it('simulated sequence: show once, then store, then nothing', () => {
    let stored: string | null = '0.1.0';
    const first = decideWhatsNew(stored, '0.2.0');
    if (first !== 'nothing') stored = '0.2.0';
    expect(first).toBe('show');
    expect(decideWhatsNew(stored, '0.2.0')).toBe('nothing');
  });
});
