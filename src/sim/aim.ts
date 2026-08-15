/**
 * Lead computation for the targeting reticle.
 *
 * The lead ring is the single HUD element that measurably helps the player hit anything;
 * everything else on a combat HUD is information. So it is worth solving properly rather
 * than approximating with "aim a bit ahead": the exact intercept is the positive root of
 * |relPos + relVel * t| = projectileSpeed * t.
 */

export interface LeadSolution {
  /** Intercept point offset from the shooter, metres. */
  x: number;
  y: number;
  z: number;
  /** Time of flight, seconds. */
  time: number;
  /** False when the target simply cannot be caught by the projectile. */
  valid: boolean;
}

/**
 * Solve for the intercept point.
 *
 * `relPos` is target minus shooter; `relVel` is target velocity minus shooter velocity,
 * because a projectile launched from a moving ship inherits that motion.
 */
export function leadSolution(
  relPosX: number, relPosY: number, relPosZ: number,
  relVelX: number, relVelY: number, relVelZ: number,
  projectileSpeed: number,
  out: LeadSolution,
): LeadSolution {
  const a = relVelX * relVelX + relVelY * relVelY + relVelZ * relVelZ - projectileSpeed * projectileSpeed;
  const b = 2 * (relPosX * relVelX + relPosY * relVelY + relPosZ * relVelZ);
  const c = relPosX * relPosX + relPosY * relPosY + relPosZ * relPosZ;

  let t: number;
  if (Math.abs(a) < 1e-6) {
    // Target closing at exactly the projectile speed: the quadratic degenerates to linear.
    if (Math.abs(b) < 1e-9) {
      out.valid = false;
      out.time = 0;
      out.x = relPosX; out.y = relPosY; out.z = relPosZ;
      return out;
    }
    t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) {
      // Unreachable: the target outruns the projectile. Fall back to the current position
      // so the reticle still marks the ship instead of vanishing.
      out.valid = false;
      out.time = 0;
      out.x = relPosX; out.y = relPosY; out.z = relPosZ;
      return out;
    }
    const root = Math.sqrt(disc);
    const t1 = (-b + root) / (2 * a);
    const t2 = (-b - root) / (2 * a);
    // Smallest strictly positive root — the first time the shell can arrive.
    t = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
    if (!Number.isFinite(t)) {
      out.valid = false;
      out.time = 0;
      out.x = relPosX; out.y = relPosY; out.z = relPosZ;
      return out;
    }
  }

  out.time = t;
  out.x = relPosX + relVelX * t;
  out.y = relPosY + relVelY * t;
  out.z = relPosZ + relVelZ * t;
  out.valid = true;
  return out;
}

export function emptyLead(): LeadSolution {
  return { x: 0, y: 0, z: 0, time: 0, valid: false };
}

/**
 * How far off the lead point the nose currently is, in radians. The HUD fades the ring in
 * as this shrinks, which teaches the mechanic without a tutorial line.
 */
export function aimError(
  noseX: number, noseY: number, noseZ: number,
  lead: LeadSolution,
): number {
  const l = Math.hypot(lead.x, lead.y, lead.z);
  if (l < 1e-6) return Math.PI;
  const dot = (noseX * lead.x + noseY * lead.y + noseZ * lead.z) / l;
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}
