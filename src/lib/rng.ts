import { hashInt, hashKey, hashString, mix32 } from './hash';

/**
 * L'Ecuyer MRG32k3a — combined multiple recursive generator.
 *
 * Chosen over a fast PCG/xoshiro because every product here stays inside float64's exact
 * integer range (max 1403580 * 4294967086 = 6.03e15 < 2^53 = 9.01e15), so the sequence is
 * bit-identical on every JS engine without BigInt or Math.imul tricks. Period is 2^191.
 * `Math.random` is banned project-wide: one seed must give one galaxy on any machine.
 */

const M1 = 4294967087;
const M2 = 4294944443;
const A12 = 1403580;
const A13N = 810728;
const A21 = 527612;
const A23N = 1370589;
const NORM = 2.328306549295728e-10;

export class Rng {
  /** The address this stream was seeded from. Children hash it, they do not consume it. */
  readonly key: number;

  private s10 = 0;
  private s11 = 0;
  private s12 = 0;
  private s20 = 0;
  private s21 = 0;
  private s22 = 0;

  private gaussCache = 0;
  private hasGauss = false;

  constructor(key: number | string) {
    this.key = typeof key === 'string' ? hashString(key) : mix32(key >>> 0);
    this.reset();
  }

  /** Re-seed to this stream's own start. Used by tests and by regenerating a chunk. */
  reset(): this {
    // Six independent words from one 32-bit key; the modulo keeps each state word legal
    // and the +1 guarantees neither triple is all-zero (an all-zero triple is absorbing).
    let h = this.key >>> 0;
    const word = (): number => {
      h = mix32(hashInt(h, h));
      return h >>> 0;
    };
    this.s10 = word() % (M1 - 1);
    this.s11 = word() % (M1 - 1);
    this.s12 = (word() % (M1 - 1)) + 1;
    this.s20 = word() % (M2 - 1);
    this.s21 = word() % (M2 - 1);
    this.s22 = (word() % (M2 - 1)) + 1;
    this.hasGauss = false;
    return this;
  }

  /** Uniform in the open interval (0, 1) — never exactly 0 or 1. */
  float(): number {
    let p1 = A12 * this.s11 - A13N * this.s10;
    let k = Math.floor(p1 / M1);
    p1 -= k * M1;
    if (p1 < 0) p1 += M1;
    this.s10 = this.s11;
    this.s11 = this.s12;
    this.s12 = p1;

    let p2 = A21 * this.s22 - A23N * this.s20;
    k = Math.floor(p2 / M2);
    p2 -= k * M2;
    if (p2 < 0) p2 += M2;
    this.s20 = this.s21;
    this.s21 = this.s22;
    this.s22 = p2;

    return (p1 <= p2 ? p1 - p2 + M1 : p1 - p2) * NORM;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** Uniform integer in [min, max], both ends included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** Uniform integer in [0, n). */
  index(n: number): number {
    return Math.floor(this.float() * n);
  }

  bool(chance = 0.5): boolean {
    return this.float() < chance;
  }

  /** Uniform in [-mag, +mag). Reads better than range(-m, m) at call sites. */
  spread(mag: number): number {
    return (this.float() * 2 - 1) * mag;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.index(items.length)];
  }

  /**
   * Weighted pick. Weights are read in array order, so the caller controls determinism —
   * pass a sorted array, never the values of an object built in unknown order.
   */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let roll = this.float() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Box-Muller. The spare value is cached, so gauss() costs one float() on average. */
  gauss(mu = 0, sigma = 1): number {
    if (this.hasGauss) {
      this.hasGauss = false;
      return mu + sigma * this.gaussCache;
    }
    let u: number;
    let v: number;
    let s: number;
    do {
      u = this.float() * 2 - 1;
      v = this.float() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    this.gaussCache = v * f;
    this.hasGauss = true;
    return mu + sigma * u * f;
  }

  /** In-place Fisher-Yates. Only ever called on arrays with a defined order. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.index(i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  /**
   * A child stream addressed by (label, index).
   *
   * Deliberately does NOT advance this stream: settlement 7 must generate identically
   * whether or not settlement 6 was ever asked for. A shared counter would make every
   * later entity shift the moment one is inserted — the single worst determinism bug
   * available in a procedural game.
   */
  derive(label: string, index = 0): Rng {
    return new Rng(hashKey(this.key, label, index));
  }
}

/** Convenience: a stream addressed by a seed and a label chain, without an intermediate. */
export function streamFor(seed: number | string, label: string, index = 0): Rng {
  return new Rng(seed).derive(label, index);
}
