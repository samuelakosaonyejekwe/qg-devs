/**
 * Deployment base path (Vite `base`, from VITE_BASE): "/" on the API server, "/qg-devs/" on GitHub Pages.
 * App routes ("/suite/lab") are always written without the base; these helpers map between app paths and
 * real URLs so links, history entries, deep-link reloads and the service worker work under any base.
 */
const raw = ((import.meta as any).env?.BASE_URL as string | undefined) || '/';
export const BASE: string = raw.endsWith('/') ? raw : `${raw}/`;

/** Real pathname → app path. */
export function toApp(pathname: string): string {
  if (BASE === '/') return pathname || '/';
  if (pathname === BASE.slice(0, -1)) return '/';
  return pathname.startsWith(BASE) ? `/${pathname.slice(BASE.length)}` : pathname;
}

/** App path (or root-relative public asset path) → real URL path under the base. */
export function toUrl(appPath: string): string {
  if (BASE === '/' || !appPath.startsWith('/') || appPath.startsWith('//') || appPath.startsWith(BASE)) return appPath;
  return BASE + appPath.slice(1);
}

/** Keep root-relative links/images inside the base when the app is served under a sub-path. */
export function installBaseRewriter(root: Node = document) {
  if (BASE === '/' || typeof MutationObserver === 'undefined') return;
  const fix = (el: Element) => {
    for (const attr of ['href', 'src']) {
      const v = el.getAttribute(attr);
      if (v && v.startsWith('/') && !v.startsWith('//') && !v.startsWith(BASE) && !v.startsWith('/api/')) el.setAttribute(attr, toUrl(v));
    }
  };
  const scan = (n: Node) => {
    if (n.nodeType !== 1) return;
    const e = n as Element;
    if (e.matches('a[href], img[src], link[href]')) fix(e);
    e.querySelectorAll('a[href], img[src], link[href]').forEach(fix);
  };
  scan(document.documentElement);
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'attributes') fix(m.target as Element);
      m.addedNodes.forEach(scan);
    }
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'src'] });
}
