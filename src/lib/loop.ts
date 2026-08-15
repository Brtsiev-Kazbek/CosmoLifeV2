/**
 * Fixed-step accumulator.
 *
 * The simulation never sees wall-clock time; it is handed a constant dt so that the same
 * inputs give the same trajectory on a 144 Hz monitor and in a headless test. Real
 * elapsed time enters only here, and only to decide how many steps to run.
 */

/** 60 Hz. Flight integration and the stick self-centre are tuned against this dt. */
export const FIXED_DT = 1 / 60;

/** One in-game day is 300 real seconds at 1x time compression. */
export const SECONDS_PER_DAY = 300;

export class FixedStep {
  private accumulator = 0;
  /** Fractional position between the last two steps, for render interpolation. */
  alpha = 0;

  constructor(
    readonly dt: number = FIXED_DT,
    /** Above this, time is dropped rather than caught up: returning from a background
     *  tab with 40 s of backlog would otherwise freeze the game for a second and run the
     *  physics at an effective dt of 40 s. */
    readonly maxStepsPerFrame: number = 5,
  ) {}

  /** Feed real elapsed seconds, get the number of fixed steps to run now. */
  advance(elapsedSeconds: number): number {
    // A negative or absurd delta means the clock moved (sleep, debugger pause); ignore it.
    if (!(elapsedSeconds > 0) || elapsedSeconds > 10) elapsedSeconds = this.dt;
    this.accumulator += elapsedSeconds;
    let steps = Math.floor(this.accumulator / this.dt);
    if (steps > this.maxStepsPerFrame) {
      this.accumulator = 0;
      steps = this.maxStepsPerFrame;
    } else {
      this.accumulator -= steps * this.dt;
    }
    this.alpha = this.accumulator / this.dt;
    return steps;
  }

  reset(): void {
    this.accumulator = 0;
    this.alpha = 0;
  }
}
