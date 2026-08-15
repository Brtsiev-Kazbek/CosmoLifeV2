/**
 * Approach guidance — the arithmetic of arriving somewhere.
 *
 * Pure functions with no renderer and no ship object, because the two failure modes here
 * are arithmetic and were both found by measurement rather than by looking at the code:
 *
 * 1. **Arrival must be a band, not a point.** A speed proportional to the distance
 *    remaining is an exponential decay: it halves the gap forever and reaches the target
 *    never. There has to be a radius inside which the approach declares itself finished.
 *
 * 2. **The target's own velocity must be in the command.** A station moves at ~100 m/s
 *    along its orbit. Commanding `remaining / 6` alone means the ship settles exactly
 *    where its closing speed equals the target's speed — the gap freezes at
 *    `6 x targetSpeed` and stays there. Measured: a ship sat 80 seconds at 2291 m from a
 *    handover point at 1704 m, closing at zero.
 */

/** Seconds of distance the guidance aims to bleed off. Larger is gentler and slower. */
export const APPROACH_TIME_CONSTANT = 6;

/** Commanded speed for a given gap and target motion, in m/s. */
export function approachSpeed(remainingM: number, targetSpeedMps: number): number {
  return remainingM / APPROACH_TIME_CONSTANT + targetSpeedMps;
}

/**
 * Radius inside which the approach is complete.
 *
 * Three terms because three different situations dominate: a big standoff scales with
 * itself, a small one still needs an absolute floor, and a moving target needs a band
 * wide enough that it cannot slide out of it between ticks.
 */
export function arrivalBand(standoffM: number, targetSpeedMps: number): number {
  return Math.max(standoffM * 0.12, 250, targetSpeedMps * 2);
}

export function hasArrived(remainingM: number, standoffM: number, targetSpeedMps: number): boolean {
  return remainingM <= arrivalBand(standoffM, targetSpeedMps);
}

/** Gap left to the standoff shell around the target, never negative. */
export function remainingTo(distanceToTargetM: number, standoffM: number): number {
  return Math.max(0, distanceToTargetM - standoffM);
}

export interface ApproachCommand {
  /** Speed to fly, m/s. */
  speed: number;
  /** True once inside the arrival band — the caller drops out of supercruise here. */
  arrived: boolean;
  remaining: number;
}

/** The full command for one tick. */
export function approachCommand(
  distanceToTargetM: number,
  standoffM: number,
  targetSpeedMps: number,
  speedCeiling: number,
  out: ApproachCommand,
): ApproachCommand {
  const remaining = remainingTo(distanceToTargetM, standoffM);
  out.remaining = remaining;
  out.arrived = hasArrived(remaining, standoffM, targetSpeedMps);
  out.speed = Math.min(speedCeiling, approachSpeed(remaining, targetSpeedMps));
  return out;
}

/**
 * Supercruise speed ceiling from mass lock.
 *
 * Speed is proportional to the distance to the nearest significant mass, so leaving a
 * planet accelerates smoothly and arriving decelerates without a scripted cutscene.
 */
export const MASS_LOCK_FACTOR = 0.06;
export const SUPERCRUISE_MIN_SPEED = 500;
/** Below this altitude the drive refuses to engage at all. */
export const SUPERCRUISE_MIN_ALTITUDE = 4500;
/** Seconds to spool up to the commanded speed. */
export const SUPERCRUISE_SPOOL_SECONDS = 1.6;

export function supercruiseCeiling(distanceToNearestMassM: number): number {
  return Math.max(SUPERCRUISE_MIN_SPEED, distanceToNearestMassM * MASS_LOCK_FACTOR);
}

export function canEngageSupercruise(altitudeM: number): boolean {
  return altitudeM >= SUPERCRUISE_MIN_ALTITUDE;
}

/**
 * Fuel for one hyperspace jump.
 *
 * Super-linear in the fraction of range used (exponent 1.7), so a chain of short hops is
 * cheaper than one long one — which is what makes the jump-range upgrade a real decision
 * rather than an obvious one.
 */
export function jumpFuel(distanceLy: number, rangeLy: number): number {
  const f = 0.6 + Math.pow(distanceLy / rangeLy, 1.7) * 3.4;
  return Math.min(24, Math.max(0.4, f));
}

/** Landing envelope. Outside it the touchdown is a crash. */
export const LANDING_MAX_SPEED = 22;
export const LANDING_MAX_TILT_RAD = (28 * Math.PI) / 180;
/** Below this altitude the ship switches to hover with gear down. */
export const HOVER_CEILING_M = 900;
/** Speed ceiling while taxiing on the surface. */
export const TAXI_MAX_SPEED = 90;

export function isSafeTouchdown(verticalSpeedMps: number, tiltRad: number): boolean {
  return Math.abs(verticalSpeedMps) <= LANDING_MAX_SPEED && Math.abs(tiltRad) <= LANDING_MAX_TILT_RAD;
}
