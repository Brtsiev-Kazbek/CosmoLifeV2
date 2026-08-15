/**
 * Which of the two depth layers an object belongs to.
 *
 * The scene spans eleven orders of magnitude — a 1.7 m walker and a 1e11 m orbit — so a
 * single depth buffer cannot hold it. Two passes: the far layer draws planets, stars and
 * distant settlements at reduced scale, then depth is cleared and the near layer draws
 * everything within 30 km at true scale.
 *
 * The rule that matters: anything farther than NEAR_RANGE_M *must* go to the far layer.
 * A settlement visible from 90 km (the `high` preset) submitted to the near layer is
 * simply clipped away and draws exactly zero triangles — a silent failure that no unit
 * test of the settlement generator can catch, which is why `layerFor` is a pure function
 * with its own test rather than an `if` buried in the draw code.
 */

export type Layer = 'near' | 'far';

/** Near-layer far plane, in metres. */
export const NEAR_RANGE_M = 30_000;

/** Near-layer near plane. Below this the walker's own eye clips through walls. */
export const NEAR_PLANE_M = 0.25;

/**
 * Far-layer positions are divided by this before reaching the vertex buffer, so a 1e11 m
 * orbit lands at 1e8 units and stays inside a workable depth range together with a
 * logarithmic depth buffer.
 */
export const FAR_SCALE = 1_000;

export function layerFor(distanceMetres: number): Layer {
  return distanceMetres < NEAR_RANGE_M ? 'near' : 'far';
}

/** Does an object of the given radius, centred at that distance, reach into the near layer? */
export function reachesNear(distanceMetres: number, radiusMetres: number): boolean {
  return distanceMetres - radiusMetres < NEAR_RANGE_M;
}
