import { starsNear, starDistance, type Star } from '../procgen/galaxy';
import { jumpFuel } from './travel';

/**
 * Multi-jump course plotting.
 *
 * Dijkstra over the stars inside a tube along the straight line to the destination. The
 * tube exists because the galaxy is infinite: an unbounded search would expand forever,
 * and a search limited only by distance-from-origin expands as a sphere and visits a
 * hundred times more systems than a route ever needs.
 *
 * **Jumps are primary; fuel is only a tie-break.** Optimising fuel first produces
 * routes with substantially more stops for a fraction of a tank — nine hops instead of
 * six to save well under one percent of fuel. Nobody wants that trade, so the cost is
 * lexicographic: hop count first, fuel second.
 */

export interface RouteOptions {
  /** Jump range in light years. */
  rangeLy: number;
  /** Half-width of the search tube, in light years. */
  tubeRadiusLy?: number;
  /** Hard cap on jumps before the search gives up. */
  maxJumps?: number;
  /** Fuel available; a leg that cannot be paid for is not traversable. */
  fuelAvailable?: number;
}

export interface RouteLeg {
  from: Star;
  to: Star;
  distanceLy: number;
  fuel: number;
}

export interface Route {
  legs: RouteLeg[];
  totalLy: number;
  totalFuel: number;
  /** False when no chain of jumps within range connects the two systems. */
  found: boolean;
}

/** Hop count dominates: one extra jump must always cost more than any fuel difference. */
const JUMP_COST = 1e6;

export function plotCourse(from: Star, to: Star, options: RouteOptions, galaxySeed: number): Route {
  const range = options.rangeLy;
  const maxJumps = options.maxJumps ?? 48;
  const direct = starDistance(from, to);

  if (from.id === to.id) return { legs: [], totalLy: 0, totalFuel: 0, found: true };

  if (direct <= range) {
    const fuel = jumpFuel(direct, range);
    return {
      legs: [{ from, to, distanceLy: direct, fuel }],
      totalLy: direct,
      totalFuel: fuel,
      found: true,
    };
  }

  const candidates = gatherTube(from, to, range, options.tubeRadiusLy ?? Math.max(range * 1.6, 24), galaxySeed);
  const index = new Map<string, Star>();
  for (const s of candidates) index.set(s.id, s);
  index.set(from.id, from);
  index.set(to.id, to);

  // Ids sorted once, so neighbour scans and the frontier are visited in a fixed order and
  // two equally good routes always resolve the same way.
  const ids = [...index.keys()].sort();

  const dist = new Map<string, number>();
  const jumps = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  for (const id of ids) dist.set(id, Infinity);
  dist.set(from.id, 0);
  jumps.set(from.id, 0);

  while (true) {
    // Linear scan of the frontier. A binary heap is the textbook answer, but a route tube
    // holds a few hundred systems and the scan is not measurable next to the neighbour
    // distance computations.
    let current = '';
    let best = Infinity;
    for (const id of ids) {
      if (visited.has(id)) continue;
      const d = dist.get(id)!;
      if (d < best) {
        best = d;
        current = id;
      }
    }
    if (current === '' || best === Infinity) break;
    if (current === to.id) break;
    visited.add(current);

    const cur = index.get(current)!;
    const curJumps = jumps.get(current)!;
    if (curJumps >= maxJumps) continue;

    for (const id of ids) {
      if (visited.has(id) || id === current) continue;
      const next = index.get(id)!;
      const d = starDistance(cur, next);
      if (d > range) continue;
      const fuel = jumpFuel(d, range);
      if (options.fuelAvailable !== undefined && fuel > options.fuelAvailable) continue;
      const cost = best + JUMP_COST + fuel;
      if (cost < dist.get(id)!) {
        dist.set(id, cost);
        jumps.set(id, curJumps + 1);
        prev.set(id, current);
      }
    }
  }

  if (!prev.has(to.id)) return { legs: [], totalLy: 0, totalFuel: 0, found: false };

  const chain: Star[] = [];
  let cursor: string | undefined = to.id;
  while (cursor) {
    chain.push(index.get(cursor)!);
    cursor = prev.get(cursor);
  }
  chain.reverse();

  const legs: RouteLeg[] = [];
  let totalLy = 0;
  let totalFuel = 0;
  for (let i = 1; i < chain.length; i++) {
    const d = starDistance(chain[i - 1], chain[i]);
    const fuel = jumpFuel(d, range);
    legs.push({ from: chain[i - 1], to: chain[i], distanceLy: d, fuel });
    totalLy += d;
    totalFuel += fuel;
  }
  return { legs, totalLy, totalFuel, found: true };
}

/**
 * Stars inside a cylinder around the from-to line.
 *
 * Sampled at intervals of the jump range rather than continuously: a sphere query per
 * sample point is cheap, and the union of overlapping spheres covers the tube.
 */
function gatherTube(from: Star, to: Star, rangeLy: number, tubeRadiusLy: number, galaxySeed: number): Star[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  const steps = Math.max(1, Math.ceil(length / Math.max(1, rangeLy)));

  const seen = new Map<string, Star>();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t;
    const y = from.y + dy * t;
    const z = from.z + dz * t;
    for (const s of starsNear(x, y, z, tubeRadiusLy, galaxySeed)) {
      if (!seen.has(s.id)) seen.set(s.id, s);
    }
  }
  // Sorted output: the Map is insertion-ordered, and insertion order here depends on the
  // sampling walk, which is stable — but sorting makes that independence explicit.
  return [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Total fuel for a route, for the "can I make it" check on the galaxy map. */
export function routeFuel(route: Route): number {
  return route.totalFuel;
}

/**
 * Drop the legs already flown. A course must survive a jump: the map should open on the
 * new system with the remaining legs intact rather than making the player re-plot.
 */
export function advanceRoute(route: Route, arrivedAtId: string): Route {
  const idx = route.legs.findIndex((l) => l.to.id === arrivedAtId);
  if (idx < 0) return route;
  const legs = route.legs.slice(idx + 1);
  return {
    legs,
    totalLy: legs.reduce((s, l) => s + l.distanceLy, 0),
    totalFuel: legs.reduce((s, l) => s + l.fuel, 0),
    found: true,
  };
}
