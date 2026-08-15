import { MeshBuilder, type Color } from './meshBuilder';
import { shade } from './palette';
import { TAU } from '../lib/util';

/**
 * Primitive emitters.
 *
 * Everything visible in the game — hulls, buildings, rocks, stations, planets — is
 * assembled from these into a MeshBuilder. They take explicit centres and half-extents
 * rather than returning objects, so a generator can emit a thousand boxes without
 * allocating a thousand anything.
 *
 * Faces get slightly different shades of the same colour. That is not decoration: with
 * one light and no textures, two coplanar-ish faces of identical colour read as one
 * surface and the silhouette loses its corners.
 */

const TOP = 1.0;
const SIDE_A = 0.86;
const SIDE_B = 0.72;
const BOTTOM = 0.55;

/** Axis-aligned box. */
export function box(
  mb: MeshBuilder,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  color: Color,
): void {
  const x0 = cx - hx, x1 = cx + hx;
  const y0 = cy - hy, y1 = cy + hy;
  const z0 = cz - hz, z1 = cz + hz;

  mb.quad(x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0, shade(color, TOP));
  mb.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, shade(color, BOTTOM));
  mb.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, shade(color, SIDE_A));
  mb.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, shade(color, SIDE_A));
  mb.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, shade(color, SIDE_B));
  mb.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, shade(color, SIDE_B));
}

/**
 * Box with independently scaled top face — the workhorse building shape. A taper of even
 * 0.9 stops a district of boxes from reading as a bar chart.
 */
export function taperedBox(
  mb: MeshBuilder,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  taper: number,
  color: Color,
): void {
  const x0 = cx - hx, x1 = cx + hx;
  const z0 = cz - hz, z1 = cz + hz;
  const y0 = cy - hy, y1 = cy + hy;
  const tx = hx * taper, tz = hz * taper;
  const tx0 = cx - tx, tx1 = cx + tx;
  const tz0 = cz - tz, tz1 = cz + tz;

  mb.quad(tx0, y1, tz0, tx0, y1, tz1, tx1, y1, tz1, tx1, y1, tz0, shade(color, TOP));
  mb.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, shade(color, BOTTOM));
  mb.quad(x0, y0, z1, x1, y0, z1, tx1, y1, tz1, tx0, y1, tz1, shade(color, SIDE_A));
  mb.quad(x1, y0, z0, x0, y0, z0, tx0, y1, tz0, tx1, y1, tz0, shade(color, SIDE_A));
  mb.quad(x1, y0, z1, x1, y0, z0, tx1, y1, tz0, tx1, y1, tz1, shade(color, SIDE_B));
  mb.quad(x0, y0, z0, x0, y0, z1, tx0, y1, tz1, tx0, y1, tz0, shade(color, SIDE_B));
}

/** Cylinder along Y, `sides` facets. */
export function cylinder(
  mb: MeshBuilder,
  cx: number, cy: number, cz: number,
  radius: number, halfHeight: number, sides: number,
  color: Color,
  topRadius = radius,
): void {
  const y0 = cy - halfHeight;
  const y1 = cy + halfHeight;
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * TAU;
    const a1 = ((i + 1) / sides) * TAU;
    const c0 = Math.cos(a0), s0 = Math.sin(a0);
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    // Shade by facet index so a cylinder keeps its roundness under a single light.
    const f = SIDE_B + (SIDE_A - SIDE_B) * (0.5 + 0.5 * Math.cos(a0));
    mb.quad(
      cx + c0 * radius, y0, cz + s0 * radius,
      cx + c1 * radius, y0, cz + s1 * radius,
      cx + c1 * topRadius, y1, cz + s1 * topRadius,
      cx + c0 * topRadius, y1, cz + s0 * topRadius,
      shade(color, f),
    );
    mb.tri(
      cx, y1, cz,
      cx + c0 * topRadius, y1, cz + s0 * topRadius,
      cx + c1 * topRadius, y1, cz + s1 * topRadius,
      shade(color, TOP),
    );
    mb.tri(
      cx, y0, cz,
      cx + c1 * radius, y0, cz + s1 * radius,
      cx + c0 * radius, y0, cz + s0 * radius,
      shade(color, BOTTOM),
    );
  }
}

export function cone(
  mb: MeshBuilder,
  cx: number, cy: number, cz: number,
  radius: number, height: number, sides: number,
  color: Color,
): void {
  cylinder(mb, cx, cy + height / 2, cz, radius, height / 2, sides, color, radius * 0.001);
}

/** Regular prism with an arbitrary base polygon in XZ, extruded along Y. */
export function prism(
  mb: MeshBuilder,
  base: ArrayLike<number>,
  y0: number, y1: number,
  color: Color,
): void {
  const n = base.length / 2;
  const top = new Float64Array(n * 3);
  const bottom = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    top[i * 3] = base[i * 2];
    top[i * 3 + 1] = y1;
    top[i * 3 + 2] = base[i * 2 + 1];
    bottom[i * 3] = base[i * 2];
    bottom[i * 3 + 1] = y0;
    bottom[i * 3 + 2] = base[i * 2 + 1];
  }
  mb.fan(top, shade(color, TOP));
  mb.fan(bottom, shade(color, BOTTOM), true);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mb.quad(
      base[i * 2], y0, base[i * 2 + 1],
      base[j * 2], y0, base[j * 2 + 1],
      base[j * 2], y1, base[j * 2 + 1],
      base[i * 2], y1, base[i * 2 + 1],
      shade(color, i % 2 === 0 ? SIDE_A : SIDE_B),
    );
  }
}

/**
 * Icosphere. `subdivisions` controls facet count (20 * 4^n triangles); the quality preset
 * maps bodyDetail onto it. Per-facet colour comes from a callback so a planet can shade
 * by latitude and a rock by random dirt without a second pass over the buffer.
 */
export function icosphere(
  mb: MeshBuilder,
  cx: number, cy: number, cz: number,
  radius: number,
  subdivisions: number,
  faceColor: (nx: number, ny: number, nz: number, index: number) => Color,
): void {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts: number[][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(normalize3);

  let faces: number[][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ].map((f) => [...f]);

  for (let s = 0; s < subdivisions; s++) {
    const next: number[][] = [];
    // Midpoint cache keyed by the ordered index pair: without it the vertex count grows
    // 4x per level instead of ~4x total and subdivision 4 becomes unusable.
    const midCache = new Map<number, number>();
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? a * 100000 + b : b * 100000 + a;
      const hit = midCache.get(key);
      if (hit !== undefined) return hit;
      const va = verts[a];
      const vb = verts[b];
      const m = normalize3([va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]]);
      verts.push(m);
      const idx = verts.length - 1;
      midCache.set(key, idx);
      return idx;
    };
    for (const f of faces) {
      const a = midpoint(f[0], f[1]);
      const b = midpoint(f[1], f[2]);
      const c = midpoint(f[2], f[0]);
      next.push([f[0], a, c], [f[1], b, a], [f[2], c, b], [a, b, c]);
    }
    faces = next;
  }

  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const a = verts[f[0]];
    const b = verts[f[1]];
    const c = verts[f[2]];
    const nx = (a[0] + b[0] + c[0]) / 3;
    const ny = (a[1] + b[1] + c[1]) / 3;
    const nz = (a[2] + b[2] + c[2]) / 3;
    const l = Math.hypot(nx, ny, nz) || 1;
    mb.tri(
      cx + a[0] * radius, cy + a[1] * radius, cz + a[2] * radius,
      cx + b[0] * radius, cy + b[1] * radius, cz + b[2] * radius,
      cx + c[0] * radius, cy + c[1] * radius, cz + c[2] * radius,
      faceColor(nx / l, ny / l, nz / l, i),
    );
  }
}

/** Facet count an icosphere will produce, for budget assertions in tests. */
export function icosphereTriangles(subdivisions: number): number {
  return 20 * Math.pow(4, subdivisions);
}

function normalize3(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
