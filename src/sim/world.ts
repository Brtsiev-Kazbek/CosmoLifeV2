import { Rng } from '../lib/rng';
import { SECONDS_PER_DAY } from '../lib/loop';
import { starsNear, type Star } from '../procgen/galaxy';
import { generateSystem, landableBodies, type StarSystem, type SystemBody } from '../procgen/system';
import { settlementName } from '../procgen/names';
import { createMarket, rollEvent, stepEvents, stepStock, type Market } from './economy';
import { stepProduction } from './production';
import { stepBackgroundFreight } from './logistics';
import { ECONOMY_TYPES, type CommodityId, type EconomyType } from './commodities';
import { newShipState, type ShipState } from './flight';
import type { Route } from './route';

/**
 * The world: one galaxy seed, one clock, and whatever the player is currently near.
 *
 * Only the current system is instantiated. Everything else is a function of the seed, so
 * "state" here is the player's own history plus the handful of markets in reach — which
 * is what keeps a save file constant-sized no matter how far someone has flown.
 */

export type PortKind = 'station' | 'settlement';

export interface Port {
  id: string;
  name: string;
  bodyId: string;
  kind: PortKind;
  economy: EconomyType;
  population: number;
  /** 0..1. Low law means contraband trades openly and pirates operate nearby. */
  law: number;
  /** Surface position for settlements, radians. Unused by stations. */
  latitude: number;
  longitude: number;
}

export interface Player {
  ship: ShipState;
  credits: number;
  /** Tonnes carried, keyed by commodity. Iterated only through COMMODITY_IDS. */
  cargo: Map<CommodityId, number>;
  holdTonnes: number;
  fuel: number;
  fuelCapacity: number;
  jumpRangeLy: number;
  /** Body or port currently selected as the nav target. */
  targetId: string | null;
  route: Route | null;
  /** Port the player is docked or landed at, if any. */
  dockedAt: string | null;
}

export interface World {
  seed: number;
  /** Absolute world time in days. Orbits are evaluated from this directly. */
  timeDays: number;
  star: Star;
  system: StarSystem;
  ports: Port[];
  markets: Map<string, Market>;
  player: Player;
  /** Carried fractional background-freight budget. */
  freightCarry: number;
  /** Whole days already processed, so market ticks happen once per day. */
  daysProcessed: number;
}

/** Where a new commander starts: a populated system near a spiral arm. */
export const START_POSITION_LY = { x: 7200, y: 0, z: 3600 };

export function createWorld(seed: number): World {
  const star = starsNear(START_POSITION_LY.x, START_POSITION_LY.y, START_POSITION_LY.z, 60, seed)[0];
  return enterSystem(seed, star, 0);
}

/** Build (or rebuild) the live state for a system at a given world time. */
export function enterSystem(seed: number, star: Star, timeDays: number, player?: Player): World {
  const system = generateSystem(star);
  const ports = generatePorts(system, star);
  const markets = new Map<string, Market>();
  for (const port of ports) {
    markets.set(
      port.id,
      createMarket(port.id, port.economy, port.population, port.law, new Rng(`${star.seed}:${port.id}`)),
    );
  }

  const world: World = {
    seed,
    timeDays,
    star,
    system,
    ports,
    markets,
    player: player ?? createPlayer(),
    freightCarry: 0,
    daysProcessed: Math.floor(timeDays),
  };

  // Settle the markets so a freshly entered system does not read as a brand new economy
  // where every world holds exactly its equilibrium. 90 days is ~8 restock time constants.
  const rng = new Rng(`${star.seed}:settle`);
  const list = [...markets.values()];
  for (let d = 0; d < 90; d++) {
    for (const m of list) {
      stepProduction(m);
      stepEvents(m, 1);
      stepStock(m, 1, rng);
    }
    world.freightCarry = stepBackgroundFreight(list, 1, world.freightCarry);
  }
  for (const m of list) stepProduction(m);
  return world;
}

function createPlayer(): Player {
  return {
    ship: newShipState(),
    credits: 1200,
    cargo: new Map(),
    holdTonnes: 24,
    fuel: 16,
    fuelCapacity: 16,
    jumpRangeLy: 14,
    targetId: null,
    route: null,
    dockedAt: null,
  };
}

/**
 * Ports in a system: every station, plus settlements on bodies that can hold them.
 *
 * Population comes from a log-uniform roll, so a system usually has a couple of outposts
 * and occasionally a capital — a linear roll makes every world the same size, which
 * removes the only thing that distinguishes one market from another at a glance.
 */
function generatePorts(system: StarSystem, star: Star): Port[] {
  const ports: Port[] = [];
  const rng = new Rng(star.seed).derive('ports');

  for (const body of system.bodies) {
    if (body.kind !== 'station') continue;
    const pr = rng.derive('station', ports.length);
    ports.push({
      id: `port:${body.id}`,
      name: body.name,
      bodyId: body.id,
      kind: 'station',
      economy: pickEconomy(pr, body),
      population: Math.round(Math.pow(10, pr.range(2.6, 4.6))),
      law: pr.range(0.25, 0.95),
      latitude: 0,
      longitude: 0,
    });
  }

  for (const body of landableBodies(system)) {
    const br = new Rng(body.seed).derive('settlements');
    // Habitability gate: an airless 700 K rock gets an outpost at best.
    const habitable = body.atmosphere > 0.15 && body.temperatureK > 210 && body.temperatureK < 340;
    const chance = habitable ? 0.75 : 0.25;
    if (!br.bool(chance)) continue;
    const count = habitable ? br.int(1, 3) : 1;
    for (let i = 0; i < count; i++) {
      const sr = br.derive('settlement', i);
      const maxPop = habitable ? 6.6 : 3.6;
      ports.push({
        id: `port:${body.id}:${i}`,
        name: settlementName(sr.derive('name')),
        bodyId: body.id,
        kind: 'settlement',
        economy: pickEconomy(sr, body),
        population: Math.round(Math.pow(10, sr.range(2.0, maxPop))),
        law: sr.range(0.05, 0.98),
        // Latitude is biased toward the temperate band rather than uniform on the sphere:
        // uniform placement puts a quarter of all towns above 60 degrees.
        latitude: sr.gauss(0, 0.55),
        longitude: sr.range(-Math.PI, Math.PI),
      });
    }
  }

  ports.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return ports;
}

function pickEconomy(rng: Rng, body: SystemBody): EconomyType {
  // Weight by what the body could plausibly support; the result still surprises, but a
  // farming world on an airless moon reads as a bug rather than as variety.
  const weights = ECONOMY_TYPES.map((type) => {
    switch (type) {
      case 'agriculture': return body.atmosphere > 0.3 && body.water > 0.1 ? 1.4 : 0.05;
      case 'extraction': return body.kind === 'moon' || body.kind === 'rocky' ? 1.5 : 0.6;
      case 'refinery': return 1.0;
      case 'industrial': return body.atmosphere > 0.1 ? 1.1 : 0.5;
      case 'hightech': return body.atmosphere > 0.2 ? 0.9 : 0.3;
      case 'service': return body.kind === 'station' ? 1.6 : 0.7;
      case 'military': return 0.5;
      case 'colony': return 0.8;
      case 'anarchy': return 0.35;
      default: return 0.5;
    }
  });
  return rng.pickWeighted(ECONOMY_TYPES, weights);
}

/**
 * Advance the world by real seconds.
 *
 * Market updates happen on whole-day boundaries rather than every tick: the restock rate
 * is expressed per day, and running it 60 times a second with dt=1/18000 accumulates
 * float error in the drift term without changing anything a player can see.
 */
export function stepWorld(world: World, dtSeconds: number, timeScale = 1): void {
  world.timeDays += (dtSeconds * timeScale) / SECONDS_PER_DAY;

  const wholeDays = Math.floor(world.timeDays);
  if (wholeDays <= world.daysProcessed) return;

  const list = [...world.markets.values()];
  const rng = new Rng(`${world.star.seed}:day:${wholeDays}`);
  for (let d = world.daysProcessed; d < wholeDays; d++) {
    for (const m of list) {
      stepProduction(m);
      stepEvents(m, 1);
      stepStock(m, 1, rng);
      rollEvent(m, rng, d);
    }
    world.freightCarry = stepBackgroundFreight(list, 1, world.freightCarry);
  }
  for (const m of list) stepProduction(m);
  world.daysProcessed = wholeDays;
}

/** Tonnes currently in the hold. */
export function cargoUsed(player: Player): number {
  let total = 0;
  for (const v of player.cargo.values()) total += v;
  return total;
}

export function cargoFree(player: Player): number {
  return Math.max(0, player.holdTonnes - cargoUsed(player));
}

export function addCargo(player: Player, id: CommodityId, tonnes: number): void {
  player.cargo.set(id, (player.cargo.get(id) ?? 0) + tonnes);
}

export function removeCargo(player: Player, id: CommodityId, tonnes: number): number {
  const have = player.cargo.get(id) ?? 0;
  const taken = Math.min(have, tonnes);
  if (have - taken <= 1e-9) player.cargo.delete(id);
  else player.cargo.set(id, have - taken);
  return taken;
}

/** The body a port sits on or orbits. */
export function portBody(world: World, port: Port): SystemBody | undefined {
  return world.system.byId.get(port.bodyId);
}
