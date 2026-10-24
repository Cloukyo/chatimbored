import assert from "node:assert/strict";
import test from "node:test";
import { trackById, locate, pointAt, TRACKS } from "../../../shared/race/track.js";
import { parseClientMessage } from "../messages/validation.js";
import { seededRandom } from "../crowd/random.js";
import { pileUp, raceMatchFor, setRaceRandomForTests } from "../minigames/PileUp.js";
import { Room } from "../rooms/Room.js";
import { COUNTDOWN_MS, GRID_SIZE, RaceMatch, ROUND_OVER_MS, type Car } from "./RaceMatch.js";

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

// Parks a car far behind the screen so the next check knocks it out.
function strand(car: Car, match: RaceMatch): void {
  const behind = pointAt(match.track, car.lapS - 3000);
  car.x = behind.x;
  car.y = behind.y;
  car.hint = behind.index;
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

test("throttle drives a car up the road", () => {
  const match = race(2);
  const car = match.car("p1")!;
  toGreenLight(match);
  const before = car.progress;
  match.setInput("p1", { kind: "race", steer: 0, throttle: 1, fires: 0 });
  run(match, 1.5);
  assert.ok(car.progress - before > 200, `moved ${car.progress - before}`);
  assert.ok(Math.hypot(car.vx, car.vy) > 250);
});

test("falling off the back of the screen knocks a car out, and the last one left takes the round", () => {
  const match = race(4);
  toGreenLight(match);
  run(match, 2.1);
  const [first, second, third, last] = match.cars;
  for (const car of [first, second, third]) {
    strand(car, match);
    match.step(DT);
    match.step(DT);
    match.step(DT);
    match.step(DT);
    assert.equal(car.state, "out");
  }
  assert.equal(match.phase, "round_over");
  assert.equal(match.roundWinner, last.id);
  assert.equal(last.points, 1);
  assert.deepEqual(match.outOrder, [first.id, second.id, third.id]);
});

test("the first one out loses a point, never going below zero", () => {
  const match = race(4);
  match.cars[0].points = 2;
  toGreenLight(match);
  run(match, 2.1);
  for (const car of match.cars.slice(0, 3)) {
    strand(car, match);
    run(match, 0.2);
  }
  assert.equal(match.cars[0].points, 1);
  assert.equal(match.cars[1].points, 0);
});

test("the next round lines everyone back up where the winner stopped", () => {
  const match = race(4);
  toGreenLight(match);
  run(match, 2.1);
  for (const car of match.cars.slice(0, 3)) {
    strand(car, match);
    run(match, 0.2);
  }
  const winner = match.cars[3];
  run(match, ROUND_OVER_MS / 1000 + DT);
  assert.equal(match.phase, "countdown");
  assert.equal(match.round, 2);
  assert.ok(match.cars.every((car) => car.state === "driving"));
  assert.equal(match.standings()[0], winner);
  assert.ok(match.cars.every((car) => Math.hypot(car.x - winner.x, car.y - winner.y) < 300));
});

test("a rocket blows up the car in front and sends it spinning", () => {
  const match = race(2);
  toGreenLight(match);
  run(match, 2.1);
  const [shooter, target] = match.cars;
  const spot = pointAt(match.track, shooter.lapS + 2000);
  const ahead = pointAt(match.track, shooter.lapS + 2250);
  Object.assign(shooter, { x: spot.x, y: spot.y, vx: 0, vy: 0, angle: Math.atan2(spot.ty, spot.tx), weapon: "rocket", ammo: 2 });
  Object.assign(target, { x: ahead.x, y: ahead.y, vx: 0, vy: 0 });
  shooter.hint = locate(match.track, shooter.x, shooter.y).index;
  target.hint = locate(match.track, target.x, target.y).index;
  match.cars.slice(2).forEach((car) => (car.state = "out"));
  match.setInput(shooter.id, { kind: "race", steer: 0, throttle: 0, fires: 1 });
  run(match, 0.6);
  assert.equal(shooter.ammo, 1);
  assert.ok(target.dizzy > 0 || Math.hypot(target.vx, target.vy) > 150, "target was hit");
});

test("a fire press counts once however many times the same input arrives", () => {
  const match = race(2);
  toGreenLight(match);
  run(match, 2.1);
  const car = match.car("p1")!;
  car.weapon = "mines";
  car.ammo = 3;
  for (let index = 0; index < 5; index += 1) {
    match.setInput("p1", { kind: "race", steer: 0, throttle: 0, fires: 1 });
    match.step(DT);
  }
  assert.equal(car.ammo, 2);
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
  for (let tick = 0; tick < 112; tick += 1) pileUp.update!(room, 50);
  for (const car of match.cars.filter((other) => other.id !== "p2")) {
    strand(car, match);
    pileUp.update!(room, 50);
    pileUp.update!(room, 50);
    pileUp.update!(room, 50);
    pileUp.update!(room, 50);
  }
  assert.equal(match.phase, "match_over");
  assert.equal(room.game.winnerId, undefined);
  for (let tick = 0; tick < 70; tick += 1) pileUp.update!(room, 50);
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
