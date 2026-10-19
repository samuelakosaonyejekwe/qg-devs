import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from '../lib/store';

describe('persisted settings are repaired, never trusted blindly', () => {
  it('keeps valid values', () => {
    const s = sanitizeSettings({ mode: 'expert', theme: 'dark', apiBase: 'https://x', apiToken: 't', browserCompute: true, computeTimeLimitS: 60, computeMaxCells: 900, reducedMotion: 'on' });
    expect(s).toEqual({ mode: 'expert', theme: 'dark', apiBase: 'https://x', apiToken: 't', browserCompute: true, computeTimeLimitS: 60, computeMaxCells: 900, reducedMotion: 'on' });
  });
  it('replaces corrupted or out-of-range values with defaults', () => {
    const s = sanitizeSettings({ mode: 'wizard', theme: 3, apiBase: null, browserCompute: 'yes', computeTimeLimitS: 1e9, computeMaxCells: NaN, reducedMotion: undefined } as never);
    expect(s.mode).toBe('beginner');
    expect(s.theme).toBe('system');
    expect(s.apiBase).toBe('');
    expect(s.browserCompute).toBe(false); // opt-in compute stays off unless explicitly true
    expect(s.computeTimeLimitS).toBe(20);
    expect(s.computeMaxCells).toBe(2500);
    expect(s.reducedMotion).toBe('system');
  });
});
