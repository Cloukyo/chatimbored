import assert from "node:assert/strict";
import test from "node:test";
import { MANSION_ROOMS, NIGHT_POINTS } from "../../../shared/party/night.js";
import { CrowdMatch } from "../crowd/CrowdMatch.js";
import { actNaturalRules, silentWitnessRules } from "../crowd/modes.js";
import { seededRandom } from "../crowd/random.js";
import { setCrowdRandomForTests } from "../minigames/CrowdGames.js";
import { RoomManager } from "../rooms/RoomManager.js";
import { PartyNight } from "./PartyNight.js";
import { scoreCrowdRound } from "./scoring.js";

let seed = 100;
setCrowdRandomForTests(() => seededRandom(seed++));

function shoot(match: CrowdMatch, shooterId: string, targetId: string): void {
  const target = match.slots.get(targetId)!.entity;
  match.queueInput(shooterId, { kind: "crowd", seq: 1, move: { x: 0, y: 0 }, run: false, act: false, shoot: { x: target.x, y: target.y } });
  match.step();
}

test("a takedown in a free-for-all round scores, and the winner claims the room", () => {
  const match = new CrowdMatch({ ...actNaturalRules, npcCount: 0 }, ["a", "b", "c"], seededRandom(1));
  shoot(match, "a", "b");
  assert.deepEqual(match.slots.get("a")!.takedowns, ["b"]);
  match.slots.get("a")!.entity.x = 1000;
  match.slots.get("c")!.entity.x = 100;
  match.timeout();

  const score = scoreCrowdRound(match);
  assert.equal(score.points.get("a"), NIGHT_POINTS.soloWin + NIGHT_POINTS.takedown + NIGHT_POINTS.survive);
  assert.equal(score.points.get("b"), 0);
  assert.equal(score.points.get("c"), NIGHT_POINTS.survive);
  assert.equal(score.claimant, "a");
});

test("shooting your own side doesn't score, and a tied team win goes to one of the tied", () => {
  const ids = ["a", "b", "c", "d"];
  const match = new CrowdMatch({ ...silentWitnessRules, npcCount: 0 }, ids, seededRandom(2));
  const hunters = ids.filter((id) => match.slots.get(id)!.role === "hunter");
  shoot(match, hunters[0], hunters[1]);
  assert.equal(match.result, undefined);
  match.timeout();

  const score = scoreCrowdRound(match);
  assert.equal(score.points.get(hunters[0]), NIGHT_POINTS.teamWin + NIGHT_POINTS.survive);
  assert.equal(score.points.get(hunters[1]), NIGHT_POINTS.teamWin);
  assert.equal(score.points.get(hunters[2]), NIGHT_POINTS.teamWin + NIGHT_POINTS.survive);
  assert.ok(score.claimant === hunters[0] || score.claimant === hunters[2]);
});

test("last place picks from three unplayed rooms", () => {
  const night = new PartyNight(["a", "b", "c"], 6, false, seededRandom(3));
  assert.equal(night.options.length, 3);
  night.pick(night.options[0]);
  night.recordRound({ points: new Map([["a", 5], ["b", 0], ["c", 2]]), claimant: "a" });
  assert.equal(night.pickerId, "b");
  assert.equal(night.options.length, 3);
  assert.ok(night.options.every((key) => !night.played.includes(key)));
  assert.throws(() => night.pick(night.played[0]));
});

test("a shared screen leaves out rooms that need secret words", () => {
  const night = new PartyNight(["a", "b"], 8, true, seededRandom(4));
  const keys = new Set<string>();
  while (!night.over) {
    night.options.forEach((key) => keys.add(key));
    night.pick(night.options[0]);
    night.skipRound();
  }
  assert.equal(night.totalRounds, 8);
  for (const room of MANSION_ROOMS) assert.equal(keys.has(room.key), !room.needsPrivateText, room.key);
});

test("final standings add claimed rooms and connected pairs", () => {
  const night = new PartyNight(["a", "b"], 4, false, seededRandom(5));
  night.points.set("a", 10);
  night.points.set("b", 12);
  night.claims.set("grand_hall", "a");
  night.claims.set("garden", "a");
  night.claims.set("vault", "a");
  night.claims.set("library", "b");
  const [first, second] = night.standings();
  assert.deepEqual(first, { playerId: "a", points: 10, rooms: 3, connectedPairs: 2, total: 10 + 3 * 2 + 2 });
  assert.equal(second.total, 12 + 2);
});

test("a night runs from the lobby through every round to the final standings", () => {
  const manager = new RoomManager(seededRandom(6));
  const { room, player: host } = manager.createRoom("Host");
  const { player: guest } = manager.joinRoom(room.code, "Guest");
  const finished = () => manager.finishGame(room);

  assert.throws(() => manager.handleRoomMessage(host.id, { type: "START_NIGHT", rounds: 4, sharedScreen: false }, finished));
  manager.handleRoomMessage(guest.id, { type: "PLAYER_READY", isReady: true }, finished);
  manager.handleRoomMessage(host.id, { type: "START_NIGHT", rounds: 4, sharedScreen: false }, finished);
  assert.equal(room.phase, "board");

  for (let round = 1; round <= 4; round += 1) {
    const night = room.night!;
    const outsider = night.pickerId === host.id ? undefined : host.id;
    const picker = night.pickerId!;
    if (!outsider && picker !== guest.id) {
      assert.throws(() => manager.handleRoomMessage(guest.id, { type: "PICK_ROOM", roomKey: night.options[0] }, finished));
    }
    manager.handleRoomMessage(picker, { type: "PICK_ROOM", roomKey: night.options[0] }, finished);
    assert.equal(room.phase, "in_game");
    manager.finishGame(room);
    assert.equal(room.phase, "results");
    assert.equal(room.snapshot().night!.roundsPlayed, round);
    manager.handleRoomMessage(host.id, { type: "NEXT_ROUND" }, finished);
  }

  assert.equal(room.phase, "night_over");
  assert.equal(room.snapshot().night!.standings!.length, 2);
  manager.handleRoomMessage(host.id, { type: "RETURN_TO_LOBBY" }, finished);
  assert.equal(room.phase, "lobby");
  assert.equal(room.night, undefined);
});

test("a picker who leaves hands the pick to whoever is now last", () => {
  const night = new PartyNight(["a", "b", "c"], 4, false, seededRandom(7));
  const leaving = night.pickerId!;
  night.removePlayer(leaving);
  assert.ok(night.pickerId && night.pickerId !== leaving);
});
