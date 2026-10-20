// Generates the QG-DEVS icon set (SVG + PNG) and the web app manifest without external dependencies.
// PNGs are rasterised procedurally from the same analytic shapes as the SVG (4×4 supersampling).
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');
const out = join(pub, 'icons');
mkdirSync(out, { recursive: true });

const BG = [27, 31, 75]; // #1b1f4b
const BG2 = [15, 18, 38]; // #0f1226
const A = [86, 180, 233]; // sphere A (sky blue)
const B = [230, 159, 0]; // sphere B (orange)
const LINE = [200, 208, 255];

// Geometry in unit coordinates (content box 0..1).
const SHAPES = {
  sphereA: { x: 0.3, y: 0.5, r: 0.105 },
  sphereB: { x: 0.7, y: 0.5, r: 0.105 },
  ghostDy: 0.2,
  ghostR: 0.075,
  arcs: [ // circles through both sphere centres; drawn only between them
    { cy: 0.5 + 0.32, w: 0.017, a: 0.85 },
    { cy: 0.5 - 0.32, w: 0.017, a: 0.85 },
    { cy: 0.5 + 0.1, w: 0.013, a: 0.5 },
    { cy: 0.5 - 0.1, w: 0.013, a: 0.5 },
  ],
};

const MANIFEST = {
  name: 'QG-DEVS',
  short_name: 'QG-DEVS',
  description: 'Quantum Gravity Discovery and Experimental Verification System',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#0f1226',
  theme_color: '#1b1f4b',
  categories: ['science', 'education', 'productivity'],
  icons: [
    { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

// ------------------------------------------------------------------ stamp check
const self = readFileSync(fileURLToPath(import.meta.url));
const hash = createHash('sha256').update(self).digest('hex').slice(0, 16);
const files = ['icon.svg', 'maskable.svg', 'icon-192.png', 'icon-512.png', 'maskable-192.png', 'maskable-512.png',
  'apple-touch-icon-180.png', 'favicon-32.png'];
const stampPath = join(out, '.stamp');
if (existsSync(stampPath) && readFileSync(stampPath, 'utf8').trim() === hash &&
    files.every((f) => existsSync(join(out, f))) && existsSync(join(pub, 'manifest.webmanifest'))) {
  console.log('icons: up to date');
  process.exit(0);
}

// ------------------------------------------------------------------ SVG
function svgContent(s, off) {
  const { sphereA: a, sphereB: b } = SHAPES;
  const X = (v) => (off + v * s).toFixed(2);
  const L = (v) => (v * s).toFixed(2);
  const parts = [];
  const half = (b.x - a.x) / 2;
  for (const arc of SHAPES.arcs) {
    const dy = arc.cy - 0.5;
    const r = Math.sqrt(half * half + dy * dy);
    const sweep = dy > 0 ? 1 : 0;
    parts.push(`<path d="M${X(a.x)} ${X(a.y)} A${L(r)} ${L(r)} 0 0 ${sweep} ${X(b.x)} ${X(b.y)}" fill="none" stroke="rgb(${LINE})" stroke-opacity="${arc.a}" stroke-width="${L(arc.w * 2)}"/>`);
  }
  for (const [sp, col] of [[a, A], [b, B]]) {
    for (const sg of [-1, 1]) {
      parts.push(`<circle cx="${X(sp.x)}" cy="${X(sp.y + sg * SHAPES.ghostDy)}" r="${L(SHAPES.ghostR)}" fill="rgb(${col})" fill-opacity="0.32"/>`);
    }
    parts.push(`<circle cx="${X(sp.x)}" cy="${X(sp.y)}" r="${L(sp.r)}" fill="rgb(${col})"/>`);
  }
  return parts.join('');
}

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><title>QG-DEVS</title>` +
  `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${BG})"/><stop offset="1" stop-color="rgb(${BG2})"/></linearGradient></defs>` +
  `<rect x="0" y="0" width="512" height="512" rx="112" fill="url(#g)"/>` + svgContent(512 * 0.84, 512 * 0.08) + `</svg>\n`;
const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><title>QG-DEVS</title>` +
  `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(${BG})"/><stop offset="1" stop-color="rgb(${BG2})"/></linearGradient></defs>` +
  `<rect x="0" y="0" width="512" height="512" fill="url(#g)"/>` + svgContent(512 * 0.64, 512 * 0.18) + `</svg>\n`;

// ------------------------------------------------------------------ raster
function blend(dst, col, a) {
  dst[0] += (col[0] - dst[0]) * a;
  dst[1] += (col[1] - dst[1]) * a;
  dst[2] += (col[2] - dst[2]) * a;
}

function sample(u, v, mode) {
  // Returns [r,g,b,a] for unit-square coordinates (u,v) of the full icon.
  let alpha = 1;
  if (mode === 'rounded') {
    const rr = 112 / 512;
    const cx = Math.min(Math.max(u, rr), 1 - rr);
    const cy = Math.min(Math.max(v, rr), 1 - rr);
    if ((u - cx) ** 2 + (v - cy) ** 2 > rr * rr) alpha = 0;
  }
  if (alpha === 0) return [0, 0, 0, 0];
  const c = [BG[0] + (BG2[0] - BG[0]) * v, BG[1] + (BG2[1] - BG[1]) * v, BG[2] + (BG2[2] - BG[2]) * v];
  const scale = mode === 'rounded' ? 0.84 : 0.64;
  const off = mode === 'rounded' ? 0.08 : 0.18;
  const x = (u - off) / scale;
  const y = (v - off) / scale;
  const { sphereA: a, sphereB: b } = SHAPES;
  const half = (b.x - a.x) / 2;
  for (const arc of SHAPES.arcs) {
    if (x < a.x || x > b.x) continue;
    const dy = arc.cy - 0.5;
    const r = Math.sqrt(half * half + dy * dy);
    const d = Math.abs(Math.hypot(x - 0.5, y - arc.cy) - r);
    if (d <= arc.w && (dy > 0 ? y < arc.cy : y > arc.cy)) blend(c, LINE, arc.a);
  }
  for (const [sp, col] of [[a, A], [b, B]]) {
    for (const sg of [-1, 1]) {
      if (Math.hypot(x - sp.x, y - sp.y - sg * SHAPES.ghostDy) <= SHAPES.ghostR) blend(c, col, 0.32);
    }
    if (Math.hypot(x - sp.x, y - sp.y) <= sp.r) blend(c, col, 1);
  }
  return [c[0], c[1], c[2], 255];
}

function raster(size, mode) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, bl = 0, al = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const s = sample((i + (si + 0.5) / ss) / size, (j + (sj + 0.5) / ss) / size, mode);
          const w = s[3] / 255;
          r += s[0] * w; g += s[1] * w; bl += s[2] * w; al += w;
        }
      }
      const k = (j * size + i) * 4;
      const n = ss * ss;
      px[k] = al ? Math.round(r / al) : 0;
      px[k + 1] = al ? Math.round(g / al) : 0;
      px[k + 2] = al ? Math.round(bl / al) : 0;
      px[k + 3] = Math.round((al / n) * 255);
    }
  }
  return encodePNG(size, size, px);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(out, 'icon.svg'), iconSvg);
writeFileSync(join(out, 'maskable.svg'), maskSvg);
writeFileSync(join(out, 'icon-192.png'), raster(192, 'rounded'));
writeFileSync(join(out, 'icon-512.png'), raster(512, 'rounded'));
writeFileSync(join(out, 'maskable-192.png'), raster(192, 'full'));
writeFileSync(join(out, 'maskable-512.png'), raster(512, 'full'));
writeFileSync(join(out, 'apple-touch-icon-180.png'), raster(180, 'full'));
writeFileSync(join(out, 'favicon-32.png'), raster(32, 'rounded'));
writeFileSync(join(pub, 'manifest.webmanifest'), JSON.stringify(MANIFEST, null, 2) + '\n');
writeFileSync(stampPath, hash + '\n');
console.log('icons: generated', files.join(', '));
