import * as THREE from 'three';
import { Rng } from '../lib/rng';
import { density, starColor } from '../procgen/galaxy';
import { clamp01 } from '../lib/util';

/**
 * The background starfield.
 *
 * Not a texture and not a random scatter: stars are sampled against the same spiral-arm
 * density field the galaxy generator uses, so the band of the Milky Way runs across the
 * sky in the direction it actually should from wherever the player is standing. Turning
 * around and seeing the galactic plane where the map says it is does more for the sense
 * of place than any amount of resolution.
 */

export interface StarfieldOptions {
  count: number;
  /** Where the observer is, in light years — the band shifts with position. */
  observerLy: { x: number; y: number; z: number };
  seed: number;
}

export function buildStarfield(opts: StarfieldOptions): THREE.Points {
  const rng = new Rng(opts.seed).derive('starfield');
  const positions = new Float32Array(opts.count * 3);
  const colors = new Float32Array(opts.count * 3);
  const sizes = new Float32Array(opts.count);

  let written = 0;
  // Rejection sampling: draw a direction, walk out along it and accept with probability
  // proportional to the integrated density. Uniform scatter gives an even sky with no
  // galactic plane at all, which reads as a screensaver.
  for (let attempt = 0; attempt < opts.count * 40 && written < opts.count; attempt++) {
    const u = rng.float() * 2 - 1;
    const theta = rng.float() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const dx = r * Math.cos(theta);
    const dy = u;
    const dz = r * Math.sin(theta);

    // Integrate density along the ray in coarse steps; the sum is what makes the plane
    // bright rather than any single sample.
    let sum = 0;
    for (let s = 1; s <= 8; s++) {
      const d = s * 900;
      sum += density(
        opts.observerLy.x + dx * d,
        opts.observerLy.y + dy * d,
        opts.observerLy.z + dz * d,
      );
    }
    const brightness = clamp01(sum / 4);
    if (rng.float() > 0.12 + brightness * 0.88) continue;

    // Placed on a unit sphere; the renderer scales the whole field to sit behind
    // everything else, so no real distance is needed.
    const i = written * 3;
    positions[i] = dx;
    positions[i + 1] = dy;
    positions[i + 2] = dz;

    const temp = Math.exp(rng.range(Math.log(2600), Math.log(24000)));
    const c = starColor(temp);
    const mag = rng.range(0.35, 1);
    colors[i] = c[0] * mag;
    colors[i + 1] = c[1] * mag;
    colors[i + 2] = c[2] * mag;
    sizes[written] = mag;
    written++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, written * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, written * 3), 3));

  const material = new THREE.PointsMaterial({
    size: 2,
    // Screen-space size: attenuating by distance would make the whole field vanish, since
    // it is drawn on a unit sphere far inside the far camera's range.
    sizeAttenuation: false,
    vertexColors: true,
    depthWrite: false,
    transparent: true,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  return points;
}

/**
 * The sky dome colour seen from a planet surface, blended by sun elevation.
 *
 * Sunset is not a filter over the frame: the sky colour and the ground light both shift,
 * which is what makes the terrain read as lit by a low sun rather than tinted.
 */
export function skyColorAt(
  base: THREE.Color,
  sunElevation: number,
  atmosphere: number,
  out: THREE.Color,
): THREE.Color {
  const day = clamp01(sunElevation * 2 + 0.15);
  const dusk = clamp01(1 - Math.abs(sunElevation) * 6);
  out.copy(base).multiplyScalar(day * atmosphere);
  // Warm the horizon band. 0.55 red / 0.25 green measured as the point where the shift is
  // visible without turning the whole sky orange at noon.
  out.r += dusk * 0.55 * atmosphere;
  out.g += dusk * 0.25 * atmosphere;
  out.b += dusk * 0.08 * atmosphere;
  return out;
}
