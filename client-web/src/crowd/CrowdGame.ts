import { CROWD_TICK_MS, facingOf, snapDirection, stepPosition } from "../../../shared/crowd/movement.js";
import {
  CROWD_STATE,
  type CrowdEntityState,
  type CrowdInput,
  type CrowdVector,
  type CrowdView,
} from "../../../shared/crowd/protocol.js";
import { type Figure, type View2D, drawFigure, drawNameTag, drawPuff, drawShot, fitArena, paintFloor, toWorld } from "./draw.js";

// Others are drawn this far in the past so there are always two snapshots to blend between.
const INTERPOLATION_DELAY_MS = 100;
const SHOT_EFFECT_MS = 260;
const PUFF_EFFECT_MS = 500;

type Snapshot = { time: number; figures: Map<number, Figure> };
type Pending = { seq: number; direction: CrowdVector; run: boolean };
type Effect = { born: number; kind: "shot"; from: CrowdVector; to: CrowdVector } | { born: number; kind: "puff"; at: CrowdVector };

const KEYS = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  run: ["ShiftLeft", "ShiftRight"],
  act: ["KeyE", "Space"],
};

export type PlayerNames = (playerId: string) => string;

export class CrowdGame {
  private view?: CrowdView;
  private endsAt = 0;
  private snapshots: Snapshot[] = [];
  // Estimated local time of server tick 0; the smallest observed offset is the least delayed.
  private tickClockOffset = Number.POSITIVE_INFINITY;
  private floor?: HTMLCanvasElement;
  private viewport: View2D = { scale: 1, offsetX: 0, offsetY: 0 };
  private readonly keys = new Set<string>();
  private pendingShot?: CrowdVector;
  private pendingAct = false;
  private seq = 0;
  private pending: Pending[] = [];
  private predicted?: { from: CrowdVector; to: CrowdVector; steppedAt: number; facing: number; moving: boolean; running: boolean };
  private readonly seenEvents = new Set<number>();
  private effects: Effect[] = [];
  private inputTimer?: number;
  private frame?: number;
  private readonly abort = new AbortController();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hud: HTMLElement,
    private readonly sendInput: (input: CrowdInput) => void,
    private readonly nameOf: PlayerNames,
  ) {
    const signal = this.abort.signal;
    window.addEventListener("keydown", (event) => this.onKey(event, true), { signal });
    window.addEventListener("keyup", (event) => this.onKey(event, false), { signal });
    window.addEventListener("blur", () => this.keys.clear(), { signal });
    window.addEventListener("resize", () => this.resize(), { signal });
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0) return;
        this.pendingShot = toWorld(this.viewport, this.canvasPoint(event));
      },
      { signal },
    );
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });
    this.resize();
    this.inputTimer = window.setInterval(() => this.tickInput(), CROWD_TICK_MS);
    const loop = (time: number) => {
      this.render(time);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  destroy(): void {
    this.abort.abort();
    window.clearInterval(this.inputTimer);
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
  }

  applyView(view: CrowdView, endsAt: number): void {
    const now = performance.now();
    if (!this.floor || this.view?.arena.width !== view.arena.width) this.floor = paintFloor(view.arena);
    this.view = view;
    this.endsAt = endsAt;

    this.tickClockOffset = Math.min(this.tickClockOffset, now - view.tick * CROWD_TICK_MS);
    const figures = unpack(view.e);
    this.snapshots.push({ time: this.tickClockOffset + view.tick * CROWD_TICK_MS, figures });
    while (this.snapshots.length > 12) this.snapshots.shift();

    this.collectEvents(view, figures, now);
    this.reconcile(view, figures, now);
    this.updateHud();
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    if (event.target instanceof HTMLInputElement) return;
    if (KEYS.act.includes(event.code) && down && !event.repeat) this.pendingAct = true;
    if (Object.values(KEYS).some((codes) => codes.includes(event.code))) event.preventDefault();
    if (down) this.keys.add(event.code);
    else this.keys.delete(event.code);
  }

  private held(codes: string[]): boolean {
    return codes.some((code) => this.keys.has(code));
  }

  private tickInput(): void {
    const view = this.view;
    if (!view || view.result || !view.alive) {
      this.pendingShot = undefined;
      this.pendingAct = false;
      return;
    }
    const move = {
      x: (this.held(KEYS.right) ? 1 : 0) - (this.held(KEYS.left) ? 1 : 0),
      y: (this.held(KEYS.down) ? 1 : 0) - (this.held(KEYS.up) ? 1 : 0),
    };
    const run = this.held(KEYS.run) && view.canRun;
    this.seq += 1;
    const input: CrowdInput = { kind: "crowd", seq: this.seq, move, run, act: this.pendingAct };
    if (this.pendingShot && view.shots > 0) input.shoot = roundPoint(this.pendingShot);
    this.pendingShot = undefined;
    this.pendingAct = false;
    this.sendInput(input);

    const direction = snapDirection(move);
    this.pending.push({ seq: this.seq, direction, run });
    if (this.predicted && !this.selfFrozen()) {
      const from = this.predicted.to;
      this.predicted = {
        from,
        to: stepPosition(from, direction, run, view.arena),
        steppedAt: performance.now(),
        facing: facingOf(direction, this.predicted.facing),
        moving: direction.x !== 0 || direction.y !== 0,
        running: run,
      };
    }
  }

  private selfFrozen(): boolean {
    const self = this.latestSelf();
    return !self || self.state === CROWD_STATE.DEAD || self.state === CROWD_STATE.SICK;
  }

  private latestSelf(): Figure | undefined {
    if (!this.view) return undefined;
    return this.snapshots[this.snapshots.length - 1]?.figures.get(this.view.you);
  }

  // Rewind to the server's position for us, then replay the inputs it hasn't applied yet.
  private reconcile(view: CrowdView, figures: Map<number, Figure>, now: number): void {
    const self = figures.get(view.you);
    if (!self) return;
    this.pending = this.pending.filter((input) => input.seq > view.ack);
    let position: CrowdVector = { x: self.x, y: self.y };
    let facing = self.facing;
    const frozen = self.state === CROWD_STATE.DEAD || self.state === CROWD_STATE.SICK;
    if (!frozen) {
      for (const input of this.pending) {
        position = stepPosition(position, input.direction, input.run, view.arena);
        facing = facingOf(input.direction, facing);
      }
    }
    const last = this.pending[this.pending.length - 1];
    const previous = this.predicted;
    this.predicted = {
      from: previous ? this.displayedSelf(now) : position,
      to: position,
      steppedAt: previous?.steppedAt ?? now,
      facing,
      moving: frozen ? false : last ? last.direction.x !== 0 || last.direction.y !== 0 : self.state !== CROWD_STATE.IDLE,
      running: last?.run ?? self.state === CROWD_STATE.RUN,
    };
  }

  private displayedSelf(now: number): CrowdVector {
    const predicted = this.predicted!;
    const t = Math.min(1, (now - predicted.steppedAt) / CROWD_TICK_MS);
    return { x: lerp(predicted.from.x, predicted.to.x, t), y: lerp(predicted.from.y, predicted.to.y, t) };
  }

  private collectEvents(view: CrowdView, figures: Map<number, Figure>, now: number): void {
    for (const event of view.events) {
      if (this.seenEvents.has(event.id)) continue;
      this.seenEvents.add(event.id);
      if (event.type === "shot") this.effects.push({ born: now, kind: "shot", from: event.from, to: event.to });
      if (event.type === "down") {
        const figure = figures.get(event.entity);
        if (figure) this.effects.push({ born: now, kind: "puff", at: { x: figure.x, y: figure.y } });
      }
    }
  }

  private updateHud(): void {
    const view = this.view;
    if (!view) return;
    const parts: string[] = [];
    if (view.mode === "act_natural") {
      parts.push("<b>Act Natural</b>");
      parts.push(view.alive ? "Reach the exit first" : "You were spotted");
      parts.push(view.shots > 0 ? "Click to shoot (1 shot)" : "Shot used");
      parts.push("Shift runs, but people notice");
    } else {
      parts.push("<b>Silent Witness</b>");
      if (view.role === "killer") {
        parts.push("You are the <b>Killer</b>");
        parts.push(view.canAct ? "E to strike someone close" : "Strike recharging");
      } else {
        parts.push("You are a <b>Hunter</b>");
        parts.push(view.shots > 0 ? "Click to shoot the Killer" : "Shot used");
      }
      parts.push(`Bodies ${view.hud.kills ?? 0}/${view.hud.killTarget ?? 5}`);
      if (!view.alive) parts.push("You're down");
    }
    parts.unshift(`<span data-timer></span>`);
    this.hud.innerHTML = parts.join(" · ");
  }

  private resize(): void {
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.canvas.clientWidth * ratio);
    this.canvas.height = Math.round(this.canvas.clientHeight * ratio);
  }

  private canvasPoint(event: PointerEvent): CrowdVector {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = this.canvas.width / rect.width;
    return { x: (event.clientX - rect.left) * ratio, y: (event.clientY - rect.top) * ratio };
  }

  private render(now: number): void {
    const ctx = this.canvas.getContext("2d")!;
    const view = this.view;
    ctx.fillStyle = "#1d2321";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const timer = this.hud.querySelector("[data-timer]");
    if (timer) timer.textContent = `${Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000))}s`;
    if (!view || !this.floor) return;

    this.viewport = fitArena(this.canvas.width, this.canvas.height, view.arena, 54 * (window.devicePixelRatio || 1));
    ctx.save();
    ctx.translate(this.viewport.offsetX, this.viewport.offsetY);
    ctx.scale(this.viewport.scale, this.viewport.scale);
    ctx.drawImage(this.floor, 0, 0);

    const figures = this.interpolated(now);
    const self = figures.get(view.you);
    if (self && this.predicted && !view.result) {
      const shown = this.displayedSelf(now);
      self.x = shown.x;
      self.y = shown.y;
      if (self.state !== CROWD_STATE.DEAD && self.state !== CROWD_STATE.SICK) {
        self.facing = this.predicted.facing;
        self.state = this.predicted.moving ? (this.predicted.running ? CROWD_STATE.RUN : CROWD_STATE.WALK) : CROWD_STATE.IDLE;
      }
    }

    const ordered = [...figures.values()].sort((a, b) => a.y - b.y);
    for (const figure of ordered) drawFigure(ctx, figure, now, figure.id === view.you);

    this.effects = this.effects.filter((effect) => now - effect.born < (effect.kind === "shot" ? SHOT_EFFECT_MS : PUFF_EFFECT_MS));
    for (const effect of this.effects) {
      if (effect.kind === "shot") drawShot(ctx, effect.from, effect.to, (now - effect.born) / SHOT_EFFECT_MS);
      else drawPuff(ctx, effect.at, (now - effect.born) / PUFF_EFFECT_MS);
    }

    if (view.result) {
      for (const entry of view.result.reveal) {
        const figure = figures.get(entry.entity);
        if (!figure) continue;
        const color = entry.role === "killer" ? "#e9806b" : entry.playerId === view.result.winnerPlayerId ? "#e0a64a" : "#ece6d6";
        const label = entry.role === "killer" ? `${this.nameOf(entry.playerId)} (Killer)` : this.nameOf(entry.playerId);
        drawNameTag(ctx, figure, label, color);
      }
    } else if (self) {
      drawNameTag(ctx, self, "You", "#e0a64a");
    }
    ctx.restore();
  }

  private interpolated(now: number): Map<number, Figure> {
    const target = now - INTERPOLATION_DELAY_MS;
    const snapshots = this.snapshots;
    if (snapshots.length === 0) return new Map();
    let older = snapshots[0];
    let newer = snapshots[snapshots.length - 1];
    for (let index = snapshots.length - 1; index > 0; index -= 1) {
      if (snapshots[index - 1].time <= target) {
        older = snapshots[index - 1];
        newer = snapshots[index];
        break;
      }
    }
    const span = newer.time - older.time;
    const t = span > 0 ? Math.max(0, Math.min(1, (target - older.time) / span)) : 1;
    const result = new Map<number, Figure>();
    for (const [id, end] of newer.figures) {
      const start = older.figures.get(id) ?? end;
      result.set(id, {
        id,
        x: lerp(start.x, end.x, t),
        y: lerp(start.y, end.y, t),
        facing: t < 0.5 ? start.facing : end.facing,
        state: t < 0.5 ? start.state : end.state,
      });
    }
    return result;
  }
}

function unpack(packed: number[]): Map<number, Figure> {
  const figures = new Map<number, Figure>();
  for (let index = 0; index + 4 < packed.length; index += 5) {
    const id = packed[index];
    figures.set(id, { id, x: packed[index + 1], y: packed[index + 2], facing: packed[index + 3], state: packed[index + 4] as CrowdEntityState });
  }
  return figures;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function roundPoint(point: CrowdVector): CrowdVector {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
