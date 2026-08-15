import * as THREE from 'three';

/**
 * The one material the game draws with.
 *
 * Lighting model: a single sun plus a hemisphere ambient (sky colour from above, ground
 * bounce from below). No specular, no textures, no smooth normals — the facet's own
 * normal and its vertex colour are everything. Wrap lighting (`0.5 + 0.5 * NdotL`) is
 * deliberate: pure Lambert leaves the entire dark side of a hull at the ambient floor and
 * the silhouette disappears against space, which reads as a rendering bug rather than a
 * lighting choice.
 */

export interface FlatMaterialOptions {
  sunColor?: THREE.Color;
  skyColor?: THREE.Color;
  groundColor?: THREE.Color;
  /** Extra emissive floor: city windows, engine flares, star surfaces. */
  emissive?: number;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  /** Far-layer meshes are pre-scaled, so fog/atmosphere fade is applied differently. */
  fogDensity?: number;
}

const vertexShader = /* glsl */ `
  attribute vec3 color;
  varying vec3 vColor;
  varying vec3 vNormalW;
  varying float vDepth;

  void main() {
    vColor = color;
    // Normal matrix, not the model matrix: non-uniform scale on a facet normal tilts the
    // light in a way that shows up as banding across a terrain chunk.
    vNormalW = normalize(normalMatrix * normal);
    vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
    vDepth = -viewPos.z;
    gl_Position = projectionMatrix * viewPos;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform vec3 uFogColor;
  uniform float uEmissive;
  uniform float uOpacity;
  uniform float uFogDensity;

  varying vec3 vColor;
  varying vec3 vNormalW;
  varying float vDepth;

  void main() {
    vec3 n = normalize(vNormalW);

    // Wrap diffuse: keeps the unlit side readable instead of crushing it to ambient.
    float ndl = dot(n, uSunDir);
    float diffuse = max(0.0, ndl * 0.5 + 0.5);
    diffuse *= diffuse;

    // Hemisphere ambient: sky above, ground bounce below.
    float hemi = n.y * 0.5 + 0.5;
    vec3 ambient = mix(uGroundColor, uSkyColor, hemi);

    vec3 lit = vColor * (uSunColor * diffuse + ambient) + vColor * uEmissive;

    // Exponential-squared fog. Distant terrain otherwise keeps full contrast right up to
    // the horizon and the planet reads as a flat painted backdrop.
    float f = 1.0 - exp(-pow(vDepth * uFogDensity, 2.0));
    lit = mix(lit, uFogColor, clamp(f, 0.0, 1.0));

    gl_FragColor = vec4(lit, uOpacity);
  }
`;

export function createFlatMaterial(opts: FlatMaterialOptions = {}): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.55).normalize() },
      uSunColor: { value: opts.sunColor ? opts.sunColor.clone() : new THREE.Color(1.0, 0.96, 0.9) },
      uSkyColor: { value: opts.skyColor ? opts.skyColor.clone() : new THREE.Color(0.10, 0.13, 0.20) },
      uGroundColor: { value: opts.groundColor ? opts.groundColor.clone() : new THREE.Color(0.05, 0.04, 0.04) },
      uFogColor: { value: new THREE.Color(0.02, 0.02, 0.035) },
      uEmissive: { value: opts.emissive ?? 0 },
      uOpacity: { value: opts.opacity ?? 1 },
      uFogDensity: { value: opts.fogDensity ?? 0 },
    },
    transparent: opts.transparent ?? false,
    depthWrite: opts.depthWrite ?? true,
  });
  mat.name = 'flat3d';
  return mat;
}

/** Push per-frame lighting into a material. Called once per material, not per object. */
export function updateFlatMaterial(
  mat: THREE.ShaderMaterial,
  sunDir: THREE.Vector3,
  sunColor: THREE.Color,
  skyColor: THREE.Color,
  groundColor: THREE.Color,
  fogColor: THREE.Color,
  fogDensity: number,
): void {
  const u = mat.uniforms;
  (u.uSunDir.value as THREE.Vector3).copy(sunDir);
  (u.uSunColor.value as THREE.Color).copy(sunColor);
  (u.uSkyColor.value as THREE.Color).copy(skyColor);
  (u.uGroundColor.value as THREE.Color).copy(groundColor);
  (u.uFogColor.value as THREE.Color).copy(fogColor);
  u.uFogDensity.value = fogDensity;
}
