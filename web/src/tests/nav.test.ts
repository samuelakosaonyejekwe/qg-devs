/** Suites are listed strictly in numerical order 1 … 18 wherever they are enumerated. */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SUITES, SUITES_IN_ORDER, prevSuite, nextSuite, topicOf, GROUPS } from '../lib/nav';

const SRC = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');

describe('suite order', () => {
  it('SUITES_IN_ORDER is exactly 1..18', () => {
    expect(SUITES_IN_ORDER.map((s) => s.n)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });
  it('slugs are unique and every suite has a topic (secondary label only)', () => {
    expect(new Set(SUITES_IN_ORDER.map((s) => s.slug)).size).toBe(18);
    for (const s of SUITES) expect(topicOf(s.n)).not.toBe('');
    expect(GROUPS.flatMap((g) => g.suites).sort((a, b) => a - b)).toEqual(SUITES_IN_ORDER.map((s) => s.n));
  });
  it('previous/next links stop at the ends', () => {
    expect(prevSuite(1)).toBeNull();
    expect(nextSuite(18)).toBeNull();
    expect(nextSuite(4)?.n).toBe(5);
    expect(prevSuite(13)?.n).toBe(12);
  });
  it('the sidebar enumerates SUITES_IN_ORDER under one heading, not topic groups', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/SUITES_IN_ORDER\.map/);
    expect(app).toMatch(/Scientific suites/);
    expect(app).not.toMatch(/GROUPS\.map/);
  });
  it('the dashboard cards and help page use the numerical order', () => {
    expect(read('pages/Dashboard.tsx')).toMatch(/SUITES_IN_ORDER\.map/);
    expect(read('pages/Dashboard.tsx')).not.toMatch(/GROUPS\.map/);
    expect(read('pages/Help.tsx')).toMatch(/SUITES_IN_ORDER/);
  });
});
