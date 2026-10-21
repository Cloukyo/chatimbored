import assert from "node:assert/strict";
import test from "node:test";
import { CROWD_RUN_SPEED, CROWD_TICK_SECONDS, CROWD_WALK_SPEED, stepPosition } from "../../../shared/crowd/movement.js";
import type { CrowdInput, CrowdView } from "../../../shared/crowd/protocol.js";
import type { CrowdMatch } from "../crowd/CrowdMatch.js";
import { ACT_NATURAL_EXIT_X, SILENT_WITNESS_KILL_TARGET } from "../crowd/modes.js";
import { seededRandom } from "../crowd/random.js";
import { Room } from "../rooms/Room.js";
import { crowdActNatural, crowdMatchFor, crowdSilentWitness, setCrowdRandomForTests } from "./CrowdGames.js";
import type { Minigame } from "./Minigame.js";

let seed = 1;
setCrowdRandomForTests(() => seededRandom(seed++));

function makeRoom(playerCount = 3): Room {
  const room = new Room("CRWD1");
  for (let index = 0; index < playerCount; index += 1) {
    room.addPlayer({ id: `p${index + 1}`, displayName: `Player ${index + 1}`, isHost: index === 0, isReady: true, score: 0 });
  }
  return room;
}

function start(minigame: Minigame, playerCount = 3): { room: Room; match: CrowdMatch } {
  const room = makeRoom(playerCount);
  room.game = minigame.setup(room);
  room.selectedMinigameId = minigame.id;
  room.phase = "in_game";
  return { room, match: crowdMatchFor(room)! };
}

function view(minigame: Minigame, room: Room, playerId: string): CrowdView {
  return minigame.snapshotFor!(room, playerId)!.crowd!;
}

const seqs = new Map<string, number>();
function input(playerId: string, overrides: Partial<CrowdInput> = {}): CrowdInput {
  const seq = (seqs.get(playerId) ?? 0) + 1;
  seqs.set(playerId, seq);
  return { kind: "crowd", seq, move: { x: 0, y: 0 }, run: false, act: false, ...overrides };
}

function send(minigame: Minigame, room: Room, playerId: string, overrides: Partial<CrowdInput> = {}): void {
  minigame.handleInput(room, playerId, input(playerId, overrides));
  minigame.update!(room, 50);
}

function entityOf(match: CrowdMatch, playerId: string) {
  return match.slots.get(playerId)!.entity;
}

test("views never say which entities are players or who holds which role", () => {
  const { room, match } = start(crowdSilentWitness, 4);
  for (let tick = 0; tick < 5; tick += 1) crowdSilentWitness.update!(room, 50);

  for (const playerId of ["p1", "p2", "p3", "p4"]) {
    const mine = view(crowdSilentWitness, room, playerId);
    const json = JSON.stringify(mine);
    assert.equal(mine.you, entityOf(match, playerId).id);
    assert.equal(mine.result, undefined);
    for (const other of ["p1", "p2", "p3", "p4"]) assert.ok(!json.includes(other));
    // The only role a player learns is their own.
    const otherRole = mine.role === "killer" ? "hunter" : "killer";
    assert.ok(!json.includes(otherRole));
    assert.equal(mine.e.length, match.entities.length * 5);
    const ids = mine.e.filter((_value, index) => index % 5 === 0);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  }
});

test("the only player ids in a view are the shared score table", () => {
  const { room } = start(crowdActNatural, 3);
  crowdActNatural.update!(room, 50);
  const crowd = JSON.stringify(view(crowdActNatural, room, "p1"));
  assert.ok(!crowd.includes("p2"));
  assert.ok(!crowd.includes("p3"));
});

test("inputs move at full walk speed in 8 directions, even from a light analog push", () => {
  const { room, match } = start(crowdActNatural);
  const entity = entityOf(match, "p1");
  entity.x = 600;
  entity.y = 360;

  send(crowdActNatural, room, "p1", { move: { x: 0.3, y: 0.02 } });
  assert.equal(entity.x, 600 + CROWD_WALK_SPEED * CROWD_TICK_SECONDS);
  assert.equal(entity.y, 360);

  send(crowdActNatural, room, "p1", { move: { x: 1, y: 0 }, run: true });
  assert.equal(entity.x, 600 + (CROWD_WALK_SPEED + CROWD_RUN_SPEED) * CROWD_TICK_SECONDS);
});

test("the server acks inputs so a client can replay its prediction exactly", () => {
  const { room, match } = start(crowdActNatural);
  const entity = entityOf(match, "p1");
  let predicted = { x: entity.x, y: entity.y };
  const moves = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: -1 }, { x: -1, y: 1 }];
  for (const move of moves) {
    send(crowdActNatural, room, "p1", { move });
    predicted = stepPosition(predicted, normalizeLikeServer(move), false, match.arena);
  }
  const mine = view(crowdActNatural, room, "p1");
  assert.equal(mine.ack, seqs.get("p1"));
  assert.deepEqual({ x: entity.x, y: entity.y }, predicted);
});

function normalizeLikeServer(move: { x: number; y: number }) {
  const length = Math.hypot(move.x, move.y);
  return { x: Math.round((move.x / length) * 1e6) / 1e6, y: Math.round((move.y / length) * 1e6) / 1e6 };
}

test("Act Natural: the first player through the exit wins and scores a point", () => {
  const { room, match } = start(crowdActNatural);
  const entity = entityOf(match, "p2");
  entity.x = ACT_NATURAL_EXIT_X - 2;

  send(crowdActNatural, room, "p2", { move: { x: 1, y: 0 } });
  assert.equal(room.game!.winnerId, "p2");

  crowdActNatural.finish(room);
  assert.equal(room.players.find((player) => player.id === "p2")!.score, 1);
  const reveal = view(crowdActNatural, room, "p1").result!.reveal;
  assert.equal(reveal.length, 3);
  assert.equal(reveal.find((entry) => entry.playerId === "p2")!.entity, entity.id);
});

test("Act Natural: one shot each, and a shot player is out", () => {
  const { room, match } = start(crowdActNatural);
  const shooter = entityOf(match, "p1");
  const target = entityOf(match, "p2");
  match.entities.filter((entity) => entity.brain).forEach((npc) => {
    npc.x = 30;
    npc.y = 30;
    npc.brain!.timerMs = 1e9;
  });
  shooter.x = 400;
  shooter.y = 400;
  target.x = 600;
  target.y = 400;

  send(crowdActNatural, room, "p1", { shoot: { x: 700, y: 400 } });
  assert.equal(target.dead, true);
  assert.equal(view(crowdActNatural, room, "p1").shots, 0);
  assert.ok(view(crowdActNatural, room, "p3").events.some((event) => event.type === "shot"));

  const third = entityOf(match, "p3");
  third.x = 650;
  third.y = 400;
  send(crowdActNatural, room, "p1", { shoot: { x: 700, y: 400 } });
  assert.equal(third.dead, false);
});

test("Silent Witness: the Killer changes between rounds", () => {
  const killers = new Set<string>();
  for (let round = 0; round < 20; round += 1) {
    const { match } = start(crowdSilentWitness, 4);
    killers.add([...match.slots.values()].find((slot) => slot.role === "killer")!.playerId);
  }
  assert.ok(killers.size > 1);
});

test("Silent Witness: the Killer's victims sicken, then die, and five deaths win it", () => {
  const { room, match } = start(crowdSilentWitness, 3);
  const killer = [...match.slots.values()].find((slot) => slot.role === "killer")!;
  const npcs = match.entities.filter((entity) => entity.brain);

  for (let kill = 0; kill < SILENT_WITNESS_KILL_TARGET; kill += 1) {
    const victim = npcs[kill];
    victim.x = killer.entity.x + 10;
    victim.y = killer.entity.y;
    victim.brain!.timerMs = 1e9;
    victim.direction = { x: 0, y: 0 };
    killer.actCooldownMs = 0;
    send(crowdSilentWitness, room, killer.playerId, { act: true });
    assert.ok(victim.sickMs > 0);
    for (let tick = 0; tick < 60 && !victim.dead; tick += 1) crowdSilentWitness.update!(room, 50);
    assert.equal(victim.dead, true);
  }
  assert.equal(room.game!.winnerId, killer.playerId);
});

test("Silent Witness: a Hunter who shoots the Killer wins it for the Hunters", () => {
  const { room, match } = start(crowdSilentWitness, 3);
  const killer = [...match.slots.values()].find((slot) => slot.role === "killer")!;
  const hunter = [...match.slots.values()].find((slot) => slot.role === "hunter")!;
  match.entities.filter((entity) => entity.brain).forEach((npc) => {
    npc.x = 30;
    npc.y = 690;
    npc.brain!.timerMs = 1e9;
  });
  hunter.entity.x = 300;
  hunter.entity.y = 300;
  killer.entity.x = 500;
  killer.entity.y = 300;

  send(crowdSilentWitness, room, hunter.playerId, { shoot: { x: 500, y: 300 } });
  assert.equal(room.game!.winnerId, "hunters");
  crowdSilentWitness.finish(room);
  assert.equal(room.players.find((player) => player.id === killer.playerId)!.score, 0);
  assert.equal(room.players.find((player) => player.id === hunter.playerId)!.score, 1);
});

test("Silent Witness: when no Hunter has a shot left, the Killer wins", () => {
  const { room, match } = start(crowdSilentWitness, 2);
  const hunter = [...match.slots.values()].find((slot) => slot.role === "hunter")!;
  hunter.entity.x = 300;
  hunter.entity.y = 300;
  send(crowdSilentWitness, room, hunter.playerId, { shoot: { x: 300, y: 30 } });
  assert.equal(room.game!.winnerId, [...match.slots.values()].find((slot) => slot.role === "killer")!.playerId);
});

test("a player who leaves keeps wandering with the crowd", () => {
  const { room, match } = start(crowdActNatural, 3);
  room.removePlayer("p3");
  crowdActNatural.onPlayerLeft!(room, "p3");
  const entity = entityOf(match, "p3");
  assert.ok(entity.brain);
  assert.equal(room.game!.winnerId, undefined);
});
