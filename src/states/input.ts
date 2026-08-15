import { VirtualStick } from '../sim/stick';

/**
 * Input.
 *
 * Bindings are on **physical key codes** (`KeyboardEvent.code`), never on the character
 * produced. On a Cyrillic layout `event.key` for the W key is "ц", so a binding table
 * written against characters leaves the player unable to walk forward — with no error and
 * no clue why. `code` is layout-independent by definition.
 *
 * The core is twelve keys plus the mouse. Everything else exists, is rebindable, and is
 * deliberately kept off the reference card.
 */

export type Action =
  | 'throttleUp' | 'throttleDown' | 'rollLeft' | 'rollRight'
  | 'strafeLeft' | 'strafeRight' | 'strafeUp' | 'strafeDown'
  | 'boost' | 'supercruise' | 'autopilot' | 'fire' | 'missile'
  | 'target' | 'context' | 'panel' | 'map' | 'pause' | 'help'
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'run';

export const DEFAULT_BINDINGS: Readonly<Record<string, Action>> = {
  KeyW: 'throttleUp',
  KeyS: 'throttleDown',
  KeyA: 'rollLeft',
  KeyD: 'rollRight',
  KeyQ: 'strafeLeft',
  KeyE: 'strafeRight',
  Space: 'strafeUp',
  KeyC: 'strafeDown',
  ShiftLeft: 'boost',
  KeyJ: 'supercruise',
  KeyX: 'autopilot',
  KeyT: 'target',
  KeyF: 'context',
  Tab: 'panel',
  KeyM: 'map',
  KeyP: 'pause',
  KeyH: 'help',
};

/** On foot the same physical keys mean movement. */
export const ON_FOOT_BINDINGS: Readonly<Record<string, Action>> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'jump',
  ShiftLeft: 'run',
  KeyF: 'context',
  Tab: 'panel',
  KeyM: 'map',
  KeyP: 'pause',
  KeyH: 'help',
};

export class InputState {
  readonly stick = new VirtualStick();
  private held = new Set<Action>();
  private pressedThisTick = new Set<Action>();
  private bindings: Readonly<Record<string, Action>> = DEFAULT_BINDINGS;
  private pointerLocked = false;
  /** Accumulated mouse delta since the last tick, in pixels. */
  private mouseDx = 0;
  private mouseDy = 0;

  constructor(private readonly element: HTMLElement) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    this.element.addEventListener('click', this.requestLock);
    window.addEventListener('blur', this.releaseAll);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.element.removeEventListener('click', this.requestLock);
    window.removeEventListener('blur', this.releaseAll);
  }

  setBindings(bindings: Readonly<Record<string, Action>>): void {
    this.bindings = bindings;
  }

  private requestLock = (): void => {
    void this.element.requestPointerLock?.();
  };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element;
    if (!this.pointerLocked) this.releaseAll();
  };

  private releaseAll = (): void => {
    this.held.clear();
    this.stick.centre();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const action = this.bindings[e.code];
    if (!action) return;
    // Tab would move focus out of the canvas and Space would scroll the page.
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!this.held.has(action)) this.pressedThisTick.add(action);
    this.held.add(action);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const action = this.bindings[e.code];
    if (action) this.held.delete(action);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.mouseDx += e.movementX;
    this.mouseDy += e.movementY;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    const action: Action | null = e.button === 0 ? 'fire' : e.button === 2 ? 'missile' : null;
    if (action) {
      if (!this.held.has(action)) this.pressedThisTick.add(action);
      this.held.add(action);
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    const action: Action | null = e.button === 0 ? 'fire' : e.button === 2 ? 'missile' : null;
    if (action) this.held.delete(action);
  };

  /** Fold accumulated mouse movement into the stick and clear edge triggers. */
  beginTick(dt: number): void {
    this.stick.moveBy(this.mouseDx, this.mouseDy);
    this.mouseDx = 0;
    this.mouseDy = 0;
    // Self-centring runs after the input, so a held mouse still wins over the return.
    this.stick.update(dt);
  }

  endTick(): void {
    this.pressedThisTick.clear();
  }

  isHeld(action: Action): boolean {
    return this.held.has(action);
  }

  /** True only on the tick the key went down — used by every toggle. */
  wasPressed(action: Action): boolean {
    return this.pressedThisTick.has(action);
  }

  /** Raw mouse look delta, for the on-foot camera which does not use the stick. */
  takeLookDelta(out: { x: number; y: number }): void {
    out.x = this.mouseDx;
    out.y = this.mouseDy;
    this.mouseDx = 0;
    this.mouseDy = 0;
  }

  get locked(): boolean {
    return this.pointerLocked;
  }

  /** Axis value from a pair of keys, for throttle and strafe. */
  axis(positive: Action, negative: Action): number {
    return (this.isHeld(positive) ? 1 : 0) - (this.isHeld(negative) ? 1 : 0);
  }
}
