import { glMatrix, mat3, mat4, quat, vec3 } from 'gl-matrix';

/**
 * Vector/matrix layer.
 *
 * gl-matrix defaults to Float32Array. That is fatal here: the world is metres and a
 * planet orbit is ~1e11 m, where float32 spacing is about 8000 m — the ship would
 * teleport between grid points. Float64 for all world maths; the conversion to float32
 * happens once, in the renderer, on camera-relative positions (floating origin).
 */
glMatrix.setMatrixArrayType(Float64Array as unknown as typeof Array);

export type Vec3 = Float64Array;
export type Quat = Float64Array;
export type Mat4 = Float64Array;
export type Mat3 = Float64Array;

export { vec3, quat, mat4, mat3 };

export function v3(x = 0, y = 0, z = 0): Vec3 {
  const out = new Float64Array(3);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export function q(): Quat {
  const out = new Float64Array(4);
  out[3] = 1;
  return out;
}

export function m4(): Mat4 {
  const out = new Float64Array(16);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** Squared length between two points. Comparisons should use this and never sqrt. */
export function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

export function dist(a: Vec3, b: Vec3): number {
  return Math.sqrt(dist2(a, b));
}

export function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function set3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/**
 * Scratch pool for hot paths.
 *
 * Rule 7 is zero allocation per frame: flight integration, terrain frame rebuild and
 * targeting all run every tick and would otherwise churn several vec3 per entity. Borrow
 * with `scratch(i)` using a literal index so two call sites can never share a slot by
 * accident.
 */
const SCRATCH: Vec3[] = [];
for (let i = 0; i < 32; i++) SCRATCH.push(v3());

export function scratch(index: number): Vec3 {
  return SCRATCH[index];
}
