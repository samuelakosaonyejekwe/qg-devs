/**
 * Page-level reset.
 *
 * Every routed page is wrapped in a <ResetScope>. Resetting re-mounts the page subtree, so every
 * component-local input returns to its documented default and every displayed result, plot and animation
 * is discarded. Job panels register their remembered job id so a reset also clears that binding. Pages that
 * edit the shared design/environment scenario offer a second option that also restores the scenario.
 * Confirmation is requested only when results are on screen.
 */
import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import { scenario } from '../lib/store';
import { DEFAULT_DESIGN, DEFAULT_ENV } from '../lib/types';

export type ResetKind = 'page' | 'scenario';

interface ResetApi {
  reset(kind: ResetKind): void;
  /** localStorage keys holding page state (e.g. remembered job ids) to delete on reset. */
  registerKey(key: string): () => void;
  /** Report whether a component currently displays results (used to decide if confirmation is needed). */
  setResult(id: string, has: boolean): void;
  hasResults(): boolean;
  /** True when this mount is the result of a reset (pages must not auto-run then). */
  afterReset: boolean;
  epoch: number;
}

const Ctx = createContext<ResetApi | null>(null);

/** Selectors that indicate computed output is displayed inside the page. */
const RESULT_SELECTOR = '[data-result], figure.chart, .view3d, .out';

export function ResetScope({ children }: { children: ComponentChildren }) {
  const [epoch, setEpoch] = useState(0);
  const keys = useRef(new Map<string, number>());
  const flags = useRef(new Map<string, boolean>());
  const root = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState('');

  const api: ResetApi = {
    epoch,
    afterReset: epoch > 0,
    reset(kind) {
      for (const k of keys.current.keys()) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
      if (kind === 'scenario') scenario.set({ design: { ...DEFAULT_DESIGN }, environment: { ...DEFAULT_ENV } });
      flags.current.clear();
      setEpoch((e) => e + 1);
      setMsg(kind === 'scenario' ? 'Page and shared scenario reset to defaults; results cleared.' : 'Page inputs reset to defaults; results cleared.');
    },
    registerKey(k) {
      keys.current.set(k, (keys.current.get(k) ?? 0) + 1);
      return () => { const n = (keys.current.get(k) ?? 1) - 1; if (n <= 0) keys.current.delete(k); else keys.current.set(k, n); };
    },
    setResult(id, has) { flags.current.set(id, has); },
    hasResults() {
      for (const v of flags.current.values()) if (v) return true;
      return !!root.current?.querySelector(RESULT_SELECTOR);
    },
  };
  return (
    <Ctx.Provider value={api}>
      <div ref={root} key={epoch} data-reset-epoch={epoch}>{children}</div>
      <div class="sr-only" role="status" aria-live="polite">{msg}</div>
    </Ctx.Provider>
  );
}

export function useResetScope(): ResetApi | null {
  return useContext(Ctx);
}

/** Register a localStorage key that a page reset must delete (e.g. a remembered job id). */
export function useResetKey(key: string | null) {
  const ctx = useContext(Ctx);
  useEffect(() => (key && ctx ? ctx.registerKey(key) : undefined), [key, ctx]);
}

/** Report that this component shows results (for the confirmation decision). */
export function useResultFlag(has: boolean) {
  const ctx = useContext(Ctx);
  const id = useRef(Math.random().toString(36).slice(2));
  useEffect(() => { ctx?.setResult(id.current, has); return () => ctx?.setResult(id.current, false); }, [has, ctx]);
}

/** True if this mount follows a reset; pages that auto-run on mount must skip that run. */
export function useAfterReset(): boolean {
  return useContext(Ctx)?.afterReset ?? false;
}

// ----------------------------------------------------------------------------- confirmation dialog
function Confirm({ open, title, body, confirmLabel, onConfirm, onCancel }: { open: boolean; title: string; body: ComponentChildren; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal?.(); cancelBtn.current?.focus(); }
    if (!open && d.open) d.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog ref={ref} class="card confirm-dialog" aria-labelledby="reset-dlg-title" aria-describedby="reset-dlg-body" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="reset-dlg-title">{title}</h2>
      <div id="reset-dlg-body"><p>{body}</p></div>
      <div class="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" class="btn" ref={cancelBtn} onClick={onCancel}>Keep results</button>
        <button type="button" class="btn danger" onClick={onConfirm} data-reset-confirm>{confirmLabel}</button>
      </div>
    </dialog>
  );
}

/**
 * Reset control. With `scenario` the page edits the shared design/environment, so a menu offers
 * "Reset this page" (keeps the shared scenario) or "Reset shared scenario to defaults".
 */
export function ResetButton({ scenario: usesScenario = false, onReset }: { scenario?: boolean; onReset?: () => void }) {
  const ctx = useContext(Ctx);
  const [menu, setMenu] = useState(false);
  const [pending, setPending] = useState<ResetKind | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);
  const doReset = useCallback((kind: ResetKind) => { onReset?.(); ctx?.reset(kind); }, [ctx, onReset]);
  const request = (kind: ResetKind) => {
    setMenu(false);
    if (ctx?.hasResults()) setPending(kind); else doReset(kind);
  };
  return (
    <span ref={wrap} class="reset-wrap">
      {usesScenario ? (
        <>
          <button type="button" class="btn" data-reset aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>↺ Reset ▾</button>
          {menu && (
            <div class="reset-menu" role="menu" aria-label="Reset options">
              <button type="button" role="menuitem" data-reset-page autoFocus onClick={() => request('page')}>
                <b>Reset this page</b><span class="small muted">Page inputs to defaults, clear results. The shared design/environment is kept.</span>
              </button>
              <button type="button" role="menuitem" data-reset-scenario onClick={() => request('scenario')}>
                <b>Reset shared scenario to defaults</b><span class="small muted">Also restores the design &amp; environment, which is shared by every suite page.</span>
              </button>
            </div>
          )}
        </>
      ) : (
        <button type="button" class="btn" data-reset data-reset-page onClick={() => request('page')} title="Restore this page's inputs to their defaults and clear its results">↺ Reset</button>
      )}
      <Confirm open={pending != null} title="Discard results and reset?"
        body={pending === 'scenario' ? 'The results on this page will be cleared and the shared design/environment (used by every suite) will be restored to the reference defaults.' : 'The results on this page will be cleared and its inputs restored to their defaults. The shared design/environment is not changed.'}
        confirmLabel="Discard and reset" onCancel={() => setPending(null)} onConfirm={() => { const k = pending!; setPending(null); doReset(k); }} />
    </span>
  );
}

/** Run + Reset (+ Cancel) bar used next to every analysis/simulation action. */
export function RunBar({ label, onRun, busy, disabled, scenario: usesScenario, onCancel, cancelLabel = 'Cancel', children }: {
  label: ComponentChildren; onRun: () => void; busy?: boolean; disabled?: boolean; scenario?: boolean; onCancel?: () => void; cancelLabel?: string; children?: ComponentChildren;
}) {
  return (
    <div class="runbar row" role="group" aria-label="Run controls">
      <button type="button" class="btn primary" data-run disabled={busy || disabled} aria-busy={busy} onClick={onRun}>{busy && <span class="spinner" aria-hidden="true" />}{label}</button>
      {onCancel && <button type="button" class="btn danger" onClick={onCancel}>{cancelLabel}</button>}
      <ResetButton scenario={usesScenario} />
      {children}
    </div>
  );
}
