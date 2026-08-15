/**
 * The commodity table and the production graph that connects it.
 *
 * This is data, not code, but it is the spine of the economy: the `inputs` field is what
 * turns a list of goods into a supply chain, and therefore what makes a mining world's
 * troubles show up as a price rise three jumps away.
 *
 * Display names live in the locale files. The ids here are stable keys and are never
 * shown to the player — a data table is exactly the place a hard-coded English string
 * hides from a localisation audit.
 */

export type CommodityId =
  | 'grain' | 'water' | 'meds' | 'consumer'
  | 'ore' | 'rare' | 'ice'
  | 'alloy' | 'chemicals' | 'fuel'
  | 'machinery' | 'electronics' | 'weapons'
  | 'luxury' | 'narcotics' | 'arms' | 'slaves';

export type CommodityCategory = 'food' | 'raw' | 'refined' | 'industrial' | 'contraband';

export interface Commodity {
  id: CommodityId;
  category: CommodityCategory;
  /** Galactic reference price in credits per tonne. */
  base: number;
  /** How violently the price wanders on its own, 0..1. */
  volatility: number;
  /** Illegal in law-abiding systems; the black market is the only buyer. */
  illegal: boolean;
  /** Inputs consumed to produce one unit, as (id, units) pairs in a fixed order. */
  inputs: readonly (readonly [CommodityId, number])[];
}

/**
 * Ordered array, not a record.
 *
 * Iteration order is part of the simulation's determinism: market updates, freight
 * planning and the port screen all walk this list, and an object's key order is only
 * stable by accident of construction.
 */
export const COMMODITIES: readonly Commodity[] = [
  { id: 'water', category: 'food', base: 12, volatility: 0.25, illegal: false, inputs: [] },
  { id: 'grain', category: 'food', base: 18, volatility: 0.45, illegal: false, inputs: [] },
  { id: 'meds', category: 'food', base: 140, volatility: 0.35, illegal: false, inputs: [['chemicals', 0.6]] },
  { id: 'consumer', category: 'food', base: 96, volatility: 0.3, illegal: false, inputs: [['alloy', 0.3], ['electronics', 0.2]] },

  { id: 'ore', category: 'raw', base: 34, volatility: 0.4, illegal: false, inputs: [] },
  { id: 'rare', category: 'raw', base: 320, volatility: 0.55, illegal: false, inputs: [] },
  { id: 'ice', category: 'raw', base: 9, volatility: 0.3, illegal: false, inputs: [] },

  { id: 'alloy', category: 'refined', base: 88, volatility: 0.35, illegal: false, inputs: [['ore', 1.4]] },
  { id: 'chemicals', category: 'refined', base: 74, volatility: 0.4, illegal: false, inputs: [['ice', 1.1], ['ore', 0.3]] },
  { id: 'fuel', category: 'refined', base: 52, volatility: 0.3, illegal: false, inputs: [['ice', 1.6]] },

  { id: 'machinery', category: 'industrial', base: 210, volatility: 0.3, illegal: false, inputs: [['alloy', 1.2]] },
  { id: 'electronics', category: 'industrial', base: 380, volatility: 0.4, illegal: false, inputs: [['rare', 0.7], ['alloy', 0.4]] },
  { id: 'weapons', category: 'industrial', base: 620, volatility: 0.5, illegal: false, inputs: [['alloy', 0.9], ['electronics', 0.5]] },

  { id: 'luxury', category: 'refined', base: 780, volatility: 0.6, illegal: false, inputs: [['rare', 0.5], ['consumer', 0.6]] },
  { id: 'narcotics', category: 'contraband', base: 940, volatility: 0.75, illegal: true, inputs: [['chemicals', 0.8]] },
  { id: 'arms', category: 'contraband', base: 1180, volatility: 0.65, illegal: true, inputs: [['weapons', 0.8]] },
  { id: 'slaves', category: 'contraband', base: 640, volatility: 0.7, illegal: true, inputs: [] },
] as const;

const BY_ID = new Map<CommodityId, Commodity>();
for (const c of COMMODITIES) BY_ID.set(c.id, c);

export function commodity(id: CommodityId): Commodity {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`unknown commodity: ${id}`);
  return c;
}

export const COMMODITY_IDS: readonly CommodityId[] = COMMODITIES.map((c) => c.id);

/**
 * Economy archetypes.
 *
 * Each names what a world makes and what it eats. The graph they form is what the
 * production model gates: an industrial world with no alloy supply stops producing
 * machinery, and the shortage propagates outward.
 */
export type EconomyType =
  | 'extraction' | 'refinery' | 'industrial' | 'hightech'
  | 'agriculture' | 'service' | 'military' | 'colony' | 'anarchy';

export interface EconomyProfile {
  type: EconomyType;
  /** Produced goods with a weight; drives equilibrium stock upward. */
  produces: readonly (readonly [CommodityId, number])[];
  /** Consumed goods with a weight; drives equilibrium stock downward and creates demand. */
  consumes: readonly (readonly [CommodityId, number])[];
}

export const ECONOMY_PROFILES: readonly EconomyProfile[] = [
  {
    type: 'extraction',
    produces: [['ore', 1.6], ['ice', 1.1], ['rare', 0.5]],
    consumes: [['machinery', 0.9], ['grain', 0.7], ['water', 0.6], ['meds', 0.4]],
  },
  {
    type: 'refinery',
    produces: [['alloy', 1.5], ['chemicals', 1.1], ['fuel', 1.2]],
    consumes: [['ore', 1.7], ['ice', 1.2], ['machinery', 0.6], ['grain', 0.5]],
  },
  {
    type: 'industrial',
    produces: [['machinery', 1.5], ['consumer', 1.0], ['weapons', 0.6]],
    consumes: [['alloy', 1.6], ['electronics', 0.7], ['grain', 0.8], ['water', 0.6]],
  },
  {
    type: 'hightech',
    produces: [['electronics', 1.5], ['meds', 0.9], ['luxury', 0.4]],
    consumes: [['rare', 1.4], ['alloy', 0.8], ['grain', 0.7], ['consumer', 0.5]],
  },
  {
    type: 'agriculture',
    produces: [['grain', 1.8], ['water', 1.4], ['consumer', 0.3]],
    consumes: [['machinery', 0.9], ['chemicals', 0.7], ['fuel', 0.5]],
  },
  {
    type: 'service',
    produces: [['consumer', 0.9], ['luxury', 0.6], ['meds', 0.5]],
    consumes: [['grain', 1.1], ['water', 0.9], ['electronics', 0.6], ['fuel', 0.5]],
  },
  {
    type: 'military',
    produces: [['weapons', 1.4], ['arms', 0.3]],
    consumes: [['alloy', 1.2], ['electronics', 0.9], ['fuel', 1.0], ['grain', 0.8]],
  },
  {
    type: 'colony',
    produces: [['ore', 0.5], ['grain', 0.4]],
    consumes: [['machinery', 1.3], ['meds', 1.0], ['consumer', 0.9], ['water', 0.8], ['grain', 0.6]],
  },
  {
    type: 'anarchy',
    produces: [['narcotics', 1.1], ['arms', 0.8], ['slaves', 0.5]],
    consumes: [['weapons', 1.0], ['fuel', 0.8], ['grain', 0.7], ['chemicals', 0.6]],
  },
] as const;

const PROFILE_BY_TYPE = new Map<EconomyType, EconomyProfile>();
for (const p of ECONOMY_PROFILES) PROFILE_BY_TYPE.set(p.type, p);

export function economyProfile(type: EconomyType): EconomyProfile {
  const p = PROFILE_BY_TYPE.get(type);
  if (!p) throw new Error(`unknown economy: ${type}`);
  return p;
}

export const ECONOMY_TYPES: readonly EconomyType[] = ECONOMY_PROFILES.map((p) => p.type);
