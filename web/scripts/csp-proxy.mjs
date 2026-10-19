#!/usr/bin/env node
/**
 * Local server that ENFORCES the production Content-Security-Policy (deploy/Caddyfile) so browser test
 * suites can prove the app runs with zero violations.
 *
 *   node scripts/csp-proxy.mjs [--dist DIR] [--port 8788] [--api http://127.0.0.1:8777]
 *
 * Static files are served from --dist (SPA fallback to index.html; sw.js and index.html no-cache); /api/* is
 * proxied to --api. When the API is unreachable the client socket is destroyed (a genuine network error,
 * as when a server is down) rather than answering 502, so offline handling is exercised faithfully.
 * Without --dist everything is proxied to --api (which serves web/dist itself).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', 8788));
const API = new URL(arg('--api', 'http://127.0.0.1:8777'));
const DIST = arg('--dist', null);
// while this file exists the API is treated as down (sockets destroyed) — lets offline tests run without
// stopping a shared backend
const DOWN_FLAG = arg('--down-flag', '/tmp/qg-csp-proxy-api-down');
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

function proxy(req, res) {
  if (fs.existsSync(DOWN_FLAG)) { req.socket.destroy(); return; }
  const up = http.request({ hostname: API.hostname, port: API.port, path: req.url, method: req.method, headers: { ...req.headers, host: API.host } }, (r) => {
    const h = { ...r.headers, 'content-security-policy': CSP };
    res.writeHead(r.statusCode ?? 502, h);
    r.pipe(res);
  });
  up.on('error', () => { req.socket.destroy(); }); // network failure, not a 502
  req.pipe(up);
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!DIST || u.pathname.startsWith('/api/')) return proxy(req, res);
  let p = path.join(DIST, decodeURIComponent(u.pathname));
  if (!p.startsWith(path.resolve(DIST)) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  const ext = path.extname(p);
  const nocache = /index\.html$|sw\.js$/.test(p);
  res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': nocache ? 'no-cache' : 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`CSP-enforcing server on http://127.0.0.1:${PORT} (dist: ${DIST ?? 'proxied'}, api: ${API.origin})`));
