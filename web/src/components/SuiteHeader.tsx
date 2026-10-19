/** Header for every suite page: name, honest maturity and documented gaps from GET /api/suites. */
import type { ComponentChildren } from 'preact';
import { useApiGet } from '../lib/api';
import { suiteByN, prevSuite, nextSuite } from '../lib/nav';
import { MaturityBadge, SourceChip, Level } from './ui';

export interface SuiteInfo { n: number; slug: string; name: string; modules: string[]; capabilities: string[]; maturity: string; gaps: string[] }

export function useSuites() {
  return useApiGet<SuiteInfo[]>('/api/suites');
}

export function SuiteHeader({ n, intro, children }: { n: number; intro: ComponentChildren; children?: ComponentChildren }) {
  const nav = suiteByN(n);
  const r = useSuites();
  const info = r.data?.find((s) => s.n === n);
  return (
    <header class="page-head" style={{ display: 'block' }}>
      <div class="row-between">
        <h1><span class="muted" style={{ fontWeight: 600 }}>Suite {n} · </span>{info?.name ?? nav.name}</h1>
        <div class="row">{info ? <MaturityBadge m={info.maturity} /> : r.error ? <span class="badge b-neutral" title="Suite registry unavailable offline">maturity unknown (offline)</span> : null}<SourceChip source={r.source === 'cache' ? 'cache' : null} cachedAt={r.cachedAt} />{children}</div>
      </div>
      <p style={{ maxWidth: '90ch' }} class="muted">{intro}</p>
      {info && info.gaps.length > 0 && (
        <p class="small" style={{ margin: '0 0 6px' }}><strong>Documented gaps:</strong> {info.gaps.join('; ')}.</p>
      )}
      {info && info.gaps.length === 0 && <p class="small muted" style={{ margin: '0 0 6px' }}>No open gaps are declared for this suite in the registry.</p>}
      <nav class="suite-pager" aria-label="Neighbouring suites">
        {prevSuite(n) ? <a href={`/suite/${prevSuite(n)!.slug}`} rel="prev">← Suite {n - 1} · {prevSuite(n)!.short}</a> : <span />}
        {nextSuite(n) ? <a href={`/suite/${nextSuite(n)!.slug}`} rel="next">Suite {n + 1} · {nextSuite(n)!.short} →</a> : <span />}
      </nav>
      <Level min="expert">
        {info && <p class="small muted" style={{ margin: 0 }}>Modules: {info.modules.map((m) => <code>{m} </code>)} · Capabilities: {info.capabilities.join('; ')}.</p>}
      </Level>
    </header>
  );
}
