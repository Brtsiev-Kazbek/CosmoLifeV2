import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Watchdogs for the project's iron rules.
 *
 * These are cheap and boring and they are the only thing standing between the codebase
 * and a slow drift back into non-determinism: one `Math.random` in a generator, or one
 * `import * as THREE` inside sim/, and the whole "same seed, same galaxy" contract is
 * gone — with no visible symptom until someone compares two machines.
 */

const SRC = join(__dirname, '../../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const rel = (p: string): string => p.slice(SRC.length + 1);

/**
 * Strip comments before scanning.
 *
 * The rules have to be nameable in prose — `rng.ts` explains *why* Math.random is banned
 * and would otherwise report itself. The `(?<!:)` guard keeps `https://` inside a string
 * from swallowing the rest of the line.
 */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(?<!:)\/\/.*$/gm, ' ');
}

describe('rule 1 — no Math.random anywhere', () => {
  it('finds none in src/', () => {
    const offenders = files.filter((f) => /Math\s*\.\s*random/.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('actually detects a violation when there is one', () => {
    // A watchdog nobody has seen fail is not a watchdog. This proves the regex fires.
    expect(/Math\s*\.\s*random/.test('const x = Math.random();')).toBe(true);
    expect(/Math\s*\.\s*random/.test(code(files[0]))).toBe(false);
  });
});

describe('rule 5 — one boundary with the renderer', () => {
  it('sim/ and procgen/ never import three.js', () => {
    const offenders = files
      .filter((f) => rel(f).startsWith('sim/') || rel(f).startsWith('procgen/'))
      .filter((f) => /from\s+['"]three/.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('sim/ and procgen/ never import from render/ except the mesh contract', () => {
    // MeshBuilder/meshData is a plain typed-array contract and is allowed; anything else
    // in render/ pulls in three transitively.
    const allowed = /from\s+['"].*render\/(meshBuilder|palette|geometry)['"]/;
    const offenders = files
      .filter((f) => rel(f).startsWith('sim/') || rel(f).startsWith('procgen/'))
      .filter((f) => {
        const src = code(f);
        const imports = src.match(/from\s+['"][^'"]*render\/[^'"]*['"]/g) ?? [];
        return imports.some((i) => !allowed.test(`from ${i.split('from')[1]}`));
      });
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('rule 3 — no wall clock inside the simulation', () => {
  it('sim/ never reads performance.now or Date.now', () => {
    const offenders = files
      .filter((f) => rel(f).startsWith('sim/'))
      .filter((f) => /(performance\s*\.\s*now|Date\s*\.\s*now|new\s+Date\s*\()/.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('rule 2 — no hidden iteration order', () => {
  it('src/ never uses for...in', () => {
    const offenders = files.filter((f) => /for\s*\([^)]*\sin\s/.test(code(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('the asset rule', () => {
  it('no binary asset files are committed under src/', () => {
    const bad: string[] = [];
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir).sort()) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) scan(p);
        else if (/\.(png|jpg|jpeg|gif|glb|gltf|fbx|obj|mp3|ogg|wav|ttf|woff2?)$/i.test(entry)) bad.push(p);
      }
    };
    scan(SRC);
    expect(bad).toEqual([]);
  });
});
