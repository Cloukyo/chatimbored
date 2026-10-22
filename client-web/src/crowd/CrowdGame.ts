import { CROWD_TICK_MS, facingOf, snapDirection, stepPosition } from "../../../shared/crowd/movement.js";
import {
  CROWD_STATE,
  type CrowdEntityState,
  type CrowdInput,
  type CrowdVector,
  type CrowdView,
} from "../../../shared/crowd/protocol.js";
import {
  type Figure,
  type View2D,
  drawBump,
  drawCrosshair,
  drawDarkness,
  drawFigure,
  drawHint,
  drawNameTag,
  drawProp,
  drawPuff,
  drawShot,
  drawStrike,
  fitArena,
  paintFloor,
  toWorld,
} from "./draw.js";
import { CUES, PAD, PadEdges, padAim, padMove, pressed, readPad, rumble } from "../input/pads.js";

// Others are drawn this far in the past so there are always two snapshots to blend between.
const INTERPOLATION_DELAY_MS = 100;
const SHOT_EFFECT_MS = 260;
const PUFF_EFFECT_MS = 500;
const STRIKE_EFFECT_MS = 300;
const FLARE_EFFECT_MS = 900;

const BUMP_EFFECT_MS = 600;

const EFFECT_MS = { shot: SHOT_EFFECT_MS, puff: PUFF_EFFECT_MS, strike: STRIKE_EFFECT_MS, bump: BUMP_EFFECT_MS };

const MODE_TITLES: Record<CrowdView["mode"], string> = {
  act_natural: "Act Natural",
  silent_witness: "Silent Witness",
  lantern_festival: "Lantern Festival",
  bell_ringers: "Bell Ringers",
  heist_hour: "Heist Hour",
  marked: "Marked",
  freeze_frame: "Freeze Frame",
  hot_parcel: "Hot Parcel",
  closing_time: "Closing Time",
};

type Snapshot = { time: number; figures: Map<number, Figure> };
type Pending = { seq: number; direction: CrowdVector; run: boolean };
type Effect =
  | { born: number; kind: "shot"; from: CrowdVector; to: CrowdVector }
  | { born: number; kind: "puff" | "strike" | "bump"; at: CrowdVector };

const KEYS = {
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  run: ["ShiftLeft", "ShiftRight"],
  act: ["KeyE", "Space"],
};

// How far ahead of a controller player their shot is aimed, along the stick or the way they face.
const PAD_SHOT_REACH = 400;
const PAD_CURSOR_SPEED = 900;
const PULSE_MS = { holding: 1000, holdingLate: 500, dark: 450 };

export type PlayerNames = (playerId: string) => string;

export type InputSource = { kind: "keyboard" } | { kind: "pad"; index: number };

// One player at this screen. Several seats share one screen on a couch.
export type GameSeat = {
  id: string;
  source: InputSource;
  send(input: CrowdInput): void;
};

type SeatState = {
  seat: GameSeat;
  view?: CrowdView;
  seq: number;
  pendingShot?: CrowdVector;
  pendingAct: boolean;
  // A controller Lookout aims with an on-screen cursor instead of the mouse.
  cursor?: CrowdVector;
  cued: boolean;
  mineCount: number;
  alive: boolean;
  lastPulse: number;
};

const CONTROLS = {
  keyboard: { shoot: "Click", act: "E", run: "Shift" },
  pad: { shoot: "X", act: "A", run: "RB" },
};

export class CrowdGame {
  private endsAt = 0;
  private snapshots: Snapshot[] = [];
  // Estimated local time of server tick 0; the smallest observed offset is the least delayed.
  private tickClockOffset = Number.POSITIVE_INFINITY;
  private floor?: HTMLCanvasElement;
  private viewport: View2D = { scale: 1, offsetX: 0, offsetY: 0 };
  private readonly keys = new Set<string>();
  private readonly seats: SeatState[];
  private readonly padEdges = new PadEdges();
  private pending: Pending[] = [];
  private predicted?: { from: CrowdVector; to: CrowdVector; steppedAt: number; facing: number; moving: boolean; running: boolean };
  private readonly seenEvents = new Set<number>();
  private effects: Effect[] = [];
  private readonly flares = new Map<number, number>();
  private pointer?: CrowdVector;
  private inputTimer?: number;
  private frame?: number;
  private readonly abort = new AbortController();

  // `shared`: several people are watching this one screen, so nobody's figure, role or secrets are shown.
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hud: HTMLElement,
    seats: GameSeat[],
    private readonly nameOf: PlayerNames,
    private readonly shared = false,
  ) {
    this.seats = seats.map((seat) => ({ seat, seq: 0, pendingAct: false, cued: false, mineCount: 0, alive: true, lastPulse: 0 }));
    const signal = this.abort.signal;
    window.addEventListener("keydown", (event) => this.onKey(event, true), { signal });
    window.addEventListener("keyup", (event) => this.onKey(event, false), { signal });
    window.addEventListener("blur", () => this.keys.clear(), { signal });
    window.addEventListener("resize", () => this.resize(), { signal });
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        const keyboard = this.keyboardSeat();
        if (event.button !== 0 || !keyboard) return;
        keyboard.pendingShot = toWorld(this.viewport, this.canvasPoint(event));
      },
      { signal },
    );
    canvas.addEventListener("pointermove", (event) => (this.pointer = toWorld(this.viewport, this.canvasPoint(event))), { signal });
    canvas.addEventListener("pointerleave", () => (this.pointer = undefined), { signal });
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

  // The first seat's view drives the picture; every seat's view drives its own input and cues.
  private get view(): CrowdView | undefined {
    return this.seats[0].view;
  }

  applyView(seatId: string, view: CrowdView, endsAt: number): void {
    const state = this.seats.find((candidate) => candidate.seat.id === seatId);
    if (!state) return;
    state.view = view;
    this.cue(state, view);
    if (state !== this.seats[0]) return;

    const now = performance.now();
    if (!this.floor || this.view?.arena.width !== view.arena.width) this.floor = paintFloor(view.arena);
    this.endsAt = endsAt;

    this.tickClockOffset = Math.min(this.tickClockOffset, now - view.tick * CROWD_TICK_MS);
    const figures = unpack(view.e);
    this.snapshots.push({ time: this.tickClockOffset + view.tick * CROWD_TICK_MS, figures });
    while (this.snapshots.length > 12) this.snapshots.shift();

    this.collectEvents(view, figures, now);
    if (!this.shared) this.reconcile(view, figures, now);
    this.updateHud();
  }

  private keyboardSeat(): SeatState | undefined {
    return this.seats.find((state) => state.seat.source.kind === "keyboard");
  }

  // Private news for a controller player, felt rather than shown.
  private cue(state: SeatState, view: CrowdView): void {
    const source = state.seat.source;
    if (source.kind !== "pad" || view.result) return;
    const now = performance.now();
    if (!state.cued) {
      state.cued = true;
      state.mineCount = view.mine.length;
      rumble(source.index, view.role === "killer" || view.role === "ringer" ? CUES.special : CUES.ordinary);
      return;
    }
    if (state.alive && !view.alive) rumble(source.index, CUES.down);
    state.alive = view.alive;
    if (view.mine.length > state.mineCount) rumble(source.index, CUES.tick);
    state.mineCount = view.mine.length;
    if (!view.alive) return;
    if (view.hud.holding) {
      const every = (view.hud.fuseSeconds ?? 10) <= 3 ? PULSE_MS.holdingLate : PULSE_MS.holding;
      if (now - state.lastPulse >= every) {
        state.lastPulse = now;
        rumble(source.index, CUES.heartbeat);
      }
    } else if ((view.hud.darkMs ?? 0) > 0 && now - state.lastPulse >= PULSE_MS.dark) {
      state.lastPulse = now;
      rumble(source.index, CUES.dark);
    }
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    if (event.target instanceof HTMLInputElement) return;
    const keyboard = this.keyboardSeat();
    if (!keyboard) return;
    if (KEYS.act.includes(event.code) && down && !event.repeat) keyboard.pendingAct = true;
    if (Object.values(KEYS).some((codes) => codes.includes(event.code))) event.preventDefault();
    if (down) this.keys.add(event.code);
    else this.keys.delete(event.code);
  }

  private held(codes: string[]): boolean {
    return codes.some((code) => this.keys.has(code));
  }

  private tickInput(): void {
    for (const state of this.seats) this.tickSeat(state);
  }

  private tickSeat(state: SeatState): void {
    const view = state.view;
    const source = state.seat.source;
    const pad = source.kind === "pad" ? readPad(source.index) : undefined;
    const edges = pad ? this.padEdges.poll(pad) : new Set<number>();
    if (!view || view.result || !view.alive) {
      state.pendingShot = undefined;
      state.pendingAct = false;
      return;
    }

    let move: CrowdVector;
    let run: boolean;
    if (pad) {
      move = padMove(pad);
      run = pressed(pad, PAD.RB) || pressed(pad, PAD.B);
      if (edges.has(PAD.A)) state.pendingAct = true;
      if (view.role === "lookout") this.moveCursor(state, view, pad);
      if ((edges.has(PAD.X) || edges.has(PAD.RT)) && view.shots > 0) state.pendingShot = this.padShotTarget(state, view, pad);
    } else {
      move = {
        x: (this.held(KEYS.right) ? 1 : 0) - (this.held(KEYS.left) ? 1 : 0),
        y: (this.held(KEYS.down) ? 1 : 0) - (this.held(KEYS.up) ? 1 : 0),
      };
      run = this.held(KEYS.run);
    }
    run = run && view.canRun;

    state.seq += 1;
    const input: CrowdInput = { kind: "crowd", seq: state.seq, move, run, act: state.pendingAct };
    if (state.pendingShot && view.shots > 0) input.shoot = roundPoint(state.pendingShot);
    state.pendingShot = undefined;
    state.pendingAct = false;
    state.seat.send(input);

    // Only a screen with one player predicts its own figure: on a shared screen the lag would point at real players.
    if (this.shared) return;
    const direction = snapDirection(move);
    this.pending.push({ seq: state.seq, direction, run });
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

  private moveCursor(state: SeatState, view: CrowdView, pad: Gamepad): void {
    const cursor = state.cursor ?? { x: view.arena.width / 2, y: view.arena.height / 2 };
    const left = padMove(pad);
    const right = padAim(pad);
    const stick = right.x !== 0 || right.y !== 0 ? right : left;
    const step = (PAD_CURSOR_SPEED * CROWD_TICK_MS) / 1000;
    state.cursor = {
      x: Math.max(0, Math.min(view.arena.width, cursor.x + stick.x * step)),
      y: Math.max(0, Math.min(view.arena.height, cursor.y + stick.y * step)),
    };
  }

  // Controller shots fly along the right stick, or the way the figure faces if the stick is idle.
  private padShotTarget(state: SeatState, view: CrowdView, pad: Gamepad): CrowdVector | undefined {
    if (view.role === "lookout") return state.cursor;
    const self = this.latestFigure(view.you);
    if (!self) return undefined;
    const from = !this.shared && this.predicted ? this.predicted.to : self;
    const aim = padAim(pad);
    const angle = aim.x !== 0 || aim.y !== 0 ? Math.atan2(aim.y, aim.x) : (self.facing * Math.PI) / 4;
    return { x: from.x + Math.cos(angle) * PAD_SHOT_REACH, y: from.y + Math.sin(angle) * PAD_SHOT_REACH };
  }

  private selfFrozen(): boolean {
    const self = this.view && this.latestFigure(this.view.you);
    return !self || isFrozen(self.state);
  }

  private latestFigure(id: number): Figure | undefined {
    return this.snapshots[this.snapshots.length - 1]?.figures.get(id);
  }

  // Rewind to the server's position for us, then replay the inputs it hasn't applied yet.
  private reconcile(view: CrowdView, figures: Map<number, Figure>, now: number): void {
    const self = figures.get(view.you);
    if (!self) return;
    this.pending = this.pending.filter((input) => input.seq > view.ack);
    let position: CrowdVector = { x: self.x, y: self.y };
    let facing = self.facing;
    const frozen = isFrozen(self.state);
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
      if (event.type === "strike") this.effects.push({ born: now, kind: "strike", at: event.at });
      if (event.type === "bump") this.effects.push({ born: now, kind: "bump", at: event.at });
      if (event.type === "flare") this.flares.set(event.prop, now);
    }
  }

  private updateHud(): void {
    const view = this.view;
    if (!view) return;
    const lines = this.shared ? sharedHudLines(view) : this.hudLines(view);
    const parts = [`<span data-timer></span>`, `<b>${MODE_TITLES[view.mode]}</b>`, ...lines];
    if (!this.shared && !view.alive) parts.push("You're down");
    this.hud.innerHTML = parts.join(" · ");
  }

  private hudLines(view: CrowdView): string[] {
    const keys = CONTROLS[this.seats[0].seat.source.kind];
    const progress = `${view.hud.progress ?? 0}/${view.hud.goal ?? 0}`;
    const shot = (aim: string) => (view.shots > 0 ? `${keys.shoot} to shoot ${aim} (${view.shots} left)` : "Out of shots");
    switch (view.mode) {
      case "act_natural":
        return ["Reach the exit first", shot("a rival"), `${keys.run} runs, but people notice`];
      case "silent_witness":
        return view.role === "killer"
          ? ["You are the <b>Killer</b>", view.canAct ? `${keys.act} to strike someone close` : "Strike recharging", `Bodies ${view.hud.kills ?? 0}/${view.hud.killTarget ?? 5}`]
          : ["You are a <b>Hunter</b>", shot("the Killer"), `Bodies ${view.hud.kills ?? 0}/${view.hud.killTarget ?? 5}`];
      case "lantern_festival":
        return [`Lanterns ${progress}`, `${keys.act} next to a lantern lights it`, `${keys.act} next to anyone else strikes them`, "Last one standing also wins"];
      case "bell_ringers":
        return view.role === "ringer"
          ? ["You are a <b>Ringer</b>", `${keys.act} next to a bell rings it`, `Bells ${progress}`]
          : ["You are a <b>Lookout</b>", shot("a Ringer"), `Bells ${progress}`];
      case "heist_hour":
        return [`Vaults ${progress}`, `${keys.act} at a vault cracks it (3 different ones)`, shot("a rival")];
      case "marked":
        return [
          view.hud.markName ? `Your mark: <b>${escapeHtml(this.nameOf(view.hud.markName))}</b>` : "No mark left",
          "the red ring is roughly where they were",
          `Marks ${progress}`,
          view.canAct ? `${keys.act} strikes, but the wrong person leaves you dazed` : "Recovering",
        ];
      case "freeze_frame":
        return ["Reach the exit first", "When the crowd freezes, freeze with it", shot("whoever kept walking")];
      case "hot_parcel":
        return view.hud.holding
          ? [`<b>You have the parcel!</b> ${view.hud.fuseSeconds ?? 0}s`, `${keys.act} next to someone hands it over, if they're a player`]
          : ["Someone has the parcel", "Keep clear of anyone bumping into people", "Last one standing wins"];
      case "closing_time":
        return [
          view.alive && (view.hud.darkMs ?? 0) > 0
            ? `<b>You're in the dark!</b> ${(((view.hud.darkLimitMs ?? 0) - (view.hud.darkMs ?? 0)) / 1000).toFixed(1)}s`
            : "Stay in the light",
          `${keys.act} strikes anyone close`,
          "Last one standing wins",
        ];
    }
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
    const self = this.shared ? undefined : figures.get(view.you);
    if (self && this.predicted && !view.result) {
      const shown = this.displayedSelf(now);
      self.x = shown.x;
      self.y = shown.y;
      if (self.state !== CROWD_STATE.DEAD && self.state !== CROWD_STATE.SICK) {
        self.facing = this.predicted.facing;
        self.state = this.predicted.moving ? (this.predicted.running ? CROWD_STATE.RUN : CROWD_STATE.WALK) : CROWD_STATE.IDLE;
      }
    }

    // On a shared screen nobody's lanterns are "theirs", so none are drawn as lit-by-you.
    const mine = this.shared ? [] : view.mine;
    for (const prop of view.props) {
      const flaredAt = this.flares.get(prop.id);
      const flare = flaredAt === undefined ? 0 : Math.max(0, 1 - (now - flaredAt) / FLARE_EFFECT_MS);
      drawProp(ctx, prop, mine.includes(prop.id), flare, now);
    }
    if (view.hud.hint && !view.result && !this.shared) drawHint(ctx, view.hud.hint, view.arena, now);

    const ordered = [...figures.values()].sort((a, b) => a.y - b.y);
    for (const figure of ordered) drawFigure(ctx, figure, now, figure === self);

    if (view.zone) drawDarkness(ctx, view.zone, view.arena);

    this.effects = this.effects.filter((effect) => now - effect.born < EFFECT_MS[effect.kind]);
    for (const effect of this.effects) {
      const age = (now - effect.born) / EFFECT_MS[effect.kind];
      if (effect.kind === "shot") drawShot(ctx, effect.from, effect.to, age);
      else if (effect.kind === "strike") drawStrike(ctx, effect.at, age);
      else if (effect.kind === "bump") drawBump(ctx, effect.at, age);
      else drawPuff(ctx, effect.at, age);
    }

    if (view.result) {
      for (const entry of view.result.reveal) {
        const figure = figures.get(entry.entity);
        if (!figure) continue;
        const won = entry.playerId === view.result.winnerPlayerId || entry.role === view.result.winnerRole;
        const color = entry.role === "killer" ? "#e9806b" : won ? "#e0a64a" : "#ece6d6";
        const suffix = entry.role === "killer" ? " (Killer)" : entry.role === "ringer" ? " (Ringer)" : "";
        const label = `${this.nameOf(entry.playerId)}${suffix}`;
        drawNameTag(ctx, figure, label, color);
      }
    } else {
      if (self) drawNameTag(ctx, self, "You", "#e0a64a");
      this.drawCrosshairs(ctx);
    }
    ctx.restore();
  }

  // Lookouts aim from above, so their crosshairs are the only thing of theirs on screen.
  private drawCrosshairs(ctx: CanvasRenderingContext2D): void {
    for (const state of this.seats) {
      const view = state.view;
      if (view?.role !== "lookout") continue;
      const at = state.seat.source.kind === "keyboard" ? this.pointer : state.cursor;
      if (at) drawCrosshair(ctx, at, view.shots > 0);
    }
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

// What a shared screen can say: the goal and anything everyone can already see. Roles and secrets are felt through rumble.
function sharedHudLines(view: CrowdView): string[] {
  const progress = `${view.hud.progress ?? 0}/${view.hud.goal ?? 0}`;
  const controls = "Stick moves · A acts · X shoots · RB runs";
  switch (view.mode) {
    case "act_natural":
    case "freeze_frame":
      return ["Reach the exit first", controls];
    case "silent_witness":
      return ["One long buzz: you're the Killer", `Bodies ${view.hud.kills ?? 0}/${view.hud.killTarget ?? 5}`, controls];
    case "bell_ringers":
      return ["One long buzz: you're a Ringer", "No figure? You're a Lookout", `Bells ${progress}`, controls];
    case "lantern_festival":
      return ["Light all five lanterns", "A buzz means you lit one", controls];
    case "heist_hour":
      return ["Crack three different vaults", "A buzz means you cracked one", controls];
    case "hot_parcel":
      return ["A heartbeat means you have the parcel", "Last one standing wins", controls];
    case "closing_time":
      return ["Stay in the light", "A buzz means you're in the dark", controls];
    case "marked":
      return ["Marked needs a private screen for each player", controls];
  }
}

function isFrozen(state: CrowdEntityState): boolean {
  return state === CROWD_STATE.DEAD || state === CROWD_STATE.SICK || state === CROWD_STATE.STUNNED;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
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
