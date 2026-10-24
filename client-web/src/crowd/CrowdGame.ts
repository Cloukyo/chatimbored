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
  type FloorStyle,
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
import { CrowdScene } from "./scene3d.js";
import { HOST_TRICKS } from "../../../shared/party/night.js";
import { sound } from "../audio/sound.js";
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
  last_dance: "The Last Dance",
};

const TRICK_NAMES: Record<string, string> = Object.fromEntries(HOST_TRICKS.map((trick) => [trick.key, trick.name]));

// Each mode is played in its own room of the mansion.
const FLOOR_STYLES: Record<CrowdView["mode"], FloorStyle> = {
  act_natural: "hall",
  silent_witness: "library",
  lantern_festival: "garden",
  bell_ringers: "tower",
  heist_hour: "vault",
  marked: "gallery",
  freeze_frame: "music",
  hot_parcel: "post",
  closing_time: "terrace",
  last_dance: "ballroom",
};

type Tag = { figure: Figure; label: string; color: string };
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
const PULSE_MS = { holding: 1000, holdingLate: 500, dark: 450, invite: 3000 };

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
  lastInvitePulse: number;
};

const CONTROLS = {
  keyboard: { shoot: "Click", act: "E", run: "Shift" },
  pad: { shoot: "X", act: "A", run: "RB" },
  touch: { shoot: "Tap", act: "Act", run: "Run" },
};

// Phones and tablets: a stick and two buttons on screen, and a tap on the crowd shoots.
const TOUCH = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
const STICK_RADIUS = 52;

// One 3D scene per canvas, kept between rounds so its shaders and models are only built once.
// Null when the browser has no WebGL and the game draws in 2D instead.
const scenes = new WeakMap<HTMLCanvasElement, CrowdScene | null>();

function sceneFor(canvas: HTMLCanvasElement): CrowdScene | undefined {
  if (!scenes.has(canvas)) scenes.set(canvas, CrowdScene.create(canvas, !TOUCH) ?? null);
  return scenes.get(canvas) ?? undefined;
}

// Heights above the floor, in the scene's units, for things drawn over the figures.
const SHOT_HEIGHT = 1.1;
const BUMP_HEIGHT = 2.4;
const TAG_HEIGHT = 2.9;
// How tall a standing figure is: in scene units, and in arena pixels in the 2D drawing.
const FIGURE_HEIGHT_3D = 2.1;
const FIGURE_HEIGHT_2D = 44;

function controlsFor(source: InputSource): (typeof CONTROLS)["keyboard"] {
  return source.kind === "pad" ? CONTROLS.pad : TOUCH ? CONTROLS.touch : CONTROLS.keyboard;
}

export class CrowdGame {
  private endsAt = 0;
  private snapshots: Snapshot[] = [];
  // Estimated local time of server tick 0; the smallest observed offset is the least delayed.
  private tickClockOffset = Number.POSITIVE_INFINITY;
  private floor?: HTMLCanvasElement;
  private floorMode?: CrowdView["mode"];
  private hudHeight = 0;
  private resultPlayed = false;
  private touchMove: CrowdVector = { x: 0, y: 0 };
  private touchRun = false;
  private touchControls?: HTMLElement;
  private lastSecond = -1;
  private lastStep = 0;
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
  private readonly scene?: CrowdScene;
  // Shots, name tags and "!"s sit on a 2D canvas over the 3D one.
  private readonly overlay?: HTMLCanvasElement;

  // `shared`: several people are watching this one screen, so nobody's figure, role or secrets are shown.
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hud: HTMLElement,
    seats: GameSeat[],
    private readonly nameOf: PlayerNames,
    private readonly shared = false,
  ) {
    this.seats = seats.map((seat) => ({ seat, seq: 0, pendingAct: false, cued: false, mineCount: 0, alive: true, lastPulse: 0, lastInvitePulse: 0 }));
    const signal = this.abort.signal;
    this.scene = sceneFor(canvas);
    if (this.scene) {
      this.overlay = document.createElement("canvas");
      this.overlay.className = "arena-overlay";
      canvas.after(this.overlay);
    }
    window.addEventListener("keydown", (event) => this.onKey(event, true), { signal });
    window.addEventListener("keyup", (event) => this.onKey(event, false), { signal });
    window.addEventListener("blur", () => this.keys.clear(), { signal });
    window.addEventListener("resize", () => this.resize(), { signal });
    canvas.addEventListener(
      "pointerdown",
      (event) => {
        const keyboard = this.keyboardSeat();
        if (event.button !== 0 || !keyboard) return;
        keyboard.pendingShot = this.aimPoint(event);
      },
      { signal },
    );
    canvas.addEventListener("pointermove", (event) => (this.pointer = this.arenaPoint(event)), { signal });
    canvas.addEventListener("pointerleave", () => (this.pointer = undefined), { signal });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });
    this.resize();
    this.inputTimer = window.setInterval(() => this.tickInput(), CROWD_TICK_MS);
    const loop = (time: number) => {
      this.render(time);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
    sound.play("start");
    sound.setCrowd(true);
    if (TOUCH && !shared) this.addTouchControls(signal);
  }

  // A thumb stick on the left, Act and Run on the right. Taps elsewhere on the arena shoot, like a click.
  private addTouchControls(signal: AbortSignal): void {
    const box = document.createElement("div");
    box.className = "touch-controls";
    box.innerHTML = `<div class="stick"><div class="knob"></div></div><div class="touch-buttons"><button class="touch-run">Run</button><button class="touch-act">Act</button></div>`;
    this.canvas.parentElement!.append(box);
    this.touchControls = box;
    const stick = box.querySelector<HTMLElement>(".stick")!;
    const knob = box.querySelector<HTMLElement>(".knob")!;
    let stickPointer: number | undefined;
    const moveStick = (event: PointerEvent) => {
      const rect = stick.getBoundingClientRect();
      let x = event.clientX - (rect.left + rect.width / 2);
      let y = event.clientY - (rect.top + rect.height / 2);
      const length = Math.hypot(x, y);
      if (length > STICK_RADIUS) {
        x = (x / length) * STICK_RADIUS;
        y = (y / length) * STICK_RADIUS;
      }
      knob.style.transform = `translate(${x}px, ${y}px)`;
      // A small dead zone so a resting thumb doesn't drift.
      this.touchMove = length < 12 ? { x: 0, y: 0 } : { x: x / STICK_RADIUS, y: y / STICK_RADIUS };
    };
    const release = (event: PointerEvent) => {
      if (event.pointerId !== stickPointer) return;
      stickPointer = undefined;
      knob.style.transform = "";
      this.touchMove = { x: 0, y: 0 };
    };
    stick.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      stickPointer = event.pointerId;
      stick.setPointerCapture(event.pointerId);
      moveStick(event);
    }, { signal });
    stick.addEventListener("pointermove", (event) => event.pointerId === stickPointer && moveStick(event), { signal });
    stick.addEventListener("pointerup", release, { signal });
    stick.addEventListener("pointercancel", release, { signal });
    const act = box.querySelector<HTMLElement>(".touch-act")!;
    act.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const keyboard = this.keyboardSeat();
      if (keyboard) keyboard.pendingAct = true;
    }, { signal });
    const run = box.querySelector<HTMLElement>(".touch-run")!;
    run.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.touchRun = true;
    }, { signal });
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) run.addEventListener(type, () => (this.touchRun = false), { signal });
  }

  destroy(): void {
    this.touchControls?.remove();
    this.overlay?.remove();
    this.scene?.clear();
    sound.setCrowd(false);
    sound.setTense(false);
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
    if (this.scene) this.scene.setRoom(FLOOR_STYLES[view.mode], view.arena);
    else if (!this.floor || this.floorMode !== view.mode) {
      this.floor = paintFloor(view.arena, FLOOR_STYLES[view.mode]);
      this.floorMode = view.mode;
    }
    this.endsAt = endsAt;

    this.tickClockOffset = Math.min(this.tickClockOffset, now - view.tick * CROWD_TICK_MS);
    const figures = unpack(view.e);
    this.snapshots.push({ time: this.tickClockOffset + view.tick * CROWD_TICK_MS, figures });
    while (this.snapshots.length > 12) this.snapshots.shift();

    this.collectEvents(view, figures, now);
    if (view.result && !this.resultPlayed) {
      this.resultPlayed = true;
      sound.setCrowd(false);
      sound.setTense(false);
      this.playResult(view);
    }
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
    if (view.party?.holdingInvite && now - state.lastInvitePulse >= PULSE_MS.invite) {
      state.lastInvitePulse = now;
      rumble(source.index, CUES.invite);
    }
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
    // A ghost keeps steering its guest after going down.
    if (!view || view.result || !(view.alive || view.ghost)) {
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
      if (aimsFromAbove(view)) this.moveCursor(state, view, pad);
      if ((edges.has(PAD.X) || edges.has(PAD.RT)) && canShoot(view)) state.pendingShot = this.padShotTarget(state, view, pad);
    } else {
      move = {
        x: (this.held(KEYS.right) ? 1 : 0) - (this.held(KEYS.left) ? 1 : 0),
        y: (this.held(KEYS.down) ? 1 : 0) - (this.held(KEYS.up) ? 1 : 0),
      };
      run = this.held(KEYS.run) || this.touchRun;
      if (move.x === 0 && move.y === 0) move = this.touchMove;
    }
    run = run && view.canRun && !view.ghost;

    // After a reconnect the server has already seen higher numbers than this fresh page.
    state.seq = Math.max(state.seq, view.ack) + 1;
    const input: CrowdInput = { kind: "crowd", seq: state.seq, move, run, act: state.pendingAct };
    if (state.pendingShot && canShoot(view)) input.shoot = roundPoint(state.pendingShot);
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
    if (aimsFromAbove(view)) return state.cursor;
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
    // Sounds sit left or right with where they happened.
    const pan = (at: CrowdVector) => ((at.x / view.arena.width) * 2 - 1) * 0.7;
    // The first view also carries the last few seconds of events; show those but don't replay their sounds.
    const quiet = this.seenEvents.size === 0 && this.snapshots.length <= 1;
    for (const event of view.events) {
      if (this.seenEvents.has(event.id)) continue;
      this.seenEvents.add(event.id);
      if (event.type === "shot") {
        this.effects.push({ born: now, kind: "shot", from: event.from, to: event.to });
        if (!quiet) sound.play("shot", pan(event.from));
      }
      if (event.type === "down") {
        const figure = figures.get(event.entity);
        if (figure) this.effects.push({ born: now, kind: "puff", at: { x: figure.x, y: figure.y } });
        if (!quiet) sound.play("down", figure ? pan(figure) : 0);
      }
      if (event.type === "strike") {
        this.effects.push({ born: now, kind: "strike", at: event.at });
        if (!quiet) sound.play("strike", pan(event.at));
      }
      if (event.type === "bump") {
        this.effects.push({ born: now, kind: "bump", at: event.at });
        if (!quiet) sound.play("bump", pan(event.at));
      }
      if (event.type === "flare") {
        this.flares.set(event.prop, now);
        const prop = view.props.find((candidate) => candidate.id === event.prop);
        if (prop && !quiet) sound.play(prop.kind === "bell" ? "bell" : prop.kind === "vault" ? "vault" : "chime", pan(prop));
      }
    }
  }

  // A sting when the round ends: a win or a loss for a screen with one player, a plain reveal on a shared one.
  private playResult(view: CrowdView): void {
    const result = view.result!;
    const mine = this.shared ? undefined : result.reveal.find((entry) => entry.entity === view.you);
    if (!mine) {
      sound.play("reveal");
      return;
    }
    const won = mine.playerId === result.winnerPlayerId || (result.winnerRole !== undefined && mine.role === result.winnerRole);
    sound.play(won ? "win" : "lose");
  }

  private updateHud(): void {
    const view = this.view;
    if (!view) return;
    const lines = this.shared ? [...sharedHudLines(view), ...this.sharedPartyLines()] : [...this.hudLines(view), ...this.partyLines(view)];
    if (!this.shared && view.ghost) lines.push("<b>You're a ghost</b>: steer your guest");
    else if (!this.shared && !view.alive) lines.push("<b>You're down</b>");
    // The timer is filled in every frame by render().
    this.hud.innerHTML =
      `<div class="hud-top"><span class="hud-time" data-timer>${this.secondsLeft()}s</span><span class="hud-title">${MODE_TITLES[view.mode]}</span></div>` +
      `<div class="hud-lines">${lines.map((line) => `<span>${line}</span>`).join("")}</div>`;
  }

  // Party Night extras, for a screen with one player on it.
  private partyLines(view: CrowdView): string[] {
    const party = view.party;
    if (!party) return [];
    const keys = controlsFor(this.seats[0].seat.source);
    const lines: string[] = [];
    if (view.role === "host") lines.push(...hostLines(party, keys));
    if (party.contract) lines.push(`Contract: ${escapeHtml(party.contract)}${party.contractDone ? " ✓" : ""}`);
    if (party.holdingInvite) lines.push("<b>You hold the cursed invite</b>, bump a player to pass it");
    if (party.nemesisName) lines.push(`Nemesis: <b>${escapeHtml(party.nemesisName)}</b> (double points)`);
    if (party.wanted) lines.push(`Wanted: the leader is ${escapeHtml(party.wanted)}`);
    return lines;
  }

  // On a shared screen only public things show: the Wanted hint and the host's tricks (everyone knows who hosts).
  private sharedPartyLines(): string[] {
    const lines: string[] = [];
    const wanted = this.seats.find((state) => state.view?.party?.wanted)?.view?.party?.wanted;
    if (wanted) lines.push(`Wanted: the leader is ${escapeHtml(wanted)}`);
    const host = this.seats.find((state) => state.view?.role === "host");
    if (host?.view?.party) lines.push(...hostLines(host.view.party, controlsFor(host.seat.source)));
    return lines;
  }

  private hudLines(view: CrowdView): string[] {
    const keys = controlsFor(this.seats[0].seat.source);
    if (view.role === "host") return [];
    const progress = `${view.hud.progress ?? 0}/${view.hud.goal ?? 0}`;
    const shot = (aim: string) => (view.shots > 0 ? `${keys.shoot} to shoot ${aim} (${view.shots} left)` : "Out of shots");
    switch (view.mode) {
      case "act_natural":
        return ["Reach the exit first", shot("a rival"), `Running (${keys.run}) gets noticed`];
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
      case "last_dance":
        return view.role === "backer"
          ? ["You're backing a finalist", "Steer your guest to get in the way"]
          : ["Hit the other finalist to win the night", shot("them"), "A miss makes nearby guests flinch", "The floor is shrinking"];
    }
  }

  // Room above the arena for the HUD. It only grows, so the arena doesn't jump as HUD lines come and go.
  private hudSpace(): number {
    this.hudHeight = Math.max(this.hudHeight, this.hud.offsetHeight);
    return this.hudHeight + 20;
  }

  private secondsLeft(): number {
    return Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
  }

  // The 3D scene sizes its own canvas as it renders.
  private resize(): void {
    if (this.scene) return;
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.canvas.clientWidth * ratio);
    this.canvas.height = Math.round(this.canvas.clientHeight * ratio);
  }

  // A click on someone's figure aims at their feet, which is where the server looks for them,
  // at the newest position this screen has for them. Anywhere else aims at the floor under the cursor.
  private aimPoint(event: PointerEvent): CrowdVector | undefined {
    const floor = this.arenaPoint(event);
    const latest = this.snapshots[this.snapshots.length - 1];
    if (!this.view || !latest) return floor;
    const rect = this.canvas.getBoundingClientRect();
    const click = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const own = this.keyboardSeat()?.view?.you;
    let best: { id: number; distance: number } | undefined;
    for (const figure of this.interpolated(performance.now()).values()) {
      if (figure.id === own || figure.state === CROWD_STATE.DEAD) continue;
      const { feet, head, reach } = this.figureOnScreen(figure, rect);
      const distance = distanceToSegment(click, feet, head);
      if (distance <= reach && (!best || distance < best.distance)) best = { id: figure.id, distance };
    }
    const target = best && latest.figures.get(best.id);
    return target ? { x: target.x, y: target.y } : floor;
  }

  // Where a figure stands on screen, in CSS pixels: feet, top of the head, and how far either side of that line counts as on them.
  private figureOnScreen(figure: Figure, rect: DOMRect): { feet: CrowdVector; head: CrowdVector; reach: number } {
    if (this.scene) {
      const feet = this.scene.project(figure, 0);
      const head = this.scene.project(figure, FIGURE_HEIGHT_3D);
      return { feet, head, reach: Math.max(8, Math.hypot(head.x - feet.x, head.y - feet.y) * 0.3) };
    }
    const toCss = rect.width / this.canvas.width;
    const scale = this.viewport.scale * toCss;
    const feet = { x: this.viewport.offsetX * toCss + figure.x * scale, y: this.viewport.offsetY * toCss + figure.y * scale };
    return { feet, head: { x: feet.x, y: feet.y - FIGURE_HEIGHT_2D * scale }, reach: 12 * scale };
  }

  // Where on the floor a click or tap landed.
  private arenaPoint(event: PointerEvent): CrowdVector | undefined {
    const rect = this.canvas.getBoundingClientRect();
    if (this.scene) return this.scene.toArena({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    const ratio = this.canvas.width / rect.width;
    return toWorld(this.viewport, { x: (event.clientX - rect.left) * ratio, y: (event.clientY - rect.top) * ratio });
  }

  private render(now: number): void {
    const view = this.view;
    this.updateTimer(view);
    if (!view) {
      if (!this.scene) this.clear2d();
      return;
    }

    const figures = this.interpolated(now);
    const self = this.shared ? undefined : figures.get(view.you);
    // Your own footsteps, only on a screen with one player.
    if (self && this.predicted?.moving && !view.result && now - this.lastStep > (this.predicted.running ? 210 : 340)) {
      this.lastStep = now;
      sound.play("step", ((self.x / view.arena.width) * 2 - 1) * 0.5);
    }
    if (self && this.predicted && !view.result) {
      const shown = this.displayedSelf(now);
      self.x = shown.x;
      self.y = shown.y;
      if (self.state !== CROWD_STATE.DEAD && self.state !== CROWD_STATE.SICK) {
        self.facing = this.predicted.facing;
        self.state = this.predicted.moving ? (this.predicted.running ? CROWD_STATE.RUN : CROWD_STATE.WALK) : CROWD_STATE.IDLE;
      }
    }
    this.effects = this.effects.filter((effect) => now - effect.born < EFFECT_MS[effect.kind]);
    if (this.scene) this.render3d(this.scene, view, figures, self, now);
    else this.render2d(view, figures, self, now);
  }

  private updateTimer(view: CrowdView | undefined): void {
    const timer = this.hud.querySelector<HTMLElement>("[data-timer]");
    if (!timer) return;
    const seconds = this.secondsLeft();
    timer.textContent = `${seconds}s`;
    timer.classList.toggle("urgent", seconds <= 10 && !view?.result);
    if (seconds !== this.lastSecond && view && !view.result) {
      this.lastSecond = seconds;
      if (seconds <= 10 && seconds > 0) sound.play("tick");
      sound.setTense(seconds <= 15);
    }
  }

  // On a shared screen nobody's lanterns are "theirs", so none are drawn as lit-by-you.
  private mineShown(view: CrowdView): number[] {
    return this.shared ? [] : view.mine;
  }

  private flareOf(id: number, now: number): number {
    const flaredAt = this.flares.get(id);
    return flaredAt === undefined ? 0 : Math.max(0, 1 - (now - flaredAt) / FLARE_EFFECT_MS);
  }

  private render3d(scene: CrowdScene, view: CrowdView, figures: Map<number, Figure>, self: Figure | undefined, now: number): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    scene.resize(width, height, this.hudSpace());
    scene.syncFigures(figures.values(), now, self?.id);
    scene.syncProps(view.props, this.mineShown(view), (id) => this.flareOf(id, now), now);
    scene.setZone(view.zone);

    // Things that lie on the floor are painted onto it.
    const hint = view.hud.hint && !view.result && !this.shared ? view.hud.hint : undefined;
    const crosshairs = view.result ? [] : this.crosshairs();
    const floorEffects = this.effects.filter((effect) => effect.kind === "puff" || effect.kind === "strike");
    const painted = hint || view.zone || crosshairs.length > 0 || floorEffects.length > 0;
    scene.paintGround(
      painted
        ? (ctx) => {
            if (hint) drawHint(ctx, hint, view.arena, now);
            if (view.zone) drawDarkness(ctx, view.zone, view.arena);
            for (const effect of floorEffects) {
              if (effect.kind === "shot" || effect.kind === "bump") continue;
              const age = (now - effect.born) / EFFECT_MS[effect.kind];
              if (effect.kind === "strike") drawStrike(ctx, effect.at, age);
              else drawPuff(ctx, effect.at, age);
            }
            for (const crosshair of crosshairs) drawCrosshair(ctx, crosshair.at, crosshair.ready);
          }
        : undefined,
    );
    scene.render();

    // The rest floats over the figures, so it is drawn flat over the picture.
    const overlay = this.overlay!;
    const ratio = window.devicePixelRatio || 1;
    if (overlay.width !== Math.round(width * ratio) || overlay.height !== Math.round(height * ratio)) {
      overlay.width = Math.round(width * ratio);
      overlay.height = Math.round(height * ratio);
    }
    const ctx = overlay.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // The 2D helpers draw a little above the point they are given; these offsets undo that.
    for (const effect of this.effects) {
      const age = (now - effect.born) / EFFECT_MS[effect.kind];
      if (effect.kind === "shot") {
        const from = scene.project(effect.from, SHOT_HEIGHT);
        const to = scene.project(effect.to, SHOT_HEIGHT);
        drawShot(ctx, { x: from.x, y: from.y + 18 }, { x: to.x, y: to.y + 18 }, age);
      } else if (effect.kind === "bump") {
        const at = scene.project(effect.at, BUMP_HEIGHT);
        drawBump(ctx, { x: at.x, y: at.y + 52 }, age);
      }
    }
    for (const tag of this.tags(view, figures, self)) {
      const at = scene.project(tag.figure, TAG_HEIGHT);
      drawNameTag(ctx, { ...tag.figure, x: at.x, y: at.y + 52 }, tag.label, tag.color);
    }
  }

  private clear2d(): void {
    const ctx = this.canvas.getContext("2d")!;
    ctx.fillStyle = "#0f080a";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private render2d(view: CrowdView, figures: Map<number, Figure>, self: Figure | undefined, now: number): void {
    this.clear2d();
    if (!this.floor) return;
    const ctx = this.canvas.getContext("2d")!;
    this.viewport = fitArena(this.canvas.width, this.canvas.height, view.arena, this.hudSpace() * (window.devicePixelRatio || 1));
    ctx.save();
    ctx.translate(this.viewport.offsetX, this.viewport.offsetY);
    ctx.scale(this.viewport.scale, this.viewport.scale);
    ctx.drawImage(this.floor, 0, 0);

    const mine = this.mineShown(view);
    for (const prop of view.props) drawProp(ctx, prop, mine.includes(prop.id), this.flareOf(prop.id, now), now);
    if (view.hud.hint && !view.result && !this.shared) drawHint(ctx, view.hud.hint, view.arena, now);

    const ordered = [...figures.values()].sort((a, b) => a.y - b.y);
    for (const figure of ordered) drawFigure(ctx, figure, now, figure === self);

    if (view.zone) drawDarkness(ctx, view.zone, view.arena);

    for (const effect of this.effects) {
      const age = (now - effect.born) / EFFECT_MS[effect.kind];
      if (effect.kind === "shot") drawShot(ctx, effect.from, effect.to, age);
      else if (effect.kind === "strike") drawStrike(ctx, effect.at, age);
      else if (effect.kind === "bump") drawBump(ctx, effect.at, age);
      else drawPuff(ctx, effect.at, age);
    }

    for (const tag of this.tags(view, figures, self)) drawNameTag(ctx, tag.figure, tag.label, tag.color);
    if (!view.result) for (const crosshair of this.crosshairs()) drawCrosshair(ctx, crosshair.at, crosshair.ready);
    ctx.restore();
  }

  // Names over heads: everyone's at the reveal, otherwise only your own and what you've earned the right to see.
  private tags(view: CrowdView, figures: Map<number, Figure>, self: Figure | undefined): Tag[] {
    const tags: Tag[] = [];
    if (view.result) {
      for (const entry of view.result.reveal) {
        const figure = figures.get(entry.entity);
        if (!figure) continue;
        const won = entry.playerId === view.result.winnerPlayerId || entry.role === view.result.winnerRole;
        const color = entry.role === "killer" ? "#e9806b" : won ? "#e0a64a" : "#ece6d6";
        const suffix = entry.role === "killer" ? " (Killer)" : entry.role === "ringer" ? " (Ringer)" : "";
        tags.push({ figure, label: `${this.nameOf(entry.playerId)}${suffix}`, color });
      }
      return tags;
    }
    if (self) tags.push({ figure: self, label: view.ghost ? "Your ghost" : "You", color: "#e0a64a" });
    if (!this.shared) tags.push(...partyTags(view, figures));
    return tags;
  }

  // Lookouts and the host aim from above, so their crosshairs are the only thing of theirs on screen.
  private crosshairs(): Array<{ at: CrowdVector; ready: boolean }> {
    const crosshairs: Array<{ at: CrowdVector; ready: boolean }> = [];
    for (const state of this.seats) {
      const view = state.view;
      if (!view || !aimsFromAbove(view)) continue;
      const at = state.seat.source.kind === "keyboard" ? this.pointer : state.cursor;
      if (at) crosshairs.push({ at, ready: canShoot(view) });
    }
    return crosshairs;
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

// A bought glimpse, or the host's overhead view of where the players are. Never on a shared screen.
function partyTags(view: CrowdView, figures: Map<number, Figure>): Tag[] {
  const party = view.party;
  if (!party) return [];
  const tags: Tag[] = [];
  const glimpse = party.glimpse !== undefined ? figures.get(party.glimpse) : undefined;
  if (glimpse) tags.push({ figure: glimpse, label: "A player", color: "#6ba3e9" });
  for (const id of party.players ?? []) {
    const figure = figures.get(id);
    if (figure) tags.push({ figure, label: "Player", color: "#e8d26a" });
  }
  return tags;
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
    case "last_dance":
      return ["The finalists hit each other to win the night", "Everyone else steers a guest as a ghost", controls];
  }
}

function hostLines(party: NonNullable<CrowdView["party"]>, keys: ReturnType<typeof controlsFor>): string[] {
  const trick = TRICK_NAMES[party.trick ?? ""] ?? "Toast";
  return [
    "<b>Party Host</b>",
    (party.tricksLeft ?? 0) > 0 ? `${keys.shoot} plays <b>${trick}</b> (${party.tricksLeft} left)` : "Out of tricks",
    `${keys.act} changes trick`,
  ];
}

// The host plays tricks the way a Lookout shoots: at a spot, from above.
function aimsFromAbove(view: CrowdView): boolean {
  return view.role === "lookout" || view.role === "host";
}

function canShoot(view: CrowdView): boolean {
  return view.role === "host" ? (view.party?.tricksLeft ?? 0) > 0 : view.shots > 0;
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

function distanceToSegment(point: CrowdVector, start: CrowdVector, end: CrowdVector): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function roundPoint(point: CrowdVector): CrowdVector {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
