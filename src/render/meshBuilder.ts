/**
 * Flat-shaded mesh accumulator.
 *
 * Vertices are never shared. Every triangle writes three vertices carrying the same
 * face normal and the same facet colour, which is what "honest flat shading" means:
 * `flatShading: true` on smoothed geometry fakes the normal in the fragment stage and
 * still cannot give a facet its own colour, and it forces an extra derivative per pixel.
 *
 * This module deliberately knows nothing about three.js. It returns plain typed arrays,
 * which is what lets terrain and settlement generation run inside a Worker (the buffers
 * are Transferable) and be tested in Vitest with no browser at all.
 */

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  /** Number of triangles actually written. */
  triangles: number;
}

/** RGB in 0..1. Packed as a plain tuple to stay allocation-free in generators. */
export type Color = readonly [number, number, number];

const GROWTH = 1.75;

export class MeshBuilder {
  private positions: Float32Array;
  private normals: Float32Array;
  private colors: Float32Array;
  /** Write cursor in floats, i.e. 9 per triangle. */
  private cursor = 0;

  constructor(expectedTriangles = 256) {
    const floats = Math.max(9, expectedTriangles * 9);
    this.positions = new Float32Array(floats);
    this.normals = new Float32Array(floats);
    this.colors = new Float32Array(floats);
  }

  get triangleCount(): number {
    return this.cursor / 9;
  }

  /** Drop everything written so far but keep the buffers — chunk rebuilds reuse them. */
  clear(): this {
    this.cursor = 0;
    return this;
  }

  private ensure(extraFloats: number): void {
    const needed = this.cursor + extraFloats;
    if (needed <= this.positions.length) return;
    let size = this.positions.length;
    while (size < needed) size = Math.ceil(size * GROWTH);
    const p = new Float32Array(size);
    const n = new Float32Array(size);
    const c = new Float32Array(size);
    p.set(this.positions);
    n.set(this.normals);
    c.set(this.colors);
    this.positions = p;
    this.normals = n;
    this.colors = c;
  }

  /**
   * One triangle, counter-clockwise when seen from the front. The normal comes from the
   * cross product of its own edges — there is no vertex-normal averaging anywhere in the
   * project, so winding order is the single source of truth for facing.
   */
  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    color: Color,
  ): this {
    this.ensure(9);
    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    if (l > 1e-20) {
      nx /= l;
      ny /= l;
      nz /= l;
    } else {
      // Degenerate triangle: keep it out of the buffer entirely rather than emit a NaN
      // normal, which turns the whole draw call black on some drivers.
      return this;
    }

    const p = this.positions;
    const n = this.normals;
    const col = this.colors;
    let i = this.cursor;
    const [r, g, b] = color;

    p[i] = ax; p[i + 1] = ay; p[i + 2] = az;
    p[i + 3] = bx; p[i + 4] = by; p[i + 5] = bz;
    p[i + 6] = cx; p[i + 7] = cy; p[i + 8] = cz;
    for (let k = 0; k < 9; k += 3) {
      n[i + k] = nx; n[i + k + 1] = ny; n[i + k + 2] = nz;
      col[i + k] = r; col[i + k + 1] = g; col[i + k + 2] = b;
    }
    i += 9;
    this.cursor = i;
    return this;
  }

  /** Quad as two triangles sharing the a-c diagonal. */
  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    color: Color,
  ): this {
    this.tri(ax, ay, az, bx, by, bz, cx, cy, cz, color);
    this.tri(ax, ay, az, cx, cy, cz, dx, dy, dz, color);
    return this;
  }

  /** Convex polygon fan. Used for building roofs and landing pads. */
  fan(points: ArrayLike<number>, color: Color, flip = false): this {
    const count = points.length / 3;
    for (let i = 1; i + 1 < count; i++) {
      const a = 0;
      const b = flip ? (i + 1) * 3 : i * 3;
      const c = flip ? i * 3 : (i + 1) * 3;
      this.tri(
        points[a], points[a + 1], points[a + 2],
        points[b], points[b + 1], points[b + 2],
        points[c], points[c + 1], points[c + 2],
        color,
      );
    }
    return this;
  }

  /** Append another builder's contents, offset by a translation. */
  append(other: MeshBuilder, ox = 0, oy = 0, oz = 0): this {
    const floats = other.cursor;
    this.ensure(floats);
    const p = this.positions;
    const src = other.positions;
    for (let i = 0; i < floats; i += 3) {
      p[this.cursor + i] = src[i] + ox;
      p[this.cursor + i + 1] = src[i + 1] + oy;
      p[this.cursor + i + 2] = src[i + 2] + oz;
    }
    this.normals.set(other.normals.subarray(0, floats), this.cursor);
    this.colors.set(other.colors.subarray(0, floats), this.cursor);
    this.cursor += floats;
    return this;
  }

  /**
   * Tight copies, ready to be handed to a BufferGeometry or transferred from a Worker.
   * Copies rather than subarrays: a subarray keeps the (possibly much larger) growth
   * buffer alive, and a Transferable view would detach the builder's own storage.
   */
  build(): MeshData {
    const floats = this.cursor;
    return {
      positions: this.positions.slice(0, floats),
      normals: this.normals.slice(0, floats),
      colors: this.colors.slice(0, floats),
      triangles: floats / 9,
    };
  }
}

/** Empty mesh — a valid result for "nothing visible here", never null. */
export function emptyMesh(): MeshData {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Float32Array(0),
    triangles: 0,
  };
}

/** The three buffers, for `postMessage` transfer lists. */
export function meshTransferables(mesh: MeshData): Transferable[] {
  return [mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer] as Transferable[];
}
