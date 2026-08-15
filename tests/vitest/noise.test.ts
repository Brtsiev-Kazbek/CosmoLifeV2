import { describe, expect, it } from 'vitest';
import { Noise } from '../../src/lib/noise';
import { Rng } from '../../src/lib/rng';

const noise = new Noise(new Rng('terrain'));

describe('Noise', () => {
  it('reproduces from the same seed', () => {
    const a = new Noise(new Rng('terrain'));
    const b = new Noise(new Rng('terrain'));
    for (let i = 0; i < 500; i++) {
      const x = i * 0.31;
      expect(a.noise3(x, x * 0.7, x * 1.3)).toBe(b.noise3(x, x * 0.7, x * 1.3));
    }
  });

  it('differs between seeds', () => {
    const a = new Noise(new Rng('terrain'));
    const b = new Noise(new Rng('terrain-2'));
    let same = 0;
    for (let i = 0; i < 200; i++) if (a.noise3(i * 0.7, 1.1, 2.3) === b.noise3(i * 0.7, 1.1, 2.3)) same++;
    expect(same).toBeLessThan(5);
  });

  it('stays inside [-1, 1]', () => {
    const r = new Rng(3);
    for (let i = 0; i < 20000; i++) {
      const v = noise.noise3(r.range(-500, 500), r.range(-500, 500), r.range(-500, 500));
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous — no cliffs between neighbouring samples', () => {
    // Terrain reads this at metre spacing; a discontinuity here is a wall the ship hits.
    const step = 1e-3;
    let worst = 0;
    const r = new Rng(17);
    for (let i = 0; i < 20000; i++) {
      const x = r.range(-200, 200);
      const y = r.range(-200, 200);
      const z = r.range(-200, 200);
      const d = Math.abs(noise.noise3(x + step, y, z) - noise.noise3(x, y, z));
      if (d > worst) worst = d;
    }
    // Perlin's gradient magnitude is bounded; over 1e-3 the jump must stay tiny.
    expect(worst).toBeLessThan(0.01);
  });

  it('is zero on the integer lattice, as Perlin must be', () => {
    for (let i = -4; i <= 4; i++) expect(Math.abs(noise.noise3(i, i + 1, i - 2))).toBeLessThan(1e-12);
  });

  it('fbm keeps its range regardless of octave count', () => {
    // Otherwise a quality preset with more octaves would build taller mountains, and the
    // same planet would have different geography on different machines.
    const r = new Rng(5);
    for (const octaves of [1, 3, 5, 8]) {
      let peak = 0;
      for (let i = 0; i < 5000; i++) {
        const v = noise.fbm3(r.range(-100, 100), r.range(-100, 100), r.range(-100, 100), octaves);
        peak = Math.max(peak, Math.abs(v));
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(peak).toBeGreaterThan(0.2);
    }
  });

  it('ridged and billow stay in range', () => {
    const r = new Rng(23);
    for (let i = 0; i < 5000; i++) {
      const x = r.range(-100, 100);
      const y = r.range(-100, 100);
      const z = r.range(-100, 100);
      expect(Math.abs(noise.ridged3(x, y, z))).toBeLessThanOrEqual(1);
      expect(Math.abs(noise.billow3(x, y, z))).toBeLessThanOrEqual(1);
    }
  });
});
