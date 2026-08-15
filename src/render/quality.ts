/**
 * Quality presets.
 *
 * The numbers are measured budgets, not preferences: terrain ring count and chunk
 * resolution together decide how many triangles the streaming set holds, and settlement
 * draw range decides how early the two-stage town build has to start. Presets are data,
 * so a test can assert relationships across all four (e.g. every settlement range beyond
 * 30 km must resolve to the far layer).
 */

export type QualityName = 'potato' | 'low' | 'medium' | 'high';

export interface QualityPreset {
  name: QualityName;
  /** Rings of terrain chunks streamed around the player. */
  terrainRings: number;
  /** Vertices per chunk edge. */
  terrainRes: number;
  /** Background stars in the far layer. */
  starCount: number;
  /** Icosphere facet budget for planetary bodies. */
  bodyDetail: number;
  shadows: boolean;
  /** Distance at which settlements start drawing, in metres. */
  settlementRangeM: number;
  maxNpcs: number;
}

export const QUALITY_PRESETS: readonly QualityPreset[] = [
  {
    name: 'potato',
    terrainRings: 3,
    terrainRes: 10,
    starCount: 260,
    bodyDetail: 20,
    shadows: false,
    settlementRangeM: 20_000,
    maxNpcs: 4,
  },
  {
    name: 'low',
    terrainRings: 4,
    terrainRes: 14,
    starCount: 550,
    bodyDetail: 28,
    shadows: false,
    settlementRangeM: 35_000,
    maxNpcs: 7,
  },
  {
    name: 'medium',
    terrainRings: 6,
    terrainRes: 20,
    starCount: 1100,
    bodyDetail: 40,
    shadows: true,
    settlementRangeM: 60_000,
    maxNpcs: 11,
  },
  {
    name: 'high',
    terrainRings: 8,
    terrainRes: 24,
    starCount: 1400,
    bodyDetail: 64,
    shadows: true,
    settlementRangeM: 90_000,
    maxNpcs: 14,
  },
] as const;

export function presetByName(name: QualityName): QualityPreset {
  const p = QUALITY_PRESETS.find((q) => q.name === name);
  if (!p) throw new Error(`unknown quality preset: ${name}`);
  return p;
}

/** bodyDetail is a facet budget; icospheres come in 20 * 4^n, so pick the largest that fits. */
export function subdivisionsFor(bodyDetail: number): number {
  let sub = 0;
  while (20 * Math.pow(4, sub + 1) <= bodyDetail * 20) sub++;
  return Math.min(sub, 5);
}
