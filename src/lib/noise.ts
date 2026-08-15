import { Rng } from './rng';

/**
 * Perlin noise over our own PRNG.
 *
 * Packaged noise libraries were rejected for one reason: they seed from their own
 * generator (usually `Math.random` by default), so the same galaxy seed would not
 * reproduce the same terrain across machines or library versions. Here the permutation
 * table is a Fisher-Yates shuffle driven by an `Rng` stream, so terrain is addressed by
 * seed like everything else.
 */
export class Noise {
  private readonly perm = new Uint8Array(512);

  constructor(rng: Rng) {
    const p: number[] = new Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    rng.shuffle(p);
    // Doubled table so the +1 lookups below never need a mask.
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Perlin 3D in roughly [-1, 1]. */
  noise3(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const fz = z - Math.floor(z);
    const u = fade(fx);
    const v = fade(fy);
    const w = fade(fz);

    const p = this.perm;
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;

    return lerp1(
      lerp1(
        lerp1(grad3(p[AA], fx, fy, fz), grad3(p[BA], fx - 1, fy, fz), u),
        lerp1(grad3(p[AB], fx, fy - 1, fz), grad3(p[BB], fx - 1, fy - 1, fz), u),
        v,
      ),
      lerp1(
        lerp1(grad3(p[AA + 1], fx, fy, fz - 1), grad3(p[BA + 1], fx - 1, fy, fz - 1), u),
        lerp1(grad3(p[AB + 1], fx, fy - 1, fz - 1), grad3(p[BB + 1], fx - 1, fy - 1, fz - 1), u),
        v,
      ),
      w,
    );
  }

  /** 2D slice. Kept separate so climate fields do not pay for the third dimension. */
  noise2(x: number, y: number): number {
    return this.noise3(x, y, 0.5);
  }

  /**
   * Fractal sum. Amplitude is normalised so the result stays in [-1, 1] regardless of
   * octave count — otherwise raising detail on a quality preset would also raise the
   * mountains, and the same planet would have different geography per machine.
   */
  fbm3(x: number, y: number, z: number, octaves = 5, lacunarity = 2.03, gain = 0.5): number {
    let freq = 1;
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise3(x * freq, y * freq, z * freq);
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return sum / norm;
  }

  /** Ridged multifractal — mountain chains and canyon walls. */
  ridged3(x: number, y: number, z: number, octaves = 5, lacunarity = 2.03, gain = 0.5): number {
    let freq = 1;
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.noise3(x * freq, y * freq, z * freq));
      sum += amp * n * n;
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return (sum / norm) * 2 - 1;
  }

  /** Billowy noise — dunes and cloud decks. */
  billow3(x: number, y: number, z: number, octaves = 4, lacunarity = 2.03, gain = 0.5): number {
    let freq = 1;
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * Math.abs(this.noise3(x * freq, y * freq, z * freq));
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return (sum / norm) * 2 - 1;
  }
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp1(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad3(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
