// Vite build plugin: emits dist/sw.js from src/sw/sw.js with the precache lists injected.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface ChunkLike {
  type: 'chunk' | 'asset';
  fileName: string;
  isEntry?: boolean;
  imports?: string[];
  viteMetadata?: { importedCss?: Set<string> };
}

export function qgServiceWorker(): Plugin {
  return {
    name: 'qg-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const src = readFileSync(join(root, 'src', 'sw', 'sw.js'), 'utf8');
      const items = Object.values(bundle) as unknown as ChunkLike[];
      const byName = new Map(items.map((c) => [c.fileName, c]));

      // Shell = entry chunks + their static imports (transitively) + the CSS they reference.
      const shell = new Set<string>(['/', '/index.html', '/manifest.webmanifest', '/theme-init.js']);
      const visit = (name: string) => {
        const url = '/' + name;
        if (shell.has(url)) return;
        shell.add(url);
        const c = byName.get(name);
        if (!c || c.type !== 'chunk') return;
        c.viteMetadata?.importedCss?.forEach((css) => shell.add('/' + css));
        (c.imports || []).forEach(visit);
      };
      items.filter((c) => c.type === 'chunk' && c.isEntry).forEach((c) => visit(c.fileName));

      const iconsDir = join(root, 'public', 'icons');
      if (existsSync(iconsDir)) {
        for (const f of readdirSync(iconsDir)) if (/\.(png|svg)$/.test(f)) shell.add('/icons/' + f);
      }

      const lazy = items
        .map((c) => c.fileName)
        .filter((f) => /\.(js|css|woff2)$/.test(f) && !shell.has('/' + f) && f !== 'sw.js')
        .map((f) => '/' + f)
        .sort();

      const version = createHash('sha256')
        .update(items.map((c) => c.fileName).sort().join('\n'))
        .update(src)
        .digest('hex')
        .slice(0, 12);

      for (const name of ['SHELL', 'LAZY', 'VERSION']) {
        if (!new RegExp(`^const ${name} = .*;$`, 'm').test(src)) throw new Error(`sw.js: placeholder line for ${name} not found`);
      }
      const inject = (_re: RegExp, decl: string) => decl;
      const code = src
        .replace(/^const SHELL = .*;$/m, () => inject(/^const SHELL = .*;$/m, `const SHELL = ${JSON.stringify([...shell].sort())};`))
        .replace(/^const LAZY = .*;$/m, () => inject(/^const LAZY = .*;$/m, `const LAZY = ${JSON.stringify(lazy)};`))
        .replace(/^const VERSION = .*;$/m, () => inject(/^const VERSION = .*;$/m, `const VERSION = ${JSON.stringify(version)};`));

      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}
