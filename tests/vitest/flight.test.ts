import { describe, expect, it } from 'vitest';
import { VirtualStick, DEFAULT_STICK, ON_FOOT_LOOK_RAD_PER_PIXEL } from '../../src/sim/stick';
import {
  approachSpeed, arrivalBand, hasArrived, approachCommand, jumpFuel,
  supercruiseCeiling, canEngageSupercruise, isSafeTouchdown,
  SUPERCRUISE_MIN_SPEED, APPROACH_TIME_CONSTANT,
} from '../../src/sim/travel';
import { leadSolution, emptyLead, aimError } from '../../src/sim/aim';
import { stepFlight, newShipState, DEFAULT_SHIP, emptyInput, shipSpeed, shipAxes } from '../../src/sim/flight';
import { v3, vec3, q } from '../../src/lib/vec';
import { FIXED_DT } from '../../src/lib/loop';

const out = { x: 0, y: 0 };

describe('virtual stick', () => {
  it('needs the configured pixel travel to reach full deflection', () => {
    const stick = new VirtualStick();
    stick.moveBy(DEFAULT_STICK.pixelsToFull, 0);
    expect(Math.hypot(stick.rawX, stick.rawY)).toBeCloseTo(1, 6);

    // The bug this guards: sensitivity read as a fraction-per-pixel would peg the stick
    // after ~20 px and the ship becomes uncontrollable.
    const partial = new VirtualStick();
    partial.moveBy(20, 0);
    expect(Math.hypot(partial.rawX, partial.rawY)).toBeCloseTo(20 / 320, 6);
  });

  it('clamps deflection into a circle, not a square', () => {
    const stick = new VirtualStick();
    stick.moveBy(10000, 10000);
    const mag = Math.hypot(stick.rawX, stick.rawY);
    expect(mag).toBeCloseTo(1, 6);
    // In a square clamp both axes would sit at 1 and the diagonal would be 1.41.
    expect(Math.abs(stick.rawX)).toBeLessThan(0.999);
  });

  it('is isotropic — a diagonal push turns as hard as a cardinal one', () => {
    const cardinal = new VirtualStick();
    cardinal.moveBy(400, 0);
    const c = cardinal.magnitude();

    const diagonal = new VirtualStick();
    diagonal.moveBy(400 / Math.SQRT2, 400 / Math.SQRT2);
    expect(diagonal.magnitude()).toBeCloseTo(c, 6);
  });

  it('ignores movement inside the deadzone', () => {
    const stick = new VirtualStick();
    stick.moveBy(DEFAULT_STICK.pixelsToFull * 0.03, 0);
    stick.output(out);
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('still reaches exactly full output at the rim', () => {
    // Rescaling past the deadzone matters: without it the ship silently loses 4% of its
    // turn rate at full stick.
    const stick = new VirtualStick();
    stick.moveBy(DEFAULT_STICK.pixelsToFull, 0);
    stick.output(out);
    expect(out.x).toBeCloseTo(1, 6);
  });

  it('spends most of the circle on small corrections', () => {
    const stick = new VirtualStick();
    stick.moveBy(DEFAULT_STICK.pixelsToFull * 0.5, 0);
    stick.output(out);
    // curve 1.6: half deflection gives about a third of the authority, so aiming happens
    // in the wide gentle part of the range.
    expect(out.x).toBeLessThan(0.4);
    expect(out.x).toBeGreaterThan(0.25);
  });

  it('self-centres when the hand stops', () => {
    const stick = new VirtualStick();
    stick.moveBy(DEFAULT_STICK.pixelsToFull, 0);
    for (let i = 0; i < 60; i++) stick.update(FIXED_DT);
    expect(stick.magnitude()).toBeLessThan(0.06);
  });

  it('does not drift back to exactly zero forever — it snaps', () => {
    const stick = new VirtualStick();
    stick.moveBy(5, 0);
    for (let i = 0; i < 600; i++) stick.update(FIXED_DT);
    expect(stick.rawX).toBe(0);
  });

  it('on-foot look is a separate, direct instrument', () => {
    expect(ON_FOOT_LOOK_RAD_PER_PIXEL).toBeCloseTo(0.0052, 6);
    // 1000 px sweep should be under a full turn, or looking around is unusable.
    expect(1000 * ON_FOOT_LOOK_RAD_PER_PIXEL).toBeLessThan(Math.PI * 2);
  });
});

describe('approach guidance', () => {
  it('commands distance over the time constant plus the target speed', () => {
    expect(approachSpeed(6000, 0)).toBeCloseTo(1000, 6);
    expect(approachSpeed(6000, 100)).toBeCloseTo(1100, 6);
  });

  it('has an arrival band, not an arrival point', () => {
    expect(arrivalBand(10000, 0)).toBe(1200);
    expect(arrivalBand(100, 0)).toBe(250);
    expect(arrivalBand(100, 400)).toBe(800);
    expect(hasArrived(200, 100, 0)).toBe(true);
  });

  it('actually converges on a stationary target', () => {
    let remaining = 2_000_000;
    let ticks = 0;
    const standoff = 1704;
    while (!hasArrived(remaining, standoff, 0) && ticks < 60 * 600) {
      remaining -= approachSpeed(remaining, 0) * FIXED_DT;
      ticks++;
    }
    expect(hasArrived(remaining, standoff, 0)).toBe(true);
    expect(ticks).toBeLessThan(60 * 120);
  });

  it('converges on a station that is moving away at 100 m/s', () => {
    // The measured failure: without the target-velocity term the gap freezes at
    // 6 x targetSpeed = 600 m and the ship sits there indefinitely.
    const targetSpeed = 100;
    const standoff = 1704;
    let gap = 50_000;
    let ticks = 0;
    while (!hasArrived(gap, standoff, targetSpeed) && ticks < 60 * 600) {
      const closing = approachSpeed(gap, targetSpeed) - targetSpeed;
      gap -= closing * FIXED_DT;
      ticks++;
    }
    expect(hasArrived(gap, standoff, targetSpeed)).toBe(true);
  });

  it('would stall without the target-velocity term — proving the term earns its place', () => {
    const targetSpeed = 100;
    const standoff = 1704;
    let gap = 50_000;
    for (let i = 0; i < 60 * 600; i++) {
      // Deliberately wrong command: distance term only.
      const closing = gap / APPROACH_TIME_CONSTANT - targetSpeed;
      gap -= closing * FIXED_DT;
    }
    // It settles exactly where closing speed hits zero: 6 x 100 = 600 m, outside the band.
    expect(gap).toBeGreaterThan(560);
    expect(gap).toBeLessThan(640);
    expect(hasArrived(gap, standoff, targetSpeed)).toBe(false);
  });

  it('clamps the command to the supercruise ceiling', () => {
    const cmd = { speed: 0, arrived: false, remaining: 0 };
    approachCommand(1e9, 1000, 0, 500_000, cmd);
    expect(cmd.speed).toBe(500_000);
    expect(cmd.arrived).toBe(false);
  });
});

describe('supercruise', () => {
  it('scales the ceiling with distance to mass, with a floor', () => {
    expect(supercruiseCeiling(0)).toBe(SUPERCRUISE_MIN_SPEED);
    expect(supercruiseCeiling(1e8)).toBeCloseTo(6e6, 6);
  });

  it('refuses to engage near a surface', () => {
    expect(canEngageSupercruise(4499)).toBe(false);
    expect(canEngageSupercruise(4500)).toBe(true);
  });

  it('is a toggle, not a hold', () => {
    const ship = newShipState();
    const env = { distanceToMassM: 1e7, altitudeM: 1e6, gravity: v3() };
    const input = emptyInput();

    input.supercruiseToggled = true;
    stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    expect(ship.supercruise).toBe(true);

    // Releasing the key must not drop it.
    input.supercruiseToggled = false;
    for (let i = 0; i < 60; i++) stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    expect(ship.supercruise).toBe(true);

    input.supercruiseToggled = true;
    stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    expect(ship.supercruise).toBe(false);
  });

  it('drops automatically when it gets too close to a surface', () => {
    const ship = newShipState();
    const env = { distanceToMassM: 1e7, altitudeM: 1e6, gravity: v3() };
    const input = emptyInput();
    input.supercruiseToggled = true;
    stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    input.supercruiseToggled = false;
    env.altitudeM = 1200;
    stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    expect(ship.supercruise).toBe(false);
  });

  it('spools up over the configured time rather than snapping', () => {
    const ship = newShipState();
    const env = { distanceToMassM: 1e8, altitudeM: 1e6, gravity: v3() };
    const input = emptyInput();
    input.supercruiseToggled = true;
    stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    input.supercruiseToggled = false;
    expect(ship.spool).toBeLessThan(0.05);
    for (let i = 0; i < Math.round(1.6 / FIXED_DT); i++) {
      stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    }
    expect(ship.spool).toBeCloseTo(1, 2);
  });
});

describe('jump fuel', () => {
  it('is super-linear in range used, so short hops beat one long one', () => {
    const long = jumpFuel(20, 20);
    const short = jumpFuel(10, 20) * 2;
    expect(short).toBeLessThan(long);
  });

  it('stays inside its clamp', () => {
    expect(jumpFuel(0, 20)).toBeGreaterThanOrEqual(0.4);
    expect(jumpFuel(1000, 20)).toBeLessThanOrEqual(24);
  });

  it('matches the specified formula', () => {
    expect(jumpFuel(10, 20)).toBeCloseTo(0.6 + Math.pow(0.5, 1.7) * 3.4, 9);
  });
});

describe('flight model', () => {
  const env = { distanceToMassM: 1e9, altitudeM: 1e6, gravity: v3() };

  it('accelerates at the configured rate', () => {
    const ship = newShipState();
    const input = emptyInput();
    input.throttle = 1;
    for (let i = 0; i < 60; i++) stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    // One second of 90 m/s^2.
    expect(shipSpeed(ship)).toBeCloseTo(90, 0);
  });

  it('caps sublight speed at 620 m/s', () => {
    const ship = newShipState();
    const input = emptyInput();
    input.throttle = 1;
    for (let i = 0; i < 60 * 60; i++) stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    expect(shipSpeed(ship)).toBeCloseTo(620, 3);
  });

  it('reverses at 45% of forward thrust', () => {
    const fwd = newShipState();
    const rev = newShipState();
    const a = emptyInput();
    a.throttle = 1;
    const b = emptyInput();
    b.throttle = -1;
    for (let i = 0; i < 30; i++) {
      stepFlight(fwd, DEFAULT_SHIP, a, env, FIXED_DT);
      stepFlight(rev, DEFAULT_SHIP, b, env, FIXED_DT);
    }
    expect(shipSpeed(rev) / shipSpeed(fwd)).toBeCloseTo(0.45, 2);
  });

  it('boosts for 4 s and then needs the cooldown', () => {
    const ship = newShipState();
    const input = emptyInput();
    input.boostPressed = true;
    stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    expect(ship.boostLeft).toBeGreaterThan(3.9);

    input.boostPressed = false;
    for (let i = 0; i < 60 * 4; i++) stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    expect(ship.boostLeft).toBe(0);

    // Still cooling down: a second press must not re-arm it.
    input.boostPressed = true;
    stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    expect(ship.boostLeft).toBe(0);
  });

  it('rotates toward the commanded rate with damping, not instantly', () => {
    const ship = newShipState();
    const input = emptyInput();
    input.pitch = 1;
    stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    expect(ship.angVel[0]).toBeGreaterThan(0);
    expect(ship.angVel[0]).toBeLessThan(DEFAULT_SHIP.pitchRate * 0.2);
    for (let i = 0; i < 120; i++) stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    expect(ship.angVel[0]).toBeCloseTo(DEFAULT_SHIP.pitchRate, 2);
  });

  it('keeps the orientation quaternion normalised over a long flight', () => {
    const ship = newShipState();
    const input = emptyInput();
    input.pitch = 0.7;
    input.roll = -0.4;
    input.yaw = 0.2;
    for (let i = 0; i < 60 * 300; i++) stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    const o = ship.orientation;
    expect(Math.hypot(o[0], o[1], o[2], o[3])).toBeCloseTo(1, 9);
  });

  it('yaw is the slowest axis, which is what forces roll-and-pull flying', () => {
    expect(DEFAULT_SHIP.yawRate).toBeLessThan(DEFAULT_SHIP.pitchRate);
    expect(DEFAULT_SHIP.pitchRate).toBeLessThan(DEFAULT_SHIP.rollRate);
  });

  it('caps a geared ship near the ground to taxi speed', () => {
    const ship = newShipState();
    ship.gearDown = true;
    const input = emptyInput();
    input.throttle = 1;
    const ground = { distanceToMassM: 1e6, altitudeM: 30, gravity: v3() };
    for (let i = 0; i < 60 * 30; i++) stepFlight(ship, DEFAULT_SHIP, input, ground, FIXED_DT);
    expect(shipSpeed(ship)).toBeLessThanOrEqual(90.001);
  });

  it('falls under gravity when unpowered', () => {
    const ship = newShipState();
    const input = emptyInput();
    const grav = { distanceToMassM: 1e6, altitudeM: 5000, gravity: v3(0, -9.8, 0) };
    for (let i = 0; i < 60; i++) stepFlight(ship, DEFAULT_SHIP, input, grav, FIXED_DT);
    expect(ship.vel[1]).toBeCloseTo(-9.8, 0);
    expect(ship.pos[1]).toBeLessThan(0);
  });

  it('body axes are orthonormal', () => {
    const ship = newShipState();
    const input = emptyInput();
    input.pitch = 0.5;
    input.roll = 0.9;
    for (let i = 0; i < 200; i++) stepFlight(ship, DEFAULT_SHIP, input, env, FIXED_DT);
    const f = v3(); const r = v3(); const u = v3();
    shipAxes(ship.orientation, f, r, u);
    expect(vec3.length(f)).toBeCloseTo(1, 9);
    expect(vec3.dot(f, r)).toBeCloseTo(0, 9);
    expect(vec3.dot(f, u)).toBeCloseTo(0, 9);
    expect(vec3.dot(r, u)).toBeCloseTo(0, 9);
  });

  it('starts pointing down -Z with an identity orientation', () => {
    const f = v3(); const r = v3(); const u = v3();
    shipAxes(q(), f, r, u);
    expect(f[2]).toBeCloseTo(-1, 9);
    expect(r[0]).toBeCloseTo(1, 9);
    expect(u[1]).toBeCloseTo(1, 9);
  });
});

describe('landing envelope', () => {
  it('accepts a gentle, level touchdown', () => {
    expect(isSafeTouchdown(-10, 0.2)).toBe(true);
  });
  it('rejects too fast', () => {
    expect(isSafeTouchdown(-23, 0)).toBe(false);
  });
  it('rejects too steep', () => {
    expect(isSafeTouchdown(-5, (29 * Math.PI) / 180)).toBe(false);
  });
});

describe('lead solution', () => {
  const lead = emptyLead();

  it('aims straight at a stationary target', () => {
    leadSolution(1000, 0, 0, 0, 0, 0, 500, lead);
    expect(lead.valid).toBe(true);
    expect(lead.time).toBeCloseTo(2, 6);
    expect(lead.x).toBeCloseTo(1000, 6);
    expect(lead.y).toBeCloseTo(0, 6);
  });

  it('leads a crossing target', () => {
    leadSolution(1000, 0, 0, 0, 200, 0, 500, lead);
    expect(lead.valid).toBe(true);
    expect(lead.y).toBeGreaterThan(0);
    // The intercept point must be exactly reachable in the solved time.
    const d = Math.hypot(lead.x, lead.y, lead.z);
    expect(d).toBeCloseTo(500 * lead.time, 4);
  });

  it('reports invalid when the target outruns the projectile', () => {
    leadSolution(1000, 0, 0, 900, 0, 0, 300, lead);
    expect(lead.valid).toBe(false);
  });

  it('picks the earliest arrival when two intercepts exist', () => {
    leadSolution(1000, 0, 0, -100, 300, 0, 600, lead);
    expect(lead.valid).toBe(true);
    expect(lead.time).toBeGreaterThan(0);
    const d = Math.hypot(lead.x, lead.y, lead.z);
    expect(d).toBeCloseTo(600 * lead.time, 4);
  });

  it('aim error is zero when the nose is on the lead point', () => {
    leadSolution(1000, 0, 0, 0, 200, 0, 500, lead);
    const l = Math.hypot(lead.x, lead.y, lead.z);
    expect(aimError(lead.x / l, lead.y / l, lead.z / l, lead)).toBeCloseTo(0, 6);
    expect(aimError(0, 0, -1, lead)).toBeGreaterThan(1);
  });
});
