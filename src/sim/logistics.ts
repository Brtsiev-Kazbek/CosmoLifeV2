import { commodity, type CommodityId } from './commodities';
import {
  buyPrice, sellPrice, executeBuy, executeSell, type Market,
} from './economy';
import { supplyFor } from './production';

/**
 * Freight — the traffic that actually moves the economy.
 *
 * A run is "this much of that, from A to B". Runs are planned from a receiver's shortfall
 * and a sender's surplus, and a **stalled factory input outranks a fat margin on
 * luxuries**: without that priority the whole fleet hauls perfume while three worlds'
 * industry sits idle, which looks like a working market and behaves like a dead one.
 *
 * Loading takes the goods off the seller's shelf and arrival puts them on the buyer's, so
 * prices move because ships carried cargo — not because a timer nudged a number.
 */

/** Standard hauler hold, tonnes. */
export const HOLD_TONNES = 60;
/** Below this margin the run is not worth flying. */
export const MIN_MARGIN_PER_TONNE = 6;

export interface FreightRun {
  id: string;
  fromId: string;
  toId: string;
  commodity: CommodityId;
  tonnes: number;
  /** Expected credits per tonne at planning time. */
  marginPerTonne: number;
  /** Higher runs first. A stalled input scores far above a luxury margin. */
  priority: number;
  /** Set once the cargo has left the seller's warehouse. */
  loaded: boolean;
}

export interface FreightPlanOptions {
  holdTonnes?: number;
  minMargin?: number;
  /** Cap on runs returned, highest priority first. */
  limit?: number;
}

/**
 * Plan runs between a set of markets.
 *
 * The market list is walked in the order given and every pairing is scored; the caller
 * passes markets in a stable order (sorted by id), so two runs of equal value always
 * resolve the same way.
 */
export function planFreight(
  markets: readonly Market[],
  options: FreightPlanOptions = {},
): FreightRun[] {
  const hold = options.holdTonnes ?? HOLD_TONNES;
  const minMargin = options.minMargin ?? MIN_MARGIN_PER_TONNE;
  const runs: FreightRun[] = [];

  for (const to of markets) {
    // What this market cannot make for lack of an input, worst first.
    const wants = new Map<CommodityId, number>();
    for (const entry of to.entries) {
      if (entry.produceWeight <= 0) continue;
      const report = supplyFor(to, entry.id);
      if (!report.bottleneck || report.supply >= 0.95) continue;
      // Urgency is how stalled the factory is. Squared, so a world at 0.2 supply outbids
      // three worlds at 0.8 rather than being averaged in with them.
      const urgency = Math.pow(1 - report.supply, 2);
      wants.set(report.bottleneck, Math.max(wants.get(report.bottleneck) ?? 0, urgency));
    }

    for (const from of markets) {
      if (from.id === to.id) continue;
      for (const src of from.entries) {
        const dst = to.byId.get(src.id);
        if (!dst) continue;
        // A seller must have a genuine surplus; selling a world's last reserves is how a
        // freight planner starves the system it is meant to supply.
        if (src.stock <= src.equilibrium * 0.9) continue;

        const margin = sellPrice(dst) - buyPrice(src);
        const urgency = wants.get(src.id) ?? 0;
        if (margin < minMargin && urgency === 0) continue;

        const tonnes = Math.min(hold, Math.floor((src.stock - src.equilibrium * 0.9) * 0.5));
        if (tonnes < 1) continue;

        runs.push({
          id: `${from.id}>${to.id}:${src.id}`,
          fromId: from.id,
          toId: to.id,
          commodity: src.id,
          tonnes,
          marginPerTonne: margin,
          // Urgency is a *tier*, not a weight. Weighting it (urgency * 1000 + margin) was
          // measured and fails: a luxury run into a stripped market carries a 2219 cr/t
          // margin, which outbids a fully stalled factory scoring 1000. Any run that
          // unblocks production therefore starts a whole band above every speculative
          // one, and margin only orders runs inside a band.
          priority: (urgency > 0 ? 1e6 + urgency * 1e6 : 0) + Math.max(0, margin),
          loaded: false,
        });
      }
    }
  }

  runs.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return options.limit ? runs.slice(0, options.limit) : runs;
}

/** Take the cargo off the seller's shelf. The price at the origin rises immediately. */
export function loadRun(run: FreightRun, from: Market): number {
  if (run.loaded) return 0;
  const entry = from.byId.get(run.commodity);
  if (!entry) return 0;
  const { cost, filled } = executeBuy(entry, run.tonnes);
  run.tonnes = filled;
  run.loaded = true;
  return cost;
}

/** Put it on the buyer's shelf. The price at the destination falls immediately. */
export function deliverRun(run: FreightRun, to: Market): number {
  if (!run.loaded) return 0;
  const entry = to.byId.get(run.commodity);
  if (!entry) return 0;
  const { revenue } = executeSell(entry, run.tonnes);
  run.loaded = false;
  return revenue;
}

/**
 * Background freight — runs resolved without a visible ship.
 *
 * Ports are millions of kilometres apart and one trader completes a single run in about
 * fifteen seconds of flight. If only the ships the player can see moved cargo, every
 * chain would starve while the player watched a single hauler. So a few runs per day
 * settle analytically wherever the player is not.
 */
export const BACKGROUND_RUNS_PER_DAY = 3;

export function stepBackgroundFreight(
  markets: readonly Market[],
  dtDays: number,
  carriedOver: number,
  runsPerDay = BACKGROUND_RUNS_PER_DAY,
): number {
  let budget = carriedOver + dtDays * runsPerDay;
  const byId = new Map<string, Market>();
  for (const m of markets) byId.set(m.id, m);

  while (budget >= 1) {
    const plan = planFreight(markets, { limit: 1 });
    if (plan.length === 0) break;
    const run = plan[0];
    const from = byId.get(run.fromId);
    const to = byId.get(run.toId);
    if (!from || !to) break;
    loadRun(run, from);
    deliverRun(run, to);
    budget -= 1;
  }
  // Fractional budget is carried, so a 0.2-day tick does not silently round to zero runs
  // and leave the economy static at high time compression.
  return budget;
}

/** Profit a player would make flying this run, after both spreads. */
export function runProfit(run: FreightRun, from: Market, to: Market): number {
  const src = from.byId.get(run.commodity);
  const dst = to.byId.get(run.commodity);
  if (!src || !dst) return 0;
  return (sellPrice(dst) - buyPrice(src)) * run.tonnes;
}

/** Is this commodity legal to carry into that market? */
export function isContraband(id: CommodityId, market: Market): boolean {
  return commodity(id).illegal && market.law > 0.35;
}
