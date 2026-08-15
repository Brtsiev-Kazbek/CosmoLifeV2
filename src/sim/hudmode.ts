/**
 * Contextual HUD mode.
 *
 * The HUD shows different layers depending on what the player is doing, and a layer
 * **fades** rather than disappearing: an element that vanishes between two frames reads as
 * a glitch and the player stops trusting the instrument. Pure function of the situation,
 * so the mode can be asserted in a headless test instead of eyeballed.
 */

export type HudMode = 'combat' | 'approach' | 'surface' | 'cruise' | 'space';

export interface HudSituation {
  /** Metres above the surface below. Infinity in deep space. */
  altitudeM: number;
  supercruise: boolean;
  /** A hostile is within weapons range and has been seen recently. */
  hostileNearby: boolean;
  /** Player has a nav target selected and the approach autopilot is running. */
  approaching: boolean;
  landed: boolean;
}

/** Below this altitude the surface layers (radar altimeter, horizon) come up. */
export const SURFACE_CEILING_M = 140_000;

export function hudMode(s: HudSituation): HudMode {
  // Order is a priority list, not a chain of coincidences: a fight overrides everything
  // because the player needs the lead ring more than the trade overlay.
  if (s.hostileNearby) return 'combat';
  if (s.landed || s.altitudeM < SURFACE_CEILING_M) return 'surface';
  if (s.approaching) return 'approach';
  if (s.supercruise) return 'cruise';
  return 'space';
}

/** Per-layer opacity for a mode. Layers dim to 0.28, they do not blink out. */
export const DIM_ALPHA = 0.28;

export type HudLayer =
  | 'throttle' | 'radar' | 'target' | 'leadRing' | 'altimeter'
  | 'horizon' | 'navRoute' | 'cargo' | 'stickWidget';

const FULL: readonly HudLayer[] = ['throttle', 'radar', 'stickWidget'];

const BY_MODE: Record<HudMode, readonly HudLayer[]> = {
  combat: ['target', 'leadRing', 'radar', 'throttle', 'stickWidget'],
  approach: ['target', 'navRoute', 'throttle', 'radar', 'stickWidget'],
  surface: ['altimeter', 'horizon', 'throttle', 'radar', 'stickWidget'],
  cruise: ['navRoute', 'target', 'throttle', 'stickWidget'],
  space: ['radar', 'throttle', 'cargo', 'stickWidget'],
};

export function layerAlpha(mode: HudMode, layer: HudLayer): number {
  if (BY_MODE[mode].includes(layer)) return 1;
  if (FULL.includes(layer)) return 1;
  return DIM_ALPHA;
}

/** Message priority. A repeat refreshes the lifetime instead of stacking a duplicate. */
export type MessagePriority = 'alert' | 'warn' | 'good' | 'info';

const PRIORITY_ORDER: Record<MessagePriority, number> = { alert: 3, warn: 2, good: 1, info: 0 };

export interface Message {
  id: string;
  text: string;
  priority: MessagePriority;
  secondsLeft: number;
}

/** No more than three lines on screen. Beyond that the ribbon is wallpaper. */
export const MAX_MESSAGES = 3;

export class MessageFeed {
  private items: Message[] = [];

  push(id: string, text: string, priority: MessagePriority, seconds = 6): void {
    const existing = this.items.find((m) => m.id === id);
    if (existing) {
      // Refresh, do not duplicate: a repeating warning that printed a new line every
      // second would push everything else off the ribbon within three seconds.
      existing.secondsLeft = seconds;
      existing.text = text;
      existing.priority = priority;
      return;
    }
    this.items.push({ id, text, priority, secondsLeft: seconds });
  }

  update(dt: number): void {
    for (const m of this.items) m.secondsLeft -= dt;
    this.items = this.items.filter((m) => m.secondsLeft > 0);
  }

  /** The lines to draw, highest priority first, newest first within a priority. */
  visible(): Message[] {
    const sorted = [...this.items].sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority];
      const pb = PRIORITY_ORDER[b.priority];
      if (pa !== pb) return pb - pa;
      if (a.secondsLeft !== b.secondsLeft) return b.secondsLeft - a.secondsLeft;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return sorted.slice(0, MAX_MESSAGES);
  }

  clear(): void {
    this.items.length = 0;
  }

  get size(): number {
    return this.items.length;
  }
}
