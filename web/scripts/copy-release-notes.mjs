#!/usr/bin/env node
/** Copies the backend release notes into the bundle so the update / "What's new" dialogs work offline. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../qgdevs/release_notes.json');
const dst = path.resolve(here, '../src/generated/release-notes.json');
fs.mkdirSync(path.dirname(dst), { recursive: true });
let data;
try {
  data = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (!Array.isArray(data.releases)) throw new Error('missing "releases" array');
} catch (e) {
  console.warn(`release notes not copied (${e.message}); bundling an empty list`);
  data = { releases: [] };
}
fs.writeFileSync(dst, JSON.stringify(data, null, 2) + '\n');
console.log(`release notes: ${data.releases.length} release(s) → ${path.relative(process.cwd(), dst)}`);
