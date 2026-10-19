import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { qgServiceWorker } from './scripts/sw-plugin';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// API proxy target for `npm run dev` (the FastAPI server). Override with QG_API_PROXY.
const proxyTarget = process.env.QG_API_PROXY || 'http://127.0.0.1:8777';

export default defineConfig({
  plugins: [preact(), qgServiceWorker()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 700,
  },
  worker: { format: 'es' },
  server: { proxy: { '/api': { target: proxyTarget, changeOrigin: true } } },
  preview: { proxy: { '/api': { target: proxyTarget, changeOrigin: true } } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any);
