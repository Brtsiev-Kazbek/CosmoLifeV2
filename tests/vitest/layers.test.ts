import { describe, expect, it } from 'vitest';
import { FAR_SCALE, NEAR_RANGE_M, layerFor, reachesNear } from '../../src/render/layers';
import { FixedStep, FIXED_DT } from '../../src/lib/loop';
import { QUALITY_PRESETS } from '../../src/render/quality';

describe('layer assignment', () => {
  it('keeps close things in the near layer', () => {
    expect(layerFor(0)).toBe('near');
    expect(layerFor(1000)).toBe('near');
    expect(layerFor(NEAR_RANGE_M - 1)).toBe('near');
  });

  it('sends anything past the near far-plane to the far layer', () => {
    expect(layerFor(NEAR_RANGE_M)).toBe('far');
    expect(layerFor(1e8)).toBe('far');
  });

  it('puts every settlement draw distance beyond 30 km in the far layer', () => {
    // The concrete defect this guards: a town visible from 90 km on the `high` preset,
    // submitted to a scene whose far plane is 30 km, draws exactly zero triangles.
    for (const preset of QUALITY_PRESETS) {
      const range = preset.settlementRangeM;
      if (range > NEAR_RANGE_M) {
        expect(layerFor(range)).toBe('far');
        expect(layerFor(range * 0.99)).toBe('far');
      }
    }
    expect(QUALITY_PRESETS.some((p) => p.settlementRangeM > NEAR_RANGE_M)).toBe(true);
  });

  it('treats a straddling body by its surface, not its centre', () => {
    // A ship on the ground: planet centre is 3.4e6 m away, surface is under the hull.
    expect(reachesNear(3.4e6, 3.4e6)).toBe(true);
    expect(reachesNear(3.4e6, 1e5)).toBe(false);
  });

  it('far scale keeps the biggest distances inside the far camera range', () => {
    // Far camera far-plane is 1e9 units; 1e12 m of world must fit after scaling.
    expect(1e12 / FAR_SCALE).toBeLessThanOrEqual(1e9);
  });
});

describe('fixed step', () => {
  it('runs the expected number of steps for a real frame time', () => {
    const step = new FixedStep();
    expect(step.advance(FIXED_DT)).toBe(1);
    expect(step.advance(FIXED_DT * 2)).toBe(2);
  });

  it('accumulates fractions instead of dropping them', () => {
    const step = new FixedStep();
    let total = 0;
    for (let i = 0; i < 100; i++) total += step.advance(1 / 144);
    // 100 frames at 144 Hz is 0.694 s, which is 41.7 steps of 1/60.
    expect(total).toBeGreaterThanOrEqual(41);
    expect(total).toBeLessThanOrEqual(42);
  });

  it('never runs more than the per-frame cap', () => {
    // A 0.4 s hitch (a chunk build overrunning) is 24 steps of 1/60; running all of them
    // in one frame makes the next frame late too and the game never recovers.
    const step = new FixedStep();
    expect(step.advance(0.4)).toBe(step.maxStepsPerFrame);
    expect(step.advance(FIXED_DT)).toBe(1);
  });

  it('drops a long stall rather than catching up', () => {
    // Returning from a background tab with 40 s of backlog must not freeze the game, and
    // must not hand the physics an effective dt of 40 s either.
    const step = new FixedStep();
    const steps = step.advance(40);
    expect(steps).toBeGreaterThanOrEqual(1);
    expect(steps).toBeLessThanOrEqual(step.maxStepsPerFrame);
    expect(step.advance(FIXED_DT)).toBe(1);
  });

  it('survives a non-monotonic clock', () => {
    const step = new FixedStep();
    expect(step.advance(-1)).toBe(1);
    expect(step.advance(0)).toBe(1);
  });
});
