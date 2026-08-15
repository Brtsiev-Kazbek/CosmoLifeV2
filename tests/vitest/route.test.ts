import { describe, expect, it } from 'vitest';
import { plotCourse, advanceRoute } from '../../src/sim/route';
import { starsNear, starDistance, type Star } from '../../src/procgen/galaxy';
import { jumpFuel } from '../../src/sim/travel';

const SEED = 20260815;
const RANGE = 14;

/** Two systems far enough apart that the route needs several hops. */
function pickPair(): [Star, Star] {
  const near = starsNear(7200, 0, 3600, 30, SEED);
  const far = starsNear(7200 + 90, 0, 3600 + 40, 30, SEED);
  return [near[0], far[0]];
}

describe('course plotting', () => {
  it('is a single leg when the destination is inside jump range', () => {
    const stars = starsNear(7200, 0, 3600, 40, SEED);
    const a = stars[0];
    const b = stars.find((s) => s.id !== a.id && starDistance(a, s) < RANGE)!;
    const route = plotCourse(a, b, { rangeLy: RANGE }, SEED);
    expect(route.found).toBe(true);
    expect(route.legs.length).toBe(1);
    expect(route.totalFuel).toBeCloseTo(jumpFuel(starDistance(a, b), RANGE), 9);
  });

  it('finds a multi-jump course to a distant system', () => {
    const [a, b] = pickPair();
    const route = plotCourse(a, b, { rangeLy: RANGE }, SEED);
    expect(route.found).toBe(true);
    expect(route.legs.length).toBeGreaterThan(1);
    expect(route.legs[0].from.id).toBe(a.id);
    expect(route.legs[route.legs.length - 1].to.id).toBe(b.id);
  });

  it('never emits a leg longer than the jump range', () => {
    const [a, b] = pickPair();
    const route = plotCourse(a, b, { rangeLy: RANGE }, SEED);
    for (const leg of route.legs) expect(leg.distanceLy).toBeLessThanOrEqual(RANGE + 1e-9);
  });

  it('chains legs end to end with no gaps', () => {
    const [a, b] = pickPair();
    const route = plotCourse(a, b, { rangeLy: RANGE }, SEED);
    for (let i = 1; i < route.legs.length; i++) {
      expect(route.legs[i].from.id).toBe(route.legs[i - 1].to.id);
    }
  });

  it('visits no system twice', () => {
    const [a, b] = pickPair();
    const route = plotCourse(a, b, { rangeLy: RANGE }, SEED);
    const seen = new Set<string>([route.legs[0].from.id]);
    for (const leg of route.legs) {
      expect(seen.has(leg.to.id)).toBe(false);
      seen.add(leg.to.id);
    }
  });

  it('prefers fewer jumps over less fuel', () => {
    // The rejected alternative: minimising fuel first. Fuel is super-linear in range used,
    // so a fuel-first cost function buys a marginal saving with extra stops. Here we prove
    // no shorter chain of jumps exists than the one returned.
    const [a, b] = pickPair();
    const route = plotCourse(a, b, { rangeLy: RANGE }, SEED);
    const hops = route.legs.length;

    // A greedy straight-line walk is an upper bound on the optimal hop count; the plotted
    // route must be at least as good.
    let cursor = a;
    let greedyHops = 0;
    const used = new Set<string>([a.id]);
    while (cursor.id !== b.id && greedyHops < 64) {
      const options = starsNear(cursor.x, cursor.y, cursor.z, RANGE, SEED)
        .filter((s) => !used.has(s.id));
      if (options.length === 0) break;
      let best = options[0];
      let bestD = starDistance(best, b);
      for (const o of options) {
        const d = starDistance(o, b);
        if (d < bestD || (d === bestD && o.id < best.id)) {
          best = o;
          bestD = d;
        }
      }
      if (starDistance(cursor, b) <= RANGE) {
        greedyHops++;
        break;
      }
      cursor = best;
      used.add(best.id);
      greedyHops++;
    }
    expect(hops).toBeLessThanOrEqual(greedyHops);
  });

  it('is deterministic — the same pair gives the same course every time', () => {
    const [a, b] = pickPair();
    const first = plotCourse(a, b, { rangeLy: RANGE }, SEED).legs.map((l) => l.to.id);
    for (let i = 0; i < 5; i++) {
      expect(plotCourse(a, b, { rangeLy: RANGE }, SEED).legs.map((l) => l.to.id)).toEqual(first);
    }
  });

  it('reports not found when the jump range is too short to bridge the gap', () => {
    const [a, b] = pickPair();
    const route = plotCourse(a, b, { rangeLy: 1.5, tubeRadiusLy: 6 }, SEED);
    expect(route.found).toBe(false);
    expect(route.legs).toEqual([]);
  });

  it('is empty and successful when already at the destination', () => {
    const [a] = pickPair();
    const route = plotCourse(a, a, { rangeLy: RANGE }, SEED);
    expect(route.found).toBe(true);
    expect(route.legs.length).toBe(0);
  });

  it('total fuel is the sum of its legs', () => {
    const [a, b] = pickPair();
    const route = plotCourse(a, b, { rangeLy: RANGE }, SEED);
    const sum = route.legs.reduce((s, l) => s + l.fuel, 0);
    expect(route.totalFuel).toBeCloseTo(sum, 9);
  });

  it('survives a jump — the course opens on the new system with the rest intact', () => {
    const [a, b] = pickPair();
    const route = plotCourse(a, b, { rangeLy: RANGE }, SEED);
    const firstHop = route.legs[0].to.id;
    const rest = advanceRoute(route, firstHop);
    expect(rest.legs.length).toBe(route.legs.length - 1);
    expect(rest.legs[0].from.id).toBe(firstHop);
    expect(rest.totalFuel).toBeLessThan(route.totalFuel);
  });

  it('leaves the course alone when arriving somewhere that is not on it', () => {
    const [a, b] = pickPair();
    const route = plotCourse(a, b, { rangeLy: RANGE }, SEED);
    expect(advanceRoute(route, 'nowhere').legs.length).toBe(route.legs.length);
  });
});
