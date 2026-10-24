import assert from "node:assert/strict";
import test from "node:test";
import { fromScreenSpace, insideBy } from "../../../shared/race/camera.js";
import { trackById, locate, pointAt, TRACKS } from "../../../shared/race/track.js";
import { parseClientMessage } from "../messages/validation.js";
import { seededRandom } from "../crowd/random.js";
import { pileUp, raceMatchFor, setRaceRandomForTests } from "../minigames/PileUp.js";
import { Room } from "../rooms/Room.js";
import { COUNTDOWN_MS, GRID_SIZE, RaceMatch, ROUND_OVER_MS, START_GRACE_S, WARN_S, type Car } from "./RaceMatch.js";

const DT = 0.05;

function race(people = 2, seed = 7): RaceMatch {
  const entrants = Array.from({ length: people }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}` }));
  return new RaceMatch(entrants, seededRandom(seed), "quarry");
}

function run(match: RaceMatch, seconds: number, each?: () => void): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
    each?.();
    match.step(DT);
  }
}

function toGreenLight(match: RaceMatch): void {
  run(match, COUNTDOWN_MS / 1000 + DT);
  assert.equal(match.phase, "racing");
}

// Past the start, when weapons and knockouts are live.
function racing(match: RaceMatch): void {
  toGreenLight(match);
  run(match, START_GRACE_S + DT);
}

// Parks a car far behind the screen, and keeps it there when called again.
const stranded = new Map<Car, { x: number; y: number; index: number }>();
function strand(car: Car, match: RaceMatch): void {
  let spot = stranded.get(car);
  if (!spot || car.state !== "driving") {
    spot = pointAt(match.track, car.lapS - 3000);
    stranded.set(car, spot);
  }
  Object.assign(car, { x: spot.x, y: spot.y, vx: 0, vy: 0, hint: spot.index });
}

// Puts a car at a distance along the track, facing up the road, stopped.
function place(car: Car, match: RaceMatch, s: number, across = 0): void {
  const spot = pointAt(match.track, s);
  Object.assign(car, { x: spot.x - spot.ty * across, y: spot.y + spot.tx * across, vx: 0, vy: 0, angle: Math.atan2(spot.ty, spot.tx), hint: spot.index });
}

function knockOutInOrder(match: RaceMatch, cars: Car[]): void {
  for (const car of cars) {
    strand(car, match);
    run(match, WARN_S + 0.2, () => strand(car, match));
    assert.equal(car.state, "out");
  }
}

test("every track's centre line can be found again from its own samples", () => {
  for (const def of TRACKS) {
    const track = trackById(def.id);
    for (const sample of track.samples.filter((_, index) => index % 37 === 0)) {
      const spot = locate(track, sample.x, sample.y);
      assert.ok(Math.abs(spot.offset) < 1, `${def.id} offset ${spot.offset}`);
      const back = pointAt(track, spot.s);
      assert.ok(Math.hypot(back.x - sample.x, back.y - sample.y) < 2);
    }
  }
});

test("bots fill the grid and nobody moves before the lights go green", () => {
  const match = race(2);
  assert.equal(match.cars.length, GRID_SIZE);
  assert.deepEqual(match.cars.map((car) => car.bot), [false, false, true, true]);
  const start = match.cars.map((car) => [car.x, car.y]);
  match.setInput("p1", { kind: "race", steer: 0, throttle: 1, fires: 0 });
  run(match, 2);
  assert.equal(match.phase, "countdown");
  assert.deepEqual(match.cars.map((car) => [car.x, car.y]), start);
});

test("hitting the gas right at the end of the countdown gives a turbo start; revving early stalls", () => {
  const match = race(2);
  const [quick, eager] = match.cars;
  match.setInput(eager.id, { kind: "race", steer: 0, throttle: 1, fires: 0 });
  run(match, COUNTDOWN_MS / 1000 - 0.3);
  match.setInput(quick.id, { kind: "race", steer: 0, throttle: 1, fires: 0 });
  run(match, 0.4);
  assert.equal(match.phase, "racing");
  assert.ok(quick.boostLeft > 0, "turbo");
  assert.ok(eager.stallLeft > 0, "stalled");
  run(match, 0.5);
  assert.ok(quick.progress - eager.progress > 100);
});

test("throttle drives a car up the road", () => {
  const match = race(2);
  const car = match.car("p1")!;
  toGreenLight(match);
  const before = car.progress;
  match.setInput("p1", { kind: "race", steer: 0, throttle: 1, fires: 0 });
  run(match, 1.5);
  assert.ok(car.progress - before > 200, `moved ${car.progress - before}`);
});

test("a car off the screen gets two seconds to get back before it blows up", () => {
  const match = race(4);
  racing(match);
  const car = match.cars[0];
  strand(car, match);
  run(match, WARN_S - 0.5, () => strand(car, match));
  assert.equal(car.state, "driving");
  assert.ok(car.warnLeft > 0);
  // Back on screen in time: the warning clears.
  place(car, match, match.cars[1].lapS);
  match.step(DT);
  assert.equal(car.warnLeft, 0);
  stranded.delete(car);
  strand(car, match);
  run(match, WARN_S + 0.2, () => strand(car, match));
  assert.equal(car.state, "out");
});

test("Mashed scoring: two for the last car left, one for the last one out, minus one for the first out", () => {
  const match = race(4);
  match.cars[0].points = 3;
  racing(match);
  const [first, , second, winner] = match.cars;
  knockOutInOrder(match, [first, match.cars[1], second]);
  assert.equal(match.phase, "round_over");
  assert.equal(match.roundWinner, winner.id);
  assert.equal(winner.points, 2);
  assert.equal(second.points, 1);
  assert.equal(first.points, 2);
  assert.equal(match.cars[1].points, 0);
});

test("the next round lines everyone back up where the winner stopped", () => {
  const match = race(4);
  racing(match);
  knockOutInOrder(match, match.cars.slice(0, 3));
  const winner = match.cars[3];
  run(match, ROUND_OVER_MS / 1000 + DT);
  assert.equal(match.phase, "countdown");
  assert.equal(match.round, 2);
  assert.ok(match.cars.every((car) => car.state === "driving"));
  assert.equal(match.standings()[0], winner);
  assert.ok(match.cars.every((car) => Math.hypot(car.x - winner.x, car.y - winner.y) < 300));
});

test("a homing missile locks on to the car in front and blows it into the air", () => {
  const match = race(2);
  racing(match);
  const [shooter, target] = match.cars;
  match.cars.slice(2).forEach((car) => (car.state = "out"));
  place(shooter, match, shooter.lapS + 2000);
  place(target, match, shooter.lapS + 2250);
  Object.assign(shooter, { weapon: "missile", ammo: 1 });
  match.step(DT);
  assert.equal(shooter.lock, target.id);
  match.setInput(shooter.id, { kind: "race", steer: 0, throttle: 0, fires: 1 });
  run(match, 0.6);
  assert.equal(shooter.weapon, undefined);
  assert.ok(target.z > 0 || target.dizzy > 0, "target was launched");
});

test("the shotgun fires out of both sides and launches whoever is alongside", () => {
  const match = race(3);
  racing(match);
  const [shooter, left, right] = match.cars;
  match.cars.slice(3).forEach((car) => (car.state = "out"));
  const s = shooter.lapS + 2000;
  place(shooter, match, s, 0);
  place(left, match, s, -60);
  place(right, match, s, 60);
  Object.assign(shooter, { weapon: "shotgun", ammo: 2 });
  match.setInput(shooter.id, { kind: "race", steer: 0, throttle: 0, fires: 1 });
  match.step(DT);
  assert.equal(shooter.ammo, 1);
  assert.ok(left.vz > 0 && right.vz > 0);
});

test("a fire press counts once however many times the same input arrives", () => {
  const match = race(2);
  racing(match);
  const car = match.car("p1")!;
  car.weapon = "mines";
  car.ammo = 2;
  for (let index = 0; index < 5; index += 1) {
    match.setInput("p1", { kind: "race", steer: 0, throttle: 0, fires: 1 });
    match.step(DT);
  }
  assert.equal(car.ammo, 1);
});

test("a knocked-out player calls in air strikes", () => {
  const match = race(3);
  racing(match);
  const out = match.car("p1")!;
  knockOutInOrder(match, [out]);
  assert.ok(out.strike);
  assert.equal(match.phase, "racing");
  out.strike!.reload = 0;
  const victim = match.cars.find((car) => car.state === "driving")!;
  out.strike!.x = victim.x;
  out.strike!.y = victim.y;
  match.setInput("p1", { kind: "race", steer: 0, throttle: 0, fires: 1 });
  match.step(DT);
  assert.ok(out.strike!.reload > 0, "fired");
  assert.ok(match.viewState().shots.some((shot) => shot.kind === "strike"));
});

test("reaching the target wins the match once the celebration is over", () => {
  setRaceRandomForTests(() => seededRandom(3));
  const room = new Room("RACE1");
  room.addPlayer({ id: "p1", displayName: "Ana", isHost: true, isReady: true, score: 0 });
  room.addPlayer({ id: "p2", displayName: "Ben", isHost: false, isReady: true, score: 0 });
  room.gameOptions = { trackId: "harbour" };
  room.game = pileUp.setup(room);
  room.phase = "in_game";
  const match = raceMatchFor(room)!;
  assert.equal(room.game.race?.trackId, "harbour");
  match.car("p2")!.points = match.target - 1;
  const tick = () => pileUp.update!(room, 50);
  for (let index = 0; index < 112; index += 1) tick();
  // p2 sits still, so keep it in the middle of the screen while everyone else is stranded.
  const winner = match.car("p2")!;
  const keep = () => {
    const spot = locate(match.track, match.view.x, match.view.y);
    Object.assign(winner, { x: match.view.x, y: match.view.y, vx: 0, vy: 0, hint: spot.index });
  };
  for (const car of match.cars.filter((other) => other.id !== "p2")) {
    for (let index = 0; index < 50 && car.state !== "out"; index += 1) {
      strand(car, match);
      keep();
      tick();
    }
  }
  assert.equal(match.phase, "match_over");
  assert.equal(room.game.winnerId, undefined);
  for (let index = 0; index < 70; index += 1) tick();
  assert.equal(room.game.winnerId, "p2");
  pileUp.finish(room);
  assert.equal(room.players.find((player) => player.id === "p2")!.score, 1);
});

test("a player who drops out has a bot drive for them, and leaving parks their car", () => {
  const match = race(2);
  toGreenLight(match);
  match.setAway("p1", true);
  const car = match.car("p1")!;
  const before = car.progress;
  run(match, 2);
  assert.ok(car.progress - before > 100);
  match.removeCar("p2");
  assert.equal(match.car("p2")!.state, "out");
});

test("race input is validated and clamped", () => {
  const message = parseClientMessage({ type: "PLAYER_INPUT", input: { kind: "race", steer: 4, throttle: -9, fires: 3 } });
  assert.deepEqual(message, { type: "PLAYER_INPUT", input: { kind: "race", steer: 1, throttle: -1, fires: 3 } });
  assert.throws(() => parseClientMessage({ type: "PLAYER_INPUT", input: { kind: "race", steer: 0, throttle: 0, fires: -1 } }));
  assert.throws(() => parseClientMessage({ type: "START_GAME", minigameId: "pile_up", trackId: 5 }));
});

test("one player can start a race alone against bots", () => {
  const room = new Room("SOLO1");
  room.addPlayer({ id: "p1", displayName: "Ana", isHost: true, isReady: false, score: 0 });
  assert.equal(room.canStart("p1", pileUp), true);
  room.game = pileUp.setup(room);
  const match = raceMatchFor(room)!;
  assert.equal(match.cars.length, GRID_SIZE);
  assert.equal(match.cars.filter((car) => !car.bot).length, 1);
});

test("the camera faces down the road, and the screen is narrower near the camera than far from it", () => {
  const match = race();
  toGreenLight(match);
  const view = match.view;
  const spot = locate(match.track, view.x, view.y);
  const road = Math.atan2(spot.sample.ty, spot.sample.tx);
  assert.ok(Math.abs(Math.atan2(Math.sin(view.angle - road), Math.cos(view.angle - road))) < 0.6);
  // Just inside a far corner is on screen; the same distance across at the near edge is not.
  const far = fromScreenSpace(view, view.width / 2 - 5, view.height / 2 - 5);
  const near = fromScreenSpace(view, view.width / 2 - 5, -view.height / 2 + 5);
  assert.ok(insideBy(view, far.x, far.y) > 0);
  assert.ok(insideBy(view, near.x, near.y) < 0);
});
