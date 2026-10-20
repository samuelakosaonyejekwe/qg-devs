import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { qgServiceWorker } from './scripts/sw-plugin';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// API proxy target for `npm run dev` (the FastAPI server). Override with QG_API_PROXY.
const proxyTarget = process.env.QG_API_PROXY || 'http://127.0.0.1:8777';

// Deployment base: "/" when served by the API server, "/qg-devs/" on GitHub Pages (VITE_BASE).
const base = (process.env.VITE_BASE || '/').replace(/\/?$/, '/');
// A build whose API lives on another origin (GitHub Pages) carries its CSP as a <meta> tag, because static hosting
// cannot send headers. Same policy as deploy/Caddyfile, with connect-src extended to the API origin;
// frame-ancestors is not allowed in <meta> and is therefore omitted.
const apiBase = process.env.VITE_API_BASE || '';
const apiOrigin = /^https?:\/\//.test(apiBase) ? new URL(apiBase).origin : '';
const metaCsp = apiOrigin
  ? `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${apiOrigin}; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'`
  : '';
const cspMeta = {
  name: 'qg-meta-csp',
  transformIndexHtml(html: string) {
    return metaCsp ? html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${metaCsp}" />`) : html;
  },
};

export default defineConfig({
  base,
  plugins: [preact(), cspMeta, qgServiceWorker()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // diagnostic builds (gpu-perf local_build): readable stack traces
    minify: process.env.QG_NO_MINIFY ? false : 'esbuild',
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 700,
  },
  worker: { format: 'es' },
  server: { proxy: { '/api': { target: proxyTarget, changeOrigin: true } } },
  preview: { proxy: { '/api': { target: proxyTarget, changeOrigin: true } } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any);
