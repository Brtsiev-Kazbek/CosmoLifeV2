import { describe, expect, it } from 'vitest';
import { Rng, streamFor } from '../../src/lib/rng';

describe('Rng — MRG32k3a', () => {
  it('gives the same sequence for the same seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 1000; i++) expect(a.float()).toBe(b.float());
  });

  it('gives different sequences for adjacent seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 200; i++) if (a.float() === b.float()) same++;
    expect(same).toBe(0);
  });

  it('accepts string seeds', () => {
    expect(new Rng('cosmolife').float()).toBe(new Rng('cosmolife').float());
    expect(new Rng('cosmolife').float()).not.toBe(new Rng('cosmolyfe').float());
  });

  it('stays strictly inside (0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 200000; i++) {
      const v = r.float();
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is uniform enough for procgen (chi-square over 16 buckets)', () => {
    const r = new Rng(99);
    const buckets = new Array(16).fill(0);
    const n = 160000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r.float() * 16)]++;
    const expected = n / 16;
    let chi2 = 0;
    for (const b of buckets) chi2 += ((b - expected) ** 2) / expected;
    // 15 dof, p=0.001 critical value is 37.7.
    expect(chi2).toBeLessThan(37.7);
  });

  it('reset() returns the stream to its start', () => {
    const r = new Rng(42);
    const first = [r.float(), r.float(), r.float()];
    r.reset();
    expect([r.float(), r.float(), r.float()]).toEqual(first);
  });

  it('int() covers both ends inclusively', () => {
    const r = new Rng(5);
    let lo = false;
    let hi = false;
    for (let i = 0; i < 5000; i++) {
      const v = r.int(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
      if (v === 3) lo = true;
      if (v === 6) hi = true;
    }
    expect(lo && hi).toBe(true);
  });

  it('gauss() has the requested mean and sigma', () => {
    const r = new Rng(11);
    const n = 100000;
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < n; i++) {
      const v = r.gauss(4, 2);
      sum += v;
      sum2 += v * v;
    }
    const mean = sum / n;
    const sd = Math.sqrt(sum2 / n - mean * mean);
    expect(Math.abs(mean - 4)).toBeLessThan(0.05);
    expect(Math.abs(sd - 2)).toBeLessThan(0.05);
  });
});

describe('Rng.derive — the order-independence rule', () => {
  it('does not consume the parent stream', () => {
    const parent = new Rng(2024);
    const before = [parent.float(), parent.float()];

    const fresh = new Rng(2024);
    fresh.float();
    fresh.derive('settlement', 3).float();
    fresh.derive('moon', 11).float();
    // The parent must be exactly where it was: deriving reads the key, not the state.
    expect(fresh.float()).toBe(before[1]);
  });

  it('generates entity N identically whether or not N-1 was generated', () => {
    const seed = 777;
    const withNeighbour = new Rng(seed);
    withNeighbour.derive('settlement', 5).float();
    const a = withNeighbour.derive('settlement', 6).float();

    const alone = new Rng(seed).derive('settlement', 6).float();
    expect(a).toBe(alone);
  });

  it('keeps labels apart so subsystems sharing an index do not collide', () => {
    const root = new Rng(31337);
    expect(root.derive('settlement', 3).float()).not.toBe(root.derive('moon', 3).float());
  });

  it('is stable across a rebuilt parent chain', () => {
    const path = (): number =>
      new Rng('galaxy').derive('sector', 42).derive('star', 2).derive('planet', 1).float();
    expect(path()).toBe(path());
    expect(streamFor('galaxy', 'sector', 42).derive('star', 2).derive('planet', 1).float()).toBe(path());
  });
});
