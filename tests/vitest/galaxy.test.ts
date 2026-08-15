import { describe, expect, it } from 'vitest';
import {
  SECTOR_LY, density, sectorOf, starsInSector, starsNear, starById, starDistance,
} from '../../src/procgen/galaxy';
import { generateSystem, bodyPositionAt, bodyVelocityAt, orbitSpeed, AU } from '../../src/procgen/system';
import { transliterate } from '../../src/procgen/names';

const SEED = 20260815;

describe('galaxy — infinite and stored nowhere', () => {
  it('returns the identical sector on every call', () => {
    const a = starsInSector({ ix: 600, iy: 0, iz: 300 }, SEED);
    const b = starsInSector({ ix: 600, iy: 0, iz: 300 }, SEED);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('flying a thousand light years out and back gives the same systems', () => {
    const home = { ix: 600, iy: 0, iz: 300 };
    const before = starsInSector(home, SEED);
    // Visit sectors 1000 ly away in every direction; nothing is cached, so this is only
    // meaningful as a proof that generation has no hidden global state.
    for (let i = 0; i < 40; i++) {
      starsInSector({ ix: home.ix + 83 + i, iy: i % 3, iz: home.iz - 83 - i }, SEED);
    }
    expect(JSON.stringify(starsInSector(home, SEED))).toBe(JSON.stringify(before));
  });

  it('gives a different galaxy for a different seed', () => {
    const a = starsInSector({ ix: 600, iy: 0, iz: 300 }, SEED);
    const b = starsInSector({ ix: 600, iy: 0, iz: 300 }, SEED + 1);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('places stars inside their own sector', () => {
    for (let i = 0; i < 50; i++) {
      const sector = { ix: 600 + i, iy: 0, iz: 300 - i };
      for (const s of starsInSector(sector, SEED)) {
        expect(sectorOf(s.x, s.y, s.z)).toEqual(sector);
      }
    }
  });

  it('gives every star a unique, resolvable id', () => {
    const seen = new Set<string>();
    for (let dx = 0; dx < 6; dx++) {
      for (let dz = 0; dz < 6; dz++) {
        for (const s of starsInSector({ ix: 600 + dx, iy: 0, iz: 300 + dz }, SEED)) {
          expect(seen.has(s.id)).toBe(false);
          seen.add(s.id);
          const found = starById(s.id, SEED);
          expect(found?.name).toBe(s.name);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(20);
  });
});

describe('spiral arm density field', () => {
  it('stays in [0, 1] everywhere, including the exact centre', () => {
    expect(density(0, 0, 0)).toBeGreaterThan(0);
    expect(density(0, 0, 0)).toBeLessThanOrEqual(1);
    for (let i = 0; i < 2000; i++) {
      const a = (i / 2000) * Math.PI * 2;
      const r = i * 20;
      const d = density(Math.cos(a) * r, ((i % 21) - 10) * 60, Math.sin(a) * r);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('is brightest in the core and fades outward', () => {
    expect(density(0, 0, 0)).toBeGreaterThan(density(0, 0, 9000));
    expect(density(0, 0, 9000)).toBeGreaterThan(density(0, 0, 40000));
  });

  it('is thin vertically — a disc, not a ball', () => {
    expect(density(8000, 0, 0)).toBeGreaterThan(density(8000, 1200, 0) * 5);
  });

  it('actually produces arms: density varies strongly around a ring', () => {
    let lo = Infinity;
    let hi = 0;
    const r = 9000;
    for (let i = 0; i < 720; i++) {
      const a = (i / 720) * Math.PI * 2;
      const d = density(Math.cos(a) * r, 0, Math.sin(a) * r);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    // Arms must be clearly denser than the inter-arm void, or the map is a smooth blob.
    expect(hi / Math.max(lo, 1e-9)).toBeGreaterThan(3);
  });

  it('makes arms denser in stars, not just in the field', () => {
    // Sample real star counts on a ring and check the spread follows the field.
    let armStars = 0;
    let voidStars = 0;
    const r = 9000 / SECTOR_LY;
    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * Math.PI * 2;
      const sector = { ix: Math.round(Math.cos(a) * r), iy: 0, iz: Math.round(Math.sin(a) * r) };
      const d = density(sector.ix * SECTOR_LY, 0, sector.iz * SECTOR_LY);
      const n = starsInSector(sector, SEED).length;
      if (d > 0.25) armStars += n;
      else if (d < 0.08) voidStars += n;
    }
    expect(armStars).toBeGreaterThan(voidStars);
  });
});

describe('starsNear', () => {
  it('returns a distance-sorted list with no star outside the radius', () => {
    const stars = starsNear(7200, 0, 3600, 40, SEED);
    expect(stars.length).toBeGreaterThan(0);
    let prev = -1;
    for (const s of stars) {
      const d = Math.hypot(s.x - 7200, s.y, s.z - 3600);
      expect(d).toBeLessThanOrEqual(40 + 1e-9);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
  });

  it('is order-stable across calls', () => {
    const a = starsNear(7200, 0, 3600, 30, SEED).map((s) => s.id);
    const b = starsNear(7200, 0, 3600, 30, SEED).map((s) => s.id);
    expect(a).toEqual(b);
  });
});

describe('systems — analytic orbits', () => {
  const star = starsNear(7200, 0, 3600, 60, SEED)[0];
  const system = generateSystem(star);

  it('generates identically from the same star', () => {
    const again = generateSystem(star);
    expect(again.bodies.map((b) => `${b.id}:${b.name}:${Math.round(b.radiusM)}`))
      .toEqual(system.bodies.map((b) => `${b.id}:${b.name}:${Math.round(b.radiusM)}`));
  });

  it('keeps planet and moon radii inside the specified envelope', () => {
    for (const b of system.bodies) {
      if (b.kind === 'moon') {
        expect(b.radiusM).toBeGreaterThanOrEqual(3e5);
        expect(b.radiusM).toBeLessThanOrEqual(1.1e6);
      } else if (['rocky', 'ocean', 'desert', 'ice', 'volcanic'].includes(b.kind)) {
        expect(b.radiusM).toBeGreaterThanOrEqual(1.4e6);
        expect(b.radiusM).toBeLessThanOrEqual(7.2e6);
      }
    }
  });

  it('reaches day 900 directly, with no stepping', () => {
    // The whole point of analytic orbits: entering a system on day 900 must not require
    // simulating days 0..899. Stepping in 1-day increments must land in the same place.
    const out = new Float64Array(3);
    const body = system.bodies.find((b) => b.orbit && b.orbit.parentId === '');
    if (!body) return;
    bodyPositionAt(system, body, 900, out);
    const direct = [out[0], out[1], out[2]];

    // Independently recompute the closed form at t=900 after touching every earlier day,
    // proving there is no accumulated state anywhere in the path.
    for (let d = 0; d < 900; d++) bodyPositionAt(system, body, d, out);
    bodyPositionAt(system, body, 900, out);
    expect(out[0]).toBe(direct[0]);
    expect(out[1]).toBe(direct[1]);
    expect(out[2]).toBe(direct[2]);
  });

  it('closes the orbit after exactly one period', () => {
    const out = new Float64Array(3);
    const body = system.bodies.find((b) => b.orbit);
    if (!body || !body.orbit) return;
    bodyPositionAt(system, body, 17, out);
    const a = [out[0], out[1], out[2]];
    bodyPositionAt(system, body, 17 + body.orbit.periodDays, out);
    expect(Math.hypot(out[0] - a[0], out[1] - a[1], out[2] - a[2])).toBeLessThan(body.orbit.semiMajorM * 1e-9);
  });

  it('carries a moon along with its planet', () => {
    const moon = system.bodies.find((b) => b.kind === 'moon');
    if (!moon || !moon.orbit) return;
    const planet = system.byId.get(moon.orbit.parentId)!;
    const mp = new Float64Array(3);
    const pp = new Float64Array(3);
    for (const t of [0, 30, 400]) {
      bodyPositionAt(system, moon, t, mp);
      bodyPositionAt(system, planet, t, pp);
      const sep = Math.hypot(mp[0] - pp[0], mp[1] - pp[1], mp[2] - pp[2]);
      // Separation must stay near the moon's own semi-major axis regardless of where the
      // planet is in its own year.
      expect(sep).toBeGreaterThan(moon.orbit.semiMajorM * 0.7);
      expect(sep).toBeLessThan(moon.orbit.semiMajorM * 1.4);
    }
  });

  it('gives velocities that match the position derivative', () => {
    const body = system.bodies.find((b) => b.orbit)!;
    const v = new Float64Array(3);
    const p0 = new Float64Array(3);
    const p1 = new Float64Array(3);
    bodyVelocityAt(system, body, 55, v);
    bodyPositionAt(system, body, 55, p0);
    bodyPositionAt(system, body, 55 + 1 / 86400, p1);
    const fd = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    expect(v[0]).toBeCloseTo(fd[0], 1);
    expect(v[2]).toBeCloseTo(fd[2], 1);
  });

  it('keeps station orbital speed catchable by a 620 m/s ship', () => {
    // Real orbital speeds are 30 km/s and rendezvous would be arithmetically impossible.
    // The design target is ~100 m/s, and it must hold for a station around a gas giant
    // too — that case measured 1093 m/s before the speed cap was added.
    let checked = 0;
    for (let i = 0; i < 200; i++) {
      const s = starsNear(7200 + i * 37, 0, 3600 - i * 11, 15, SEED)[0];
      if (!s) continue;
      for (const b of generateSystem(s).bodies) {
        if (b.kind === 'station' && b.orbit) {
          const v = orbitSpeed(b.orbit);
          expect(v).toBeGreaterThan(5);
          expect(v).toBeLessThanOrEqual(110 + 1e-9);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('keeps every orbiting body slow enough to intercept', () => {
    for (let i = 0; i < 60; i++) {
      const s = starsNear(7200 + i * 53, 0, 3600 + i * 29, 15, SEED)[0];
      if (!s) continue;
      for (const b of generateSystem(s).bodies) {
        if (b.orbit) expect(orbitSpeed(b.orbit)).toBeLessThanOrEqual(520 + 1e-9);
      }
    }
  });

  it('orders planets outward from the star', () => {
    const planets = system.bodies.filter((b) => b.orbit && b.orbit.parentId === '' && b.kind !== 'belt');
    for (let i = 1; i < planets.length; i++) {
      expect(planets[i].orbit!.semiMajorM).toBeGreaterThan(planets[i - 1].orbit!.semiMajorM);
    }
  });

  it('places the innermost planet outside the star', () => {
    const star0 = system.bodies[0];
    for (const b of system.bodies) {
      if (b.orbit && b.orbit.parentId === '') {
        expect(b.orbit.semiMajorM).toBeGreaterThan(star0.radiusM);
      }
    }
  });
});

describe('names', () => {
  it('transliterates to Cyrillic deterministically', () => {
    expect(transliterate('Shanto')).toBe('Шанто');
    // 'ae' is a digraph in the table and becomes a single 'э', not 'аэ'.
    expect(transliterate('Kraeus')).toBe('Крэус');
    expect(transliterate(transliterate('Shanto'))).toBe(transliterate('Shanto'));
  });

  it('keeps numerals and separators', () => {
    expect(transliterate('Ren-42')).toBe('Рен-42');
  });

  it('generates names that survive a round trip through the galaxy', () => {
    const star = starsNear(7200, 0, 3600, 50, SEED)[0];
    expect(star.name.length).toBeGreaterThan(1);
    expect(transliterate(star.name).length).toBeGreaterThan(1);
  });
});

describe('scale sanity', () => {
  it('AU and sector size are what the design says', () => {
    expect(SECTOR_LY).toBe(12);
    expect(Math.round(AU)).toBe(149597870700);
  });

  it('star distance is symmetric', () => {
    const [a, b] = starsNear(7200, 0, 3600, 50, SEED);
    expect(starDistance(a, b)).toBeCloseTo(starDistance(b, a), 9);
  });
});
