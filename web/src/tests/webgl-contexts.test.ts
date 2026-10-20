/**
 * Regression: the graphics test called a WebGL probe while rendering, creating a new WebGL context on every
 * animation frame (≈170 per 8-second test). Browsers keep only ~16 contexts per page, so the live 3-D view was
 * force-lost, and on real GPUs the burst made the browser reset the GPU and block WebGL for the page — which
 * surfaced as "Cannot read properties of null (reading 'trim')" (three reading a program log on a lost
 * context), "VALIDATE_STATUS false" shader errors and missing 3-D views.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('WebGL capability probe', () => {
  it('creates at most one context per page load and releases it', async () => {
    let created = 0, released = 0;
    const gl = {
      RENDERER: 0x1f01,
      getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext: () => { released++; } } : n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null),
      getParameter: (p: number) => (p === 0x9246 ? 'Test GPU' : 'generic'),
    };
    vi.stubGlobal('document', { createElement: () => ({ getContext: (t: string) => (/webgl/.test(t) ? (created++, gl) : null) }) });
    vi.resetModules();
    const { webglAvailable, webglRenderer } = await import('../three/detect');
    for (let i = 0; i < 500; i++) { expect(webglAvailable()).toBe(true); expect(webglRenderer()).toBe('Test GPU'); }
    expect(created).toBe(1);
    expect(released).toBe(1);
    vi.unstubAllGlobals();
  });

  it('no component or page creates WebGL contexts directly (only the cached probe and the 3-D stage)', () => {
    const root = path.resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f.name) && !/\.test\.ts$/.test(f.name) && !p.endsWith(path.join('three', 'detect.ts'))) {
          if (/getContext\(\s*['"](webgl2?|experimental-webgl)['"]/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(root, p));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
