/** Version comparison and the "show What's new once" decision (pure functions, unit-tested). */

export interface Release { version: string; date?: string; title: string; highlights: string[]; fixes: string[] }

function parts(v: string): number[] {
  const core = String(v ?? '').trim().replace(/^v/i, '').split(/[-+]/)[0];
  return core.split('.').map((x) => { const n = parseInt(x, 10); return Number.isFinite(n) ? n : 0; });
}

/** Numeric semantic-version comparison: negative if a < b, 0 if equal, positive if a > b.
 *  Missing parts count as 0 ("1.2" == "1.2.0"); a pre-release suffix sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  const preA = /-/.test(a), preB = /-/.test(b);
  if (preA !== preB) return preA ? -1 : 1;
  return 0;
}

/** Releases with lastSeen < version ≤ current, newest first (lastSeen null → all up to current). */
export function releasesBetween(releases: Release[], lastSeen: string | null, current: string): Release[] {
  return releases
    .filter((r) => compareVersions(r.version, current) <= 0 && (lastSeen == null || compareVersions(r.version, lastSeen) > 0))
    .sort((x, y) => compareVersions(y.version, x.version));
}

/** First visit: remember silently. Upgraded since last visit: show. Otherwise nothing. */
export function decideWhatsNew(lastSeen: string | null, current: string): 'store-silently' | 'show' | 'nothing' {
  if (lastSeen == null || lastSeen === '') return 'store-silently';
  return compareVersions(current, lastSeen) > 0 ? 'show' : 'nothing';
}

export const LAST_SEEN_KEY = 'qg.lastSeenVersion';
export function readLastSeen(): string | null { try { return localStorage.getItem(LAST_SEEN_KEY); } catch { return null; } }
export function writeLastSeen(v: string) { try { localStorage.setItem(LAST_SEEN_KEY, v); } catch { /* storage unavailable */ } }
