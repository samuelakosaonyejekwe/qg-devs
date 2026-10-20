#!/usr/bin/env node
/**
 * Serves a build like GitHub Pages does, for local testing of the Pages deployment:
 *   files under /<prefix>/ from --dist; unknown paths → 404.html with HTTP 404 (the SPA picks up the route);
 *   no CSP or other security headers (the Pages build carries its CSP in a <meta> tag).
 *
 *   node scripts/pages-serve.mjs --dist /path/to/dist --prefix /qg-devs/ --port 8790
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DIST = path.resolve(arg('--dist', 'dist'));
const PREFIX = arg('--prefix', '/qg-devs/');
const PORT = Number(arg('--port', 8790));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (!p.startsWith(PREFIX)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not under the Pages prefix'); return; }
  p = p.slice(PREFIX.length);
  let file = path.join(DIST, p);
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=600' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  const nf = path.join(DIST, '404.html');
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not found');
}).listen(PORT, '127.0.0.1', () => console.log(`pages-serve: http://127.0.0.1:${PORT}${PREFIX} ← ${DIST}`));
