import {
  LOCKING_WEAPONS,
  type CarState,
  type RaceCar,
  type RaceEvent,
  type RaceInput,
  type RacePhase,
  type RaceView,
  type ShotKind,
  type WeaponKind,
} from "../../../shared/race/protocol.js";
import { VERGE_WIDTH, locate, pointAt, trackById, type Track } from "../../../shared/race/track.js";
import { pickWeighted, type Random } from "../crowd/random.js";
import { botInput, type BotBrain } from "./bot.js";

// Pile-Up plays by Mashed's rules: one shared screen that follows the leader, a couple of seconds to get back on it
// before your car blows up, the last car left takes the round, and the next round starts where that one stopped.

// The shared screen, in world units, before the camera zooms. It zooms out a little to fit a spread-out pack,
// and late in a round it starts closing in so somebody always goes.
export const VIEW_WIDTH = 1000;
export const VIEW_HEIGHT = 580;
const ZOOM_IN = 0.85;
const ZOOM_OUT = 1.3;
export const SHRINK_AFTER_S = 20;
// Screen lost per second once the shrinking starts, down to the smallest screen.
const SHRINK_RATE = 0.02;
const MIN_SHRINK = 0.25;

export const CAR_RADIUS = 15;
export const MAX_SPEED = 340;
const TURBO_SPEED = 520;
const VERGE_SPEED = 190;
const ACCELERATION = 430;
const TURBO_ACCELERATION = 900;
const BRAKING = 700;
const REVERSE_SPEED = 130;
const ROLLING_DRAG = 140;
// Turn rate at full lock, in radians per second, once the car is moving.
const STEER_RATE = 3.1;
const ROAD_GRIP = 9;
const VERGE_GRIP = 4.5;
const OIL_GRIP = 0.7;
const BUMP_BOUNCE = 1.15;
// The slapstick: blasts and big shunts throw cars into the air, where they tumble and can't steer.
const GRAVITY = 1500;
const BLAST_LIFT = 0.55;
const SHUNT_HOP = 0.4;
const LAND_BOUNCE = 0.45;
// Off the ground: no bumping into cars, no picking up crates, and a drop can be flown over.
const AIRBORNE_Z = 10;

// Off the screen, a car gets this long to get back on before it explodes.
export const WARN_S = 2;
const FALL_S = 0.9;
const GHOST_S = 1.6;
// A car going over the edge is put back this far behind where it fell.
const RESPAWN_BACK = 140;
const CAMERA_FOLLOW = 4;
// How far up the road the camera looks, at the leader's top speed.
const CAMERA_LEAD = 150;
// Right after the start nobody can fire or be knocked out, so a round can't be over before it starts.
export const START_GRACE_S = 2;
// If a round somehow drags on this long, whoever is in front takes it.
const ROUND_LIMIT_S = 100;
// Never let the leader get closer than this to the edge of the screen.
const LEADER_MARGIN = 150;

export const COUNTDOWN_MS = 3500;
const NEXT_COUNTDOWN_MS = 3000;
export const ROUND_OVER_MS = 3200;
const MATCH_OVER_MS = 3000;
// Turbo start: hit the gas in the last half second of the countdown. Rev any earlier and you stall.
const TURBO_WINDOW_S = 0.5;
const STALL_WINDOW_S = 1.5;
const TURBO_S = 1.2;
const STALL_S = 0.9;

// Mashed scoring: the last car left gets two points, the last one knocked out gets one, the first one out loses one.
export const TARGET_POINTS = 10;
export const WIN_POINTS = 2;
export const RUNNER_UP_POINTS = 1;
export const FIRST_OUT_POINTS = -1;
// With fewer people than this, bots fill the grid.
export const GRID_SIZE = 4;

const CRATE_RADIUS = 16;
const CRATE_RESPAWN_S = 5;
const LOCK_CONE = 0.35;
const LOCK_RANGE = 700;
const MISSILE_SPEED = 720;
const MISSILE_LIFE_S = 2.2;
const BULLET_SPEED = 1200;
const BULLET_LIFE_S = 0.45;
const BURST = 8;
const BURST_GAP_S = 0.05;
const SHOTGUN_RANGE = 170;
const MORTAR_FLIGHT_S = 1;
const MORTAR_RANGE = 520;
const MINE_ARM_S = 1;
const MINE_LIFE_S = 30;
const MAX_MINES = 14;
const DRUM_FUSE_S = 2;
const SLICK_RADIUS = 60;
const SLICK_LIFE_S = 10;
const FLAME_S = 1.2;
const FLAME_RANGE = 190;
const BURN_S = 2.5;
const FLASH_CONFUSION_S = 1.5;
const STRIKE_FALL_S = 1.1;
const STRIKE_RELOAD_S = 3.5;
const STRIKE_AIM_SPEED = 520;
const STRIKE_DRIFT = 140;
const EVENT_LIFE_TICKS = 30;

export const BLASTS = {
  missile: { radius: 110, force: 680 },
  mortar: { radius: 90, force: 580 },
  mine: { radius: 85, force: 540 },
  drum: { radius: 85, force: 560 },
  strike: { radius: 95, force: 620 },
} as const;

export const AMMO: Record<WeaponKind, number> = {
  missile: 1,
  machinegun: 3,
  shotgun: 2,
  mortar: 3,
  mines: 2,
  drums: 3,
  oil: 2,
  flamethrower: 2,
  flashbang: 1,
};

const BOT_NAMES = ["Rusty", "Dent", "Bumper", "Clank", "Skid", "Wonky", "Muffler", "Hubcap"];

export type RaceEntrant = { id: string; name: string };

export type Car = {
  id: string;
  name: string;
  color: number;
  bot: boolean;
  // A person's car that a bot drives while they're away.
  away: boolean;
  // Left the match: parked out of every round from now on.
  gone: boolean;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  spin: number;
  state: CarState;
  points: number;
  weapon?: WeaponKind;
  ammo: number;
  lock?: string;
  boostLeft: number;
  stallLeft: number;
  // How the start went: revved too early, nailed it, or neither.
  launch: "none" | "early" | "perfect";
  dizzy: number;
  burnLeft: number;
  flameLeft: number;
  burstLeft: number;
  burstTimer: number;
  confusedLeft: number;
  // Height off the ground, and how fast that changes.
  z: number;
  vz: number;
  // Tumble while airborne, for the client to draw the car flipping over.
  roll: number;
  rollRate: number;
  ghostLeft: number;
  fallLeft: number;
  warnLeft: number;
  strike?: { x: number; y: number; reload: number };
  input: RaceInput;
  firesSeen: number;
  // Total distance driven along the track, laps included. Higher is further ahead.
  progress: number;
  lapS: number;
  hint: number;
  inSlick: boolean;
  brain: BotBrain;
};

type Shot = {
  id: number;
  kind: ShotKind;
  owner: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  angle: number;
  age: number;
  life: number;
  hint: number;
  // Where a lobbed shot comes down, and where it set off from.
  tx: number;
  ty: number;
  fromX: number;
  fromY: number;
  target?: string;
};
type Mine = { id: number; owner: string; x: number; y: number; age: number; blow: boolean };
type Slick = { id: number; x: number; y: number; radius: number; life: number };
type Crate = { id: number; x: number; y: number; wait: number };
type TimedEvent = { tick: number; event: RaceEvent };

export class RaceMatch {
  readonly track: Track;
  readonly cars: Car[] = [];
  phase: RacePhase = "countdown";
  phaseLeft = COUNTDOWN_MS / 1000;
  round = 1;
  tick = 0;
  roundTime = 0;
  view = { x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT };
  zoom = 1;
  outOrder: string[] = [];
  roundWinner?: string;
  matchWinner?: string;
  // Set once the celebration after the last round has played out.
  finished = false;
  private shots: Shot[] = [];
  private mines: Mine[] = [];
  private slicks: Slick[] = [];
  private crates: Crate[] = [];
  private events: TimedEvent[] = [];
  private nextId = 1;

  constructor(
    entrants: RaceEntrant[],
    private readonly random: Random,
    trackId: string,
    readonly target = TARGET_POINTS,
  ) {
    this.track = trackById(trackId);
    entrants.forEach((entrant, index) => this.cars.push(this.newCar(entrant.id, entrant.name, index, false)));
    const botNames = [...BOT_NAMES];
    for (let index = this.cars.length; index < GRID_SIZE; index += 1) {
      const name = botNames.splice(Math.floor(this.random() * botNames.length), 1)[0];
      this.cars.push(this.newCar(`bot-${index}`, name, index, true));
    }
    this.lineUp(0, [...this.cars]);
    this.placeCrates();
  }

  car(id: string): Car | undefined {
    return this.cars.find((car) => car.id === id);
  }

  setInput(id: string, input: RaceInput): void {
    const car = this.car(id);
    if (!car || car.bot) return;
    car.input = input;
  }

  setAway(id: string, away: boolean): void {
    const car = this.car(id);
    if (car && !car.bot) car.away = away;
  }

  // A player left for good: their car parks itself out of the race.
  removeCar(id: string): void {
    const car = this.car(id);
    if (!car || car.bot) return;
    car.gone = true;
    car.away = false;
    car.strike = undefined;
    if (car.state === "out") return;
    if (this.phase === "racing") this.knockOut(car);
    else car.state = "out";
  }

  step(dt: number): void {
    dt = Math.min(0.1, Math.max(0, dt));
    this.tick += 1;
    this.events = this.events.filter((timed) => this.tick - timed.tick < EVENT_LIFE_TICKS);
    this.phaseLeft -= dt;

    if (this.phase === "countdown") {
      this.updateCamera(dt, true);
      this.watchLaunches();
      if (this.phaseLeft <= 0) this.go();
      // Fire presses during the countdown don't count later.
      this.cars.forEach((car) => (car.firesSeen = car.input.fires));
      return;
    }

    if (this.phase === "round_over") {
      this.simulate(dt);
      if (this.phaseLeft <= 0) this.afterRound();
      return;
    }

    if (this.phase === "match_over") {
      this.simulate(dt);
      if (this.phaseLeft <= 0) this.finished = true;
      return;
    }

    this.roundTime += dt;
    this.simulate(dt);
    this.aimStrikes(dt);
    this.checkScreen(dt);
    const left = this.cars.filter((car) => car.state !== "out");
    if (left.length <= 1) this.endRound(left[0]?.id ?? this.outOrder[this.outOrder.length - 1]);
    else if (this.roundTime > ROUND_LIMIT_S) this.endRound(this.standings()[0].id);
  }

  // The time limit ran out: whoever has the most points wins.
  timeout(): void {
    if (this.matchWinner) return;
    const best = [...this.cars].sort((a, b) => b.points - a.points || b.progress - a.progress)[0];
    this.matchWinner = best?.id;
    this.phase = "match_over";
    this.finished = true;
  }

  viewState(): RaceView {
    const round = (value: number) => Math.round(value * 10) / 10;
    return {
      trackId: this.track.def.id,
      phase: this.phase,
      phaseMs: Math.max(0, Math.round(this.phaseLeft * 1000)),
      round: this.round,
      target: this.target,
      tick: this.tick,
      view: { x: round(this.view.x), y: round(this.view.y), width: round(this.view.width), height: round(this.view.height) },
      shrinking: this.phase === "racing" && this.roundTime > SHRINK_AFTER_S,
      cars: this.cars.map(
        (car): RaceCar => ({
          id: car.id,
          name: car.name,
          color: car.color,
          bot: car.bot,
          x: round(car.x),
          y: round(car.y),
          angle: Math.round(car.angle * 1000) / 1000,
          vx: round(car.vx),
          vy: round(car.vy),
          state: car.state,
          points: car.points,
          weapon: car.weapon,
          ammo: car.ammo,
          boosting: car.boostLeft > 0,
          dizzy: round(car.dizzy),
          z: Math.round(car.z),
          roll: Math.round(car.roll * 100) / 100,
          ghost: car.ghostLeft > 0,
          burning: car.burnLeft > 0,
          flaming: car.flameLeft > 0,
          stalled: car.stallLeft > 0,
          lock: car.lock,
          warn: round(car.warnLeft),
          strike: car.strike ? { x: Math.round(car.strike.x), y: Math.round(car.strike.y), ready: car.strike.reload <= 0 } : undefined,
        }),
      ),
      shots: this.shots.map((shot) => ({
        id: shot.id,
        kind: shot.kind,
        x: round(shot.x),
        y: round(shot.y),
        z: Math.round(shot.z),
        angle: Math.round(shot.angle * 100) / 100,
        ...(shot.kind === "mortar" || shot.kind === "strike" ? { tx: Math.round(shot.tx), ty: Math.round(shot.ty) } : {}),
      })),
      mines: this.mines.map((mine) => ({ id: mine.id, x: round(mine.x), y: round(mine.y), armed: mine.age >= MINE_ARM_S })),
      slicks: this.slicks.map((slick) => ({ id: slick.id, x: round(slick.x), y: round(slick.y), radius: slick.radius })),
      crates: this.crates.filter((crate) => crate.wait <= 0).map((crate) => ({ id: crate.id, x: round(crate.x), y: round(crate.y) })),
      events: this.events.map((timed) => timed.event),
      outOrder: [...this.outOrder],
      roundWinner: this.roundWinner,
      matchWinner: this.matchWinner,
    };
  }

  // Cars ahead first.
  standings(): Car[] {
    return [...this.cars].filter((car) => car.state !== "out").sort((a, b) => b.progress - a.progress);
  }

  // Blast everything near a point: a shove away from it, a spin, and a trip into the air.
  explode(x: number, y: number, radius: number, force: number, spare?: string): void {
    this.emit({ type: "boom", x: Math.round(x), y: Math.round(y), radius });
    for (const car of this.cars) {
      if (car.id === spare || car.state !== "driving" || car.ghostLeft > 0) continue;
      const dx = car.x - x;
      const dy = car.y - y;
      const distance = Math.hypot(dx, dy);
      if (distance > radius + CAR_RADIUS) continue;
      const strength = force * (1 - (0.5 * Math.min(distance, radius)) / radius);
      const nx = distance > 0.01 ? dx / distance : Math.cos(car.angle);
      const ny = distance > 0.01 ? dy / distance : Math.sin(car.angle);
      car.vx += nx * strength;
      car.vy += ny * strength;
      this.tumble(car, strength * BLAST_LIFT, 7);
    }
    // Mines and drums caught in a blast go off too.
    for (const mine of this.mines) if (Math.hypot(mine.x - x, mine.y - y) < radius) mine.blow = true;
    for (const shot of this.shots) if (shot.kind === "drum" && Math.hypot(shot.x - x, shot.y - y) < radius) shot.life = Math.min(shot.life, shot.age + 0.1);
  }

  private tumble(car: Car, lift: number, spin: number): void {
    car.spin = (this.random() < 0.5 ? -1 : 1) * (spin + this.random() * 5);
    car.dizzy = Math.max(car.dizzy, 0.9);
    car.vz = Math.max(car.vz, 0) + lift;
    car.rollRate = (this.random() < 0.5 ? -1 : 1) * (9 + this.random() * 7);
  }

  private newCar(id: string, name: string, color: number, bot: boolean): Car {
    return {
      id,
      name,
      color,
      bot,
      away: false,
      gone: false,
      x: 0,
      y: 0,
      angle: 0,
      vx: 0,
      vy: 0,
      spin: 0,
      state: "driving",
      points: 0,
      ammo: 0,
      boostLeft: 0,
      stallLeft: 0,
      launch: "none",
      dizzy: 0,
      burnLeft: 0,
      flameLeft: 0,
      burstLeft: 0,
      burstTimer: 0,
      confusedLeft: 0,
      z: 0,
      vz: 0,
      roll: 0,
      rollRate: 0,
      ghostLeft: 0,
      fallLeft: 0,
      warnLeft: 0,
      input: { kind: "race", steer: 0, throttle: 0, fires: 0 },
      firesSeen: 0,
      progress: 0,
      lapS: 0,
      hint: 0,
      inSlick: false,
      brain: { lane: (this.random() - 0.5) * 0.8, laneTimer: 0, stuckFor: 0, reverseFor: 0, fire: false, launch: "none" },
    };
  }

  // Two by two behind a line at distance s, everyone stopped and facing up the road, first in the order on pole.
  private lineUp(s: number, order: Car[]): void {
    order.forEach((car, index) => {
      const row = Math.floor(index / 2);
      const along = s - 60 - row * 70;
      const spot = pointAt(this.track, along);
      const across = Math.min(spot.halfWidth * 0.5, 55) * (index % 2 === 0 ? -1 : 1);
      car.x = spot.x - spot.ty * across;
      car.y = spot.y + spot.tx * across;
      car.angle = Math.atan2(spot.ty, spot.tx);
      car.vx = 0;
      car.vy = 0;
      car.spin = 0;
      car.state = "driving";
      car.boostLeft = 0;
      car.stallLeft = 0;
      car.launch = "none";
      car.dizzy = 0;
      car.burnLeft = 0;
      car.flameLeft = 0;
      car.burstLeft = 0;
      car.confusedLeft = 0;
      this.land(car);
      car.ghostLeft = 0;
      car.fallLeft = 0;
      car.warnLeft = 0;
      car.strike = undefined;
      car.inSlick = false;
      // A bot's luck on the start line is decided up front.
      const roll = this.random();
      car.brain.launch = roll < 0.35 ? "perfect" : roll < 0.5 ? "early" : "none";
      const here = locate(this.track, car.x, car.y, spot.index);
      car.hint = here.index;
      car.lapS = here.s;
      // Only the gaps between cars matter. The right-hand car of a row starts a hair behind, so the order holds.
      car.progress = along - (index % 2) * 0.5;
    });
    this.shots = [];
    this.mines = [];
    this.slicks = [];
    this.zoom = 1;
    const ahead = pointAt(this.track, s);
    this.view = { x: ahead.x, y: ahead.y, width: VIEW_WIDTH, height: VIEW_HEIGHT };
    this.updateCamera(0, true);
  }

  private placeCrates(): void {
    this.crates = this.track.def.crates.map(([fraction, across]) => {
      const spot = pointAt(this.track, fraction * this.track.length);
      const offset = across * spot.halfWidth * 0.6;
      return { id: this.nextId++, x: spot.x - spot.ty * offset, y: spot.y + spot.tx * offset, wait: 0 };
    });
  }

  // Revving on the line: too early stalls, right at the end gets a turbo start.
  private watchLaunches(): void {
    for (const car of this.cars) {
      if (car.state !== "driving" || car.launch === "early") continue;
      const revving = car.bot || car.away ? this.botRevving(car) : car.input.throttle > 0.5;
      if (!revving) continue;
      if (this.phaseLeft > TURBO_WINDOW_S && this.phaseLeft <= STALL_WINDOW_S) car.launch = "early";
      else if (this.phaseLeft <= TURBO_WINDOW_S && car.launch === "none") car.launch = "perfect";
    }
  }

  private botRevving(car: Car): boolean {
    if (car.brain.launch === "early") return this.phaseLeft < 1.2;
    if (car.brain.launch === "perfect") return this.phaseLeft < 0.3;
    return false;
  }

  private go(): void {
    this.phase = "racing";
    this.roundTime = 0;
    this.emit({ type: "go" });
    for (const car of this.cars) {
      if (car.state !== "driving") continue;
      if (car.launch === "perfect") {
        car.boostLeft = TURBO_S;
        this.emit({ type: "turbo", car: car.id });
      } else if (car.launch === "early") {
        car.stallLeft = STALL_S;
        this.emit({ type: "stall", car: car.id });
      }
    }
  }

  private simulate(dt: number): void {
    const steps = Math.max(1, Math.ceil(dt / 0.025));
    const small = dt / steps;
    for (let index = 0; index < steps; index += 1) {
      for (const car of this.cars) this.drive(car, small);
      this.collideCars();
    }
    if (this.phase === "racing") {
      for (const car of this.cars) this.updateLock(car);
      for (const car of this.cars) this.useWeapon(car, dt);
      this.pickUpCrates(dt);
    }
    this.moveShots(dt);
    this.tickMines(dt);
    this.slicks = this.slicks.filter((slick) => (slick.life -= dt) > 0);
    this.updateCamera(dt, false);
  }

  private drive(car: Car, dt: number): void {
    if (car.state === "out") return;
    if (car.state === "falling") {
      car.fallLeft -= dt;
      if (car.fallLeft <= 0) this.respawn(car);
      return;
    }
    car.ghostLeft = Math.max(0, car.ghostLeft - dt);
    car.boostLeft = Math.max(0, car.boostLeft - dt);
    car.stallLeft = Math.max(0, car.stallLeft - dt);
    car.burnLeft = Math.max(0, car.burnLeft - dt);
    car.confusedLeft = Math.max(0, car.confusedLeft - dt);
    if (car.z > 0 || car.vz > 0) {
      this.fly(car, dt);
      return;
    }
    car.dizzy = Math.max(0, car.dizzy - dt);

    const input = this.phase === "racing" || this.phase === "round_over" ? this.inputFor(car, dt) : { steer: 0, throttle: 0 };
    // The winner of a round coasts; everyone else has stopped mattering. A stalled car just sits there.
    const throttle = this.phase === "racing" && car.stallLeft <= 0 ? input.throttle : 0;
    let steer = input.steer;
    // On fire: the driver flails at the wheel.
    if (car.burnLeft > 0) steer = Math.max(-1, Math.min(1, steer + Math.sin(this.tick * 0.9 + car.color) * 0.8));
    const spot = locate(this.track, car.x, car.y, car.hint);
    const onVerge = Math.abs(spot.offset) - spot.sample.halfWidth > 0;
    const slick = this.slicks.find((candidate) => Math.hypot(candidate.x - car.x, candidate.y - car.y) < candidate.radius);
    if (slick && !car.inSlick) {
      car.spin = (this.random() < 0.5 ? -1 : 1) * (4 + this.random() * 3);
      car.dizzy = Math.max(car.dizzy, 0.8);
    }
    car.inSlick = Boolean(slick);

    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    let forward = car.vx * fx + car.vy * fy;
    let lateral = -car.vx * fy + car.vy * fx;

    const boosting = car.boostLeft > 0;
    const topSpeed = (boosting ? TURBO_SPEED : onVerge ? VERGE_SPEED : MAX_SPEED) * (car.bot && !car.away ? 0.95 : 1) * (car.burnLeft > 0 ? 0.9 : 1);
    if (boosting && car.stallLeft <= 0 && this.phase === "racing") {
      forward += TURBO_ACCELERATION * dt;
    } else if (throttle > 0.05) {
      forward += ACCELERATION * throttle * dt;
    } else if (throttle < -0.05) {
      if (forward > 0) forward = Math.max(0, forward + BRAKING * throttle * dt);
      else forward = Math.max(-REVERSE_SPEED, forward + ACCELERATION * 0.6 * throttle * dt);
    } else {
      forward -= Math.sign(forward) * Math.min(Math.abs(forward), ROLLING_DRAG * dt);
    }
    if (forward > topSpeed) forward -= (forward - topSpeed) * Math.min(1, 3 * dt);

    const grip = slick ? OIL_GRIP : car.dizzy > 0 ? 2 : (onVerge ? VERGE_GRIP : ROAD_GRIP) * (car.burnLeft > 0 ? 0.5 : 1);
    lateral *= Math.exp(-grip * dt);

    if (car.dizzy > 0) {
      car.angle += car.spin * dt;
      car.spin *= Math.exp(-1.5 * dt);
    } else {
      const grab = Math.min(1, Math.abs(forward) / 140);
      car.angle += STEER_RATE * steer * grab * Math.sign(forward || 1) * dt;
    }

    // The velocity stays in the old frame as the car turns; the grip above pulls it round next step. That lag is the drift.
    car.vx = fx * forward - fy * lateral;
    car.vy = fy * forward + fx * lateral;

    car.x += car.vx * dt;
    car.y += car.vy * dt;
    this.keepOnTrack(car);
  }

  // Up in the air the car just goes where it was thrown, tumbling, until it lands with a bounce.
  private fly(car: Car, dt: number): void {
    car.vz -= GRAVITY * dt;
    car.z += car.vz * dt;
    car.roll += car.rollRate * dt;
    car.angle += car.spin * dt;
    car.vx *= Math.exp(-0.3 * dt);
    car.vy *= Math.exp(-0.3 * dt);
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    if (car.z <= 0) {
      car.z = 0;
      if (car.vz < -320) {
        this.emit({ type: "crash", x: Math.round(car.x), y: Math.round(car.y), force: Math.round(-car.vz / 2) });
        car.vz = -car.vz * LAND_BOUNCE;
        car.rollRate *= 0.5;
        car.vx *= 0.8;
        car.vy *= 0.8;
      } else {
        this.land(car);
        car.dizzy = Math.max(car.dizzy, 0.5);
      }
    }
    this.keepOnTrack(car);
  }

  private land(car: Car): void {
    car.z = 0;
    car.vz = 0;
    car.roll = 0;
    car.rollRate = 0;
  }

  // Keeps the car on the map: walls bounce it back, drops swallow it.
  private keepOnTrack(car: Car): void {
    const spot = locate(this.track, car.x, car.y, car.hint);
    let delta = spot.s - car.lapS;
    if (delta > this.track.length / 2) delta -= this.track.length;
    if (delta < -this.track.length / 2) delta += this.track.length;
    car.progress += delta;
    car.lapS = spot.s;
    car.hint = spot.index;
    const limit = spot.sample.halfWidth + VERGE_WIDTH;
    const beyond = Math.abs(spot.offset) - limit;
    if (beyond <= 0) return;
    const side = Math.sign(spot.offset);
    const normalX = -spot.sample.ty * side;
    const normalY = spot.sample.tx * side;
    if (spot.sample.edge === "wall") {
      car.x -= normalX * beyond;
      car.y -= normalY * beyond;
      const into = car.vx * normalX + car.vy * normalY;
      if (into > 0) {
        car.vx -= normalX * into * 1.5;
        car.vy -= normalY * into * 1.5;
        if (into > 160) this.emit({ type: "crash", x: Math.round(car.x), y: Math.round(car.y), force: Math.round(into) });
      }
      return;
    }
    if (beyond > CAR_RADIUS * 0.6 && car.ghostLeft <= 0 && car.z <= 0) {
      car.state = "falling";
      car.fallLeft = FALL_S;
      car.boostLeft = 0;
      car.burnLeft = 0;
      this.emit({ type: "splash", car: car.id, x: Math.round(car.x), y: Math.round(car.y) });
    }
  }

  private respawn(car: Car): void {
    const spot = pointAt(this.track, car.lapS - RESPAWN_BACK);
    car.state = "driving";
    car.x = spot.x;
    car.y = spot.y;
    car.angle = Math.atan2(spot.ty, spot.tx);
    car.vx = spot.tx * 60;
    car.vy = spot.ty * 60;
    car.spin = 0;
    car.dizzy = 0;
    this.land(car);
    car.ghostLeft = GHOST_S;
    car.progress -= RESPAWN_BACK;
    car.lapS = locate(this.track, car.x, car.y, spot.index).s;
    car.hint = spot.index;
  }

  private inputFor(car: Car, dt: number): { steer: number; throttle: number } {
    if (car.bot || car.away) return botInput(car, this, dt, this.random);
    return { steer: car.input.steer, throttle: car.input.throttle };
  }

  private collideCars(): void {
    for (let a = 0; a < this.cars.length; a += 1) {
      const first = this.cars[a];
      if (first.state !== "driving") continue;
      for (let b = a + 1; b < this.cars.length; b += 1) {
        const second = this.cars[b];
        if (second.state !== "driving") continue;
        if (first.ghostLeft > 0 || second.ghostLeft > 0 || first.z > AIRBORNE_Z || second.z > AIRBORNE_Z) continue;
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= CAR_RADIUS * 2 || distance < 0.001) continue;
        const nx = dx / distance;
        const ny = dy / distance;
        const overlap = CAR_RADIUS * 2 - distance;
        first.x -= nx * overlap * 0.5;
        first.y -= ny * overlap * 0.5;
        second.x += nx * overlap * 0.5;
        second.y += ny * overlap * 0.5;
        const closing = (first.vx - second.vx) * nx + (first.vy - second.vy) * ny;
        if (closing <= 0) continue;
        // Bouncier than real life: a good shunt sends the other car flying.
        const impulse = (closing * (1 + BUMP_BOUNCE)) / 2;
        first.vx -= nx * impulse;
        first.vy -= ny * impulse;
        second.vx += nx * impulse;
        second.vy += ny * impulse;
        if (closing > 120) {
          const twist = Math.min(5, closing / 90);
          first.spin = -twist;
          second.spin = twist;
          first.dizzy = Math.max(first.dizzy, 0.25);
          second.dizzy = Math.max(second.dizzy, 0.25);
        }
        // A proper T-bone pops both cars off the ground.
        if (closing > 230) {
          for (const car of [first, second]) {
            car.vz = Math.max(car.vz, closing * SHUNT_HOP);
            car.rollRate = (this.random() < 0.5 ? -1 : 1) * (5 + this.random() * 5);
          }
        }
        if (closing > 150) this.emit({ type: "crash", x: Math.round((first.x + second.x) / 2), y: Math.round((first.y + second.y) / 2), force: Math.round(closing) });
      }
    }
  }

  private pickUpCrates(dt: number): void {
    const order = this.standings();
    for (const crate of this.crates) {
      if (crate.wait > 0) {
        crate.wait -= dt;
        continue;
      }
      const car = this.cars.find(
        (candidate) =>
          candidate.state === "driving" &&
          candidate.z < AIRBORNE_Z &&
          !candidate.weapon &&
          Math.hypot(candidate.x - crate.x, candidate.y - crate.y) < CAR_RADIUS + CRATE_RADIUS,
      );
      if (!car) continue;
      const rank = order.length > 1 ? order.indexOf(car) / (order.length - 1) : 0;
      car.weapon = this.rollWeapon(Math.max(0, rank));
      car.ammo = AMMO[car.weapon];
      crate.wait = CRATE_RESPAWN_S;
      this.emit({ type: "pickup", car: car.id, weapon: car.weapon });
    }
  }

  // Cars at the back get more to fire forwards; the leader gets more to leave behind.
  rollWeapon(rank: number): WeaponKind {
    const behind = rank;
    const ahead = 1 - rank;
    return pickWeighted<WeaponKind>(
      [
        ["missile", 1 + 2 * behind],
        ["machinegun", 1.5 + 1.5 * behind],
        ["shotgun", 1.5 + behind],
        ["mortar", 1 + 2 * behind],
        ["mines", 1.5 + 1.5 * ahead],
        ["drums", 1 + 2 * ahead],
        ["oil", 1.5 + ahead],
        ["flamethrower", 1 + 2 * ahead],
        ["flashbang", 1],
      ],
      this.random,
    );
  }

  // Locking weapons pick the nearest car inside a narrow cone ahead.
  private updateLock(car: Car): void {
    car.lock = undefined;
    if (car.state !== "driving" || !car.weapon || !LOCKING_WEAPONS.includes(car.weapon)) return;
    let best = Infinity;
    for (const other of this.cars) {
      if (other === car || other.state !== "driving" || other.ghostLeft > 0) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const distance = Math.hypot(dx, dy);
      if (distance > LOCK_RANGE || distance >= best) continue;
      if (Math.abs(wrapAngle(Math.atan2(dy, dx) - car.angle)) > LOCK_CONE) continue;
      best = distance;
      car.lock = other.id;
    }
  }

  private useWeapon(car: Car, dt: number): void {
    // A knocked-out player's presses are for air strikes.
    if (car.state === "out") return;
    const wantsFire = car.bot || car.away ? car.brain.fire === true : car.input.fires > car.firesSeen;
    car.firesSeen = car.input.fires;
    car.brain.fire = false;
    this.keepFiring(car, dt);
    if (!wantsFire || car.state !== "driving" || !car.weapon || this.roundTime <= START_GRACE_S) return;
    this.fire(car, car.weapon);
    car.ammo -= 1;
    if (car.ammo <= 0) {
      car.weapon = undefined;
      car.lock = undefined;
      car.ammo = 0;
    }
  }

  // Weapons that keep going after the press: machine-gun bursts and the flamethrower.
  private keepFiring(car: Car, dt: number): void {
    if (car.state !== "driving") {
      car.burstLeft = 0;
      car.flameLeft = 0;
      return;
    }
    if (car.burstLeft > 0) {
      car.burstTimer -= dt;
      while (car.burstLeft > 0 && car.burstTimer <= 0) {
        this.fireBullet(car);
        car.burstLeft -= 1;
        car.burstTimer += BURST_GAP_S;
      }
    }
    if (car.flameLeft > 0) {
      car.flameLeft -= dt;
      const backX = -Math.cos(car.angle);
      const backY = -Math.sin(car.angle);
      for (const other of this.cars) {
        if (other === car || other.state !== "driving" || other.ghostLeft > 0) continue;
        const dx = other.x - car.x;
        const dy = other.y - car.y;
        const distance = Math.hypot(dx, dy);
        if (distance > FLAME_RANGE || (dx * backX + dy * backY) / (distance || 1) < 0.85) continue;
        if (other.burnLeft <= 0) this.emit({ type: "burn", car: other.id });
        other.burnLeft = BURN_S;
        // The jet pushes, too.
        other.vx += backX * 300 * dt;
        other.vy += backY * 300 * dt;
      }
    }
  }

  fire(car: Car, weapon: WeaponKind): void {
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    const locked = car.lock ? this.car(car.lock) : undefined;
    this.emit({ type: "fire", car: car.id, weapon });
    switch (weapon) {
      case "missile":
        this.addShot("missile", car, car.x + fx * (CAR_RADIUS + 10), car.y + fy * (CAR_RADIUS + 10), car.angle, MISSILE_SPEED, MISSILE_LIFE_S, locked?.id);
        return;
      case "machinegun":
        car.burstLeft = BURST;
        car.burstTimer = 0;
        return;
      case "shotgun":
        this.shotgun(car);
        return;
      case "mortar": {
        const shot = this.addShot("mortar", car, car.x, car.y, car.angle, 0, MORTAR_FLIGHT_S, locked?.id);
        const aim = locked ? { x: locked.x + locked.vx * MORTAR_FLIGHT_S * 0.8, y: locked.y + locked.vy * MORTAR_FLIGHT_S * 0.8 } : { x: car.x + fx * MORTAR_RANGE, y: car.y + fy * MORTAR_RANGE };
        shot.tx = aim.x;
        shot.ty = aim.y;
        return;
      }
      case "mines":
        if (this.mines.length >= MAX_MINES) this.mines.shift();
        this.mines.push({ id: this.nextId++, owner: car.id, x: car.x - fx * (CAR_RADIUS + 14), y: car.y - fy * (CAR_RADIUS + 14), age: 0, blow: false });
        return;
      case "drums": {
        const shot = this.addShot("drum", car, car.x - fx * (CAR_RADIUS + 12), car.y - fy * (CAR_RADIUS + 12), car.angle, 0, DRUM_FUSE_S);
        const sideways = (this.random() - 0.5) * 160;
        shot.vx = car.vx * 0.4 - fx * 220 - fy * sideways;
        shot.vy = car.vy * 0.4 - fy * 220 + fx * sideways;
        return;
      }
      case "oil":
        this.slicks.push({ id: this.nextId++, x: car.x - fx * (CAR_RADIUS + 40), y: car.y - fy * (CAR_RADIUS + 40), radius: SLICK_RADIUS, life: SLICK_LIFE_S });
        return;
      case "flamethrower":
        car.flameLeft = FLAME_S;
        return;
      case "flashbang":
        // Blinds everyone on the screen, the thrower included. Bots just panic.
        this.emit({ type: "flash", x: Math.round(car.x), y: Math.round(car.y) });
        for (const other of this.cars) if (other.bot || other.away) other.confusedLeft = FLASH_CONFUSION_S;
        return;
    }
  }

  private addShot(kind: ShotKind, car: Car, x: number, y: number, angle: number, speed: number, life: number, target?: string): Shot {
    const shot: Shot = {
      id: this.nextId++,
      kind,
      owner: car.id,
      x,
      y,
      z: 0,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      age: 0,
      life,
      hint: car.hint,
      tx: x,
      ty: y,
      fromX: x,
      fromY: y,
      target,
    };
    this.shots.push(shot);
    return shot;
  }

  private fireBullet(car: Car): void {
    const locked = car.lock ? this.car(car.lock) : undefined;
    let angle = car.angle + (this.random() - 0.5) * 0.08;
    if (locked) {
      const wanted = Math.atan2(locked.y - car.y, locked.x - car.x);
      angle += Math.max(-0.2, Math.min(0.2, wrapAngle(wanted - angle)));
    }
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    this.addShot("bullet", car, car.x + fx * (CAR_RADIUS + 6), car.y + fy * (CAR_RADIUS + 6), angle, BULLET_SPEED, BULLET_LIFE_S);
  }

  // Both barrels, out of both sides: anyone alongside gets blown off the ground.
  private shotgun(car: Car): void {
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    for (const other of this.cars) {
      if (other === car || other.state !== "driving" || other.ghostLeft > 0) continue;
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      if (Math.hypot(dx, dy) > SHOTGUN_RANGE) continue;
      const along = dx * fx + dy * fy;
      const across = -dx * fy + dy * fx;
      if (Math.abs(across) < Math.abs(along) * 0.8) continue;
      const side = Math.sign(across) || 1;
      other.vx += -fy * side * 420;
      other.vy += fx * side * 420;
      this.tumble(other, 420, 6);
      this.emit({ type: "hit", x: Math.round(other.x), y: Math.round(other.y) });
    }
  }

  private moveShots(dt: number): void {
    const keep: Shot[] = [];
    for (const shot of this.shots) {
      shot.age += dt;
      if (this.moveShot(shot, dt)) keep.push(shot);
    }
    this.shots = keep;
  }

  // Moves one shot; false once it has gone off or run out.
  private moveShot(shot: Shot, dt: number): boolean {
    const hitCar = (reach: number) =>
      this.cars.find(
        (car) =>
          car.id !== shot.owner &&
          car.state === "driving" &&
          car.ghostLeft <= 0 &&
          car.z < 40 &&
          Math.hypot(car.x - shot.x, car.y - shot.y) < CAR_RADIUS + reach,
      );
    if (shot.kind === "mortar" || shot.kind === "strike") {
      const target = shot.target ? this.car(shot.target) : undefined;
      // The mortar keeps half an eye on its target on the way down.
      if (shot.kind === "mortar" && target && target.state === "driving") {
        const pull = 140 * dt;
        shot.tx += Math.max(-pull, Math.min(pull, target.x - shot.tx));
        shot.ty += Math.max(-pull, Math.min(pull, target.y - shot.ty));
      }
      const t = Math.min(1, shot.age / shot.life);
      shot.x = shot.fromX + (shot.tx - shot.fromX) * t;
      shot.y = shot.fromY + (shot.ty - shot.fromY) * t;
      shot.z = shot.kind === "mortar" ? 4 * 220 * t * (1 - t) : 600 * (1 - t);
      if (t < 1) return true;
      const blast = shot.kind === "mortar" ? BLASTS.mortar : BLASTS.strike;
      this.explode(shot.tx, shot.ty, blast.radius, blast.force);
      return false;
    }
    if (shot.kind === "missile") {
      const target = shot.target ? this.car(shot.target) : this.seek(shot);
      if (target && target.state === "driving") {
        const turnRate = shot.target ? 3.5 : 1.5;
        const turn = wrapAngle(Math.atan2(target.y - shot.y, target.x - shot.x) - shot.angle);
        shot.angle += Math.max(-turnRate * dt, Math.min(turnRate * dt, turn));
        shot.vx = Math.cos(shot.angle) * MISSILE_SPEED;
        shot.vy = Math.sin(shot.angle) * MISSILE_SPEED;
      }
    }
    if (shot.kind === "drum") {
      shot.vx *= Math.exp(-2 * dt);
      shot.vy *= Math.exp(-2 * dt);
      shot.angle += Math.hypot(shot.vx, shot.vy) * dt * 0.05;
    }
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    const spot = locate(this.track, shot.x, shot.y, shot.hint);
    shot.hint = spot.index;
    const hitWall = spot.sample.edge === "wall" && Math.abs(spot.offset) > spot.sample.halfWidth + VERGE_WIDTH;

    if (shot.kind === "bullet") {
      const victim = hitCar(4);
      if (victim) {
        victim.vx += Math.cos(shot.angle) * 90;
        victim.vy += Math.sin(shot.angle) * 90;
        victim.spin = (this.random() - 0.5) * 6;
        victim.dizzy = Math.max(victim.dizzy, 0.15);
        this.emit({ type: "hit", x: Math.round(shot.x), y: Math.round(shot.y) });
        return false;
      }
      return !hitWall && shot.age < shot.life;
    }
    if (shot.kind === "drum") {
      // The thrower is safe from their own drum for a moment, then it's anyone's.
      const victim = this.cars.find(
        (car) => (car.id !== shot.owner || shot.age > 0.4) && car.state === "driving" && car.z < 30 && Math.hypot(car.x - shot.x, car.y - shot.y) < CAR_RADIUS + 10,
      );
      if (victim || shot.age >= shot.life) {
        this.explode(shot.x, shot.y, BLASTS.drum.radius, BLASTS.drum.force);
        return false;
      }
      if (hitWall) {
        shot.vx *= -0.5;
        shot.vy *= -0.5;
      }
      return true;
    }
    // Missile.
    if (hitCar(8) || hitWall || shot.age >= shot.life) {
      const fizzle = shot.age >= shot.life && !hitWall;
      this.explode(shot.x, shot.y, BLASTS.missile.radius * (fizzle ? 0.6 : 1), BLASTS.missile.force * (fizzle ? 0.5 : 1));
      return false;
    }
    return true;
  }

  // An unlocked missile still drifts towards anything roughly ahead of it.
  private seek(shot: Shot): Car | undefined {
    let best: Car | undefined;
    let bestScore = Infinity;
    for (const car of this.cars) {
      if (car.id === shot.owner || car.state !== "driving" || car.ghostLeft > 0) continue;
      const dx = car.x - shot.x;
      const dy = car.y - shot.y;
      const distance = Math.hypot(dx, dy);
      const off = Math.abs(wrapAngle(Math.atan2(dy, dx) - shot.angle));
      if (distance > LOCK_RANGE || off > Math.PI / 4) continue;
      const score = distance * (1 + off);
      if (score < bestScore) {
        bestScore = score;
        best = car;
      }
    }
    return best;
  }

  private tickMines(dt: number): void {
    for (const mine of this.mines) {
      mine.age += dt;
      if (mine.age < MINE_ARM_S || mine.blow) continue;
      if (this.cars.some((car) => car.state === "driving" && car.ghostLeft <= 0 && car.z < 30 && Math.hypot(car.x - mine.x, car.y - mine.y) < CAR_RADIUS + 14)) {
        mine.blow = true;
      }
    }
    // Blasts can set off more mines, so keep going until nothing new goes off.
    let blowing = this.mines.filter((mine) => mine.blow);
    while (blowing.length > 0) {
      this.mines = this.mines.filter((mine) => !mine.blow);
      blowing.forEach((mine) => this.explode(mine.x, mine.y, BLASTS.mine.radius, BLASTS.mine.force));
      blowing = this.mines.filter((mine) => mine.blow);
    }
    this.mines = this.mines.filter((mine) => mine.age < MINE_LIFE_S);
  }

  // Knocked-out players get their revenge from the sky: a crosshair they steer, which also drifts towards the nearest car.
  private aimStrikes(dt: number): void {
    for (const car of this.cars) {
      const strike = car.strike;
      if (!strike) continue;
      strike.reload -= dt;
      const prey = this.cars
        .filter((other) => other.state === "driving")
        .sort((a, b) => Math.hypot(a.x - strike.x, a.y - strike.y) - Math.hypot(b.x - strike.x, b.y - strike.y))[0];
      if (prey) {
        const dx = prey.x - strike.x;
        const dy = prey.y - strike.y;
        const distance = Math.hypot(dx, dy) || 1;
        const drift = Math.min(distance, STRIKE_DRIFT * dt);
        strike.x += (dx / distance) * drift;
        strike.y += (dy / distance) * drift;
      }
      strike.x += car.input.steer * STRIKE_AIM_SPEED * dt;
      strike.y -= car.input.throttle * STRIKE_AIM_SPEED * dt;
      strike.x = Math.max(this.view.x - this.view.width / 2, Math.min(this.view.x + this.view.width / 2, strike.x));
      strike.y = Math.max(this.view.y - this.view.height / 2, Math.min(this.view.y + this.view.height / 2, strike.y));
      const fired = car.input.fires > car.firesSeen;
      car.firesSeen = car.input.fires;
      if (fired && strike.reload <= 0) {
        strike.reload = STRIKE_RELOAD_S;
        const shot = this.addShot("strike", car, strike.x, strike.y, 0, 0, STRIKE_FALL_S);
        shot.z = 600;
      }
    }
  }

  private updateCamera(dt: number, snap: boolean): void {
    const field = this.standings().filter((car) => car.state === "driving" || car.state === "falling");
    const leader = field[0];
    if (!leader) return;
    const leaderSpeed = Math.min(1, Math.hypot(leader.vx, leader.vy) / MAX_SPEED);
    const ahead = pointAt(this.track, leader.lapS + CAMERA_LEAD * leaderSpeed);
    const packX = field.reduce((sum, car) => sum + car.x, 0) / field.length;
    const packY = field.reduce((sum, car) => sum + car.y, 0) / field.length;
    const targetX = ahead.x * 0.6 + packX * 0.4;
    const targetY = ahead.y * 0.6 + packY * 0.4;
    const follow = snap ? 1 : 1 - Math.exp(-CAMERA_FOLLOW * dt);
    let x = this.view.x + (targetX - this.view.x) * follow;
    let y = this.view.y + (targetY - this.view.y) * follow;

    // Zoom out to fit the pack, within limits, like Mashed's camera. Anyone beyond the widest view is on their own.
    const spreadX = Math.max(...field.map((car) => Math.abs(car.x - x)));
    const spreadY = Math.max(...field.map((car) => Math.abs(car.y - y)));
    const wanted = Math.max(ZOOM_IN, Math.min(ZOOM_OUT, Math.max((spreadX + 60) / (VIEW_WIDTH / 2), (spreadY + 60) / (VIEW_HEIGHT / 2))));
    this.zoom = snap ? 1 : this.zoom + (wanted - this.zoom) * (1 - Math.exp(-1.5 * dt));
    const shrink = this.phase === "racing" ? Math.max(MIN_SHRINK, 1 - Math.max(0, this.roundTime - SHRINK_AFTER_S) * SHRINK_RATE) : 1;
    const scale = this.phase === "round_over" || this.phase === "match_over" ? this.view.width / VIEW_WIDTH : this.zoom * shrink;
    const width = VIEW_WIDTH * scale;
    const height = VIEW_HEIGHT * scale;

    const roomX = Math.max(0, width / 2 - LEADER_MARGIN * scale);
    const roomY = Math.max(0, height / 2 - LEADER_MARGIN * scale);
    x = Math.max(leader.x - roomX, Math.min(leader.x + roomX, x));
    y = Math.max(leader.y - roomY, Math.min(leader.y + roomY, y));
    this.view = { x, y, width, height };
  }

  // Off the screen, the clock starts: get back on within two seconds or blow up.
  private checkScreen(dt: number): void {
    if (this.roundTime <= START_GRACE_S) return;
    const halfWidth = this.view.width / 2 + CAR_RADIUS;
    const halfHeight = this.view.height / 2 + CAR_RADIUS;
    for (const car of this.cars) {
      if (car.state !== "driving") continue;
      const off = Math.abs(car.x - this.view.x) > halfWidth || Math.abs(car.y - this.view.y) > halfHeight;
      if (!off) {
        car.warnLeft = 0;
        continue;
      }
      car.warnLeft = car.warnLeft > 0 ? car.warnLeft - dt : WARN_S;
      if (car.warnLeft <= 0) {
        this.emit({ type: "boom", x: Math.round(car.x), y: Math.round(car.y), radius: 70 });
        this.knockOut(car);
      }
    }
  }

  private knockOut(car: Car): void {
    car.state = "out";
    car.weapon = undefined;
    car.lock = undefined;
    car.ammo = 0;
    car.warnLeft = 0;
    car.burstLeft = 0;
    car.flameLeft = 0;
    this.outOrder.push(car.id);
    this.emit({ type: "out", car: car.id, x: Math.round(car.x), y: Math.round(car.y) });
    // People, not bots, get to call in air strikes for the rest of the round.
    if (!car.bot && !car.gone) car.strike = { x: this.view.x, y: this.view.y, reload: 1.5 };
  }

  private endRound(winnerId: string | undefined): void {
    this.roundWinner = winnerId;
    const winner = winnerId ? this.car(winnerId) : undefined;
    if (winner) winner.points += WIN_POINTS;
    const crowd = this.cars.filter((car) => !car.gone).length >= 3;
    const second = crowd ? this.car(this.outOrder[this.outOrder.length - 1] ?? "") : undefined;
    const first = crowd ? this.car(this.outOrder[0] ?? "") : undefined;
    if (second && second !== winner) second.points += RUNNER_UP_POINTS;
    if (first && first !== winner && first !== second && !first.gone) first.points = Math.max(0, first.points + FIRST_OUT_POINTS);
    this.emit({ type: "round", winner: winnerId, second: second?.id, first: first?.id });
    for (const car of this.cars) car.strike = undefined;
    const champion = [...this.cars].sort((a, b) => b.points - a.points)[0];
    if (champion && champion.points >= this.target) {
      this.matchWinner = champion.id;
      this.phase = "match_over";
      this.phaseLeft = MATCH_OVER_MS / 1000;
      return;
    }
    this.phase = "round_over";
    this.phaseLeft = ROUND_OVER_MS / 1000;
  }

  private afterRound(): void {
    const winner = this.roundWinner ? this.car(this.roundWinner) : undefined;
    const s = winner ? winner.lapS : locate(this.track, this.view.x, this.view.y).s;
    // Everyone still in the match lines up where the winner stopped: the winner on pole, then the last ones out.
    const order = [winner, ...[...this.outOrder].reverse().map((id) => this.car(id))].filter(
      (car, index, list): car is Car => Boolean(car) && !car!.gone && list.indexOf(car) === index,
    );
    this.cars.filter((car) => !car.gone && !order.includes(car)).forEach((car) => order.push(car));
    this.lineUp(s, order);
    this.round += 1;
    this.outOrder = [];
    this.roundWinner = undefined;
    this.roundTime = 0;
    this.crates.forEach((crate) => (crate.wait = 0));
    this.phase = "countdown";
    this.phaseLeft = NEXT_COUNTDOWN_MS / 1000;
  }

  private emit(event: DistributiveOmit<RaceEvent, "id">): void {
    this.events.push({ tick: this.tick, event: { ...event, id: this.nextId++ } as RaceEvent });
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
