import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { Provenance } from '../lib/types';
import { fmtQ, fmtTime } from '../lib/format';
import { ApiError, type Source } from '../lib/api';
import { useStore, settings, atLeast, type Mode } from '../lib/store';

// ----------------------------------------------------------------------------- provenance badges
const PROV: Record<Provenance, [string, string, string]> = {
  COMPUTED: ['b-computed', 'Computed', 'Computed by the QG-DEVS server from the stated model and inputs.'],
  COMPUTED_LOCAL: ['b-local', 'Computed locally', 'Computed in this browser by the offline engine (verified against the server reference by golden-vector tests).'],
  SYNTHETIC: ['b-synthetic', 'Synthetic', 'Simulated data generated from a model — not a measurement of nature.'],
  CALCULATED_REQUIREMENT: ['b-requirement', 'Calculated requirement', 'A requirement derived by calculation from the model; not a property of any built apparatus.'],
  LITERATURE_REFERENCE: ['b-literature', 'Literature reference', 'Value taken from a cited publication.'],
  ESTIMATED: ['b-estimated', 'Estimated', 'Order-of-magnitude estimate; replace with a measured value before relying on it.'],
  UNVERIFIED_ASSUMPTION: ['b-assumption', 'Unverified assumption', 'Assumption that has not been verified; results depending on it are conditional.'],
  CACHED: ['b-cached', 'Cached', 'Served from the offline cache; may be out of date.'],
};
export function ProvBadge({ kind, title }: { kind: Provenance | string; title?: string }) {
  const p = PROV[kind as Provenance];
  if (!p) return <span class="badge b-neutral" title={title}>{String(kind).replace(/_/g, ' ')}</span>;
  return <span class={`badge ${p[0]}`} title={title ?? p[2]}>{p[1]}</span>;
}

/** Map arbitrary backend status strings to a provenance badge where one applies. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s in PROV) return <ProvBadge kind={s} />;
  if (/^(PASSED|OK|SUCCEEDED|VALID|TRUE|AVAILABLE|PROVED)$/.test(s)) return <span class="badge b-ok">{status}</span>;
  if (/FAIL|ERROR|NOT_PASSED|INVALID|BROKEN/.test(s)) return <span class="badge b-bad">{status.replace(/_/g, ' ')}</span>;
  if (/PARTIAL|REQUIRES|PENDING|QUEUED|RUNNING|WARN/.test(s)) return <span class="badge b-warn">{status.replace(/_/g, ' ')}</span>;
  return <span class="badge b-neutral">{status.replace(/_/g, ' ')}</span>;
}

// ----------------------------------------------------------------------------- assurance (six statuses)
export type Assurance = 'FORMALLY VERIFIED' | 'NUMERICALLY VERIFIED' | 'PARTIALLY VERIFIED' | 'UNVERIFIED' | 'SPECULATIVE' | 'FAILED';
const AS: Record<Assurance, [string, string, string]> = {
  'FORMALLY VERIFIED': ['as-formal', '✔✔', 'Machine-checked proof (Lean 4) with status "proved".'],
  'NUMERICALLY VERIFIED': ['as-numeric', '✔', 'Passes registered numerical benchmarks within pre-justified tolerances.'],
  'PARTIALLY VERIFIED': ['as-partial', '◐', 'Some, not all, required checks have been performed or passed.'],
  UNVERIFIED: ['as-unverified', '○', 'No verification recorded.'],
  SPECULATIVE: ['as-speculative', '?', 'Outside the validated domain of every implemented model.'],
  FAILED: ['as-failed', '✖', 'A verification check failed.'],
};
export function normaliseAssurance(s: string | null | undefined): Assurance {
  const u = (s ?? '').toUpperCase().replace(/_/g, ' ');
  if (u === 'PROVED' || u.startsWith('FORMALLY')) return 'FORMALLY VERIFIED';
  if (u.includes('FAIL') || u === 'ERROR') return 'FAILED';
  if (u.includes('SPECULATIVE')) return 'SPECULATIVE';
  if (u.startsWith('PARTIAL') || u === 'SORRY' || u.includes('PARTIAL')) return 'PARTIALLY VERIFIED';
  if (u.includes('NUMERICALLY') || u.includes('VERIFIED AGAINST') || u === 'IMPLEMENTED VERIFIED') return 'NUMERICALLY VERIFIED';
  return 'UNVERIFIED';
}
export function AssuranceBadge({ status, raw }: { status: Assurance | string; raw?: string }) {
  const a = (status in AS ? status : normaliseAssurance(status)) as Assurance;
  const [cls, glyph, tip] = AS[a];
  return <span class={`badge ${cls}`} title={`${tip}${raw ? ` (recorded status: ${raw})` : ''}`}><span aria-hidden="true">{glyph}</span>{a}</span>;
}
export const ASSURANCE_LIST = Object.keys(AS) as Assurance[];

export function MaturityBadge({ m }: { m: string }) {
  const cls = m === 'IMPLEMENTED_VERIFIED' ? 'b-ok' : m === 'IMPLEMENTED' ? 'b-computed' : m === 'BASELINE' ? 'b-warn' : 'b-neutral';
  return <span class={`badge ${cls}`} title="Maturity as declared by the suite registry (GET /api/suites)">{m.replace(/_/g, ' ')}</span>;
}

// ----------------------------------------------------------------------------- banners
const WarnIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3 2 21h20L12 3z" /><path d="M12 10v5M12 18h.01" /></svg>;
const InfoIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>;

/** Persistent banner on result/evidence pages. Only the backend classification may relax it. */
export function EvidenceBanner({ classification }: { classification?: { classification?: string; physical_claim_permitted?: boolean; statement?: string } | string | null }) {
  const c = typeof classification === 'string' ? { classification } : classification;
  if (c && c.physical_claim_permitted) {
    return <div class="banner ok" role="note"><InfoIcon /><div><strong>Backend classification: {c.classification}</strong>{c.statement ? ` — ${c.statement}` : ''}</div></div>;
  }
  return (
    <div class="banner evidence" role="note" aria-label="Evidence status">
      <WarnIcon />
      <div><strong>Computational prediction — not physical evidence.</strong>{' '}
        {c?.classification ? <>{/^COMPUTED LOCALLY/.test(c.classification) ? 'Result status' : 'Backend classification'}: <b>{c.classification}</b>{c.statement ? ` — ${c.statement}` : ''}</> : 'Results are model-dependent calculations; no physical measurement is involved.'}
      </div>
    </div>
  );
}
export function SyntheticBanner({ children }: { children?: ComponentChildren }) {
  return <div class="banner synthetic" role="note"><WarnIcon /><div><strong>SYNTHETIC data.</strong> Generated from a model by the simulator; not a measurement. {children}</div></div>;
}
export function InfoBanner({ children, kind = 'info' }: { children: ComponentChildren; kind?: 'info' | 'danger' | 'ok' }) {
  return <div class={`banner ${kind}`} role="note"><InfoIcon /><div>{children}</div></div>;
}

// ----------------------------------------------------------------------------- status
export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div class="row muted" role="status" aria-live="polite"><span class="spinner" aria-hidden="true" /> {label}…</div>;
}
export function ErrorBox({ error, what }: { error: unknown; what?: string }) {
  if (!error) return null;
  const e = error as ApiError;
  const offline = e instanceof ApiError && (e.offline || e.status === 0);
  return (
    <div class="error-box" role="alert">
      <strong>{offline ? 'Offline / server unreachable' : `Error${e?.status ? ` ${e.status}` : ''}`}</strong>{what ? ` while ${what}` : ''}: {String(e?.message ?? error)}
      {offline && <div class="small muted">No fresh data was fetched. Cached results (if any) are labelled with their cache time.</div>}
    </div>
  );
}
export function SourceChip({ source, cachedAt }: { source: Source | null; cachedAt?: string | null }) {
  if (!source) return null;
  if (source === 'cache') return <span class="cached-chip"><ProvBadge kind="CACHED" /> cached at {fmtTime(cachedAt)}</span>;
  if (source === 'local') return <span class="cached-chip"><ProvBadge kind="COMPUTED_LOCAL" /></span>;
  if (source === 'network') return <span class="cached-chip" title={cachedAt ? `received ${fmtTime(cachedAt)}` : ''}>live · {cachedAt ? fmtTime(cachedAt) : 'now'}</span>;
  return null;
}
export function Progress({ value, label }: { value: number | null; label: string }) {
  const v = value == null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(1, value));
  return <div class="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)}><div style={{ width: `${v * 100}%` }} /></div>;
}

// ----------------------------------------------------------------------------- tooltip
export function Tip({ text, label = 'More information' }: { text: ComponentChildren; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" class="tip-btn" aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open} onClick={() => setOpen((o) => !o)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>i</button>
      {open && <span role="tooltip" id={id} class="tip-pop">{text}</span>}
    </span>
  );
}

// ----------------------------------------------------------------------------- outputs
export interface OutProps {
  label: string; value: number | string | null | undefined; unit?: string; unc?: number | string | null; interp?: ComponentChildren;
  prov?: Provenance | string; tone?: 'good' | 'bad' | null; sig?: number; tip?: string;
}
export function Out({ label, value, unit, unc, interp, prov, tone, sig = 4, tip }: OutProps) {
  const v = typeof value === 'number' ? fmtQ(value, unit, sig) : value ?? '—';
  return (
    <div class={`out ${tone ?? ''}`}>
      <div class="out-label"><span>{label} {tip && <Tip text={tip} />}</span>{prov && <ProvBadge kind={prov} />}</div>
      <div class="out-value">{v}</div>
      {unc != null && unc !== '' && <div class="out-unc">± {typeof unc === 'number' ? fmtQ(unc, unit, 2) : unc}</div>}
      {interp && <div class="out-interp">{interp}</div>}
    </div>
  );
}

// ----------------------------------------------------------------------------- structure
export function PageHead({ title, sub, children, n }: { title: string; sub?: ComponentChildren; children?: ComponentChildren; n?: number }) {
  return (
    <div class="page-head">
      <div>
        <h1>{n ? <span class="muted" style={{ fontWeight: 600 }}>Suite {n} · </span> : null}{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div class="row">{children}</div>}
    </div>
  );
}
export function Card({ title, children, actions, level, id, class: cls }: { title?: ComponentChildren; children: ComponentChildren; actions?: ComponentChildren; level?: Mode; id?: string; class?: string }) {
  const s = useStore(settings);
  if (level && !atLeast(s.mode, level)) return null;
  return (
    <section class={`card ${cls ?? ''}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions) && <div class="card-head">{typeof title === 'string' ? <h2>{title}</h2> : title}{actions && <div class="row">{actions}</div>}</div>}
      {children}
    </section>
  );
}
/** Render children only at or above a mode level. */
export function Level({ min, children }: { min: Mode; children: ComponentChildren }) {
  const s = useStore(settings);
  return atLeast(s.mode, min) ? <>{children}</> : null;
}

export function Tabs({ tabs, active, onChange, label }: { tabs: { id: string; label: ComponentChildren }[]; active: string; onChange: (id: string) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const key = (e: KeyboardEvent, i: number) => {
    let j = i;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length; else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0; else if (e.key === 'End') j = tabs.length - 1; else return;
    e.preventDefault(); onChange(tabs[j].id); refs.current[j]?.focus();
  };
  return (
    <div role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button type="button" role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={active === t.id} tabIndex={active === t.id ? 0 : -1}
          ref={(el) => (refs.current[i] = el)} onClick={() => onChange(t.id)} onKeyDown={(e: any) => key(e, i)}>{t.label}</button>
      ))}
    </div>
  );
}
export function TabPanel({ id, active, children }: { id: string; active: string; children: ComponentChildren }) {
  if (id !== active) return null;
  return <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0}>{children}</div>;
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren; disabled?: boolean }) {
  const id = useId();
  return (
    <span class="switch">
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} disabled={disabled} onClick={() => onChange(!checked)} />
      <span id={id} onClick={() => !disabled && onChange(!checked)}>{label}</span>
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: ComponentChildren; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" role="radio" aria-checked={value === o.v} disabled={o.disabled} title={o.title} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export function KV({ rows }: { rows: [ComponentChildren, ComponentChildren][] }) {
  return <dl class="kv">{rows.map(([k, v], i) => <><dt key={`k${i}`}>{k}</dt><dd key={`v${i}`}>{v}</dd></>)}</dl>;
}

export function DataTable({ head, rows, numeric = [], caption, hl }: { head: ComponentChildren[]; rows: ComponentChildren[][]; numeric?: number[]; caption?: string; hl?: (i: number) => boolean }) {
  return (
    <div class="table-wrap">
      <table class="data">
        {caption && <caption class="sr-only">{caption}</caption>}
        <thead><tr>{head.map((h, i) => <th scope="col" class={numeric.includes(i) ? 'num' : ''}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr class={hl?.(i) ? 'hl' : ''}>{r.map((c, j) => <td class={numeric.includes(j) ? 'num' : ''}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Json({ data, max = 360 }: { data: unknown; max?: number }) {
  return <pre class="code" style={{ maxHeight: `${max}px` }}>{JSON.stringify(data, null, 2)}</pre>;
}

export function Btn(props: JSX.HTMLAttributes<HTMLButtonElement> & { busy?: boolean; kind?: 'primary' | 'danger' }) {
  const { busy, kind, children, class: cls, ...rest } = props as any;
  return <button type="button" class={`btn ${kind ?? ''} ${cls ?? ''}`} disabled={busy || rest.disabled} aria-busy={busy} {...rest}>{busy && <span class="spinner" aria-hidden="true" />}{children}</button>;
}
