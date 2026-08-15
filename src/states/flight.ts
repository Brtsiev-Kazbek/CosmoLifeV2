import * as THREE from 'three';
import { Renderer, toMesh, type WorldObject } from '../render/renderer';
import { createFlatMaterial, updateFlatMaterial } from '../render/shaders/flat';
import { buildBody, buildAtmosphere, bodyPalette } from '../render/bodies';
import { buildStarfield } from '../render/sky';
import { START_POSITION_LY, stepWorld, type World } from '../sim/world';
import { bodyPositionAt, bodyVelocityAt, type SystemBody } from '../procgen/system';
import { stepFlight, DEFAULT_SHIP, emptyInput, shipSpeed, type FlightInput } from '../sim/flight';
import { approachCommand, supercruiseCeiling } from '../sim/travel';
import { hudMode, MessageFeed, SURFACE_CEILING_M } from '../sim/hudmode';
import { v3, vec3, type Vec3 } from '../lib/vec';
import { clamp } from '../lib/util';
import type { QualityPreset } from '../render/quality';
import type { InputState } from './input';
import type { HudData } from '../ui/hud';
import { t } from '../i18n';

/**
 * The flight state — the game's default screen.
 *
 * Holds the three-way binding between the simulation (float64 world metres), the renderer
 * (camera-relative float32) and the HUD (DOM). Bodies are registered with the renderer
 * once and their world positions are rewritten each tick from the analytic orbits, so the
 * near/far layer decision is recomputed every frame by distance and never chosen here.
 */

interface BodyView {
  body: SystemBody;
  object: WorldObject;
  atmosphere?: WorldObject;
}

const scratchPos = v3();
const scratchVel = v3();
const scratchRel = v3();

export class FlightState {
  readonly renderer: Renderer;
  readonly feed = new MessageFeed();

  private material = createFlatMaterial();
  private emissiveMaterial = createFlatMaterial({ emissive: 1.4 });
  private atmosphereMaterial = createFlatMaterial({
    transparent: true, opacity: 0.16, depthWrite: false, emissive: 0.5,
  });
  private views: BodyView[] = [];
  private input: FlightInput = emptyInput();
  private throttle = 0;
  private autopilot = false;
  private sunDir = new THREE.Vector3(1, 0, 0);
  private sunColor = new THREE.Color(1, 0.96, 0.9);
  private skyColor = new THREE.Color(0.06, 0.08, 0.13);
  private groundColor = new THREE.Color(0.03, 0.03, 0.045);
  private fogColor = new THREE.Color(0.02, 0.02, 0.035);
  private stickOut = { x: 0, y: 0 };
  private approach = { speed: 0, arrived: false, remaining: 0 };
  private cameraQuat = new THREE.Quaternion();

  constructor(
    canvas: HTMLCanvasElement,
    readonly world: World,
    readonly preset: QualityPreset,
  ) {
    this.renderer = new Renderer(canvas, world.player.ship.pos);
    this.buildScene();
    this.placeStart();
  }

  private buildScene(): void {
    for (const body of this.world.system.bodies) {
      if (body.kind === 'belt') continue;
      const appearance = buildBody(body, this.preset.bodyDetail);
      const isStar = body.kind === 'star';
      const mesh = toMesh(appearance.mesh, isStar ? this.emissiveMaterial : this.material);
      const object = this.renderer.add({
        object: mesh,
        worldPos: v3(),
        radius: body.radiusM,
        visible: true,
      });
      const view: BodyView = { body, object };

      if (body.atmosphere > 0.05 && !isStar) {
        const shell = toMesh(
          buildAtmosphere(body, appearance.atmosphereColor, this.preset.bodyDetail),
          this.atmosphereMaterial,
        );
        view.atmosphere = this.renderer.add({
          object: shell,
          worldPos: v3(),
          radius: body.radiusM * 1.03,
          visible: true,
        });
      }
      this.views.push(view);
    }

    const stars = buildStarfield({
      count: this.preset.starCount,
      observerLy: START_POSITION_LY,
      seed: this.world.seed,
    });
    // The starfield is the one object that is pinned to a layer rather than measured: it
    // is infinitely far away by construction and has no world position at all.
    this.renderer.farScene.add(stars);
    stars.scale.setScalar(9e8);
    this.starfield = stars;
  }

  private starfield: THREE.Points | null = null;

  /** Put the player somewhere with a view: off the first planet's day side. */
  private placeStart(): void {
    const planet = this.world.system.bodies.find((b) => b.orbit && b.orbit.parentId === '' && b.kind !== 'belt')
      ?? this.world.system.bodies[0];
    bodyPositionAt(this.world.system, planet, this.world.timeDays, scratchPos);
    const offset = planet.radiusM * 4 + 20000;
    vec3.set(this.world.player.ship.pos, scratchPos[0] + offset, scratchPos[1] + offset * 0.35, scratchPos[2] + offset);
    this.world.player.targetId = planet.id;
    this.lookAt(scratchPos);
  }

  private lookAt(target: Vec3): void {
    vec3.subtract(scratchRel, target, this.world.player.ship.pos);
    const m = new THREE.Matrix4();
    m.lookAt(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(scratchRel[0], scratchRel[1], scratchRel[2]).normalize(),
      new THREE.Vector3(0, 1, 0),
    );
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    // three.js lookAt orients -Z at the target, which matches the ship's forward axis.
    this.world.player.ship.orientation[0] = q.x;
    this.world.player.ship.orientation[1] = q.y;
    this.world.player.ship.orientation[2] = q.z;
    this.world.player.ship.orientation[3] = q.w;
  }

  setSize(width: number, height: number): void {
    this.renderer.setSize(width, height, Math.min(2, window.devicePixelRatio));
  }

  /** One fixed simulation step. */
  step(input: InputState, dt: number): void {
    const player = this.world.player;
    const ship = player.ship;

    input.beginTick(dt);
    input.stick.output(this.stickOut);

    // Throttle is a held axis with memory, not a per-frame impulse: a ship you have to
    // hold the key on to keep moving reads as a car, not a spacecraft.
    this.throttle = clamp(this.throttle + input.axis('throttleUp', 'throttleDown') * dt * 1.4, -1, 1);

    this.input.pitch = -this.stickOut.y;
    this.input.yaw = this.stickOut.x;
    this.input.roll = input.axis('rollRight', 'rollLeft');
    this.input.throttle = this.throttle;
    this.input.strafeX = input.axis('strafeRight', 'strafeLeft');
    this.input.strafeY = input.axis('strafeUp', 'strafeDown');
    this.input.boostPressed = input.wasPressed('boost');
    this.input.supercruiseToggled = input.wasPressed('supercruise');

    if (input.wasPressed('supercruise')) {
      this.feed.push('sc', ship.supercruise ? t('message.supercruiseOff') : t('message.supercruiseOn'), 'info', 3);
    }
    if (input.wasPressed('target')) this.cycleTarget();
    if (input.wasPressed('autopilot')) {
      this.autopilot = !this.autopilot;
      this.feed.push('ap', this.autopilot ? 'Автопилот включён' : 'Автопилот выключен', 'info', 3);
    }

    const env = this.environment();
    if (this.autopilot) this.driveAutopilot(env.distanceToMassM, dt);

    stepFlight(ship, DEFAULT_SHIP, this.input, env, dt);
    stepWorld(this.world, dt);
    this.feed.update(dt);
    input.endTick();

    this.updateBodies();
    this.updateLighting();
  }

  /** Nearest body surface and its gravity — what the flight model needs from the world. */
  private environment(): { distanceToMassM: number; altitudeM: number; gravity: Vec3 } {
    const ship = this.world.player.ship;
    let nearest = Infinity;
    let altitude = Infinity;
    vec3.set(scratchVel, 0, 0, 0);

    for (const view of this.views) {
      if (view.body.kind === 'star') continue;
      bodyPositionAt(this.world.system, view.body, this.world.timeDays, scratchPos);
      vec3.subtract(scratchRel, scratchPos, ship.pos);
      const d = vec3.length(scratchRel);
      const surface = d - view.body.radiusM;
      if (surface < altitude) {
        altitude = surface;
        nearest = d;
        // Gravity only matters inside a few radii; beyond that it is noise on a float.
        if (surface < view.body.radiusM * 3) {
          const g = (6.674e-11 * view.body.massKg) / Math.max(1, d * d);
          vec3.scale(scratchVel, scratchRel, g / Math.max(1, d));
        }
      }
    }
    return {
      distanceToMassM: Number.isFinite(nearest) ? nearest : 1e12,
      altitudeM: altitude,
      gravity: scratchVel,
    };
  }

  private driveAutopilot(distanceToMass: number, dt: number): void {
    const target = this.targetBody();
    if (!target) return;
    const ship = this.world.player.ship;
    bodyPositionAt(this.world.system, target, this.world.timeDays, scratchPos);
    bodyVelocityAt(this.world.system, target, this.world.timeDays, scratchVel);
    vec3.subtract(scratchRel, scratchPos, ship.pos);
    const distance = vec3.length(scratchRel);
    const standoff = target.radiusM * 1.6 + 2000;

    approachCommand(
      distance,
      standoff,
      vec3.length(scratchVel),
      ship.supercruise ? supercruiseCeiling(distanceToMass) : DEFAULT_SHIP.maxSpeed,
      this.approach,
    );

    this.lookAt(scratchPos);
    if (this.approach.arrived) {
      if (ship.supercruise) {
        this.input.supercruiseToggled = true;
        this.feed.push('arr', t('message.arrived', { name: target.name }), 'good', 5);
      }
      this.throttle = 0;
      this.autopilot = false;
      return;
    }
    // Command a speed, not a thrust: the flight model caps velocity, so matching the
    // commanded speed is a matter of holding throttle until it is reached.
    const speed = shipSpeed(ship);
    this.throttle = clamp(this.throttle + Math.sign(this.approach.speed - speed) * dt * 2, -1, 1);
  }

  private targetBody(): SystemBody | undefined {
    const id = this.world.player.targetId;
    return id ? this.world.system.byId.get(id) : undefined;
  }

  private cycleTarget(): void {
    const list = this.world.system.bodies.filter((b) => b.kind !== 'belt');
    if (list.length === 0) return;
    const current = list.findIndex((b) => b.id === this.world.player.targetId);
    const next = list[(current + 1) % list.length];
    this.world.player.targetId = next.id;
    this.feed.push('tgt', t('message.targetSet', { name: next.name }), 'info', 4);
  }

  private updateBodies(): void {
    for (const view of this.views) {
      bodyPositionAt(this.world.system, view.body, this.world.timeDays, view.object.worldPos);
      if (view.atmosphere) {
        vec3.copy(view.atmosphere.worldPos, view.object.worldPos);
      }
      // Rotation is the body's own spin; the surface frame in the landing state is built
      // from this same angle, so a town stays under the same patch of ground.
      const spin = (this.world.timeDays / view.body.rotationDays) * Math.PI * 2;
      view.object.object.rotation.set(0, spin, 0);
    }
  }

  private updateLighting(): void {
    const star = this.world.system.bodies[0];
    bodyPositionAt(this.world.system, star, this.world.timeDays, scratchPos);
    vec3.subtract(scratchRel, scratchPos, this.world.player.ship.pos);
    const len = vec3.length(scratchRel) || 1;
    this.sunDir.set(scratchRel[0] / len, scratchRel[1] / len, scratchRel[2] / len);

    for (const mat of [this.material, this.emissiveMaterial, this.atmosphereMaterial]) {
      updateFlatMaterial(mat, this.sunDir, this.sunColor, this.skyColor, this.groundColor, this.fogColor, 0);
    }
  }

  render(): void {
    const ship = this.world.player.ship;
    this.cameraQuat.set(ship.orientation[0], ship.orientation[1], ship.orientation[2], ship.orientation[3]);
    this.renderer.setCameraOrientation(this.cameraQuat);
    if (this.starfield) this.starfield.quaternion.set(0, 0, 0, 1);
    this.renderer.render();
  }

  hudData(input: InputState): HudData {
    const player = this.world.player;
    const ship = player.ship;
    const env = this.environment();
    const target = this.targetBody();
    let targetDistance = Infinity;
    if (target) {
      bodyPositionAt(this.world.system, target, this.world.timeDays, scratchPos);
      vec3.subtract(scratchRel, scratchPos, ship.pos);
      targetDistance = vec3.length(scratchRel);
    }

    let cargoUsed = 0;
    for (const v of player.cargo.values()) cargoUsed += v;

    return {
      mode: hudMode({
        altitudeM: env.altitudeM,
        supercruise: ship.supercruise,
        hostileNearby: false,
        approaching: this.autopilot,
        landed: ship.landed,
      }),
      speed: shipSpeed(ship),
      throttle: this.throttle,
      altitudeM: env.altitudeM < SURFACE_CEILING_M ? env.altitudeM : Infinity,
      supercruise: ship.supercruise,
      spool: ship.spool,
      boostLeft: ship.boostLeft,
      boostCooldown: ship.boostCooldown,
      credits: player.credits,
      fuel: player.fuel,
      fuelCapacity: player.fuelCapacity,
      cargoUsed,
      cargoCapacity: player.holdTonnes,
      systemName: this.world.star.name,
      targetName: target?.name ?? null,
      targetDistanceM: targetDistance,
      stickX: input.stick.rawX,
      stickY: input.stick.rawY,
      messages: this.feed.visible(),
      contextPrompt: this.contextPrompt(targetDistance, target),
      timeDays: this.world.timeDays,
    };
  }

  private contextPrompt(targetDistance: number, target: SystemBody | undefined): string | null {
    if (!target) return null;
    if (targetDistance < target.radiusM * 2.2) {
      return target.kind === 'station' ? `[F] ${t('action.dock')}` : `[F] ${t('action.land')}`;
    }
    return null;
  }

  dispose(): void {
    this.renderer.dispose();
  }

  /** Exposed for the scripted run: proves a draw path executed by counting triangles. */
  get triangleCount(): number {
    return this.renderer.stats.triangles;
  }
}

/** Unused import guard: bodyPalette is re-exported for the surface state to share. */
export { bodyPalette };
