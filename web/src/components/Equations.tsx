/**
 * "Governing equations" card for a suite: live from GET /api/equations, falling back to the copy bundled at
 * build time (scripts/copy-equations.mjs) when offline. Equations are KaTeX-validated on the backend.
 */
import { useApiGet } from '../lib/api';
import bundled from '../generated/equations.json';
import { Tex, MathText } from './Tex';

export interface EqEntry { label: string; tex: string; note?: string }
export interface EquationSet { suites: Record<string, EqEntry[]>; models: Record<string, { dynamics?: string[]; known_limits?: string[] }>; protocol: Record<string, string> }

export const BUNDLED_EQUATIONS = bundled as unknown as EquationSet;

export function useEquations(): { data: EquationSet; source: 'server' | 'bundled' } {
  const r = useApiGet<EquationSet>('/api/equations');
  const ok = r.data && typeof r.data === 'object' && r.data.suites;
  return { data: ok ? r.data! : BUNDLED_EQUATIONS, source: ok ? 'server' : 'bundled' };
}

export function GoverningEquations({ suite }: { suite: number }) {
  const { data, source } = useEquations();
  const eqs = data.suites[String(suite)] ?? [];
  if (!eqs.length) return null;
  return (
    <details class="card eq-card" open>
      <summary><h2 style={{ display: 'inline' }}>Governing equations</h2> <span class="small muted">({eqs.length}{source === 'bundled' ? ', bundled copy — server unavailable' : ''})</span></summary>
      <dl class="eq-list">
        {eqs.map((e) => (
          <div class="eq-item">
            <dt>{e.label}</dt>
            <dd><Tex tex={e.tex} display alt={e.label} />{e.note && <p class="small muted eq-note"><MathText text={e.note} /></p>}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
