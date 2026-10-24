import {
  type CarState,
  type RaceCar,
  type RaceEvent,
  type RaceInput,
  type RacePhase,
  type RaceView,
  type WeaponKind,
} from "../../../shared/race/protocol.js";
import { VERGE_WIDTH, locate, pointAt, trackById, type Track } from "../../../shared/race/track.js";
import { pickWeighted, type Random } from "../crowd/random.js";
import { botInput, type BotBrain } from "./bot.js";

// The shared screen, in world units. It shrinks late in a round so somebody always drops off.
export const VIEW_WIDTH = 1000;
export const VIEW_HEIGHT = 580;
export const SHRINK_AFTER_S = 22;
// Zoom lost per second once the shrinking starts, down to the smallest screen.
export const SHRINK_RATE = 0.018;
export const MIN_ZOOM = 0.2;

export const CAR_RADIUS = 15;
export const MAX_SPEED = 340;
export const BOOST_SPEED = 540;
const VERGE_SPEED = 190;
const ACCELERATION = 430;
const BOOST_ACCELERATION = 900;
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

// Seconds off the screen before a car is out, so a car skimming the edge for one tick survives.
const OFFSCREEN_GRACE_S = 0.15;
const FALL_S = 0.9;
const GHOST_S = 1.6;
// A car going over the edge is put back this far behind where it fell.
const RESPAWN_BACK = 140;
const CAMERA_FOLLOW = 4;
// How far up the road the camera looks, at the leader's top speed.
const CAMERA_LEAD = 150;
// Right after the start nobody can fire or be knocked out, so a round can't be over before it starts.
const START_GRACE_S = 2;
// If a round somehow drags on this long, whoever is in front takes it.
const ROUND_LIMIT_S = 90;
// Never let the leader get closer than this to the edge of the screen.
const LEADER_MARGIN = 150;

export const COUNTDOWN_MS = 3500;
const NEXT_COUNTDOWN_MS = 2500;
export const ROUND_OVER_MS = 3200;
const MATCH_OVER_MS = 3000;
export const TARGET_POINTS = 5;
// With fewer people than this, bots fill the grid.
export const GRID_SIZE = 4;

const CRATE_RADIUS = 16;
const CRATE_RESPAWN_S = 5;
const ROCKET_SPEED = 780;
const ROCKET_LIFE_S = 1.7;
const ROCKET_TURN = 2.4;
const ROCKET_SEEK_RANGE = 750;
const MINE_ARM_S = 0.5;
const MINE_LIFE_S = 30;
const MAX_MINES = 14;
const SLICK_RADIUS = 58;
const SLICK_LIFE_S = 9;
const NITRO_S = 1.8;
const EVENT_LIFE_TICKS = 30;

export const BLASTS = {
  rocket: { radius: 95, force: 600 },
  mine: { radius: 85, force: 540 },
  shockwave: { radius: 210, force: 680 },
} as const;

const AMMO: Record<WeaponKind, number> = { rocket: 2, mines: 3, oil: 2, shockwave: 1, nitro: 1 };

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
  boostLeft: number;
  dizzy: number;
  // Height off the ground, and how fast that changes.
  z: number;
  vz: number;
  // Tumble while airborne, for the client to draw the car flipping over.
  roll: number;
  rollRate: number;
  ghostLeft: number;
  fallLeft: number;
  offscreenFor: number;
  input: RaceInput;
  firesSeen: number;
  // Total distance driven along the track, laps included. Higher is further ahead.
  progress: number;
  lapS: number;
  hint: number;
  inSlick: boolean;
  brain: BotBrain;
};

type Rocket = { id: number; owner: string; x: number; y: number; angle: number; life: number; hint: number };
type Mine = { id: number; owner: string; x: number; y: number; age: number; hint: number; blow: boolean };
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
  outOrder: string[] = [];
  roundWinner?: string;
  matchWinner?: string;
  // Set once the celebration after the last round has played out.
  finished = false;
  private rockets: Rocket[] = [];
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
      if (this.phaseLeft <= 0) {
        this.phase = "racing";
        this.roundTime = 0;
        this.emit({ type: "go" });
      }
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
      shrinking: this.phase === "racing" && this.roundTime > SHRINK_AFTER_S,
      view: { x: round(this.view.x), y: round(this.view.y), width: round(this.view.width), height: round(this.view.height) },
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
        }),
      ),
      rockets: this.rockets.map((rocket) => ({ id: rocket.id, x: round(rocket.x), y: round(rocket.y), angle: Math.round(rocket.angle * 100) / 100 })),
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
      car.spin = (this.random() < 0.5 ? -1 : 1) * (7 + this.random() * 5);
      car.dizzy = 0.9;
      car.vz = Math.max(car.vz, 0) + strength * BLAST_LIFT;
      car.rollRate = (this.random() < 0.5 ? -1 : 1) * (9 + this.random() * 7);
    }
    // Mines caught in a blast go off too.
    for (const mine of this.mines) if (Math.hypot(mine.x - x, mine.y - y) < radius) mine.blow = true;
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
      dizzy: 0,
      z: 0,
      vz: 0,
      roll: 0,
      rollRate: 0,
      ghostLeft: 0,
      fallLeft: 0,
      offscreenFor: 0,
      input: { kind: "race", steer: 0, throttle: 0, fires: 0 },
      firesSeen: 0,
      progress: 0,
      lapS: 0,
      hint: 0,
      inSlick: false,
      brain: { lane: (this.random() - 0.5) * 0.8, laneTimer: 0, stuckFor: 0, reverseFor: 0, fire: false },
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
      car.dizzy = 0;
      this.land(car);
      car.ghostLeft = 0;
      car.fallLeft = 0;
      car.offscreenFor = 0;
      car.inSlick = false;
      const here = locate(this.track, car.x, car.y, spot.index);
      car.hint = here.index;
      car.lapS = here.s;
      // Only the gaps between cars matter. The right-hand car of a row starts a hair behind, so the order holds.
      car.progress = along - (index % 2) * 0.5;
    });
    this.rockets = [];
    this.mines = [];
    this.slicks = [];
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

  private simulate(dt: number): void {
    const steps = Math.max(1, Math.ceil(dt / 0.025));
    const small = dt / steps;
    for (let index = 0; index < steps; index += 1) {
      for (const car of this.cars) this.drive(car, small);
      this.collideCars();
    }
    if (this.phase === "racing") {
      for (const car of this.cars) this.useWeapon(car);
      this.pickUpCrates(dt);
    }
    this.moveRockets(dt);
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
    if (car.z > 0 || car.vz > 0) {
      this.fly(car, dt);
      return;
    }
    car.dizzy = Math.max(0, car.dizzy - dt);

    const input = this.phase === "racing" || this.phase === "round_over" ? this.inputFor(car, dt) : { steer: 0, throttle: 0 };
    // The winner of a round coasts; everyone else has stopped mattering.
    const throttle = this.phase === "racing" ? input.throttle : 0;
    const spot = locate(this.track, car.x, car.y, car.hint);
    const beyond = Math.abs(spot.offset) - spot.sample.halfWidth;
    const onVerge = beyond > 0;
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
    const topSpeed = (boosting ? BOOST_SPEED : onVerge ? VERGE_SPEED : MAX_SPEED) * (car.bot && !car.away ? 0.95 : 1);
    if (throttle > 0.05) {
      forward += (boosting ? BOOST_ACCELERATION : ACCELERATION) * throttle * dt;
    } else if (throttle < -0.05) {
      if (forward > 0) forward = Math.max(0, forward + BRAKING * throttle * dt);
      else forward = Math.max(-REVERSE_SPEED, forward + ACCELERATION * 0.6 * throttle * dt);
    } else {
      forward -= Math.sign(forward) * Math.min(Math.abs(forward), ROLLING_DRAG * dt);
    }
    if (boosting) forward = Math.max(forward, BOOST_SPEED * 0.8);
    if (forward > topSpeed) forward -= (forward - topSpeed) * Math.min(1, 3 * dt);

    const grip = slick ? OIL_GRIP : car.dizzy > 0 ? 2 : onVerge ? VERGE_GRIP : ROAD_GRIP;
    lateral *= Math.exp(-grip * dt);

    if (car.dizzy > 0) {
      car.angle += car.spin * dt;
      car.spin *= Math.exp(-1.5 * dt);
    } else {
      const grab = Math.min(1, Math.abs(forward) / 140);
      car.angle += STEER_RATE * input.steer * grab * Math.sign(forward || 1) * dt;
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
        (candidate) => candidate.state === "driving" && candidate.z < AIRBORNE_Z && !candidate.weapon && Math.hypot(candidate.x - crate.x, candidate.y - crate.y) < CAR_RADIUS + CRATE_RADIUS,
      );
      if (!car) continue;
      const rank = order.length > 1 ? order.indexOf(car) / (order.length - 1) : 0;
      car.weapon = this.rollWeapon(Math.max(0, rank));
      car.ammo = AMMO[car.weapon];
      crate.wait = CRATE_RESPAWN_S;
      this.emit({ type: "pickup", car: car.id, weapon: car.weapon });
    }
  }

  // Cars at the back get more to throw forwards; the leader gets more to leave behind.
  rollWeapon(rank: number): WeaponKind {
    return pickWeighted<WeaponKind>(
      [
        ["rocket", 2 + 2 * rank],
        ["mines", 2 + 1.5 * (1 - rank)],
        ["oil", 2 + (1 - rank)],
        ["shockwave", 1 + 2 * rank],
        ["nitro", 1 + 2 * rank],
      ],
      this.random,
    );
  }

  private useWeapon(car: Car): void {
    const wantsFire = car.bot || car.away ? car.brain.fire === true : car.input.fires > car.firesSeen;
    car.firesSeen = car.input.fires;
    car.brain.fire = false;
    if (!wantsFire || car.state !== "driving" || !car.weapon || this.roundTime <= START_GRACE_S) return;
    const weapon = car.weapon;
    this.fire(car, weapon);
    car.ammo -= 1;
    if (car.ammo <= 0) {
      car.weapon = undefined;
      car.ammo = 0;
    }
  }

  fire(car: Car, weapon: WeaponKind): void {
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    this.emit({ type: "fire", car: car.id, weapon });
    if (weapon === "rocket") {
      this.rockets.push({
        id: this.nextId++,
        owner: car.id,
        x: car.x + fx * (CAR_RADIUS + 10),
        y: car.y + fy * (CAR_RADIUS + 10),
        angle: car.angle,
        life: ROCKET_LIFE_S,
        hint: car.hint,
      });
    } else if (weapon === "mines") {
      if (this.mines.length >= MAX_MINES) this.mines.shift();
      this.mines.push({ id: this.nextId++, owner: car.id, x: car.x - fx * (CAR_RADIUS + 14), y: car.y - fy * (CAR_RADIUS + 14), age: 0, hint: car.hint, blow: false });
    } else if (weapon === "oil") {
      this.slicks.push({ id: this.nextId++, x: car.x - fx * (CAR_RADIUS + 40), y: car.y - fy * (CAR_RADIUS + 40), radius: SLICK_RADIUS, life: SLICK_LIFE_S });
    } else if (weapon === "shockwave") {
      this.explode(car.x, car.y, BLASTS.shockwave.radius, BLASTS.shockwave.force, car.id);
    } else {
      car.boostLeft = NITRO_S;
    }
  }

  private moveRockets(dt: number): void {
    const keep: Rocket[] = [];
    for (const rocket of this.rockets) {
      rocket.life -= dt;
      const target = this.rocketTarget(rocket);
      if (target) {
        const wanted = Math.atan2(target.y - rocket.y, target.x - rocket.x);
        const turn = wrapAngle(wanted - rocket.angle);
        rocket.angle += Math.max(-ROCKET_TURN * dt, Math.min(ROCKET_TURN * dt, turn));
      }
      rocket.x += Math.cos(rocket.angle) * ROCKET_SPEED * dt;
      rocket.y += Math.sin(rocket.angle) * ROCKET_SPEED * dt;
      const spot = locate(this.track, rocket.x, rocket.y, rocket.hint);
      rocket.hint = spot.index;
      const hitWall = spot.sample.edge === "wall" && Math.abs(spot.offset) > spot.sample.halfWidth + VERGE_WIDTH;
      const hitCar = this.cars.some(
        (car) => car.id !== rocket.owner && car.state === "driving" && car.ghostLeft <= 0 && car.z < 40 && Math.hypot(car.x - rocket.x, car.y - rocket.y) < CAR_RADIUS + 8,
      );
      if (hitCar || hitWall) {
        this.explode(rocket.x, rocket.y, BLASTS.rocket.radius, BLASTS.rocket.force);
        continue;
      }
      if (rocket.life > 0) keep.push(rocket);
      else this.explode(rocket.x, rocket.y, BLASTS.rocket.radius * 0.6, BLASTS.rocket.force * 0.5);
    }
    this.rockets = keep;
  }

  private rocketTarget(rocket: Rocket): Car | undefined {
    let best: Car | undefined;
    let bestScore = Infinity;
    for (const car of this.cars) {
      if (car.id === rocket.owner || car.state !== "driving" || car.ghostLeft > 0) continue;
      const dx = car.x - rocket.x;
      const dy = car.y - rocket.y;
      const distance = Math.hypot(dx, dy);
      if (distance > ROCKET_SEEK_RANGE) continue;
      const off = Math.abs(wrapAngle(Math.atan2(dy, dx) - rocket.angle));
      if (off > Math.PI / 4) continue;
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
      if (this.cars.some((car) => car.state === "driving" && car.ghostLeft <= 0 && Math.hypot(car.x - mine.x, car.y - mine.y) < CAR_RADIUS + 12)) {
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

  private updateCamera(dt: number, snap: boolean): void {
    const field = this.standings().filter((car) => car.state === "driving" || car.state === "falling");
    const leader = field[0];
    if (!leader) return;
    const zoom =
      this.phase === "racing"
        ? Math.max(MIN_ZOOM, 1 - Math.max(0, this.roundTime - SHRINK_AFTER_S) * SHRINK_RATE)
        : this.phase === "countdown"
          ? 1
          : this.view.width / VIEW_WIDTH;
    const width = VIEW_WIDTH * zoom;
    const height = VIEW_HEIGHT * zoom;
    const leaderSpeed = Math.min(1, Math.hypot(leader.vx, leader.vy) / MAX_SPEED);
    const ahead = pointAt(this.track, leader.lapS + CAMERA_LEAD * leaderSpeed);
    const packX = field.reduce((sum, car) => sum + car.x, 0) / field.length;
    const packY = field.reduce((sum, car) => sum + car.y, 0) / field.length;
    const targetX = ahead.x * 0.6 + packX * 0.4;
    const targetY = ahead.y * 0.6 + packY * 0.4;
    const follow = snap ? 1 : 1 - Math.exp(-CAMERA_FOLLOW * dt);
    let x = this.view.x + (targetX - this.view.x) * follow;
    let y = this.view.y + (targetY - this.view.y) * follow;
    const roomX = Math.max(0, width / 2 - LEADER_MARGIN * zoom);
    const roomY = Math.max(0, height / 2 - LEADER_MARGIN * zoom);
    x = Math.max(leader.x - roomX, Math.min(leader.x + roomX, x));
    y = Math.max(leader.y - roomY, Math.min(leader.y + roomY, y));
    this.view = { x, y, width, height };
  }

  private checkScreen(dt: number): void {
    if (this.roundTime <= START_GRACE_S) return;
    const halfWidth = this.view.width / 2 + CAR_RADIUS;
    const halfHeight = this.view.height / 2 + CAR_RADIUS;
    for (const car of this.cars) {
      if (car.state !== "driving") continue;
      const off = Math.abs(car.x - this.view.x) > halfWidth || Math.abs(car.y - this.view.y) > halfHeight;
      car.offscreenFor = off ? car.offscreenFor + dt : 0;
      if (car.offscreenFor > OFFSCREEN_GRACE_S) this.knockOut(car);
    }
  }

  private knockOut(car: Car): void {
    car.state = "out";
    car.weapon = undefined;
    car.ammo = 0;
    this.outOrder.push(car.id);
    this.emit({ type: "out", car: car.id, x: Math.round(car.x), y: Math.round(car.y) });
  }

  private endRound(winnerId: string | undefined): void {
    this.roundWinner = winnerId;
    const winner = winnerId ? this.car(winnerId) : undefined;
    if (winner) winner.points += 1;
    // The first one off the screen drops a point, as long as there was a crowd to lose to.
    const firstOut = this.car(this.outOrder[0] ?? "");
    if (firstOut && firstOut !== winner && this.cars.length >= 3) firstOut.points = Math.max(0, firstOut.points - 1);
    this.emit({ type: "round", winner: winnerId });
    if (winner && winner.points >= this.target) {
      this.matchWinner = winner.id;
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
