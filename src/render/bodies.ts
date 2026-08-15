import { Rng } from '../lib/rng';
import { Noise } from '../lib/noise';
import { MeshBuilder, type Color, type MeshData } from '../render/meshBuilder';
import { icosphere } from './geometry';
import { hsv, mixColor, shade } from './palette';
import { clamp01, lerp } from '../lib/util';
import type { SystemBody } from '../procgen/system';
import { subdivisionsFor } from './quality';

/**
 * Planet, moon and star meshes for the far layer.
 *
 * A body seen from orbit is a coloured sphere with per-facet shading driven by the same
 * noise field the surface terrain uses, so descending does not reveal a different planet
 * than the one that was approached. Nothing here is smooth-shaded: each facet takes the
 * colour of its own patch of the world, which is what makes a low-detail sphere read as a
 * planet rather than as a low-poly ball.
 */

export interface BodyAppearance {
  mesh: MeshData;
  /** Colour of the atmosphere shell, if any. */
  atmosphereColor: Color;
  /** Colour a surface sky takes at noon. */
  skyColor: Color;
  /** Sea level colour, or null when the body has no water. */
  waterColor: Color | null;
}

/** Colour of a patch of surface given latitude, height and the body's character. */
export function surfaceColor(
  body: SystemBody,
  noise: Noise,
  nx: number, ny: number, nz: number,
  palette: BodyPalette,
): Color {
  const latitude = Math.abs(ny);
  // Two octaves is enough at orbital facet size; more detail is invisible and costs a
  // noise call per facet on a 4096-facet sphere.
  const h = noise.fbm3(nx * 2.6, ny * 2.6, nz * 2.6, 3) * 0.5 + 0.5;
  const wet = clamp01(noise.fbm3(nx * 1.7 + 11, ny * 1.7, nz * 1.7 - 5, 2) * 0.5 + 0.5);

  if (h < body.water) {
    // Deeper water is darker; the shelf is what makes a coastline visible from orbit.
    const depth = clamp01((body.water - h) / Math.max(0.05, body.water));
    return mixColor(palette.shallow, palette.deep, depth);
  }

  const dryness = clamp01(1 - wet);
  const land = mixColor(palette.lowland, palette.highland, clamp01((h - body.water) / Math.max(0.12, 1 - body.water)));
  const arid = mixColor(land, palette.arid, dryness * 0.7);
  // Ice caps by latitude, softened by the body's temperature.
  const iceLine = clamp01(1 - (body.temperatureK - 180) / 160);
  const ice = clamp01((latitude - (1 - iceLine * 0.85)) * 4);
  return mixColor(arid, palette.ice, ice);
}

export interface BodyPalette {
  deep: Color;
  shallow: Color;
  lowland: Color;
  highland: Color;
  arid: Color;
  ice: Color;
  sky: Color;
  atmosphere: Color;
}

export function bodyPalette(body: SystemBody): BodyPalette {
  const rng = new Rng(body.seed).derive('palette');
  switch (body.kind) {
    case 'ocean':
      return {
        deep: hsv(rng.range(0.55, 0.62), 0.7, 0.22),
        shallow: hsv(rng.range(0.50, 0.57), 0.55, 0.48),
        lowland: hsv(rng.range(0.22, 0.34), 0.45, 0.42),
        highland: hsv(rng.range(0.14, 0.24), 0.35, 0.36),
        arid: hsv(rng.range(0.10, 0.16), 0.40, 0.48),
        ice: [0.90, 0.94, 0.98],
        sky: hsv(0.58, 0.45, 0.62),
        atmosphere: hsv(0.57, 0.6, 0.7),
      };
    case 'desert':
      return {
        deep: hsv(0.09, 0.5, 0.3),
        shallow: hsv(0.09, 0.4, 0.4),
        lowland: hsv(rng.range(0.07, 0.12), 0.52, 0.52),
        highland: hsv(rng.range(0.05, 0.10), 0.45, 0.40),
        arid: hsv(rng.range(0.08, 0.13), 0.60, 0.60),
        ice: [0.86, 0.86, 0.84],
        sky: hsv(0.10, 0.35, 0.55),
        atmosphere: hsv(0.09, 0.5, 0.6),
      };
    case 'volcanic':
      return {
        deep: hsv(0.02, 0.8, 0.35),
        shallow: hsv(0.04, 0.85, 0.5),
        lowland: hsv(rng.range(0.98, 1.02) % 1, 0.25, 0.20),
        highland: hsv(rng.range(0.02, 0.06), 0.55, 0.30),
        arid: hsv(0.03, 0.7, 0.42),
        ice: [0.35, 0.30, 0.30],
        sky: hsv(0.02, 0.5, 0.35),
        atmosphere: hsv(0.03, 0.7, 0.45),
      };
    case 'ice':
      return {
        deep: hsv(0.55, 0.35, 0.45),
        shallow: hsv(0.53, 0.25, 0.62),
        lowland: hsv(0.56, 0.12, 0.70),
        highland: hsv(0.58, 0.08, 0.82),
        arid: hsv(0.55, 0.15, 0.66),
        ice: [0.93, 0.96, 1.0],
        sky: hsv(0.58, 0.25, 0.70),
        atmosphere: hsv(0.57, 0.3, 0.75),
      };
    case 'gas':
      return {
        deep: hsv(rng.range(0.05, 0.14), 0.45, 0.45),
        shallow: hsv(rng.range(0.05, 0.14), 0.35, 0.60),
        lowland: hsv(rng.range(0.05, 0.14), 0.30, 0.70),
        highland: hsv(rng.range(0.03, 0.10), 0.40, 0.55),
        arid: hsv(rng.range(0.55, 0.62), 0.30, 0.50),
        ice: [0.85, 0.85, 0.88],
        sky: hsv(0.10, 0.4, 0.5),
        atmosphere: hsv(0.09, 0.4, 0.6),
      };
    default:
      return {
        deep: hsv(0.08, 0.2, 0.22),
        shallow: hsv(0.08, 0.18, 0.32),
        lowland: hsv(rng.range(0.05, 0.12), 0.22, 0.40),
        highland: hsv(rng.range(0.03, 0.10), 0.18, 0.52),
        arid: hsv(rng.range(0.06, 0.13), 0.28, 0.46),
        ice: [0.88, 0.90, 0.92],
        sky: hsv(0.6, 0.15, 0.35),
        atmosphere: hsv(0.58, 0.25, 0.45),
      };
  }
}

/** Build the orbital mesh for a body. */
export function buildBody(body: SystemBody, bodyDetail: number): BodyAppearance {
  const palette = bodyPalette(body);
  const noise = new Noise(new Rng(body.seed).derive('shape'));
  const mb = new MeshBuilder(1024);
  const sub = subdivisionsFor(bodyDetail);

  if (body.kind === 'star') {
    // A star is emissive and needs no shading variation beyond a faint granulation, which
    // keeps the disc from looking like a flat cut-out circle.
    icosphere(mb, 0, 0, 0, body.radiusM, Math.min(3, sub), (nx, ny, nz) => {
      const g = noise.fbm3(nx * 6, ny * 6, nz * 6, 2) * 0.5 + 0.5;
      return shade([1, 0.95, 0.85], 0.9 + g * 0.2);
    });
    return {
      mesh: mb.build(),
      atmosphereColor: [1, 0.9, 0.7],
      skyColor: [1, 0.95, 0.85],
      waterColor: null,
    };
  }

  if (body.kind === 'gas') {
    // Banding, not blotches: latitude bands are the whole visual identity of a gas giant.
    icosphere(mb, 0, 0, 0, body.radiusM, sub, (nx, ny, nz) => {
      const band = Math.sin(ny * 7 + noise.fbm3(nx, ny * 4, nz, 2) * 1.6);
      const t = clamp01(band * 0.5 + 0.5);
      return mixColor(palette.deep, palette.lowland, t);
    });
    return {
      mesh: mb.build(),
      atmosphereColor: palette.atmosphere,
      skyColor: palette.sky,
      waterColor: null,
    };
  }

  icosphere(mb, 0, 0, 0, body.radiusM, sub, (nx, ny, nz) =>
    surfaceColor(body, noise, nx, ny, nz, palette));

  return {
    mesh: mb.build(),
    atmosphereColor: palette.atmosphere,
    skyColor: palette.sky,
    waterColor: body.water > 0 ? palette.shallow : null,
  };
}

/**
 * Night-side city lights, as an emissive point cloud on the dark hemisphere.
 *
 * Placed by the same settlement seed the surface generator uses, so a light seen from
 * orbit is a town that is really there when you land on it.
 */
export function cityLightPositions(body: SystemBody, count: number): Float32Array {
  const rng = new Rng(body.seed).derive('lights');
  const noise = new Noise(new Rng(body.seed).derive('shape'));
  const out = new Float32Array(count * 3);
  let written = 0;
  // Rejection sampling against habitability: lights cluster where a settlement would
  // actually be placed, not uniformly over ocean and ice cap.
  for (let attempt = 0; attempt < count * 24 && written < count; attempt++) {
    const u = rng.float() * 2 - 1;
    const theta = rng.float() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const nx = r * Math.cos(theta);
    const ny = u;
    const nz = r * Math.sin(theta);
    const h = noise.fbm3(nx * 2.6, ny * 2.6, nz * 2.6, 3) * 0.5 + 0.5;
    if (h < body.water) continue;
    const latPenalty = 1 - Math.abs(ny) * 0.8;
    if (rng.float() > latPenalty) continue;
    out[written * 3] = nx * body.radiusM;
    out[written * 3 + 1] = ny * body.radiusM;
    out[written * 3 + 2] = nz * body.radiusM;
    written++;
  }
  return out.subarray(0, written * 3);
}

/** Atmosphere shell: a slightly larger sphere drawn additively. */
export function buildAtmosphere(body: SystemBody, color: Color, bodyDetail: number): MeshData {
  const mb = new MeshBuilder(512);
  // 2.5% larger. Below ~1% the shell z-fights the surface at orbital distance; above ~5%
  // the planet looks like it is wearing a hat.
  const r = body.radiusM * 1.025;
  icosphere(mb, 0, 0, 0, r, Math.max(1, subdivisionsFor(bodyDetail) - 1), (_nx, ny) =>
    shade(color, lerp(0.7, 1.0, clamp01(1 - Math.abs(ny)))));
  return mb.build();
}
