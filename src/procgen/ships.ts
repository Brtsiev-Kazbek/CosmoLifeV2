import { Rng } from '../lib/rng';
import { MeshBuilder, type Color, type MeshData } from '../render/meshBuilder';
import { box, taperedBox, cylinder, prism } from '../render/geometry';
import { hsv, hullSafe, shade } from '../render/palette';

/**
 * Procedural ship hulls.
 *
 * Built from a small kit — a spine, a cockpit wedge, wings, engine nacelles — so that
 * hulls read as belonging to one shipwright's tradition while never repeating. Colour
 * goes through `hullSafe`: an unconstrained random hull comes out white often enough to
 * matter, and a white flat-shaded hull against a lit planet limb loses its silhouette
 * entirely, which looks like a rendering fault rather than a paint job.
 */

export type ShipClass = 'shuttle' | 'hauler' | 'fighter' | 'explorer' | 'freighter';

export interface ShipDesign {
  id: string;
  name: string;
  shipClass: ShipClass;
  /** Overall length in metres. */
  lengthM: number;
  /** Cargo capacity in tonnes. */
  holdTonnes: number;
  /** Jump range in light years. */
  jumpRangeLy: number;
  hullPoints: number;
  shieldPoints: number;
  mesh: MeshData;
}

interface ClassSpec {
  length: [number, number];
  hold: [number, number];
  jump: [number, number];
  hull: [number, number];
  shield: [number, number];
  wingSpan: [number, number];
  engines: number[];
}

const SPECS: Record<ShipClass, ClassSpec> = {
  shuttle: { length: [14, 22], hold: [8, 20], jump: [8, 13], hull: [80, 130], shield: [40, 80], wingSpan: [0.5, 0.8], engines: [2] },
  hauler: { length: [26, 40], hold: [40, 90], jump: [10, 16], hull: [140, 220], shield: [60, 110], wingSpan: [0.4, 0.7], engines: [2, 3] },
  fighter: { length: [12, 19], hold: [2, 8], jump: [6, 11], hull: [90, 150], shield: [110, 190], wingSpan: [0.9, 1.4], engines: [2, 4] },
  explorer: { length: [22, 34], hold: [16, 38], jump: [18, 28], hull: [110, 180], shield: [70, 130], wingSpan: [0.7, 1.1], engines: [2] },
  freighter: { length: [48, 88], hold: [140, 340], jump: [8, 14], hull: [280, 460], shield: [90, 160], wingSpan: [0.3, 0.6], engines: [3, 4, 6] },
};

export const SHIP_CLASSES: readonly ShipClass[] = ['shuttle', 'hauler', 'fighter', 'explorer', 'freighter'];

export function generateShip(seed: number | string, shipClass: ShipClass): ShipDesign {
  const rng = new Rng(seed);
  const spec = SPECS[shipClass];
  const length = rng.range(spec.length[0], spec.length[1]);
  const halfLength = length / 2;
  const width = length * rng.range(spec.wingSpan[0], spec.wingSpan[1]) * 0.5;
  const height = length * rng.range(0.10, 0.20);

  // Two-tone: a body colour and a brighter trim, both desaturated. Fully saturated hulls
  // read as toys next to the muted rock and metal of everything else in frame.
  const hue = rng.float();
  const body = hullSafe(hsv(hue, rng.range(0.08, 0.30), rng.range(0.34, 0.62)));
  const trim = hullSafe(hsv((hue + rng.range(0.08, 0.28)) % 1, rng.range(0.25, 0.55), rng.range(0.45, 0.78)));
  const glow: Color = [0.45, 0.72, 1.0];

  const mb = new MeshBuilder(512);

  // Spine.
  taperedBox(mb, 0, 0, 0, width * 0.28, height * 0.5, halfLength, rng.range(0.55, 0.85), body);

  // Cockpit — a wedge forward and above, which is what gives the hull a readable nose.
  const cockpitZ = -halfLength * rng.range(0.45, 0.70);
  prism(
    mb,
    [
      -width * 0.16, cockpitZ - length * 0.10,
      width * 0.16, cockpitZ - length * 0.10,
      width * 0.22, cockpitZ + length * 0.10,
      -width * 0.22, cockpitZ + length * 0.10,
    ],
    height * 0.45,
    height * 0.45 + height * rng.range(0.5, 0.9),
    trim,
  );

  // Wings.
  const wingZ = halfLength * rng.range(-0.1, 0.35);
  const sweep = length * rng.range(0.10, 0.28);
  for (const side of [-1, 1]) {
    prism(
      mb,
      [
        side * width * 0.25, wingZ - length * 0.10,
        side * width, wingZ - length * 0.10 + sweep,
        side * width, wingZ + length * 0.12 + sweep,
        side * width * 0.25, wingZ + length * 0.14,
      ],
      -height * 0.12,
      height * 0.12,
      body,
    );
  }

  // Engines at the tail, glowing.
  const engineCount = rng.pick(spec.engines);
  const engineR = height * rng.range(0.30, 0.48);
  for (let i = 0; i < engineCount; i++) {
    const t = engineCount === 1 ? 0.5 : i / (engineCount - 1);
    const ex = (t - 0.5) * width * 1.1;
    const ey = rng.spread(height * 0.15);
    cylinder(mb, ex, ey, halfLength * 0.86, engineR, halfLength * 0.14, 8, shade(trim, 0.8));
    // The nozzle disc is emissive-coloured rather than lit; at flat-shading fidelity a
    // dark hole at the back reads as damage.
    cylinder(mb, ex, ey, halfLength * 0.99, engineR * 0.72, halfLength * 0.02, 8, glow);
  }

  // Greebles: a handful of boxes so the silhouette is not a smooth solid.
  const greebles = rng.int(3, 9);
  for (let i = 0; i < greebles; i++) {
    const gr = rng.derive('greeble', i);
    box(
      mb,
      gr.spread(width * 0.5),
      gr.spread(height * 0.7),
      gr.spread(halfLength * 0.7),
      width * gr.range(0.03, 0.10),
      height * gr.range(0.10, 0.30),
      halfLength * gr.range(0.03, 0.12),
      gr.bool(0.5) ? trim : shade(body, 0.85),
    );
  }

  return {
    id: `${shipClass}:${rng.key}`,
    name: shipClass,
    shipClass,
    lengthM: length,
    holdTonnes: Math.round(rng.range(spec.hold[0], spec.hold[1])),
    jumpRangeLy: rng.range(spec.jump[0], spec.jump[1]),
    hullPoints: Math.round(rng.range(spec.hull[0], spec.hull[1])),
    shieldPoints: Math.round(rng.range(spec.shield[0], spec.shield[1])),
    mesh: mb.build(),
  };
}
