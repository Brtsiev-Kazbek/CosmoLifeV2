import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { HudMode, Message } from '../sim/hudmode';
import { layerAlpha } from '../sim/hudmode';
import { t } from '../i18n';

/**
 * The HUD, in the DOM.
 *
 * Text layout, ellipsis, wrapping and font metrics are the browser's problem rather than
 * the renderer's, which is the whole reason for putting the interface here instead of
 * drawing it into the canvas. The canvas below stays purely a 3D view.
 *
 * Everything on screen either fades to `DIM_ALPHA` or is at full opacity — a layer that
 * disappears between two frames reads as a fault and the player stops trusting it.
 */

export interface HudData {
  mode: HudMode;
  speed: number;
  throttle: number;
  altitudeM: number;
  supercruise: boolean;
  spool: number;
  boostLeft: number;
  boostCooldown: number;
  credits: number;
  fuel: number;
  fuelCapacity: number;
  cargoUsed: number;
  cargoCapacity: number;
  systemName: string;
  targetName: string | null;
  targetDistanceM: number;
  /** Raw stick deflection, drawn on the reticle. */
  stickX: number;
  stickY: number;
  messages: Message[];
  /** Prompt for the single context action, already localised. */
  contextPrompt: string | null;
  timeDays: number;
}

@customElement('cl-hud')
export class ClHud extends LitElement {
  static styles = css`
    :host {
      position: absolute;
      inset: 0;
      display: block;
      pointer-events: none;
      font-family: 'Menlo', 'DejaVu Sans Mono', monospace;
      color: #cfe6ff;
      text-shadow: 0 0 6px rgba(0, 20, 40, 0.9);
      user-select: none;
      font-variant-numeric: tabular-nums;
    }
    .panel {
      position: absolute;
      background: linear-gradient(180deg, rgba(6, 14, 26, 0.55), rgba(6, 14, 26, 0.32));
      border: 1px solid rgba(120, 190, 255, 0.28);
      border-radius: 3px;
      padding: 6px 10px;
      font-size: 12px;
      line-height: 1.5;
      transition: opacity 220ms ease;
      backdrop-filter: blur(2px);
    }
    .left { left: 18px; bottom: 18px; min-width: 190px; }
    .right { right: 18px; bottom: 18px; min-width: 170px; text-align: right; }
    .top { left: 50%; top: 14px; transform: translateX(-50%); text-align: center; }
    .row { display: flex; justify-content: space-between; gap: 14px; white-space: nowrap; }
    .row .k { opacity: 0.62; }
    .big { font-size: 19px; letter-spacing: 0.06em; }
    .accent { color: #8fd0ff; }
    .warn { color: #ffcc66; }
    .alert { color: #ff7a6b; }
    .good { color: #86e08a; }

    .reticle {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 128px;
      height: 128px;
      margin: -64px 0 0 -64px;
    }

    .messages {
      position: absolute;
      left: 50%;
      top: 64px;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      gap: 3px;
      align-items: center;
      font-size: 13px;
      /* Three lines, hard. Beyond that the ribbon is wallpaper and nobody reads it. */
      max-height: 66px;
      overflow: hidden;
    }
    .messages div {
      background: rgba(4, 10, 20, 0.55);
      padding: 2px 12px;
      border-radius: 2px;
      max-width: 62vw;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .context {
      position: absolute;
      left: 50%;
      bottom: 132px;
      transform: translateX(-50%);
      font-size: 14px;
      background: rgba(4, 10, 20, 0.6);
      border: 1px solid rgba(140, 210, 255, 0.4);
      border-radius: 3px;
      padding: 5px 14px;
    }

    .bar {
      height: 3px;
      background: rgba(140, 200, 255, 0.18);
      border-radius: 2px;
      overflow: hidden;
      margin-top: 3px;
    }
    .bar > i { display: block; height: 100%; background: #6fc0ff; }
  `;

  @property({ attribute: false }) data: HudData | null = null;

  render(): TemplateResult {
    const d = this.data;
    if (!d) return html``;
    const a = (layer: Parameters<typeof layerAlpha>[1]): string =>
      `opacity:${layerAlpha(d.mode, layer)}`;

    return html`
      <div class="panel top" style=${a('navRoute')}>
        <span class="accent">${d.systemName}</span>
        &nbsp;·&nbsp;${t('hud.day')} ${Math.floor(d.timeDays)}
        ${d.targetName ? html`&nbsp;·&nbsp;${d.targetName} ${formatDistance(d.targetDistanceM)}` : ''}
      </div>

      ${this.renderReticle(d)}

      <div class="messages">
        ${d.messages.map((m) => html`<div class=${m.priority}>${m.text}</div>`)}
      </div>

      ${d.contextPrompt ? html`<div class="context">${d.contextPrompt}</div>` : ''}

      <div class="panel left" style=${a('throttle')}>
        <div class="row big">
          <span>${Math.round(d.speed).toLocaleString('ru-RU')}</span>
          <span class="k">${t('units.mps')}</span>
        </div>
        <div class="bar"><i style="width:${Math.abs(d.throttle) * 100}%"></i></div>
        <div class="row">
          <span class="k">${t('hud.throttle')}</span>
          <span>${Math.round(d.throttle * 100)}%</span>
        </div>
        ${d.supercruise
          ? html`<div class="row"><span class="k">${t('hud.supercruise')}</span>
              <span class="accent">${Math.round(d.spool * 100)}%</span></div>`
          : ''}
        ${d.boostLeft > 0
          ? html`<div class="row"><span class="k">${t('hud.boost')}</span>
              <span class="good">${d.boostLeft.toFixed(1)}${t('units.s')}</span></div>`
          : d.boostCooldown > 0
            ? html`<div class="row"><span class="k">${t('hud.boost')}</span>
                <span class="warn">${d.boostCooldown.toFixed(1)}${t('units.s')}</span></div>`
            : ''}
        ${Number.isFinite(d.altitudeM)
          ? html`<div class="row" style=${a('altimeter')}>
              <span class="k">${t('hud.altitude')}</span><span>${formatDistance(d.altitudeM)}</span>
            </div>`
          : ''}
      </div>

      <div class="panel right" style=${a('cargo')}>
        <div class="row"><span class="k">${t('hud.credits')}</span>
          <span>${Math.round(d.credits).toLocaleString('ru-RU')}</span></div>
        <div class="row"><span class="k">${t('hud.fuel')}</span>
          <span class=${d.fuel < d.fuelCapacity * 0.2 ? 'warn' : ''}>
            ${d.fuel.toFixed(1)} / ${d.fuelCapacity.toFixed(0)}</span></div>
        <div class="row"><span class="k">${t('hud.cargo')}</span>
          <span>${Math.round(d.cargoUsed)} / ${d.cargoCapacity}${t('units.t')}</span></div>
      </div>
    `;
  }

  /**
   * The reticle carries the stick deflection.
   *
   * A control with hidden state cannot be learned: without seeing where the virtual stick
   * is, the player cannot tell a ship that is slow to respond from a stick that is already
   * at its stop.
   */
  private renderReticle(d: HudData): TemplateResult {
    const r = 46;
    const px = 64 + d.stickX * r;
    const py = 64 + d.stickY * r;
    return html`
      <svg class="reticle" viewBox="0 0 128 128" style=${`opacity:${layerAlpha(d.mode, 'stickWidget')}`}>
        <circle cx="64" cy="64" r=${r} fill="none" stroke="rgba(140,200,255,0.20)" stroke-width="1" />
        <path d="M64 52 v8 M64 76 v-8 M52 64 h8 M76 64 h-8"
              stroke="rgba(190,225,255,0.85)" stroke-width="1.4" fill="none" />
        <line x1="64" y1="64" x2=${px} y2=${py} stroke="rgba(120,200,255,0.55)" stroke-width="1" />
        <circle cx=${px} cy=${py} r="3.5" fill="rgba(150,215,255,0.9)" />
      </svg>
    `;
  }
}

function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return '—';
  if (metres < 1000) return `${Math.round(metres)} ${t('units.m')}`;
  if (metres < 1e6) return `${(metres / 1000).toFixed(1)} ${t('units.km')}`;
  if (metres < 1.496e11) return `${(metres / 1e6).toFixed(0)} ${t('units.Mm')}`;
  return `${(metres / 1.495978707e11).toFixed(2)} ${t('units.au')}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'cl-hud': ClHud;
  }
}
