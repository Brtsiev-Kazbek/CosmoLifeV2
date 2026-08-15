/**
 * Integer hashing used to seed every derived stream.
 *
 * Everything procedural in the game is addressed by a key (sector coordinates, a label
 * plus an index, a body id) rather than by a position in a global draw sequence. Hashing
 * that key into a seed is what makes `derive` independent of call order.
 */

const FNV_OFFSET = 2166136261 >>> 0;
const FNV_PRIME = 16777619;

/** FNV-1a over UTF-16 code units. 32-bit, avalanche is finished by `mix32`. */
export function hashString(str: string, seed = FNV_OFFSET): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return mix32(h);
}

/** Murmur3 finalizer. Raw FNV leaves low-bit structure that shows up as visible lattice
 *  artefacts when sector coordinates differ by one. */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash of a signed integer. */
export function hashInt(n: number, seed = FNV_OFFSET): number {
  let h = seed >>> 0;
  let v = n | 0;
  for (let i = 0; i < 4; i++) {
    h ^= v & 0xff;
    h = Math.imul(h, FNV_PRIME) >>> 0;
    v >>= 8;
  }
  return mix32(h);
}

/** Hash of an integer tuple — sector coordinates, chunk coordinates, block indices. */
export function hashInts(...ns: number[]): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < ns.length; i++) h = hashInt(ns[i], h);
  return mix32(h);
}

/** Combine a parent key with a label and index. The label keeps unrelated subsystems from
 *  colliding when they use the same index (settlement 3 vs. moon 3). */
export function hashKey(parent: number, label: string, index: number): number {
  return mix32(hashInt(index, hashString(label, parent >>> 0)));
}
