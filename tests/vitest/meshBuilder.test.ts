import { describe, expect, it } from 'vitest';
import { MeshBuilder, emptyMesh } from '../../src/render/meshBuilder';
import { box, icosphere, icosphereTriangles, cylinder, prism } from '../../src/render/geometry';
import { Rng } from '../../src/lib/rng';

describe('MeshBuilder — honest flat shading', () => {
  it('never shares a vertex between triangles', () => {
    const mb = new MeshBuilder();
    box(mb, 0, 0, 0, 1, 1, 1, [0.5, 0.5, 0.5]);
    const mesh = mb.build();
    // 12 triangles * 3 vertices, all separate: a shared-vertex cube would be 8.
    expect(mesh.triangles).toBe(12);
    expect(mesh.positions.length).toBe(12 * 9);
  });

  it('gives all three vertices of a triangle the same normal and colour', () => {
    const mb = new MeshBuilder();
    mb.tri(0, 0, 0, 1, 0, 0, 0, 0, 1, [0.2, 0.4, 0.6]);
    const m = mb.build();
    for (let v = 0; v < 3; v++) {
      expect(m.normals[v * 3]).toBe(m.normals[0]);
      expect(m.normals[v * 3 + 1]).toBe(m.normals[1]);
      expect(m.normals[v * 3 + 2]).toBe(m.normals[2]);
      expect(m.colors[v * 3]).toBeCloseTo(0.2, 6);
      expect(m.colors[v * 3 + 1]).toBeCloseTo(0.4, 6);
      expect(m.colors[v * 3 + 2]).toBeCloseTo(0.6, 6);
    }
  });

  it('computes the face normal from the triangle winding', () => {
    const mb = new MeshBuilder();
    // Counter-clockwise seen from +Y must face +Y.
    mb.tri(0, 0, 0, 0, 0, 1, 1, 0, 0, [1, 1, 1]);
    const m = mb.build();
    expect(m.normals[0]).toBeCloseTo(0, 6);
    expect(m.normals[1]).toBeCloseTo(1, 6);
    expect(m.normals[2]).toBeCloseTo(0, 6);
  });

  it('emits unit-length normals everywhere', () => {
    const mb = new MeshBuilder();
    const rng = new Rng(4);
    icosphere(mb, 0, 0, 0, 100, 2, () => [0.5, 0.5, 0.5]);
    cylinder(mb, 5, 0, 0, 3, 4, 9, [0.3, 0.3, 0.3]);
    prism(mb, [0, 0, 5, 0, 5, 5, 0, 5], 0, 3, [0.4, 0.4, 0.4]);
    box(mb, rng.range(-5, 5), 0, 0, 1, 2, 3, [0.6, 0.6, 0.6]);
    const m = mb.build();
    for (let i = 0; i < m.normals.length; i += 3) {
      const l = Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]);
      expect(l).toBeCloseTo(1, 4);
    }
  });

  it('drops degenerate triangles instead of writing NaN normals', () => {
    const mb = new MeshBuilder();
    mb.tri(0, 0, 0, 1, 0, 0, 2, 0, 0, [1, 1, 1]); // collinear
    expect(mb.triangleCount).toBe(0);
    const m = mb.build();
    for (const v of m.normals) expect(Number.isNaN(v)).toBe(false);
  });

  it('grows past its initial capacity without corrupting earlier data', () => {
    const mb = new MeshBuilder(1);
    for (let i = 0; i < 500; i++) mb.tri(i, 0, 0, i + 1, 0, 0, i, 1, 0, [i / 500, 0, 0]);
    const m = mb.build();
    expect(m.triangles).toBe(500);
    expect(m.positions[0]).toBe(0);
    expect(m.positions[499 * 9]).toBe(499);
  });

  it('clear() keeps the buffers but resets the cursor', () => {
    const mb = new MeshBuilder(64);
    box(mb, 0, 0, 0, 1, 1, 1, [1, 1, 1]);
    mb.clear();
    expect(mb.triangleCount).toBe(0);
    expect(mb.build().positions.length).toBe(0);
  });

  it('append() offsets geometry and preserves normals', () => {
    const part = new MeshBuilder();
    box(part, 0, 0, 0, 1, 1, 1, [0.5, 0.2, 0.2]);
    const whole = new MeshBuilder();
    whole.append(part, 10, 0, 0);
    const m = whole.build();
    expect(m.triangles).toBe(12);
    let minX = Infinity;
    for (let i = 0; i < m.positions.length; i += 3) minX = Math.min(minX, m.positions[i]);
    expect(minX).toBe(9);
  });

  it('emptyMesh is a valid zero-triangle result', () => {
    const m = emptyMesh();
    expect(m.triangles).toBe(0);
    expect(m.positions.length).toBe(0);
  });
});

describe('geometry primitives', () => {
  it('icosphere produces the documented facet count', () => {
    for (const sub of [0, 1, 2, 3]) {
      const mb = new MeshBuilder();
      icosphere(mb, 0, 0, 0, 1, sub, () => [1, 1, 1]);
      expect(mb.triangleCount).toBe(icosphereTriangles(sub));
    }
  });

  it('icosphere vertices sit on the sphere', () => {
    const mb = new MeshBuilder();
    icosphere(mb, 7, -3, 2, 50, 2, () => [1, 1, 1]);
    const m = mb.build();
    for (let i = 0; i < m.positions.length; i += 3) {
      const d = Math.hypot(m.positions[i] - 7, m.positions[i + 1] + 3, m.positions[i + 2] - 2);
      expect(d).toBeCloseTo(50, 3);
    }
  });

  it('box faces are shaded apart so corners stay readable', () => {
    const mb = new MeshBuilder();
    box(mb, 0, 0, 0, 1, 1, 1, [0.6, 0.6, 0.6]);
    const m = mb.build();
    const shades = new Set<number>();
    for (let t = 0; t < m.triangles; t++) shades.add(Math.round(m.colors[t * 9] * 1000));
    // Top, bottom and two side shades: a single-shade cube reads as a flat blob.
    expect(shades.size).toBeGreaterThanOrEqual(4);
  });
});
