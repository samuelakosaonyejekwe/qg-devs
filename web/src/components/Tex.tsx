/**
 * Typeset mathematics with KaTeX.
 *
 * KaTeX and its stylesheet/fonts are loaded lazily (own chunk; fonts are emitted into the build, no CDN),
 * so pages without equations never pay for them. Output is HTML + MathML, so screen readers read the
 * MathML. Until KaTeX has loaded — or if a formula fails to parse — the LaTeX source is shown as plain
 * text, never a blank.
 *
 *   <Tex tex="\Delta\varphi = \varphi_{LL} + \varphi_{RR} - \varphi_{LR} - \varphi_{RL}" display />
 *   <MathText text="Phases grow as $\varphi_{ij} = -U_{ij} t/\hbar$." />
 */
import { useEffect, useState } from 'preact/hooks';

type Katex = typeof import('katex');
let katexMod: Katex | null = null;
let loading: Promise<Katex> | null = null;

export function loadKatex(): Promise<Katex> {
  if (katexMod) return Promise.resolve(katexMod);
  if (!loading) {
    loading = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => {
      katexMod = ((m as any).default ?? m) as Katex;
      return katexMod;
    });
  }
  return loading;
}

const cache = new Map<string, string>();

export function renderTex(k: Katex, tex: string, display: boolean): string | null {
  const key = `${display ? 'D' : 'I'}${tex}`;
  const hit = cache.get(key);
  if (hit != null) return hit;
  try {
    const html = k.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore', output: 'htmlAndMathml', trust: false });
    cache.set(key, html);
    return html;
  } catch {
    return null;
  }
}

function useKatex(): Katex | null {
  const [k, setK] = useState<Katex | null>(katexMod);
  useEffect(() => { if (!k) loadKatex().then(setK).catch(() => undefined); }, []);
  return k;
}

/** One formula. `alt` is a plain-text rendering used as tooltip (e.g. the backend's plain-text form). */
export function Tex({ tex, display = false, alt, class: cls }: { tex: string; display?: boolean; alt?: string; class?: string }) {
  const k = useKatex();
  const html = k ? renderTex(k, tex, display) : null;
  const Tag = display ? 'div' : 'span';
  if (html == null) {
    return <Tag class={`tex tex-src ${display ? 'tex-display' : ''} ${cls ?? ''}`} title={alt} aria-busy={!k}>{tex}</Tag>;
  }
  return <Tag class={`tex ${display ? 'tex-display' : ''} ${cls ?? ''}`} title={alt} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Split text on $…$ (inline) and $$…$$ (display) delimiters; `\$` is a literal dollar sign. */
export function splitMath(text: string): { kind: 'text' | 'inline' | 'display'; s: string }[] {
  const ESC = '\u0000';
  const src = text.replace(/\\\$/g, ESC); // protect literal \$ (no regex look-behind: older Safari)
  const out: { kind: 'text' | 'inline' | 'display'; s: string }[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
  const un = (x: string) => x.split(ESC).join('$');
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ kind: 'text', s: un(src.slice(last, m.index)) });
    out.push(m[1] != null ? { kind: 'display', s: un(m[1]) } : { kind: 'inline', s: un(m[2]) });
    last = re.lastIndex;
  }
  if (last < src.length) out.push({ kind: 'text', s: un(src.slice(last)) });
  return out;
}

/** Prose with embedded $…$ maths. */
export function MathText({ text }: { text: string }) {
  const parts = splitMath(text);
  if (parts.length === 1 && parts[0].kind === 'text') return <>{text}</>;
  return <>{parts.map((p) => (p.kind === 'text' ? p.s : <Tex tex={p.s} display={p.kind === 'display'} />))}</>;
}
