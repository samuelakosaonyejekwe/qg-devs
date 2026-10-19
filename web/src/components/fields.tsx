import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState, useCallback } from 'preact/hooks';
import { Tip } from './ui';
import { UNIT_CHOICES, autoUnit, fmtQ } from '../lib/format';
import { parseNumber, toDisplay, toSI, fmtInput } from '../lib/numparse';
import { useStore, settings, atLeast, type Mode } from '../lib/store';

/** Collects the validity of all fields in a form so the run button can be disabled while any is invalid. */
export function useValidity() {
  const [bad, setBad] = useState<Record<string, string>>({});
  const report = useCallback((name: string, err: string | null) => {
    setBad((b) => {
      if (err == null) { if (!(name in b)) return b; const { [name]: _, ...rest } = b; return rest; }
      if (b[name] === err) return b;
      return { ...b, [name]: err };
    });
  }, []);
  return { invalid: bad, ok: Object.keys(bad).length === 0, report };
}

export interface NumberFieldProps {
  name: string; label: string; value: number; onChange: (si: number) => void; unit: string;
  min?: number; max?: number; minExclusive?: boolean; maxExclusive?: boolean; integer?: boolean;
  help: ComponentChildren; level?: Mode; report?: (name: string, err: string | null) => void; hint?: ComponentChildren; disabled?: boolean;
  unitChoices?: [string, number][]; // overrides the default choices for `unit`
}

function rangeText(p: NumberFieldProps): string {
  const u = p.unit;
  const lo = p.min != null ? `${fmtQ(p.min, u, 3)} ${p.minExclusive ? '<' : '≤'} ` : '';
  const hi = p.max != null ? ` ${p.maxExclusive ? '<' : '≤'} ${fmtQ(p.max, u, 3)}` : '';
  return lo || hi ? `${lo}x${hi}` : '';
}

/** Numeric input: value held in SI, shown in a selectable display unit, validated against the admissible range. */
export function NumberField(p: NumberFieldProps) {
  const s = useStore(settings);
  const id = useId();
  const choices = p.unitChoices ?? UNIT_CHOICES[p.unit];
  const [du, setDu] = useState<[string, number]>(() => (choices ? autoUnit(p.value, p.unit) : [p.unit, 1]));
  const [text, setText] = useState(() => fmtInput(toDisplay(p.value, du[1])));
  const [err, setErr] = useState<string | null>(null);
  const lastSI = useRef(p.value);
  useEffect(() => {
    if (p.value !== lastSI.current) { lastSI.current = p.value; setText(fmtInput(toDisplay(p.value, du[1]))); setErr(null); p.report?.(p.name, null); }
  }, [p.value]);
  useEffect(() => () => p.report?.(p.name, null), []);
  const visible = !p.level || atLeast(s.mode, p.level);
  // A field hidden by the detail level must not keep blocking Run with an error the user cannot see:
  // discard the invalid draft and show the stored (valid) value again when it reappears.
  useEffect(() => {
    if (!visible && err) { setErr(null); setText(fmtInput(toDisplay(p.value, du[1]))); p.report?.(p.name, null); }
  }, [visible]);

  const validate = (si: number): string | null => {
    if (!Number.isFinite(si)) return 'Enter a finite number.';
    if (p.integer && !Number.isInteger(si)) return 'Must be an integer.';
    if (p.min != null && (p.minExclusive ? si <= p.min : si < p.min)) return `Must be ${p.minExclusive ? '>' : '≥'} ${fmtQ(p.min, p.unit, 3)}.`;
    if (p.max != null && (p.maxExclusive ? si >= p.max : si > p.max)) return `Must be ${p.maxExclusive ? '<' : '≤'} ${fmtQ(p.max, p.unit, 3)}.`;
    return null;
  };
  const commit = (t: string, f = du[1]) => {
    setText(t);
    const parsed = parseNumber(t);
    const si = parsed.ok ? toSI(parsed.value, f) : NaN;
    const e = parsed.ok ? validate(si) : parsed.error;
    setErr(e);
    p.report?.(p.name, e);
    if (!e) { lastSI.current = si; p.onChange(si); }
  };
  if (!visible) return null;
  const rt = rangeText(p);
  return (
    <div class={`field ${err ? 'invalid' : ''}`}>
      <label class="field-label" for={id}>{p.label} <Tip text={<>{p.help}{rt && <><br /><br />Admissible range: {rt}</>}</>} label={`About ${p.label}`} /></label>
      <div class="field-input">
        <input id={id} inputMode="decimal" autoComplete="off" spellcheck={false} value={text} disabled={p.disabled}
          aria-invalid={!!err} aria-describedby={`${id}-msg`} onInput={(e: any) => commit(e.currentTarget.value)} />
        {choices ? (
          <select class="unit" aria-label={`${p.label} unit`} value={du[0]} disabled={p.disabled} onChange={(e: any) => {
            const c = choices.find((x) => x[0] === e.currentTarget.value)!;
            setDu(c);
            if (!err) setText(fmtInput(toDisplay(p.value, c[1])));
          }}>{choices.map((c) => <option value={c[0]}>{c[0]}</option>)}</select>
        ) : p.unit && p.unit !== '1' ? <span class="field-range" style={{ alignSelf: 'center', paddingLeft: '4px' }}>{p.unit}</span> : null}
      </div>
      <div id={`${id}-msg`} aria-live="polite">
        {err ? <div class="field-error">{err}</div> : (p.hint ? <div class="field-hint">{p.hint}</div> : rt ? <div class="field-hint">{rt}</div> : null)}
      </div>
    </div>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, help, level }: { label: string; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; help: ComponentChildren; level?: Mode }) {
  const s = useStore(settings);
  const id = useId();
  if (level && !atLeast(s.mode, level)) return null;
  return (
    <div class="field">
      <label class="field-label" for={id}>{label} <Tip text={help} label={`About ${label}`} /></label>
      <div class="field-input"><select id={id} value={value} onChange={(e: any) => onChange(e.currentTarget.value)}>{options.map((o) => <option value={o.v}>{o.label}</option>)}</select></div>
    </div>
  );
}

export function TextField({ label, value, onChange, help, placeholder, required, multiline }: { label: string; value: string; onChange: (v: string) => void; help?: ComponentChildren; placeholder?: string; required?: boolean; multiline?: boolean }) {
  const id = useId();
  const err = required && !value.trim() ? 'Required.' : null;
  return (
    <div class={`field ${err ? 'invalid' : ''}`}>
      <label class="field-label" for={id}>{label} {help && <Tip text={help} label={`About ${label}`} />}</label>
      {multiline
        ? <textarea id={id} class="input" value={value} placeholder={placeholder} aria-invalid={!!err} onInput={(e: any) => onChange(e.currentTarget.value)} />
        : <div class="field-input"><input id={id} value={value} placeholder={placeholder} aria-invalid={!!err} onInput={(e: any) => onChange(e.currentTarget.value)} /></div>}
      {err && <div class="field-error">{err}</div>}
    </div>
  );
}
