import { Rng } from '../lib/rng';
import { hashInts } from '../lib/hash';
import { clamp, clamp01, TAU } from '../lib/util';
import { starName } from './names';

/**
 * The galaxy is an infinite lattice of 12-light-year sectors.
 *
 * Nothing is stored. A sector's contents come from a hash of its integer coordinates, so
 * flying a thousand light years out and back returns the identical systems, and the save
 * file never grows with exploration. Star count per sector is modulated by a spiral-arm
 * density field: dense arms, thin voids between them, a bright bulge at the centre.
 */

export const SECTOR_LY = 12;

/** Stars in a sector at full density. 8 over 1728 ly^3 is ~0.005/ly^3, the local value. */
const STARS_AT_FULL_DENSITY = 8;

/** Galactic disc scale length in light years. */
const DISC_SCALE_LY = 7000;
/** Bulge radius. Inside it the density saturates instead of diverging at r -> 0. */
const CORE_RADIUS_LY = 1400;
/** Vertical scale height. The disc is thin — a few hundred ly. */
const DISC_HEIGHT_LY = 340;

const ARM_COUNT = 2;
/** Logarithmic-spiral tightness. 0.22 rad gives arms that wrap about 1.5 turns. */
const ARM_PITCH = 0.22;
/** Angular half-width of an arm in radians at the reference radius. */
const ARM_WIDTH = 0.62;
/** How much of the density lives in the arms vs. the smooth disc. */
const ARM_CONTRAST = 0.72;

export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';

export interface Star {
  /** Stable id: sector coordinates plus index within the sector. */
  id: string;
  name: string;
  /** Position in light years, galactic frame. Y is height above the disc plane. */
  x: number;
  y: number;
  z: number;
  spectral: SpectralClass;
  /** Solar masses. */
  mass: number;
  /** Kelvin — drives the render colour and the habitable-zone radius. */
  temperature: number;
  /** Seed for the system generator. */
  seed: number;
}

export interface SectorCoord {
  ix: number;
  iy: number;
  iz: number;
}

/**
 * Spiral-arm density in [0, 1] at a point in light years.
 *
 * Pure and cheap: it is called for every candidate sector when the galaxy map pans, so it
 * must stay allocation-free.
 */
export function density(x: number, y: number, z: number): number {
  const r = Math.hypot(x, z);

  // Radial: flat inside the bulge, exponential outside. Without the bulge floor, sectors
  // near r=0 get a divide-by-zero angle and the core turns into a single bright pixel.
  const radial = r < CORE_RADIUS_LY
    ? 1
    : Math.exp(-(r - CORE_RADIUS_LY) / DISC_SCALE_LY);

  // Vertical: thin disc, thicker in the core.
  const height = DISC_HEIGHT_LY * (1 + 2.5 * Math.exp(-r / CORE_RADIUS_LY));
  const vertical = Math.exp(-Math.abs(y) / height);

  // Arms: a logarithmic spiral is theta = ln(r) / tan(pitch). Distance to the nearest arm
  // is measured in angle, wrapped into the arm spacing.
  let arm = 0;
  if (r > CORE_RADIUS_LY * 0.5) {
    const theta = Math.atan2(z, x);
    const spiral = Math.log(r / CORE_RADIUS_LY) / Math.tan(ARM_PITCH);
    const spacing = TAU / ARM_COUNT;
    let delta = (theta - spiral) % spacing;
    if (delta < 0) delta += spacing;
    // Fold to the nearer side of the arm.
    const d = Math.min(delta, spacing - delta);
    arm = Math.exp(-(d * d) / (2 * ARM_WIDTH * ARM_WIDTH));
  } else {
    arm = 1;
  }

  const structure = (1 - ARM_CONTRAST) + ARM_CONTRAST * arm;
  return clamp01(radial * vertical * structure);
}

/** Density sampled at a sector's centre. */
export function sectorDensity(sector: SectorCoord): number {
  return density(
    (sector.ix + 0.5) * SECTOR_LY,
    (sector.iy + 0.5) * SECTOR_LY,
    (sector.iz + 0.5) * SECTOR_LY,
  );
}

/** The stream for a sector. Addressed by coordinates, so it never depends on visit order. */
export function sectorRng(sector: SectorCoord, galaxySeed: number): Rng {
  return new Rng(hashInts(galaxySeed, sector.ix, sector.iy, sector.iz));
}

/**
 * Stars in one sector.
 *
 * Allocates, so callers cache per sector while it is on screen; the galaxy map holds a
 * bounded LRU keyed by sector id rather than a growing dictionary.
 */
export function starsInSector(sector: SectorCoord, galaxySeed: number): Star[] {
  const d = sectorDensity(sector);
  // Below this the sector is empty. Rolling a Poisson count for a density of 1e-4 wastes
  // most of the map pan budget on sectors that produce nothing.
  if (d < 0.02) return [];

  const rng = sectorRng(sector, galaxySeed);
  const expected = d * STARS_AT_FULL_DENSITY;
  // Fractional expectation resolved by a roll, so a sparse region still gets occasional
  // single stars instead of rounding to zero everywhere.
  let count = Math.floor(expected);
  if (rng.float() < expected - count) count++;
  if (count === 0) return [];

  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    // Each star gets its own derived stream: adding a star to a sector must not change
    // the ones before it, and re-rolling star 3 must not need stars 0..2.
    const sr = rng.derive('star', i);
    const spectral = pickSpectral(sr);
    const temp = TEMPERATURE[spectral];
    stars.push({
      id: `${sector.ix}.${sector.iy}.${sector.iz}.${i}`,
      name: starName(sr.derive('name')),
      x: (sector.ix + sr.float()) * SECTOR_LY,
      y: (sector.iy + sr.float()) * SECTOR_LY,
      z: (sector.iz + sr.float()) * SECTOR_LY,
      spectral,
      mass: MASS[spectral] * sr.range(0.85, 1.15),
      temperature: temp * sr.range(0.94, 1.06),
      seed: sr.derive('system').key,
    });
  }
  return stars;
}

/**
 * Initial mass function, heavily biased to small cool stars as reality is. O and B stars
 * are rare on purpose: they make an arrival memorable instead of routine.
 */
const SPECTRAL: readonly SpectralClass[] = ['M', 'K', 'G', 'F', 'A', 'B', 'O'];
const SPECTRAL_WEIGHT: readonly number[] = [0.62, 0.17, 0.09, 0.06, 0.036, 0.011, 0.003];

const TEMPERATURE: Record<SpectralClass, number> = {
  M: 3200, K: 4600, G: 5700, F: 6800, A: 8800, B: 16000, O: 32000,
};
const MASS: Record<SpectralClass, number> = {
  M: 0.35, K: 0.72, G: 1.0, F: 1.35, A: 2.1, B: 6.5, O: 22,
};

function pickSpectral(rng: Rng): SpectralClass {
  return rng.pickWeighted(SPECTRAL, SPECTRAL_WEIGHT);
}

/** Star colour from temperature, as an RGB triple in 0..1. */
export function starColor(temperature: number): [number, number, number] {
  // Piecewise fit to blackbody: cheap, and only the ends matter visually.
  const t = clamp(temperature, 2000, 40000);
  if (t < 3500) return [1.0, 0.55 + (t - 2000) / 6000, 0.32];
  if (t < 5200) return [1.0, 0.78 + (t - 3500) / 12000, 0.55 + (t - 3500) / 6000];
  if (t < 6500) return [1.0, 0.96, 0.86 + (t - 5200) / 12000];
  if (t < 10000) return [0.92 - (t - 6500) / 40000, 0.94, 1.0];
  return [0.70, 0.80, 1.0];
}

/** Sector containing a point given in light years. */
export function sectorOf(x: number, y: number, z: number): SectorCoord {
  return {
    ix: Math.floor(x / SECTOR_LY),
    iy: Math.floor(y / SECTOR_LY),
    iz: Math.floor(z / SECTOR_LY),
  };
}

/**
 * Every star within `radiusLy` of a point, sorted by distance with an id tie-break.
 *
 * The sort matters: two stars at identical distance must come back in the same order on
 * every machine, or the jump route and the map's "nearest system" disagree between runs.
 */
export function starsNear(
  x: number, y: number, z: number,
  radiusLy: number,
  galaxySeed: number,
): Star[] {
  const rSect = Math.ceil(radiusLy / SECTOR_LY);
  const centre = sectorOf(x, y, z);
  const out: Star[] = [];
  const r2 = radiusLy * radiusLy;

  for (let dx = -rSect; dx <= rSect; dx++) {
    for (let dy = -rSect; dy <= rSect; dy++) {
      for (let dz = -rSect; dz <= rSect; dz++) {
        const stars = starsInSector(
          { ix: centre.ix + dx, iy: centre.iy + dy, iz: centre.iz + dz },
          galaxySeed,
        );
        for (const s of stars) {
          const d2 = (s.x - x) ** 2 + (s.y - y) ** 2 + (s.z - z) ** 2;
          if (d2 <= r2) out.push(s);
        }
      }
    }
  }

  out.sort((a, b) => {
    const da = (a.x - x) ** 2 + (a.y - y) ** 2 + (a.z - z) ** 2;
    const db = (b.x - x) ** 2 + (b.y - y) ** 2 + (b.z - z) ** 2;
    if (da !== db) return da - db;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/** Distance in light years between two stars. */
export function starDistance(a: Star, b: Star): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Look a star up by id without scanning: the id encodes its sector. */
export function starById(id: string, galaxySeed: number): Star | undefined {
  const parts = id.split('.');
  if (parts.length !== 4) return undefined;
  const sector = { ix: Number(parts[0]), iy: Number(parts[1]), iz: Number(parts[2]) };
  if (!Number.isFinite(sector.ix) || !Number.isFinite(sector.iy) || !Number.isFinite(sector.iz)) {
    return undefined;
  }
  return starsInSector(sector, galaxySeed)[Number(parts[3])];
}
