/** Small pure helpers shared by simulation and generation. No imports, no state. */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse lerp, clamped. Returns 0 when the range is degenerate rather than NaN. */
export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : clamp01((v - a) / (b - a));
}

export function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = invLerp(edge0, edge1, v);
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach. `rate` is "e-folds per second". */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

/** Move toward a target by at most `maxDelta`. Used where overshoot must be impossible. */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function wrap(v: number, period: number): number {
  const r = v % period;
  return r < 0 ? r + period : r;
}

/** Shortest signed angular difference, in (-pi, pi]. */
export function angleDelta(from: number, to: number): number {
  return wrap(to - from + Math.PI, Math.PI * 2) - Math.PI;
}

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

/**
 * Sort with a mandatory tie-break.
 *
 * `Array.prototype.sort` is only guaranteed stable for the comparator's own equality, and
 * every list here is assembled from hashed ids whose insertion order must never leak into
 * results. Every sort in the project goes through this, so equal keys resolve by id.
 */
export function sortByKey<T>(items: T[], key: (item: T) => number, id: (item: T) => string): T[] {
  return items.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return ka - kb;
    const ia = id(a);
    const ib = id(b);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

/** Descending variant; the id tie-break stays ascending so the order is total. */
export function sortByKeyDesc<T>(items: T[], key: (item: T) => number, id: (item: T) => string): T[] {
  return items.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return kb - ka;
    const ia = id(a);
    const ib = id(b);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
}

/** Ordered keys of a record. Guards against `for...in` and unordered Object.keys use. */
export function sortedKeys<V>(rec: Record<string, V>): string[] {
  return Object.keys(rec).sort();
}

/** Stable checksum of a number series — the economy/diplomacy fingerprints in tests. */
export function checksum(values: Iterable<number>): number {
  let h = 2166136261 >>> 0;
  for (const v of values) {
    // Quantise before hashing: float noise below 1e-6 must not move the fingerprint,
    // otherwise the test fails on unrelated refactors that reassociate arithmetic.
    const q = Math.round(v * 1e6);
    h ^= q & 0xffffffff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= Math.floor(q / 0x100000000) & 0xffffffff;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function formatInt(v: number): string {
  return Math.round(v).toString();
}
