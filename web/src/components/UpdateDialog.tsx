/**
 * "Update available" and "What's new" dialogs.
 *
 * - Update available: shown when the service worker reports a waiting (new) version. "Update now" activates
 *   it and reloads on the same route; "Later" closes the dialog and leaves an "Update ready" chip in the
 *   header. On the next launch a still-waiting worker triggers the dialog again (main.tsx re-announces it).
 * - What's new: shown once after the running version changes (compared with localStorage
 *   'qg.lastSeenVersion'); never on a first-ever visit. Also openable at any time (header, Help).
 * Release notes come from GET /api/release; when that is unreachable the notes bundled at build time are used.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { createStore, useStore } from '../lib/store';
import { apiGet } from '../lib/api';
import { compareVersions, decideWhatsNew, readLastSeen, releasesBetween, writeLastSeen, type Release } from '../lib/version';
import bundled from '../generated/release-notes.json';

export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

interface Waiting { postMessage(msg: unknown): void }
interface UpdateState {
  open: null | 'update' | 'whatsnew';
  waiting: Waiting | null;     // the new service worker awaiting activation
  updateReady: boolean;        // "Later" was chosen: keep the header chip until applied
  whatsNewSince: string | null; // last-seen version for the What's new list (null = full history)
}
export const updateState = createStore<UpdateState>({ open: null, waiting: null, updateReady: false, whatsNewSince: null });

const BUNDLED: Release[] = ((bundled as { releases?: Release[] }).releases ?? []).slice();

/** Release notes from the server (fresh), else the bundled copy. */
async function loadNotes(): Promise<{ version: string | null; releases: Release[]; source: 'server' | 'bundled' }> {
  try {
    const r = await apiGet<{ version: string; releases: Release[] }>('/api/release', undefined, { noCache: true });
    if (Array.isArray(r.data?.releases)) return { version: r.data.version ?? null, releases: r.data.releases, source: 'server' };
  } catch { /* offline or older server: fall back */ }
  return { version: BUNDLED[0]?.version ?? null, releases: BUNDLED, source: 'bundled' };
}

/** Open the What's new dialog manually (full history up to the running version). */
export function openWhatsNew() {
  updateState.set({ open: 'whatsnew', whatsNewSince: null });
}

const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** Mounted once in the app shell. */
export function UpdateDialogHost() {
  const st = useStore(updateState);
  const [notes, setNotes] = useState<{ version: string | null; releases: Release[]; source: 'server' | 'bundled' } | null>(null);

  // SW reports a waiting version → Update-available dialog
  useEffect(() => {
    const onUpd = (e: Event) => {
      const w = (e as CustomEvent).detail as Waiting | null;
      if (w) updateState.set({ waiting: w, open: 'update' });
    };
    window.addEventListener('qg-sw-update', onUpd);
    return () => window.removeEventListener('qg-sw-update', onUpd);
  }, []);

  // after an update: What's new, once
  useEffect(() => {
    const last = readLastSeen();
    const d = decideWhatsNew(last, APP_VERSION);
    if (d === 'store-silently') writeLastSeen(APP_VERSION);
    else if (d === 'show') updateState.set({ open: 'whatsnew', whatsNewSince: last });
  }, []);

  useEffect(() => { if (st.open && !notes) loadNotes().then(setNotes); }, [st.open]);

  if (!st.open) return null;
  const close = () => {
    if (st.open === 'whatsnew') writeLastSeen(APP_VERSION);
    updateState.set({ open: null, updateReady: st.open === 'update' ? true : st.updateReady });
  };
  if (st.open === 'update') {
    const target = notes?.version ?? null;
    const rel = notes?.releases.find((r) => target && compareVersions(r.version, target) === 0) ?? notes?.releases[0] ?? null;
    return (
      <Modal title="Update available" titleId="upd-title" onClose={close}
        chip={<span class="upd-chip" aria-label={`Version ${APP_VERSION} to ${target && target !== APP_VERSION ? target : 'a new build'}`}>{APP_VERSION} <span aria-hidden="true">→</span> {target && target !== APP_VERSION ? target : `new build${target ? ` of ${target}` : ''}`}</span>}
        actions={<>
          <button type="button" class="btn" onClick={close}>Later</button>
          <button type="button" class="btn primary" data-update-now onClick={() => applyUpdate(st.waiting)}>Update now</button>
        </>}>
        <p class="muted small" style={{ margin: '0 0 8px' }}>A new version of QG-DEVS has been downloaded. Updating reloads this page and keeps your place; saved inputs and projects are kept.</p>
        {notes ? (rel ? <ReleaseBody r={rel} /> : <p class="small muted">No release notes are available for this version.</p>) : <p class="small muted"><span class="spinner" /> Loading release notes…</p>}
        {notes?.source === 'bundled' && <p class="small muted">Release notes shown from the copy bundled with the app (server unreachable).</p>}
      </Modal>
    );
  }
  const list = notes ? releasesBetween(notes.releases, st.whatsNewSince, APP_VERSION) : [];
  return (
    <Modal title={`What's new in ${APP_VERSION}`} titleId="whatsnew-title" onClose={close}
      chip={st.whatsNewSince ? <span class="upd-chip">{st.whatsNewSince} <span aria-hidden="true">→</span> {APP_VERSION}</span> : <span class="upd-chip">version {APP_VERSION}</span>}
      actions={<button type="button" class="btn primary" onClick={close}>Got it</button>}>
      {!notes && <p class="small muted"><span class="spinner" /> Loading release notes…</p>}
      {notes && list.length === 0 && <p class="small muted">No release notes are recorded for this version.</p>}
      {list.map((r, i) => (
        <section class="upd-release" aria-label={`Release ${r.version}`}>
          {(list.length > 1 || i > 0) && <h3 class="upd-ver">{r.version}{r.date ? <span class="muted small"> · {r.date}</span> : null}</h3>}
          <ReleaseBody r={r} />
        </section>
      ))}
      {notes?.source === 'bundled' && <p class="small muted">Shown from the release notes bundled with the app (server unreachable).</p>}
    </Modal>
  );
}

function applyUpdate(w: Waiting | null) {
  const here = location.pathname + location.search + location.hash;
  try { sessionStorage.setItem('qg.updateReturn', here); } catch { /* ignore */ }
  if (w) w.postMessage({ type: 'SKIP_WAITING' }); // main.tsx reloads on controllerchange (same URL)
  updateState.set({ open: null, updateReady: false });
  // If the new worker does not take control promptly, reload on the same route anyway.
  setTimeout(() => { location.replace(here); }, 4000);
}

function ReleaseBody({ r }: { r: Release }) {
  return (
    <div>
      <p class="upd-title">{r.title}</p>
      {r.highlights.length > 0 && (
        <ul class="upd-list" aria-label="Highlights">
          {r.highlights.map((h) => <li><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="var(--ok-soft)" stroke="var(--ok)" /><path d="m6 10.5 2.6 2.6L14 7.6" fill="none" stroke="var(--ok)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg><span>{h}</span></li>)}
        </ul>
      )}
      {r.fixes.length > 0 && (
        <details class="upd-fixes"><summary>Fixes ({r.fixes.length})</summary>
          <ul class="upd-list fixes">{r.fixes.map((f) => <li><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="var(--info-soft)" stroke="var(--info)" /><path d="M7 10h6" stroke="var(--info)" stroke-width="2" stroke-linecap="round" /></svg><span>{f}</span></li>)}</ul>
        </details>
      )}
    </div>
  );
}

/** Accessible modal: focus trap, Esc closes, focus returns to the previously focused element. */
function Modal({ title, titleId, chip, children, actions, onClose }: { title: string; titleId: string; chip?: preact.ComponentChildren; children: preact.ComponentChildren; actions: preact.ComponentChildren; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(card.current?.querySelectorAll<HTMLElement>('button, [href], summary, input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((e) => !e.hasAttribute('disabled'));
    (card.current?.querySelector<HTMLElement>('.btn.primary') ?? focusables()[0])?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables(); if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!card.current?.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key, true); document.body.style.overflow = prevOverflow; prev?.focus?.(); };
  }, []);
  return (
    <div class={`upd-backdrop ${reducedMotion() ? '' : 'anim'}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="upd-card" ref={card} role="dialog" aria-modal="true" aria-labelledby={titleId} data-update-dialog>
        <div class="upd-head">
          <img src="/icons/icon.svg" alt="" width="40" height="40" />
          <div><div class="upd-brand">QG-DEVS</div><h2 id={titleId}>{title}</h2></div>
          {chip}
        </div>
        <div class="upd-body">{children}</div>
        <div class="upd-actions">{actions}</div>
      </div>
    </div>
  );
}

/** Header chip shown after "Later" until the update is applied; reopens the dialog. */
export function UpdateReadyChip() {
  const st = useStore(updateState);
  if (!st.updateReady || st.open) return null;
  return <button type="button" class="hdr-btn upd-ready" data-update-ready onClick={() => updateState.set({ open: 'update' })} title="A new version is ready — click to review and update">● <span>Update ready</span></button>;
}

/** Header button opening the release notes at any time. */
export function WhatsNewButton() {
  return <button type="button" class="hdr-btn hide-sm" onClick={openWhatsNew} title="What's new in this version">What's new</button>;
}
