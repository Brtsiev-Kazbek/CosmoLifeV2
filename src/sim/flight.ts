import { quat, vec3, type Quat, type Vec3, v3, q } from '../lib/vec';
import { clamp, damp } from '../lib/util';
import {
  SUPERCRUISE_SPOOL_SECONDS, supercruiseCeiling, canEngageSupercruise,
} from './travel';

/**
 * Ship flight model.
 *
 * Newtonian with an authority ceiling: thrust accelerates, nothing decelerates you except
 * thrust, but speed is capped so the ship stays a ship rather than a projectile. The
 * numbers below are the tuned set — they are what makes a hull feel heavy without feeling
 * unresponsive, and changing one in isolation breaks the balance between them (a higher
 * angular damping with the same rates, for instance, makes the ship feel like it is
 * turning through syrup).
 */

export interface ShipConfig {
  /** m/s^2 of main thrust. */
  linearAccel: number;
  boostMultiplier: number;
  boostSeconds: number;
  boostCooldownSeconds: number;
  /** Sublight speed ceiling, m/s. */
  maxSpeed: number;
  /** Reverse thrust as a fraction of main. */
  reverseFactor: number;
  /** Lateral/vertical thrust as a fraction of main. */
  strafeFactor: number;
  /** rad/s at full stick. */
  pitchRate: number;
  yawRate: number;
  rollRate: number;
  /** e-folds per second the angular rate converges on the commanded one. */
  angularDamping: number;
}

export const DEFAULT_SHIP: ShipConfig = {
  linearAccel: 90,
  boostMultiplier: 3.2,
  boostSeconds: 4,
  boostCooldownSeconds: 7,
  maxSpeed: 620,
  reverseFactor: 0.45,
  strafeFactor: 0.55,
  pitchRate: 1.35,
  // Yaw is deliberately the slowest axis: it pushes the player to roll-and-pull, which is
  // what makes the ship read as an aircraft rather than a floating turret.
  yawRate: 0.85,
  rollRate: 2.2,
  angularDamping: 3.4,
};

export interface FlightInput {
  /** -1..1. Positive is nose up. */
  pitch: number;
  /** -1..1. Positive is nose right. */
  yaw: number;
  /** -1..1. Positive rolls right. */
  roll: number;
  /** -1..1. Positive is forward thrust, negative is reverse. */
  throttle: number;
  /** -1..1 lateral and vertical thrust. */
  strafeX: number;
  strafeY: number;
  /** Edge-triggered by the caller: true only on the frame the key went down. */
  boostPressed: boolean;
  /** Supercruise is a toggle, not a hold: pressed once engages, again disengages. */
  supercruiseToggled: boolean;
}

export function emptyInput(): FlightInput {
  return {
    pitch: 0, yaw: 0, roll: 0, throttle: 0, strafeX: 0, strafeY: 0,
    boostPressed: false, supercruiseToggled: false,
  };
}

export interface ShipState {
  /** World position, float64 metres. */
  pos: Vec3;
  /** World velocity, m/s. */
  vel: Vec3;
  orientation: Quat;
  /** Body-frame angular velocity, rad/s. */
  angVel: Vec3;
  /** Seconds of boost left; 0 when not boosting. */
  boostLeft: number;
  /** Seconds until boost is available again. */
  boostCooldown: number;
  supercruise: boolean;
  /** 0..1 spool factor; supercruise speed is scaled by this. */
  spool: number;
  /** Landing gear out — also the flag that caps speed to taxi limits. */
  gearDown: boolean;
  landed: boolean;
}

export function newShipState(): ShipState {
  return {
    pos: v3(),
    vel: v3(),
    orientation: q(),
    angVel: v3(),
    boostLeft: 0,
    boostCooldown: 0,
    supercruise: false,
    spool: 0,
    gearDown: false,
    landed: false,
  };
}

/** Environment the flight model needs but does not own. */
export interface FlightEnvironment {
  /** Distance to the nearest significant mass, metres — drives the supercruise ceiling. */
  distanceToMassM: number;
  /** Height above the surface directly below, metres. Infinity in deep space. */
  altitudeM: number;
  /** Gravity vector, m/s^2, world frame. Zero away from a body. */
  gravity: Vec3;
}

const forward = v3();
const right = v3();
const up = v3();
const accel = v3();
const tmpQuat = q();
const cmdAngVel = v3();

/** Body axes from an orientation. -Z is forward, matching the camera convention. */
export function shipAxes(orientation: Quat, outForward: Vec3, outRight: Vec3, outUp: Vec3): void {
  vec3.set(outForward, 0, 0, -1);
  vec3.transformQuat(outForward, outForward, orientation);
  vec3.set(outRight, 1, 0, 0);
  vec3.transformQuat(outRight, outRight, orientation);
  vec3.set(outUp, 0, 1, 0);
  vec3.transformQuat(outUp, outUp, orientation);
}

/**
 * One fixed step of flight. Mutates `state` in place and allocates nothing — this runs
 * for the player and every visible NPC at 60 Hz.
 */
export function stepFlight(
  state: ShipState,
  config: ShipConfig,
  input: FlightInput,
  env: FlightEnvironment,
  dt: number,
): void {
  // --- boost -------------------------------------------------------------------------
  if (input.boostPressed && state.boostLeft <= 0 && state.boostCooldown <= 0) {
    state.boostLeft = config.boostSeconds;
    // The cooldown starts now, not when the boost ends, so the usable duty cycle is
    // 4 s on / 3 s off rather than 4 on / 7 off.
    state.boostCooldown = config.boostCooldownSeconds;
  }
  if (state.boostLeft > 0) state.boostLeft = Math.max(0, state.boostLeft - dt);
  if (state.boostCooldown > 0) state.boostCooldown = Math.max(0, state.boostCooldown - dt);
  const boosting = state.boostLeft > 0;

  // --- supercruise -------------------------------------------------------------------
  if (input.supercruiseToggled) {
    if (state.supercruise) {
      state.supercruise = false;
    } else if (canEngageSupercruise(env.altitudeM) && !state.landed) {
      state.supercruise = true;
    }
  }
  state.spool = state.supercruise
    ? Math.min(1, state.spool + dt / SUPERCRUISE_SPOOL_SECONDS)
    : Math.max(0, state.spool - dt / (SUPERCRUISE_SPOOL_SECONDS * 0.5));
  if (state.supercruise && !canEngageSupercruise(env.altitudeM)) {
    // Dropped by proximity, not by the player: flying into a planet at 1e6 m/s has to end
    // somewhere, and ending in an automatic drop is kinder than ending in the crust.
    state.supercruise = false;
  }

  // --- rotation ----------------------------------------------------------------------
  vec3.set(
    cmdAngVel,
    input.pitch * config.pitchRate,
    input.yaw * config.yawRate,
    input.roll * config.rollRate,
  );
  state.angVel[0] = damp(state.angVel[0], cmdAngVel[0], config.angularDamping, dt);
  state.angVel[1] = damp(state.angVel[1], cmdAngVel[1], config.angularDamping, dt);
  state.angVel[2] = damp(state.angVel[2], cmdAngVel[2], config.angularDamping, dt);

  // Body-frame integration: build the delta rotation in the body frame and post-multiply,
  // which keeps roll-then-pitch behaving like an aircraft instead of like Euler angles.
  const wx = state.angVel[0] * dt;
  const wy = -state.angVel[1] * dt;
  const wz = -state.angVel[2] * dt;
  quat.identity(tmpQuat);
  quat.rotateY(tmpQuat, tmpQuat, wy);
  quat.rotateX(tmpQuat, tmpQuat, wx);
  quat.rotateZ(tmpQuat, tmpQuat, wz);
  quat.multiply(state.orientation, state.orientation, tmpQuat);
  quat.normalize(state.orientation, state.orientation);

  // --- translation -------------------------------------------------------------------
  shipAxes(state.orientation, forward, right, up);
  const thrust = config.linearAccel * (boosting ? config.boostMultiplier : 1);
  const along = input.throttle >= 0 ? input.throttle * thrust : input.throttle * thrust * config.reverseFactor;

  vec3.set(accel, 0, 0, 0);
  vec3.scaleAndAdd(accel, accel, forward, along);
  vec3.scaleAndAdd(accel, accel, right, input.strafeX * thrust * config.strafeFactor);
  vec3.scaleAndAdd(accel, accel, up, input.strafeY * thrust * config.strafeFactor);
  vec3.add(accel, accel, env.gravity);

  vec3.scaleAndAdd(state.vel, state.vel, accel, dt);

  // Speed ceiling. Three regimes, and the order matters: supercruise wins over boost,
  // and the taxi cap wins over everything so a landed ship cannot be flown like a jet.
  let ceiling: number;
  if (state.supercruise) {
    ceiling = supercruiseCeiling(env.distanceToMassM) * state.spool;
  } else if (state.gearDown && env.altitudeM < 900) {
    ceiling = 90;
  } else {
    ceiling = config.maxSpeed * (boosting ? config.boostMultiplier : 1);
  }
  const speed = vec3.length(state.vel);
  if (speed > ceiling && speed > 0) vec3.scale(state.vel, state.vel, ceiling / speed);

  vec3.scaleAndAdd(state.pos, state.pos, state.vel, dt);
}

/** Speed in m/s. */
export function shipSpeed(state: ShipState): number {
  return vec3.length(state.vel);
}

/** Angle between the nose and the velocity vector, radians. Drives the drift indicator. */
export function driftAngle(state: ShipState): number {
  const speed = vec3.length(state.vel);
  if (speed < 1e-3) return 0;
  shipAxes(state.orientation, forward, right, up);
  const dot = vec3.dot(forward, state.vel) / speed;
  return Math.acos(clamp(dot, -1, 1));
}
