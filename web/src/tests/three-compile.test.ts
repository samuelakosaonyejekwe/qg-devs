import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Regression guard. Asynchronous shader compilation (three's compileAsync) polls programs over several frames;
// when a 3-D view was disposed meanwhile (fast navigation, Reset, data refresh) it read deleted programs and
// raised page errors on real GPUs ("Cannot read properties of null (reading 'trim')", "reading 'isReady'",
// "VALIDATE_STATUS false"). The stage must compile synchronously on first render.
describe('3-D stage shader compilation', () => {
  const src = readFileSync(fileURLToPath(new URL('../three/core.ts', import.meta.url)), 'utf8').replace(/\/\/.*$/gm, '');
  it('does not use asynchronous compilation that can outlive the scene', () => {
    expect(src).not.toMatch(/compileAsync\s*\(/);
  });
  it('renders the scene in the draw loop', () => {
    expect(src).toMatch(/renderer\.render\(scene, camera\)/);
  });
});
