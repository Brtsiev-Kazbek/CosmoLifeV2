import { Rng } from '../lib/rng';
import { clamp, TAU } from '../lib/util';
import { bodyName, moonName, starName } from './names';
import type { Star } from './galaxy';

/**
 * A star system, generated from the star's seed and evaluated analytically in time.
 *
 * No orbit is ever integrated. Every body's position is a closed-form function of world
 * time, which is the only way a galaxy this size works: the player can arrive at a system
 * on day 900 without anyone having simulated days 0..899, and two players (or a test and
 * the game) agree on where the station is without exchanging state.
 */

export const AU = 1.495978707e11;
const G = 6.674e-11;
const SOLAR_MASS = 1.989e30;

/**
 * Orbital motion is deliberately slowed from reality.
 *
 * A body at 1 AU really moves at 30 km/s; the ship's sublight ceiling is 620 m/s, so a
 * rendezvous would be arithmetically impossible and every station would outrun the
 * player forever. Dividing angular rate by 60 puts a planet at ~500 m/s and keeps
 * Kepler's third law intact between planets. Moons and stations need their own factor
 * (3.4) because the same divisor would leave a station crawling at 5 m/s, and the
 * approach autopilot's whole "target velocity" term exists to handle a station that
 * genuinely moves — measured target speed is ~100 m/s.
 */
const SLOWDOWN_AROUND_STAR = 60;
const SLOWDOWN_AROUND_PLANET = 3.4;

/**
 * Hard ceilings on tangential speed, applied after the slowdown.
 *
 * A fixed divisor is not enough on its own: the same factor that gives a station around a
 * small rocky world a comfortable 78 m/s gives one around a gas giant 1093 m/s (measured),
 * because orbital speed goes as sqrt(GM/r) and gas giants are 200x heavier. Where the cap
 * bites, the period is stretched until the speed obeys it. Stations land on ~100 m/s,
 * which is exactly the case the approach autopilot's target-velocity term is tuned for.
 */
const MAX_PLANET_SPEED = 520;
const MAX_MOON_SPEED = 260;
const MAX_STATION_SPEED = 110;

export type BodyKind = 'star' | 'rocky' | 'ocean' | 'desert' | 'ice' | 'volcanic' | 'gas' | 'moon' | 'belt' | 'station';

export interface Orbit {
  /** Id of the body orbited. Empty for the primary star. */
  parentId: string;
  /** Semi-major axis in metres. */
  semiMajorM: number;
  eccentricity: number;
  /** Radians. Small for planets, larger for captured moons and belts. */
  inclination: number;
  /** Longitude of the ascending node, radians. */
  node: number;
  /** Mean anomaly at t = 0, radians. This is what makes day 900 reachable directly. */
  phase0: number;
  /** Orbital period in days, after the playability slowdown. */
  periodDays: number;
}

export interface SystemBody {
  id: string;
  name: string;
  kind: BodyKind;
  /** Metres. Planets 1.4e6..7.2e6, moons 3e5..1.1e6. */
  radiusM: number;
  massKg: number;
  orbit: Orbit | null;
  /** Sidereal rotation period in days; drives day/night and the surface frame. */
  rotationDays: number;
  /** 0..1. Above 0.05 there is a sky, weather and a horizon haze. */
  atmosphere: number;
  /** 0..1 fraction of the surface below sea level; 0 means no water mesh at all. */
  water: number;
  /** Mean surface temperature in Kelvin. */
  temperatureK: number;
  /** Terrain amplitude in metres, peak to trough. */
  reliefM: number;
  /** Seed for terrain, settlements and everything else on this body. */
  seed: number;
  /** Children in generation order — never re-sorted, so indices stay stable. */
  childIds: string[];
}

export interface StarSystem {
  starId: string;
  name: string;
  /** Solar luminosities. Drives the habitable zone and the light colour. */
  luminosity: number;
  massKg: number;
  bodies: SystemBody[];
  /** Index into `bodies` by id — built once, iterated only via sorted arrays. */
  byId: Map<string, SystemBody>;
}

export function generateSystem(star: Star): StarSystem {
  const rng = new Rng(star.seed);
  const massKg = star.mass * SOLAR_MASS;
  // Mass-luminosity relation. Only the exponent matters for placing the habitable zone.
  const luminosity = Math.pow(star.mass, 3.5);
  const hzAu = Math.sqrt(luminosity);

  const bodies: SystemBody[] = [];
  const primary: SystemBody = {
    id: 'star',
    name: star.name,
    kind: 'star',
    radiusM: 6.957e8 * Math.pow(star.mass, 0.8),
    massKg,
    orbit: null,
    rotationDays: 25,
    atmosphere: 0,
    water: 0,
    temperatureK: star.temperature,
    reliefM: 0,
    seed: rng.derive('star-surface').key,
    childIds: [],
  };
  bodies.push(primary);

  const planetCount = rng.pickWeighted([0, 1, 2, 3, 4, 5, 6, 7, 8], [0.04, 0.08, 0.13, 0.17, 0.18, 0.15, 0.12, 0.08, 0.05]);

  // Titius-Bode-like spacing: each orbit is a jittered multiple of the last. A uniform
  // random spread puts planets on top of each other and the system reads as noise.
  let au = rng.range(0.28, 0.62) * Math.max(0.35, hzAu);
  for (let i = 0; i < planetCount; i++) {
    const pr = rng.derive('planet', i);
    const id = `p${i}`;
    const kind = pickPlanetKind(pr, au, hzAu);
    const radiusM = kind === 'gas'
      ? pr.range(2.4e7, 7.1e7)
      : pr.range(1.4e6, 7.2e6);
    const density = kind === 'gas' ? 1300 : pr.range(3600, 5800);
    const planetMass = (4 / 3) * Math.PI * Math.pow(radiusM, 3) * density;

    const planet: SystemBody = {
      id,
      name: bodyName(star.name, i),
      kind,
      radiusM,
      massKg: planetMass,
      orbit: makeOrbit(pr.derive('orbit'), '', au * AU, massKg, SLOWDOWN_AROUND_STAR, 0.06, MAX_PLANET_SPEED),
      rotationDays: pr.range(0.35, 2.6) * (pr.bool(0.08) ? -1 : 1),
      atmosphere: atmosphereFor(kind, pr),
      water: waterFor(kind, pr),
      temperatureK: surfaceTemperature(luminosity, au, atmosphereFor(kind, pr)),
      // Relief scales with radius but sub-linearly: a small world keeps proportionally
      // taller mountains because there is less gravity to flatten them.
      reliefM: kind === 'gas' ? 0 : pr.range(900, 5200) * Math.pow(radiusM / 3.4e6, 0.45),
      seed: pr.derive('surface').key,
      childIds: [],
    };
    bodies.push(planet);
    primary.childIds.push(id);

    {
      // Gas giants always get a moon family — they are unlandable themselves, so without
      // moons an entire orbit would hold nothing to visit.
      const moonCount = kind === 'gas'
        ? pr.int(1, 5)
        : pr.pickWeighted([0, 1, 2], [0.55, 0.33, 0.12]);
      for (let m = 0; m < moonCount; m++) {
        const mr = pr.derive('moon', m);
        const moonId = `${id}m${m}`;
        const moonRadius = mr.range(3e5, 1.1e6);
        const moonMass = (4 / 3) * Math.PI * Math.pow(moonRadius, 3) * mr.range(2600, 3900);
        // Orbit radius in planet radii — 2.5 to 12 keeps the moon visible from the planet
        // and outside the roche limit.
        const moonA = radiusM * mr.range(2.5, 12);
        bodies.push({
          id: moonId,
          name: moonName(planet.name, m),
          kind: 'moon',
          radiusM: moonRadius,
          massKg: moonMass,
          orbit: makeOrbit(mr.derive('orbit'), id, moonA, planetMass, SLOWDOWN_AROUND_PLANET, 0.12, MAX_MOON_SPEED),
          rotationDays: mr.range(0.6, 4),
          atmosphere: mr.bool(0.18) ? mr.range(0.02, 0.2) : 0,
          water: 0,
          temperatureK: surfaceTemperature(luminosity, au, 0),
          reliefM: mr.range(400, 2600),
          seed: mr.derive('surface').key,
          childIds: [],
        });
        planet.childIds.push(moonId);
      }
    }

    au *= rng.range(1.42, 2.05);
  }

  // Asteroid belts sit in the gaps; a system with no planets still gets one so there is
  // always something to mine.
  const beltCount = planetCount === 0 ? 1 : rng.pickWeighted([0, 1, 2], [0.42, 0.44, 0.14]);
  for (let b = 0; b < beltCount; b++) {
    const br = rng.derive('belt', b);
    const beltAu = br.range(1.2, 4.5) * Math.max(0.6, hzAu);
    const id = `b${b}`;
    bodies.push({
      id,
      name: `${star.name} ${br.bool(0.5) ? 'Ring' : 'Belt'} ${b + 1}`,
      kind: 'belt',
      radiusM: beltAu * AU * br.range(0.06, 0.16),
      massKg: 1e18,
      orbit: makeOrbit(br.derive('orbit'), '', beltAu * AU, massKg, SLOWDOWN_AROUND_STAR, 0.04, MAX_PLANET_SPEED),
      rotationDays: 1,
      atmosphere: 0,
      water: 0,
      temperatureK: surfaceTemperature(luminosity, beltAu, 0),
      reliefM: 0,
      seed: br.derive('rocks').key,
      childIds: [],
    });
    primary.childIds.push(id);
  }

  // Stations orbit a body rather than the star, so docking is always near something.
  const anchorable = bodies.filter((b) => b.kind !== 'star' && b.kind !== 'belt');
  const stationCount = anchorable.length === 0
    ? 0
    : rng.pickWeighted([0, 1, 2, 3], [0.22, 0.42, 0.24, 0.12]);
  for (let s = 0; s < stationCount; s++) {
    const sr = rng.derive('station', s);
    const anchor = anchorable[sr.index(anchorable.length)];
    const id = `s${s}`;
    // 1.06..1.4 planet radii: close enough that the planet fills the sky on approach.
    const a = anchor.radiusM * sr.range(1.06, 1.4);
    bodies.push({
      id,
      name: `${starName(sr.derive('name'))} ${sr.pick(['Station', 'Port', 'Dock', 'Outpost', 'Hub'])}`,
      kind: 'station',
      radiusM: sr.range(320, 1400),
      massKg: 1e9,
      orbit: makeOrbit(sr.derive('orbit'), anchor.id, a, anchor.massKg, SLOWDOWN_AROUND_PLANET, 0.01, MAX_STATION_SPEED),
      rotationDays: sr.range(0.002, 0.01),
      atmosphere: 0,
      water: 0,
      temperatureK: 290,
      reliefM: 0,
      seed: sr.derive('layout').key,
      childIds: [],
    });
    anchor.childIds.push(id);
  }

  const byId = new Map<string, SystemBody>();
  for (const b of bodies) byId.set(b.id, b);

  return { starId: star.id, name: star.name, luminosity, massKg, bodies, byId };
}

function makeOrbit(
  rng: Rng,
  parentId: string,
  semiMajorM: number,
  centralMassKg: number,
  slowdown: number,
  maxEccentricity: number,
  maxSpeedMps: number,
): Orbit {
  const realPeriodSec = TAU * Math.sqrt(Math.pow(semiMajorM, 3) / (G * centralMassKg));
  let periodSec = realPeriodSec * slowdown;
  const speed = (TAU * semiMajorM) / periodSec;
  if (speed > maxSpeedMps) periodSec = (TAU * semiMajorM) / maxSpeedMps;
  return {
    parentId,
    semiMajorM,
    eccentricity: rng.float() * maxEccentricity,
    inclination: rng.gauss(0, 0.04),
    node: rng.float() * TAU,
    phase0: rng.float() * TAU,
    periodDays: periodSec / 86400,
  };
}

/**
 * Position of a body at an absolute world time, in metres, system-centred.
 *
 * Walks the parent chain, so a station's position includes its planet's orbital motion.
 * Writes into `out` and allocates nothing — this runs for every body every frame.
 */
export function bodyPositionAt(
  system: StarSystem,
  body: SystemBody,
  timeDays: number,
  out: Float64Array,
): Float64Array {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  let cur: SystemBody | undefined = body;
  // Depth is at most 3 (star -> planet -> moon/station); the guard is against a malformed
  // parent id creating a cycle rather than against real depth.
  for (let depth = 0; cur && cur.orbit && depth < 8; depth++) {
    orbitOffset(cur.orbit, timeDays, out);
    cur = system.byId.get(cur.orbit.parentId);
  }
  return out;
}

const TMP = new Float64Array(3);

/** Velocity by central difference. Used by the approach autopilot's target-speed term. */
export function bodyVelocityAt(
  system: StarSystem,
  body: SystemBody,
  timeDays: number,
  out: Float64Array,
): Float64Array {
  // 1/1000 day = 86.4 s: small enough that the chord matches the tangent to well under a
  // metre per second, large enough to stay clear of float64 cancellation.
  const h = 1e-3;
  bodyPositionAt(system, body, timeDays + h, out);
  bodyPositionAt(system, body, timeDays - h, TMP);
  const inv = 1 / (2 * h * 86400);
  out[0] = (out[0] - TMP[0]) * inv;
  out[1] = (out[1] - TMP[1]) * inv;
  out[2] = (out[2] - TMP[2]) * inv;
  return out;
}

/** Add one orbit's offset to `out`. */
function orbitOffset(orbit: Orbit, timeDays: number, out: Float64Array): void {
  const meanAnomaly = orbit.phase0 + (TAU * timeDays) / orbit.periodDays;
  const e = orbit.eccentricity;

  // Newton on Kepler's equation. Three iterations are enough below e=0.2 (error < 1e-10)
  // and, unlike a fixed series expansion, it stays exact as eccentricity grows.
  let E = meanAnomaly;
  for (let i = 0; i < 3; i++) {
    E -= (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E));
  }

  const a = orbit.semiMajorM;
  const b = a * Math.sqrt(1 - e * e);
  const px = a * (Math.cos(E) - e);
  const pz = b * Math.sin(E);

  // Inclination about X, then rotate by the node about Y.
  const iy = pz * Math.sin(orbit.inclination);
  const iz = pz * Math.cos(orbit.inclination);
  const cn = Math.cos(orbit.node);
  const sn = Math.sin(orbit.node);

  out[0] += px * cn - iz * sn;
  out[1] += iy;
  out[2] += px * sn + iz * cn;
}

/** Orbital speed of a body around its parent, m/s. Handy for HUD and tests. */
export function orbitSpeed(orbit: Orbit): number {
  return (TAU * orbit.semiMajorM) / (orbit.periodDays * 86400);
}

function pickPlanetKind(rng: Rng, au: number, hzAu: number): BodyKind {
  const warmth = au / Math.max(0.05, hzAu);
  if (warmth > 2.6) return rng.pickWeighted<BodyKind>(['gas', 'ice', 'rocky'], [0.52, 0.36, 0.12]);
  if (warmth > 1.25) return rng.pickWeighted<BodyKind>(['ice', 'rocky', 'gas'], [0.42, 0.44, 0.14]);
  if (warmth > 0.72) return rng.pickWeighted<BodyKind>(['ocean', 'rocky', 'desert'], [0.34, 0.42, 0.24]);
  if (warmth > 0.4) return rng.pickWeighted<BodyKind>(['desert', 'rocky', 'volcanic'], [0.44, 0.34, 0.22]);
  return rng.pickWeighted<BodyKind>(['volcanic', 'rocky', 'desert'], [0.46, 0.34, 0.20]);
}

function atmosphereFor(kind: BodyKind, rng: Rng): number {
  switch (kind) {
    case 'gas': return 1;
    case 'ocean': return rng.range(0.55, 1);
    case 'desert': return rng.range(0.05, 0.55);
    case 'volcanic': return rng.range(0.1, 0.8);
    case 'ice': return rng.range(0, 0.3);
    default: return rng.bool(0.45) ? rng.range(0.02, 0.5) : 0;
  }
}

function waterFor(kind: BodyKind, rng: Rng): number {
  switch (kind) {
    case 'ocean': return rng.range(0.5, 0.86);
    case 'rocky': return rng.bool(0.3) ? rng.range(0.05, 0.4) : 0;
    case 'ice': return rng.range(0.2, 0.7);
    default: return 0;
  }
}

/** Equilibrium temperature with a crude greenhouse term. */
function surfaceTemperature(luminosity: number, au: number, atmosphere: number): number {
  const eq = 278.6 * Math.pow(luminosity, 0.25) / Math.sqrt(Math.max(0.02, au));
  return clamp(eq * (1 + atmosphere * 0.35), 30, 900);
}

/** Bodies you can land on: solid surface, and not the star. */
export function landableBodies(system: StarSystem): SystemBody[] {
  return system.bodies.filter((b) => b.kind !== 'star' && b.kind !== 'gas' && b.kind !== 'belt' && b.kind !== 'station');
}
