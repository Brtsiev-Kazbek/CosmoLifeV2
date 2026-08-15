import type { Color } from './meshBuilder';
import { clamp01, lerp } from '../lib/util';

/**
 * Colour helpers.
 *
 * Flat shading has no textures to carry information, so hue and value do all the work of
 * telling a hull from a rock from a roof. Every colour in the game comes from here, which
 * also means a single place to keep facets out of the two failure modes that ruined
 * readability in practice: pure white hulls (they blow out against a bright limb) and
 * saturated buildings (a settlement in faction colours dissolves into red rock).
 */

export function rgb(r: number, g: number, b: number): Color {
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/** h in [0,1), s and v in [0,1]. */
export function hsv(h: number, s: number, v: number): Color {
  const hh = (h - Math.floor(h)) * 6;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i % 6) {
    case 0: return rgb(v, t, p);
    case 1: return rgb(q, v, p);
    case 2: return rgb(p, v, t);
    case 3: return rgb(p, q, v);
    case 4: return rgb(t, p, v);
    default: return rgb(v, p, q);
  }
}

/** Multiply value. Facet variation within one object is a shade, not a new hue. */
export function shade(c: Color, factor: number): Color {
  return rgb(c[0] * factor, c[1] * factor, c[2] * factor);
}

export function mixColor(a: Color, b: Color, t: number): Color {
  return rgb(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
}

/**
 * Pull a colour toward neutral grey of the same luminance.
 *
 * Settlements are drawn with `toNeutral(factionColour, 0.72)`: a town built in its
 * owner's palette is invisible on a planet whose rock shares that hue, and the player
 * reads "grey structures" as artificial far more reliably than any colour choice.
 */
export function toNeutral(c: Color, amount: number): Color {
  const l = luminance(c);
  return mixColor(c, rgb(l, l, l), clamp01(amount));
}

export function luminance(c: Color): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Clamp a hull colour away from white, which blows out against a lit planet limb. */
export function hullSafe(c: Color): Color {
  const l = luminance(c);
  // 0.82 measured: above it the specular-free flat facet reads as a white silhouette and
  // the ship's shape disappears; below 0.10 it merges with space.
  if (l > 0.82) return shade(c, 0.82 / l);
  if (l < 0.1) return mixColor(c, rgb(0.1, 0.1, 0.1), 0.6);
  return c;
}

/** Pack to the 0..255 triple a CSS string needs, for DOM/HUD elements. */
export function toCss(c: Color): string {
  const r = Math.round(clamp01(c[0]) * 255);
  const g = Math.round(clamp01(c[1]) * 255);
  const b = Math.round(clamp01(c[2]) * 255);
  return `rgb(${r},${g},${b})`;
}

export const BLACK: Color = [0, 0, 0];
export const WHITE: Color = [1, 1, 1];
