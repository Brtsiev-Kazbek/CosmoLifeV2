import { FixedStep } from './lib/loop';
import { createWorld } from './sim/world';
import { FlightState } from './states/flight';
import { InputState } from './states/input';
import { presetByName, type QualityName } from './render/quality';
import { initI18n } from './i18n';
import './ui/hud';
import type { ClHud } from './ui/hud';

/**
 * Entry point.
 *
 * Real time enters the program in exactly one place — this loop — and is immediately
 * converted into a whole number of fixed steps. Nothing downstream ever sees a variable
 * dt, which is what makes a headless test and a browser run produce the same trajectory.
 */

const DEFAULT_SEED = 20260815;

function readSeed(): number {
  const param = new URLSearchParams(location.search).get('seed');
  const parsed = param ? Number.parseInt(param, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_SEED;
}

function readQuality(): QualityName {
  const q = new URLSearchParams(location.search).get('quality');
  return q === 'potato' || q === 'low' || q === 'medium' || q === 'high' ? q : 'medium';
}

function boot(): void {
  initI18n('ru');

  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as ClHud;
  const hint = document.getElementById('hint');

  const world = createWorld(readSeed());
  const preset = presetByName(readQuality());
  const flight = new FlightState(canvas, world, preset);
  const input = new InputState(canvas);
  input.attach();

  const resize = (): void => flight.setSize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', resize);
  resize();

  const step = new FixedStep();
  let last = performance.now() / 1000;
  let paused = false;

  const frame = (): void => {
    requestAnimationFrame(frame);
    const now = performance.now() / 1000;
    const elapsed = now - last;
    last = now;

    if (input.wasPressed('pause')) paused = !paused;

    const steps = paused ? 0 : step.advance(elapsed);
    for (let i = 0; i < steps; i++) flight.step(input, step.dt);

    flight.render();
    hud.data = flight.hudData(input);

    if (hint && input.locked) hint.classList.add('hidden');
  };

  requestAnimationFrame(frame);

  // The scripted run drives the game through this handle: it needs to step deterministic
  // frames and read the triangle count, which is how "this draw path really executed" is
  // proven rather than assumed.
  interface TestHandle {
    world: typeof world;
    flight: FlightState;
    input: InputState;
    stepFrames(count: number): void;
    triangles(): number;
  }
  (window as unknown as { cosmolife: TestHandle }).cosmolife = {
    world,
    flight,
    input,
    stepFrames(count: number): void {
      for (let i = 0; i < count; i++) {
        flight.step(input, step.dt);
        flight.render();
      }
      hud.data = flight.hudData(input);
    },
    triangles(): number {
      return flight.triangleCount;
    },
  };
}

boot();
