import { Rng } from '../lib/rng';
import { clamp } from '../lib/util';
import {
  COMMODITIES, COMMODITY_IDS, commodity, economyProfile,
  type CommodityId, type EconomyType,
} from './commodities';

/**
 * Markets hold **stock**, never a price.
 *
 * Price is a function of how much is on the shelf, which is what makes trade physical:
 * buying out a warehouse pushes the price up while you are still buying, and dumping
 * sixty tonnes of grain on a farming world collapses it. A market that stored a price and
 * nudged it toward a target would produce the same numbers on screen and none of the
 * behaviour.
 */

/** price = base * clamp((eq / stock)^PRICE_EXPONENT, PRICE_MIN, PRICE_MAX) * modifier */
export const PRICE_EXPONENT = 0.42;
export const PRICE_MIN = 0.32;
export const PRICE_MAX = 3.6;
/** Stock is floored at this fraction of equilibrium so the price cannot go to infinity. */
export const STOCK_FLOOR_FRACTION = 0.05;
/** Dealer spread: you buy above the price and sell below it. */
export const BUY_SPREAD = 1.06;
export const SELL_SPREAD = 0.94;
/** Fraction of the gap to the target closed per day. ~11 days to settle. */
export const RESTOCK_RATE = 0.09;

/**
 * Daily consumption as a fraction of the market's scale.
 *
 * Measured, not chosen. Supply at autarky works out to
 * `EQ_BASELINE / (consumeWeight * RATION * BUFFER_DAYS)`, so with the industrial world's
 * alloy weight of 1.6: RATION 0.12 settles every world at 0.20 supply (permanent famine,
 * nothing ever recovers), 0.02 settles at 1.0 (nothing is ever scarce and the chains are
 * decoration), and 0.03 lands on 0.80 — tight enough that a lost convoy hurts, loose
 * enough that a world is not always starving.
 */
export const RATION = 0.03;
/** Days of input a factory wants on hand before it counts itself fully supplied. */
export const BUFFER_DAYS = 6;
/** Output floor: a starved factory still holds a quarter of its equilibrium stock. */
export const SUPPLY_FLOOR = 0.25;

/**
 * Equilibrium stock of a good the market does not produce, as a fraction of its scale.
 *
 * This single number sets where the whole economy sits. It is not free: it is pinned by
 * the calibration above, since supply = EQ_BASELINE / (cw * RATION * BUFFER_DAYS).
 */
export const EQ_BASELINE = 0.23;
/** Extra equilibrium stock per unit of production weight. */
export const EQ_PER_PRODUCTION = 1.5;

export interface MarketEntry {
  id: CommodityId;
  /** Tonnes on the shelf. The only stored state. */
  stock: number;
  /** Tonnes the market tends toward when fully supplied. */
  equilibrium: number;
  produceWeight: number;
  consumeWeight: number;
  /** Local price multiplier from events and law. 1 is neutral. */
  modifier: number;
  /** 0..1 input supply for a produced good; 1 for anything not produced here. */
  supply: number;
  /** Id of the input that is holding production back, for the port screen's "why". */
  bottleneck: CommodityId | null;
}

export interface Market {
  id: string;
  economy: EconomyType;
  population: number;
  /** 0..1. Low means contraband trades openly and prices are wilder. */
  law: number;
  /** Scale factor derived from population; every quantity is proportional to it. */
  scale: number;
  /** Ordered exactly like COMMODITY_IDS — iteration order is part of determinism. */
  entries: MarketEntry[];
  byId: Map<CommodityId, MarketEntry>;
  /** Active local events, ordered by id. */
  events: MarketEvent[];
}

export interface MarketEvent {
  id: string;
  kind: 'harvest-failure' | 'strike' | 'lost-convoy' | 'new-vein';
  commodity: CommodityId;
  daysLeft: number;
  /** Multiplier applied to the affected commodity's price modifier. */
  strength: number;
}

/** Population enters sub-linearly: a capital is bigger, not a thousand times bigger. */
export function marketScale(population: number): number {
  return 40 * Math.pow(Math.max(1, population), 0.42);
}

export function createMarket(
  id: string,
  economy: EconomyType,
  population: number,
  law: number,
  rng: Rng,
): Market {
  const profile = economyProfile(economy);
  const scale = marketScale(population);

  const produce = new Map<CommodityId, number>();
  for (const [cid, w] of profile.produces) produce.set(cid, w);
  const consume = new Map<CommodityId, number>();
  for (const [cid, w] of profile.consumes) consume.set(cid, w);

  const entries: MarketEntry[] = [];
  const byId = new Map<CommodityId, MarketEntry>();
  for (const c of COMMODITIES) {
    const pw = produce.get(c.id) ?? 0;
    const cw = consume.get(c.id) ?? 0;
    const equilibrium = scale * (EQ_BASELINE + EQ_PER_PRODUCTION * pw);
    const entry: MarketEntry = {
      id: c.id,
      // Start scattered around equilibrium so two worlds of the same type are not clones.
      stock: equilibrium * rng.range(0.75, 1.25),
      equilibrium,
      produceWeight: pw,
      consumeWeight: cw,
      modifier: 1,
      supply: 1,
      bottleneck: null,
    };
    entries.push(entry);
    byId.set(c.id, entry);
  }

  const market: Market = { id, economy, population, law, scale, entries, byId, events: [] };
  applyLawModifiers(market);
  return market;
}

/** Contraband is dear where the law is strong, because supplying it is dangerous. */
function applyLawModifiers(market: Market): void {
  for (const e of market.entries) {
    if (commodity(e.id).illegal) {
      e.modifier = 0.7 + market.law * 1.4;
      // A lawful world barely stocks contraband at all.
      e.equilibrium *= 1 - market.law * 0.8;
      e.stock = Math.min(e.stock, e.equilibrium);
    }
  }
}

/** Reference price before the dealer's spread. */
export function unitPrice(entry: MarketEntry): number {
  const base = commodity(entry.id).base;
  const floor = entry.equilibrium * STOCK_FLOOR_FRACTION;
  const scarcity = entry.equilibrium / Math.max(entry.stock, floor);
  return base * clamp(Math.pow(scarcity, PRICE_EXPONENT), PRICE_MIN, PRICE_MAX) * entry.modifier;
}

export function buyPrice(entry: MarketEntry): number {
  return unitPrice(entry) * BUY_SPREAD;
}

export function sellPrice(entry: MarketEntry): number {
  return unitPrice(entry) * SELL_SPREAD;
}

/**
 * Cost of buying `tonnes`, integrating the price as the shelf empties.
 *
 * A flat `price * quantity` would let a player empty a warehouse at the first tonne's
 * price; the whole point of storing stock is that the market moves under the trade.
 */
export function quoteBuy(entry: MarketEntry, tonnes: number): { cost: number; filled: number } {
  const step = Math.max(1, Math.floor(tonnes / 32));
  let filled = 0;
  let cost = 0;
  const saved = entry.stock;
  while (filled < tonnes) {
    const take = Math.min(step, tonnes - filled, entry.stock);
    if (take <= 0) break;
    cost += buyPrice(entry) * take;
    entry.stock -= take;
    filled += take;
  }
  entry.stock = saved;
  return { cost, filled };
}

export function quoteSell(entry: MarketEntry, tonnes: number): { revenue: number; filled: number } {
  const step = Math.max(1, Math.floor(tonnes / 32));
  let filled = 0;
  let revenue = 0;
  const saved = entry.stock;
  while (filled < tonnes) {
    const give = Math.min(step, tonnes - filled);
    revenue += sellPrice(entry) * give;
    entry.stock += give;
    filled += give;
  }
  entry.stock = saved;
  return { revenue, filled };
}

/** Execute a purchase: stock leaves the market. Returns credits spent and tonnes moved. */
export function executeBuy(entry: MarketEntry, tonnes: number): { cost: number; filled: number } {
  const quote = quoteBuy(entry, tonnes);
  entry.stock = Math.max(0, entry.stock - quote.filled);
  return quote;
}

export function executeSell(entry: MarketEntry, tonnes: number): { revenue: number; filled: number } {
  const quote = quoteSell(entry, tonnes);
  entry.stock += quote.filled;
  return quote;
}

/** Daily consumption of one good, in tonnes. */
export function consumptionPerDay(entry: MarketEntry, market: Market): number {
  return market.scale * entry.consumeWeight * RATION;
}

/** Roll a local event. Called by the world tick, not by the market itself. */
export function rollEvent(market: Market, rng: Rng, dayIndex: number): MarketEvent | null {
  // ~1 event per market per 40 days: often enough to notice, rare enough to be news.
  if (!rng.bool(0.025)) return null;
  const producing = market.entries.filter((e) => e.produceWeight > 0);
  const consuming = market.entries.filter((e) => e.consumeWeight > 0);
  const kind = rng.pick(['harvest-failure', 'strike', 'lost-convoy', 'new-vein'] as const);
  const pool = kind === 'lost-convoy' ? consuming : producing;
  if (pool.length === 0) return null;
  const target = pool[rng.index(pool.length)];
  const event: MarketEvent = {
    id: `${market.id}:${dayIndex}:${kind}`,
    kind,
    commodity: target.id,
    daysLeft: kind === 'new-vein' ? rng.range(20, 60) : rng.range(8, 26),
    strength: kind === 'new-vein' ? rng.range(0.6, 0.85) : rng.range(1.25, 1.9),
  };
  market.events.push(event);
  // Events bite immediately as a stock shock, then decay through the modifier: a strike
  // that only moved a multiplier would be invisible to a trader already in the system.
  switch (kind) {
    case 'harvest-failure':
    case 'strike':
      target.stock *= rng.range(0.25, 0.55);
      break;
    case 'lost-convoy':
      target.stock *= rng.range(0.4, 0.7);
      break;
    case 'new-vein':
      target.stock *= rng.range(1.5, 2.4);
      break;
  }
  return event;
}

/** Advance events and fold them into price modifiers. */
export function stepEvents(market: Market, dtDays: number): void {
  for (const e of market.entries) {
    if (!commodity(e.id).illegal) e.modifier = 1;
  }
  applyLawModifiers(market);

  const surviving: MarketEvent[] = [];
  for (const ev of market.events) {
    ev.daysLeft -= dtDays;
    if (ev.daysLeft > 0) {
      const entry = market.byId.get(ev.commodity);
      if (entry) entry.modifier *= ev.strength;
      surviving.push(ev);
    }
  }
  market.events = surviving;
}

/**
 * Restock toward the target, plus random drift.
 *
 * `target` comes from the production model and is a **level**, not a rate — see
 * production.ts for why gating the rate instead barely moves prices at all.
 */
export function stepStock(market: Market, dtDays: number, rng: Rng): void {
  for (const entry of market.entries) {
    const target = entry.equilibrium * (entry.produceWeight > 0
      ? SUPPLY_FLOOR + (1 - SUPPLY_FLOOR) * entry.supply
      : 1);
    entry.stock += (target - entry.stock) * RESTOCK_RATE * dtDays;
    const vol = commodity(entry.id).volatility;
    entry.stock += entry.equilibrium * rng.gauss(0, vol * 0.06) * dtDays;
    if (entry.stock < 0) entry.stock = 0;
  }
}

/** Every commodity id in table order — the only sanctioned way to iterate a market. */
export function marketIds(): readonly CommodityId[] {
  return COMMODITY_IDS;
}
