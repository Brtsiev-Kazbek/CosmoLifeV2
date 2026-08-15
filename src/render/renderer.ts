import * as THREE from 'three';
import type { MeshData } from './meshBuilder';
import { FAR_SCALE, NEAR_PLANE_M, NEAR_RANGE_M, layerFor, type Layer } from './layers';
import type { Vec3 } from '../lib/vec';
import { createFlatMaterial } from './shaders/flat';

/**
 * The only module that knows three.js exists on the drawing side.
 *
 * Two responsibilities, both structural:
 *
 * 1. **Floating origin.** World positions are float64 metres and reach 1e11; float32
 *    vertex data at that magnitude has ~8 km spacing. Every object is therefore drawn at
 *    its position *relative to the camera*, and the camera itself always sits at the
 *    origin of the three.js scene.
 *
 * 2. **Layer assignment is computed, never chosen.** Each frame every registered object
 *    is measured against the camera and put into the near or far scene by `layerFor`.
 *    Hand-picking a layer at the call site is how a settlement ends up submitted to a
 *    scene whose far plane is 30 km, drawing zero triangles from 40 km with no error.
 */

export interface WorldObject {
  object: THREE.Object3D;
  /** Float64 world position in metres. Mutated in place by the sim; never copied here. */
  worldPos: Vec3;
  /** Bounding radius in metres, used for near/far straddling and culling. */
  radius: number;
  /** Force a layer. Only stars and the skybox use this; everything else is measured. */
  forceLayer?: Layer;
  visible: boolean;
}

export interface RenderStats {
  triangles: number;
  nearObjects: number;
  farObjects: number;
  drawCalls: number;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly nearScene = new THREE.Scene();
  readonly farScene = new THREE.Scene();
  readonly nearCamera: THREE.PerspectiveCamera;
  readonly farCamera: THREE.PerspectiveCamera;

  /** Camera position in float64 world metres — the origin everything is drawn against. */
  readonly cameraWorld: Vec3;

  readonly stats: RenderStats = { triangles: 0, nearObjects: 0, farObjects: 0, drawCalls: 0 };

  private objects: WorldObject[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, cameraWorld: Vec3) {
    this.cameraWorld = cameraWorld;
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // Flat facets have hard edges everywhere; without MSAA the whole image crawls.
      powerPreference: 'high-performance',
      // Needed by the far pass: a linear depth buffer cannot separate a station at 5e5 m
      // from a planet at 1e8 m in the same frame.
      logarithmicDepthBuffer: true,
    });
    this.gl.autoClear = false;
    this.gl.setClearColor(0x02030a, 1);

    this.nearCamera = new THREE.PerspectiveCamera(70, 1, NEAR_PLANE_M, NEAR_RANGE_M);
    // Far plane covers 1e12 m once divided by FAR_SCALE.
    this.farCamera = new THREE.PerspectiveCamera(70, 1, 1, 1e9);
  }

  setSize(width: number, height: number, pixelRatio = 1): void {
    this.gl.setPixelRatio(pixelRatio);
    this.gl.setSize(width, height, false);
    const aspect = width / Math.max(1, height);
    this.nearCamera.aspect = aspect;
    this.farCamera.aspect = aspect;
    this.nearCamera.updateProjectionMatrix();
    this.farCamera.updateProjectionMatrix();
  }

  setFieldOfView(degrees: number): void {
    this.nearCamera.fov = degrees;
    this.farCamera.fov = degrees;
    this.nearCamera.updateProjectionMatrix();
    this.farCamera.updateProjectionMatrix();
  }

  add(obj: WorldObject): WorldObject {
    this.objects.push(obj);
    return obj;
  }

  remove(obj: WorldObject): void {
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
    obj.object.parent?.remove(obj.object);
  }

  clearObjects(): void {
    for (const o of this.objects) o.object.parent?.remove(o.object);
    this.objects.length = 0;
  }

  /** Orientation only — position is always the origin, by the floating-origin rule. */
  setCameraOrientation(quaternion: THREE.Quaternion): void {
    this.nearCamera.quaternion.copy(quaternion);
    this.farCamera.quaternion.copy(quaternion);
    this.nearCamera.position.set(0, 0, 0);
    this.farCamera.position.set(0, 0, 0);
    this.nearCamera.updateMatrixWorld();
    this.farCamera.updateMatrixWorld();
  }

  /**
   * Place every registered object relative to the camera and file it into a layer.
   * Runs once per frame over a flat array with no allocation.
   */
  private place(): void {
    const cx = this.cameraWorld[0];
    const cy = this.cameraWorld[1];
    const cz = this.cameraWorld[2];
    this.stats.nearObjects = 0;
    this.stats.farObjects = 0;

    for (let i = 0; i < this.objects.length; i++) {
      const o = this.objects[i];
      const dx = o.worldPos[0] - cx;
      const dy = o.worldPos[1] - cy;
      const dz = o.worldPos[2] - cz;
      const d = Math.hypot(dx, dy, dz);

      if (!o.visible) {
        o.object.visible = false;
        continue;
      }
      o.object.visible = true;

      // Straddling objects (a planet whose surface is under the ship but whose centre is
      // 3e6 m away) belong to the near layer only if their *surface* is inside it.
      const layer: Layer = o.forceLayer ?? layerFor(Math.max(0, d - o.radius));

      if (layer === 'near') {
        o.object.position.set(dx, dy, dz);
        o.object.scale.setScalar(1);
        if (o.object.parent !== this.nearScene) this.nearScene.add(o.object);
        this.stats.nearObjects++;
      } else {
        o.object.position.set(dx / FAR_SCALE, dy / FAR_SCALE, dz / FAR_SCALE);
        o.object.scale.setScalar(1 / FAR_SCALE);
        if (o.object.parent !== this.farScene) this.farScene.add(o.object);
        this.stats.farObjects++;
      }
    }
  }

  render(): void {
    this.place();
    this.gl.clear(true, true, true);

    // Far first, then the depth buffer is thrown away: near geometry always wins, which
    // is correct because nothing in the near layer can be behind something in the far one.
    this.gl.render(this.farScene, this.farCamera);
    this.gl.clearDepth();
    this.gl.render(this.nearScene, this.nearCamera);

    const info = this.gl.info.render;
    this.stats.triangles = info.triangles;
    this.stats.drawCalls = info.calls;
  }

  /** Screen-space projection of a world point, for HUD markers drawn in the DOM. */
  project(worldPos: Vec3, out: { x: number; y: number; depth: number }): boolean {
    this.tmp.set(
      worldPos[0] - this.cameraWorld[0],
      worldPos[1] - this.cameraWorld[1],
      worldPos[2] - this.cameraWorld[2],
    );
    const dist = this.tmp.length();
    // Project through whichever camera would have drawn it, or the marker drifts off the
    // object by several degrees near the layer boundary.
    const cam = layerFor(dist) === 'near' ? this.nearCamera : this.farCamera;
    if (cam === this.farCamera) this.tmp.multiplyScalar(1 / FAR_SCALE);
    this.tmp.project(cam);
    out.x = (this.tmp.x * 0.5 + 0.5) * this.gl.domElement.clientWidth;
    out.y = (-this.tmp.y * 0.5 + 0.5) * this.gl.domElement.clientHeight;
    out.depth = dist;
    return this.tmp.z < 1;
  }

  dispose(): void {
    this.clearObjects();
    this.gl.dispose();
  }
}

/**
 * The single conversion from generator output to GPU buffers.
 *
 * Everything upstream of this line is plain typed arrays, which is what makes terrain and
 * settlement generation runnable in a Worker and testable without a browser.
 */
export function toBufferGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
  // No index buffer by design: vertices are split per triangle for flat shading, so an
  // index would be a 1:1 identity map and pure overhead.
  geo.computeBoundingSphere();
  return geo;
}

/** Mesh from generator output, using the shared flat material. */
export function toMesh(mesh: MeshData, material?: THREE.ShaderMaterial): THREE.Mesh {
  return new THREE.Mesh(toBufferGeometry(mesh), material ?? createFlatMaterial());
}
