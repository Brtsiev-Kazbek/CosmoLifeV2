import { commodity, type CommodityId } from './commodities';
import { BUFFER_DAYS, RATION, SUPPLY_FLOOR, type Market, type MarketEntry } from './economy';
import { clamp01 } from '../lib/util';

/**
 * Production gating — what a world can actually make.
 *
 * Two decisions here, both load-bearing:
 *
 * 1. **The worst input decides.** Supply is the minimum across inputs, not an average,
 *    because a factory missing one component is stopped, not slowed. An average lets a
 *    world with plenty of alloy and no electronics keep producing weapons at 70%, which
 *    quietly removes the entire point of a supply chain.
 *
 * 2. **Supply sets a level, not a rate.** The target stock is scaled by supply and the
 *    restock rate is untouched. Gating the rate instead was tried and measured: sixty days
 *    of total starvation moved the price by 6%, because stock still crept to the same
 *    equilibrium, just slower. Gating the level takes alloy from 593 t to 170 t and the
 *    price from 309 to 521 — the shortage is finally visible in the only place the player
 *    reads the economy from.
 */

export interface SupplyReport {
  id: CommodityId;
  supply: number;
  bottleneck: CommodityId | null;
  /** Days of the bottleneck input actually on hand. */
  bottleneckDays: number;
}

/** Days of stock a market holds of one input, relative to what it burns. */
export function daysOfStock(entry: MarketEntry, market: Market): number {
  const perDay = market.scale * entry.consumeWeight * RATION;
  if (perDay <= 0) return Infinity;
  return entry.stock / perDay;
}

/**
 * Supply for a single produced good.
 *
 * Only inputs the world actually consumes gate it: an economy profile that produces
 * machinery lists alloy among its consumed goods, and an input nobody consumes is one the
 * world does not use in its process.
 */
export function supplyFor(market: Market, id: CommodityId): SupplyReport {
  const inputs = commodity(id).inputs;
  let worst = 1;
  let bottleneck: CommodityId | null = null;
  let bottleneckDays = Infinity;

  for (const [inputId] of inputs) {
    const entry = market.byId.get(inputId);
    if (!entry || entry.consumeWeight <= 0) continue;
    const days = daysOfStock(entry, market);
    const s = clamp01(days / BUFFER_DAYS);
    if (s < worst) {
      worst = s;
      bottleneck = inputId;
      bottleneckDays = days;
    }
  }
  return { id, supply: worst, bottleneck, bottleneckDays };
}

/** Recompute supply for every produced good. Called once per market tick. */
export function stepProduction(market: Market): void {
  for (const entry of market.entries) {
    if (entry.produceWeight <= 0) {
      entry.supply = 1;
      entry.bottleneck = null;
      continue;
    }
    const report = supplyFor(market, entry.id);
    entry.supply = report.supply;
    entry.bottleneck = report.bottleneck;
  }
}

/** The stock level a produced good is heading for, given its current supply. */
export function targetStock(entry: MarketEntry): number {
  if (entry.produceWeight <= 0) return entry.equilibrium;
  return entry.equilibrium * (SUPPLY_FLOOR + (1 - SUPPLY_FLOOR) * entry.supply);
}

/**
 * Mean supply across everything a market produces. The single number that says whether a
 * world is healthy; the calibration target is about 0.8 for a world trading normally.
 */
export function meanSupply(market: Market): number {
  let sum = 0;
  let count = 0;
  for (const entry of market.entries) {
    if (entry.produceWeight <= 0) continue;
    sum += entry.supply;
    count++;
  }
  return count === 0 ? 1 : sum / count;
}

/** Goods this market is short of, worst first, for contract and freight generation. */
export function shortages(market: Market): SupplyReport[] {
  const out: SupplyReport[] = [];
  for (const entry of market.entries) {
    if (entry.produceWeight <= 0) continue;
    const report = supplyFor(market, entry.id);
    if (report.supply < 0.95 && report.bottleneck) out.push(report);
  }
  out.sort((a, b) => {
    if (a.supply !== b.supply) return a.supply - b.supply;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}
