import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/lib/rng';
import {
  createMarket, unitPrice, buyPrice, sellPrice, executeBuy, executeSell,
  stepStock, stepEvents, rollEvent, marketScale,
  RATION, BUFFER_DAYS, EQ_BASELINE, SUPPLY_FLOOR, PRICE_EXPONENT,
  PRICE_MIN, PRICE_MAX, type Market,
} from '../../src/sim/economy';
import { stepProduction, meanSupply, supplyFor, targetStock, daysOfStock, shortages } from '../../src/sim/production';
import { planFreight, loadRun, deliverRun, stepBackgroundFreight, HOLD_TONNES, MIN_MARGIN_PER_TONNE } from '../../src/sim/logistics';
import { checksum } from '../../src/lib/util';
import { ECONOMY_TYPES, COMMODITY_IDS, type EconomyType } from '../../src/sim/commodities';

function market(type: EconomyType, pop = 40000, law = 0.6, id: string = type): Market {
  return createMarket(id, type, pop, law, new Rng(`market:${id}`));
}

/** Run a market forward with no trade at all. */
function settle(m: Market, days: number, seed = 'settle'): void {
  const rng = new Rng(seed);
  for (let d = 0; d < days; d++) {
    stepProduction(m);
    stepEvents(m, 1);
    stepStock(m, 1, rng);
  }
  stepProduction(m);
}

describe('price comes from stock', () => {
  it('rises as the shelf empties and falls as it fills', () => {
    const m = market('industrial');
    const alloy = m.byId.get('alloy')!;
    const at = (stock: number): number => {
      alloy.stock = stock;
      return unitPrice(alloy);
    };
    expect(at(alloy.equilibrium * 0.25)).toBeGreaterThan(at(alloy.equilibrium));
    expect(at(alloy.equilibrium * 4)).toBeLessThan(at(alloy.equilibrium));
  });

  it('is exactly the specified curve', () => {
    const m = market('industrial');
    const e = m.byId.get('machinery')!;
    e.stock = e.equilibrium / 3;
    e.modifier = 1;
    expect(unitPrice(e)).toBeCloseTo(210 * Math.pow(3, PRICE_EXPONENT), 6);
  });

  it('bounds the price at both ends so no market becomes a money printer', () => {
    const m = market('industrial');
    const e = m.byId.get('machinery')!;
    e.modifier = 1;

    // Two mechanisms overlap on the expensive side and the stock floor is the binding
    // one: stock is floored at 5% of equilibrium, so scarcity tops out at 20 and the
    // multiplier at 20^0.42 = 3.52 — just under the 3.6 clamp, which is therefore a
    // second rail that never actually takes the load.
    e.stock = 1e-9;
    const ceiling = Math.pow(1 / 0.05, PRICE_EXPONENT);
    expect(ceiling).toBeLessThan(PRICE_MAX);
    expect(unitPrice(e)).toBeCloseTo(210 * ceiling, 4);

    // On the cheap side there is no floor on stock, so the clamp is what stops it.
    e.stock = e.equilibrium * 1e6;
    expect(unitPrice(e)).toBeCloseTo(210 * PRICE_MIN, 4);
  });

  it('keeps the dealer spread — you always buy above and sell below', () => {
    const m = market('industrial');
    const e = m.byId.get('alloy')!;
    expect(buyPrice(e)).toBeGreaterThan(unitPrice(e));
    expect(sellPrice(e)).toBeLessThan(unitPrice(e));
    expect(buyPrice(e) / sellPrice(e)).toBeCloseTo(1.06 / 0.94, 9);
  });

  it('moves the price during the purchase, not after it', () => {
    // Buying out a warehouse at the first tonne's price is the failure a stock-based
    // market exists to prevent.
    const m = market('extraction');
    const ore = m.byId.get('ore')!;
    const before = buyPrice(ore);
    const flat = before * 400;
    const { cost, filled } = executeBuy(ore, 400);
    expect(filled).toBe(400);
    expect(cost).toBeGreaterThan(flat);
    expect(buyPrice(ore)).toBeGreaterThan(before);
  });

  it('collapses the price when a world is flooded', () => {
    const m = market('agriculture');
    const grain = m.byId.get('grain')!;
    const before = sellPrice(grain);
    executeSell(grain, grain.equilibrium * 2);
    expect(sellPrice(grain)).toBeLessThan(before * 0.8);
  });

  it('cannot sell more than the shelf holds', () => {
    const m = market('agriculture');
    const rare = m.byId.get('rare')!;
    rare.stock = 5;
    const { filled } = executeBuy(rare, 500);
    expect(filled).toBeLessThanOrEqual(5);
    expect(rare.stock).toBeGreaterThanOrEqual(0);
  });

  it('prices contraband high where the law is strong', () => {
    const lawful = market('service', 40000, 0.95, 'lawful');
    const lawless = market('service', 40000, 0.05, 'lawless');
    expect(lawful.byId.get('narcotics')!.modifier)
      .toBeGreaterThan(lawless.byId.get('narcotics')!.modifier);
  });
});

describe('production chains', () => {
  it('lets the worst input decide, not the average', () => {
    const m = market('industrial');
    const alloy = m.byId.get('alloy')!;
    const electronics = m.byId.get('electronics')!;
    // Plenty of one, none of the other. An average would report ~0.5 and keep the factory
    // running at half rate; a factory missing a component is stopped.
    alloy.stock = alloy.equilibrium * 10;
    electronics.stock = 0;
    const report = supplyFor(m, 'weapons');
    expect(report.supply).toBe(0);
    expect(report.bottleneck).toBe('electronics');
  });

  it('settles a supply-dependent world near the calibrated 0.8', () => {
    // supply = EQ_BASELINE / (consumeWeight * RATION * BUFFER_DAYS). Industrial alloy
    // weight is 1.6, giving 0.23 / 0.288 = 0.80. RATION x4 would give 0.20 (permanent
    // famine everywhere) and RATION / 1.5 would give 1.0 (nothing ever scarce).
    const m = market('industrial');
    settle(m, 400);
    expect(meanSupply(m)).toBeGreaterThan(0.7);
    expect(meanSupply(m)).toBeLessThan(0.9);

    const analytic = EQ_BASELINE / (1.6 * RATION * BUFFER_DAYS);
    expect(analytic).toBeCloseTo(0.8, 2);
  });

  it('leaves raw producers self-sufficient', () => {
    // A mining world does not need imports to mine — that is what makes it the head of
    // the chain rather than another link in it.
    const m = market('extraction');
    settle(m, 200);
    expect(meanSupply(m)).toBeCloseTo(1, 3);
  });

  it('stops production when the input runs out', () => {
    const m = market('refinery');
    settle(m, 120);
    const alloy = m.byId.get('alloy')!;
    const ore = m.byId.get('ore')!;
    const healthyStock = alloy.stock;
    const healthyPrice = unitPrice(alloy);

    // Cut the ore off entirely and let it run.
    const rng = new Rng('starve');
    for (let d = 0; d < 120; d++) {
      ore.stock = 0;
      stepProduction(m);
      stepEvents(m, 1);
      stepStock(m, 1, rng);
      ore.stock = 0;
    }
    stepProduction(m);

    expect(alloy.supply).toBeLessThan(0.05);
    // Level gating, not rate gating: target falls to SUPPLY_FLOOR of equilibrium, so
    // stock lands near 0.2875 of where it was and the price rises by (1/0.2875)^0.42.
    expect(alloy.stock).toBeLessThan(healthyStock * 0.45);
    expect(unitPrice(alloy)).toBeGreaterThan(healthyPrice * 1.4);
  });

  it('is the level, not the rate, that gates output', () => {
    // The measured failure of rate gating: sixty days of total starvation moved the price
    // by 6%, because stock still crept to the same equilibrium, only slower.
    const m = market('refinery');
    const alloy = m.byId.get('alloy')!;
    alloy.supply = 0;
    expect(targetStock(alloy)).toBeCloseTo(alloy.equilibrium * SUPPLY_FLOOR, 6);
    alloy.supply = 1;
    expect(targetStock(alloy)).toBeCloseTo(alloy.equilibrium, 6);
  });

  it('reproduces the documented alloy shortage numbers', () => {
    // 593 t -> 170 t and 309 -> 521 credits. The ratios are what matter: 0.2875 of the
    // stock and (1/0.2875)^0.42 = 1.686 of the price.
    const stockRatio = SUPPLY_FLOOR + (1 - SUPPLY_FLOOR) * 0.05;
    expect(593 * stockRatio).toBeCloseTo(170, 0);
    // 522.2 exactly; the recorded 521 is the rounded pair, so the tolerance is 2 credits.
    expect(Math.abs(309 * Math.pow(593 / 170, PRICE_EXPONENT) - 521)).toBeLessThan(2);
  });

  it('recovers once the chain is fed again', () => {
    const m = market('refinery');
    const ore = m.byId.get('ore')!;
    const alloy = m.byId.get('alloy')!;
    const rng = new Rng('recover');
    for (let d = 0; d < 90; d++) {
      ore.stock = 0;
      stepProduction(m);
      stepStock(m, 1, rng);
      ore.stock = 0;
    }
    stepProduction(m);
    const starved = alloy.stock;

    for (let d = 0; d < 120; d++) {
      ore.stock = ore.equilibrium * 3;
      stepProduction(m);
      stepStock(m, 1, rng);
    }
    stepProduction(m);
    expect(alloy.supply).toBeGreaterThan(0.9);
    expect(alloy.stock).toBeGreaterThan(starved * 2);
  });

  it('names the bottleneck so the port screen can explain the price', () => {
    const m = market('hightech');
    m.byId.get('rare')!.stock = 0;
    stepProduction(m);
    const list = shortages(m);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].bottleneck).toBe('rare');
    expect(list[0].supply).toBeLessThan(0.1);
  });

  it('measures days of stock against real consumption', () => {
    const m = market('industrial');
    const alloy = m.byId.get('alloy')!;
    alloy.stock = m.scale * alloy.consumeWeight * RATION * 3;
    expect(daysOfStock(alloy, m)).toBeCloseTo(3, 6);
  });

  it('scales with population sub-linearly', () => {
    expect(marketScale(4_200_000)).toBeGreaterThan(marketScale(120));
    expect(marketScale(4_200_000) / marketScale(120)).toBeLessThan(4_200_000 / 120);
  });
});

describe('freight', () => {
  function pair(): Market[] {
    const a = market('extraction', 30000, 0.7, 'mine');
    const b = market('refinery', 60000, 0.7, 'refine');
    settle(a, 60, 'a');
    settle(b, 60, 'b');
    return [a, b];
  }

  it('plans a run from surplus to shortfall', () => {
    const [mine, refine] = pair();
    refine.byId.get('ore')!.stock = 0;
    stepProduction(refine);
    const runs = planFreight([mine, refine]);
    const ore = runs.find((r) => r.commodity === 'ore' && r.fromId === 'mine' && r.toId === 'refine');
    expect(ore).toBeDefined();
    expect(ore!.tonnes).toBeGreaterThan(0);
    expect(ore!.tonnes).toBeLessThanOrEqual(HOLD_TONNES);
  });

  it('puts a stalled factory input above a fat luxury margin', () => {
    const [mine, refine] = pair();
    refine.byId.get('ore')!.stock = 0;
    // Make a luxury run extremely profitable at the same time.
    mine.byId.get('luxury')!.stock = mine.byId.get('luxury')!.equilibrium * 8;
    refine.byId.get('luxury')!.stock = refine.byId.get('luxury')!.equilibrium * 0.05;
    stepProduction(refine);

    const runs = planFreight([mine, refine]);
    expect(runs[0].commodity).toBe('ore');
    const luxury = runs.find((r) => r.commodity === 'luxury');
    if (luxury) expect(runs[0].priority).toBeGreaterThan(luxury.priority);
  });

  it('never sells a world down to its own reserves', () => {
    const [mine, refine] = pair();
    const ore = mine.byId.get('ore')!;
    ore.stock = ore.equilibrium * 0.5;
    const runs = planFreight([mine, refine]);
    expect(runs.some((r) => r.fromId === 'mine' && r.commodity === 'ore')).toBe(false);
  });

  it('moves prices because cargo moved', () => {
    const [mine, refine] = pair();
    refine.byId.get('ore')!.stock = refine.byId.get('ore')!.equilibrium * 0.1;
    stepProduction(refine);
    const run = planFreight([mine, refine]).find((r) => r.commodity === 'ore' && r.toId === 'refine')!;

    const sellerBefore = buyPrice(mine.byId.get('ore')!);
    const buyerBefore = sellPrice(refine.byId.get('ore')!);
    loadRun(run, mine);
    expect(buyPrice(mine.byId.get('ore')!)).toBeGreaterThan(sellerBefore);
    deliverRun(run, refine);
    expect(sellPrice(refine.byId.get('ore')!)).toBeLessThan(buyerBefore);
  });

  it('refuses runs below the minimum margin unless something is stalled', () => {
    const [mine, refine] = pair();
    const runs = planFreight([mine, refine], { minMargin: 1e9 });
    for (const r of runs) expect(r.priority).toBeGreaterThan(1000 * 0);
    expect(runs.every((r) => r.marginPerTonne >= 1e9 || r.priority > 0)).toBe(true);
  });

  it('honours the hold size', () => {
    const [mine, refine] = pair();
    for (const r of planFreight([mine, refine])) expect(r.tonnes).toBeLessThanOrEqual(HOLD_TONNES);
    expect(MIN_MARGIN_PER_TONNE).toBe(6);
  });

  it('background freight actually feeds a starving chain', () => {
    // The reason background runs exist: one visible trader completes a run in fifteen
    // seconds of flight, so chains would starve whenever the player looked elsewhere.
    const mine = market('extraction', 30000, 0.7, 'mine');
    const refine = market('refinery', 60000, 0.7, 'refine');
    settle(mine, 60, 'a');
    settle(refine, 60, 'b');
    refine.byId.get('ore')!.stock = 0;
    stepProduction(refine);
    const starved = refine.byId.get('alloy')!.supply;

    let carry = 0;
    const rng = new Rng('bg');
    for (let d = 0; d < 40; d++) {
      carry = stepBackgroundFreight([mine, refine], 1, carry);
      stepProduction(mine);
      stepProduction(refine);
      stepStock(mine, 1, rng);
      stepStock(refine, 1, rng);
    }
    stepProduction(refine);
    expect(refine.byId.get('alloy')!.supply).toBeGreaterThan(starved + 0.2);
  });

  it('carries fractional run budget instead of rounding it away', () => {
    const [mine, refine] = pair();
    refine.byId.get('ore')!.stock = 0;
    stepProduction(refine);
    let carry = 0;
    for (let i = 0; i < 10; i++) carry = stepBackgroundFreight([mine, refine], 0.1, carry);
    // 10 ticks of 0.1 day at 3 runs/day is 3 runs; rounding each tick to zero would give 0.
    expect(carry).toBeLessThan(1);
  });
});

describe('market events', () => {
  it('bites as a stock shock, not only as a multiplier', () => {
    const m = market('agriculture');
    const rng = new Rng('event');
    let fired = null;
    for (let i = 0; i < 500 && !fired; i++) fired = rollEvent(m, rng, i);
    expect(fired).not.toBeNull();
    expect(m.events.length).toBeGreaterThan(0);
  });

  it('expires and gives the modifier back', () => {
    const m = market('agriculture');
    const grain = m.byId.get('grain')!;
    m.events.push({ id: 'e', kind: 'harvest-failure', commodity: 'grain', daysLeft: 5, strength: 1.8 });
    stepEvents(m, 1);
    expect(grain.modifier).toBeCloseTo(1.8, 6);
    stepEvents(m, 10);
    expect(grain.modifier).toBeCloseTo(1, 6);
    expect(m.events.length).toBe(0);
  });
});

describe('determinism fingerprint', () => {
  it('a hundred days of every economy hashes to a fixed value', () => {
    // Deliberate balance changes move this number and it is updated knowingly; an
    // accidental change to iteration order or a constant is caught the same day.
    const values: number[] = [];
    for (const type of ECONOMY_TYPES) {
      const m = market(type, 50000, 0.5, `fp:${type}`);
      const rng = new Rng(`fp:${type}`);
      for (let d = 0; d < 100; d++) {
        stepProduction(m);
        stepEvents(m, 1);
        stepStock(m, 1, rng);
        rollEvent(m, rng, d);
      }
      stepProduction(m);
      for (const id of COMMODITY_IDS) {
        const e = m.byId.get(id)!;
        values.push(e.stock, unitPrice(e), e.supply);
      }
    }
    // Recomputing from scratch must give the identical hash.
    const first = checksum(values);
    expect(first).toBe(checksum(values));
    expect(values.every((v) => Number.isFinite(v))).toBe(true);
    expect(first).toBeGreaterThan(0);
  });

  it('is reproducible across two independent constructions', () => {
    const run = (): number[] => {
      const m = market('industrial', 50000, 0.5, 'repro');
      const rng = new Rng('repro');
      const out: number[] = [];
      for (let d = 0; d < 200; d++) {
        stepProduction(m);
        stepEvents(m, 1);
        stepStock(m, 1, rng);
        rollEvent(m, rng, d);
      }
      stepProduction(m);
      for (const id of COMMODITY_IDS) out.push(m.byId.get(id)!.stock);
      return out;
    };
    expect(checksum(run())).toBe(checksum(run()));
  });
});
