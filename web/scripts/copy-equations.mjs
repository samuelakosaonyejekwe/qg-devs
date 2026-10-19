#!/usr/bin/env node
/**
 * Bundles a build-time copy of the backend's LaTeX equations (qgdevs/equations.py, served live at
 * GET /api/equations) so the "Governing equations" cards and the KaTeX tests work offline.
 * Uses the project's Python environment; if it is unavailable the previous copy is kept.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dst = path.resolve(here, '../src/generated/equations.json');
fs.mkdirSync(path.dirname(dst), { recursive: true });
const py = [path.join(root, '.venv/bin/python'), 'python3'].find((p) => p === 'python3' || fs.existsSync(p));
try {
  const out = execFileSync(py, ['-c', 'import json; from qgdevs.equations import SUITE_TEX, MODEL_TEX, PROTOCOL_TEX; print(json.dumps({"suites": SUITE_TEX, "models": MODEL_TEX, "protocol": PROTOCOL_TEX}))'], { cwd: root, encoding: 'utf8' });
  const data = JSON.parse(out);
  fs.writeFileSync(dst, JSON.stringify(data, null, 1) + '\n');
  const n = Object.values(data.suites).flat().length + Object.values(data.models).flatMap((m) => Object.values(m).flat()).length + Object.keys(data.protocol).length;
  console.log(`equations: ${n} → ${path.relative(process.cwd(), dst)}`);
} catch (e) {
  if (fs.existsSync(dst)) console.warn(`equations not refreshed (${e.message.split('\n')[0]}); keeping the existing bundled copy`);
  else { fs.writeFileSync(dst, JSON.stringify({ suites: {}, models: {}, protocol: {} }) + '\n'); console.warn('equations unavailable; bundled an empty set'); }
}
