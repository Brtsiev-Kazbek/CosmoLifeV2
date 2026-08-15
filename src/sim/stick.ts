import { clamp01 } from '../lib/util';

/**
 * Mouse as a virtual stick.
 *
 * The sensitivity unit is **pixels of travel to full deflection**, not "fraction per
 * pixel". That distinction is the whole design: expressed as a fraction, a plausible
 * looking 0.05 puts the stick at the stop after 20 px of mouse movement and the ship is
 * uncontrollable, while the same number written as 320 px is immediately legible and
 * tunable by the player.
 *
 * Deflection is clamped to a **circle**. Clamping each axis separately (a square) makes
 * the diagonal reach 1.41x further than the cardinal directions, so a diagonal correction
 * is half again as strong as the identical vertical one — which feels like the ship
 * fighting the hand.
 *
 * The response curve exists because aiming is made of small corrections: with curve 1.6,
 * most of the circle's area maps to the gentle part of the range.
 */

export interface StickConfig {
  /** Pixels of mouse travel from centre to full deflection. */
  pixelsToFull: number;
  /** Fraction of the radius ignored around centre. */
  deadzone: number;
  /** Exponent applied radially after the deadzone. */
  curve: number;
  /** Self-centring rate, e-folds per second. */
  recenterPerSecond: number;
}

export const DEFAULT_STICK: StickConfig = {
  pixelsToFull: 320,
  deadzone: 0.04,
  curve: 1.6,
  recenterPerSecond: 3,
};

/** On-foot look is a different instrument: direct angular rate, radians per pixel. */
export const ON_FOOT_LOOK_RAD_PER_PIXEL = 0.0052;

export class VirtualStick {
  /** Raw deflection, inside the unit circle. This is what the on-screen widget draws. */
  rawX = 0;
  rawY = 0;

  constructor(public config: StickConfig = { ...DEFAULT_STICK }) {}

  /** Feed raw mouse movement in pixels. */
  moveBy(dxPixels: number, dyPixels: number): void {
    const scale = 1 / this.config.pixelsToFull;
    this.rawX += dxPixels * scale;
    this.rawY += dyPixels * scale;
    this.clampToCircle();
  }

  /** Place the stick directly, e.g. from a gamepad axis pair. */
  setRaw(x: number, y: number): void {
    this.rawX = x;
    this.rawY = y;
    this.clampToCircle();
  }

  private clampToCircle(): void {
    const mag = Math.hypot(this.rawX, this.rawY);
    if (mag > 1) {
      this.rawX /= mag;
      this.rawY /= mag;
    }
  }

  /** Self-centring. Without it the ship keeps turning after the hand has stopped. */
  update(dt: number): void {
    const k = Math.exp(-this.config.recenterPerSecond * dt);
    this.rawX *= k;
    this.rawY *= k;
    // Snap the last sliver to zero so a resting stick reads exactly centred and the HUD
    // widget does not shimmer at the third decimal.
    if (Math.hypot(this.rawX, this.rawY) < 1e-4) {
      this.rawX = 0;
      this.rawY = 0;
    }
  }

  centre(): void {
    this.rawX = 0;
    this.rawY = 0;
  }

  /** Deflection after deadzone and curve. Writes into `out` to stay allocation-free. */
  output(out: { x: number; y: number }): { x: number; y: number } {
    const mag = Math.hypot(this.rawX, this.rawY);
    if (mag <= this.config.deadzone) {
      out.x = 0;
      out.y = 0;
      return out;
    }
    // Rescale so the deadzone edge is 0 and the rim is still exactly 1 — otherwise the
    // stick can never reach full deflection and the ship loses 4% of its turn rate.
    const t = clamp01((mag - this.config.deadzone) / (1 - this.config.deadzone));
    const shaped = Math.pow(t, this.config.curve);
    const scale = shaped / mag;
    out.x = this.rawX * scale;
    out.y = this.rawY * scale;
    return out;
  }

  /** Magnitude of the shaped output, for the HUD widget's fill. */
  magnitude(): number {
    const mag = Math.hypot(this.rawX, this.rawY);
    if (mag <= this.config.deadzone) return 0;
    return Math.pow(clamp01((mag - this.config.deadzone) / (1 - this.config.deadzone)), this.config.curve);
  }
}
