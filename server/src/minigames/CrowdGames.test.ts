import assert from "node:assert/strict";
import test from "node:test";
import { CROWD_RUN_SPEED, CROWD_TICK_SECONDS, CROWD_WALK_SPEED, stepPosition } from "../../../shared/crowd/movement.js";
import type { CrowdInput, CrowdView } from "../../../shared/crowd/protocol.js";
import type { CrowdMatch } from "../crowd/CrowdMatch.js";
import {
  ACT_NATURAL_EXIT_X,
  HEIST_GOAL,
  LANTERN_GOAL,
  LOOKOUT_ARROWS,
  MARKED_GOAL,
  CLOSING_DARK_LIMIT_MS,
  CLOSING_END_RADIUS,
  FREEZE_GAP_MS,
  PARCEL_FUSE_MS,
  SILENT_WITNESS_KILL_TARGET,
  closingZone,
  freezeState,
  markedState,
  parcelState,
} from "../crowd/modes.js";
import { seededRandom } from "../crowd/random.js";
import { Room } from "../rooms/Room.js";
import {
  crowdActNatural,
  crowdBellRingers,
  crowdClosingTime,
  crowdFreezeFrame,
  crowdHeistHour,
  crowdHotParcel,
  crowdLanternFestival,
  crowdMarked,
  crowdMatchFor,
  crowdSilentWitness,
  setCrowdRandomForTests,
} from "./CrowdGames.js";
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

// Parks every NPC in a far corner so they can't get in the way.
function clearCrowd(match: CrowdMatch, x = 30, y = 690): void {
  match.entities.filter((entity) => entity.brain).forEach((npc) => {
    npc.x = x;
    npc.y = y;
    npc.direction = { x: 0, y: 0 };
    npc.brain!.timerMs = 1e9;
  });
}

function standAt(match: CrowdMatch, playerId: string, spot: { x: number; y: number }): void {
  const entity = entityOf(match, playerId);
  entity.x = spot.x;
  entity.y = spot.y + 10;
  match.slots.get(playerId)!.actCooldownMs = 0;
}

test("Lantern Festival: lighting every lantern wins, and each one flares for everyone", () => {
  const { room, match } = start(crowdLanternFestival, 3);
  clearCrowd(match);
  assert.equal(match.props.length, LANTERN_GOAL);
  for (const lantern of match.props) {
    standAt(match, "p1", lantern);
    send(crowdLanternFestival, room, "p1", { act: true });
    assert.ok(view(crowdLanternFestival, room, "p2").events.some((event) => event.type === "flare" && event.prop === lantern.id));
  }
  assert.equal(view(crowdLanternFestival, room, "p1").hud.progress, LANTERN_GOAL);
  assert.equal(view(crowdLanternFestival, room, "p2").mine.length, 0);
  assert.equal(room.game!.winnerId, "p1");
});

test("Lantern Festival: a strike takes down whoever is in reach, and the last one standing wins", () => {
  const { room, match } = start(crowdLanternFestival, 2);
  clearCrowd(match);
  standAt(match, "p1", { x: 640, y: 300 });
  standAt(match, "p2", { x: 660, y: 300 });
  send(crowdLanternFestival, room, "p1", { act: true });
  assert.equal(entityOf(match, "p2").dead, true);
  assert.equal(room.game!.winnerId, "p1");
});

test("Bell Ringers: Lookouts aren't in the crowd and shoot where they click", () => {
  const { room, match } = start(crowdBellRingers, 3);
  const ringer = [...match.slots.values()].find((slot) => slot.role === "ringer")!;
  const lookout = [...match.slots.values()].find((slot) => slot.role === "lookout")!;
  const lookoutView = view(crowdBellRingers, room, lookout.playerId);
  assert.equal(lookoutView.you, 0);
  assert.equal(lookoutView.shots, LOOKOUT_ARROWS);
  assert.equal(lookoutView.e.length, (match.entities.length - 2) * 5);

  clearCrowd(match);
  ringer.entity.x = 600;
  ringer.entity.y = 400;
  send(crowdBellRingers, room, lookout.playerId, { shoot: { x: 603, y: 409 } });
  assert.equal(ringer.entity.dead, true);
  assert.equal(room.game!.winnerId, "lookouts");
  crowdBellRingers.finish(room);
  assert.equal(room.players.find((player) => player.id === lookout.playerId)!.score, 1);
  assert.equal(room.players.find((player) => player.id === ringer.playerId)!.score, 0);
});

test("Bell Ringers: ringing every bell wins it for the Ringers", () => {
  const { room, match } = start(crowdBellRingers, 4);
  clearCrowd(match);
  const ringers = [...match.slots.values()].filter((slot) => slot.role === "ringer");
  assert.equal(ringers.length, 2);
  match.props.forEach((bell, index) => {
    const ringer = ringers[index % 2];
    standAt(match, ringer.playerId, bell);
    send(crowdBellRingers, room, ringer.playerId, { act: true });
    assert.equal(bell.on, true);
  });
  assert.equal(room.game!.winnerId, "ringers");
});

test("Bell Ringers: Lookouts out of arrows hand the round to the Ringers", () => {
  const { room, match } = start(crowdBellRingers, 2);
  clearCrowd(match);
  const lookout = [...match.slots.values()].find((slot) => slot.role === "lookout")!;
  for (let arrow = 0; arrow < LOOKOUT_ARROWS; arrow += 1) send(crowdBellRingers, room, lookout.playerId, { shoot: { x: 900, y: 100 } });
  assert.equal(room.game!.winnerId, "ringers");
});

test("Heist Hour: three different vaults win, and a cracked vault stays alarmed for a while", () => {
  const { room, match } = start(crowdHeistHour, 3);
  clearCrowd(match);
  const [first, second, third] = match.props;
  standAt(match, "p1", first);
  send(crowdHeistHour, room, "p1", { act: true });
  assert.equal(first.on, true);

  standAt(match, "p2", first);
  send(crowdHeistHour, room, "p2", { act: true });
  assert.equal(view(crowdHeistHour, room, "p2").hud.progress, 0);

  for (const vault of [second, third]) {
    standAt(match, "p1", vault);
    send(crowdHeistHour, room, "p1", { act: true });
  }
  assert.equal(view(crowdHeistHour, room, "p1").hud.progress, HEIST_GOAL);
  assert.equal(room.game!.winnerId, "p1");
});

test("Heist Hour: alarms reset after a few seconds", () => {
  const { room, match } = start(crowdHeistHour, 2);
  clearCrowd(match);
  const vault = match.props[0];
  standAt(match, "p1", vault);
  send(crowdHeistHour, room, "p1", { act: true });
  for (let tick = 0; tick < 120; tick += 1) crowdHeistHour.update!(room, 50);
  assert.equal(vault.on, false);
});

test("Marked: striking your mark scores and hands you their mark", () => {
  const { room, match } = start(crowdMarked, 4);
  clearCrowd(match);
  const state = markedState(match);
  const mark = state.targets.get("p1")!;
  const next = state.targets.get(mark)!;
  standAt(match, "p1", { x: 640, y: 300 });
  standAt(match, mark, { x: 660, y: 300 });
  send(crowdMarked, room, "p1", { act: true });
  assert.equal(entityOf(match, mark).dead, true);
  const mine = view(crowdMarked, room, "p1");
  assert.equal(mine.hud.progress, 1);
  assert.equal(mine.hud.markName, next);
  assert.equal(entityOf(match, "p1").stunMs, 0);
});

test("Marked: striking the wrong person leaves you stunned in plain view", () => {
  const { room, match } = start(crowdMarked, 3);
  clearCrowd(match);
  const npc = match.entities.find((entity) => entity.brain)!;
  standAt(match, "p1", { x: 640, y: 300 });
  npc.x = 660;
  npc.y = 310;
  send(crowdMarked, room, "p1", { act: true });
  assert.equal(npc.dead, true);
  assert.ok(entityOf(match, "p1").stunMs > 0);
  const packed = view(crowdMarked, room, "p2").e;
  const index = packed.findIndex((value, at) => at % 5 === 0 && value === entityOf(match, "p1").id);
  assert.equal(packed[index + 4], 5);
});

test("Marked: everyone gets a rough hint of where their mark is", () => {
  const { room, match } = start(crowdMarked, 3);
  crowdMarked.update!(room, 50);
  for (const playerId of ["p1", "p2", "p3"]) {
    const mine = view(crowdMarked, room, playerId);
    const target = entityOf(match, mine.hud.markName!);
    assert.ok(mine.hud.hint);
    assert.ok(Math.abs(mine.hud.hint!.x - target.x) <= 75);
  }
  assert.equal(MARKED_GOAL, 3);
});

test("Freeze Frame: the whole crowd stops together, then starts again", () => {
  const { room, match } = start(crowdFreezeFrame, 2);
  const npcs = match.entities.filter((entity) => entity.brain);
  let ticks = 0;
  while (freezeState(match).frozenMs === 0 && ticks < FREEZE_GAP_MS[1] / 50 + 5) {
    crowdFreezeFrame.update!(room, 50);
    ticks += 1;
  }
  assert.ok(freezeState(match).frozenMs > 0);
  crowdFreezeFrame.update!(room, 50);
  assert.ok(npcs.every((npc) => npc.direction.x === 0 && npc.direction.y === 0));
  const before = npcs.map((npc) => [npc.x, npc.y]);
  crowdFreezeFrame.update!(room, 50);
  assert.deepEqual(npcs.map((npc) => [npc.x, npc.y]), before);

  for (let tick = 0; tick < 120; tick += 1) crowdFreezeFrame.update!(room, 50);
  assert.ok(npcs.some((npc) => npc.direction.x !== 0 || npc.direction.y !== 0));
});

test("Freeze Frame: players aren't frozen, and the exit still wins", () => {
  const { room, match } = start(crowdFreezeFrame, 2);
  freezeState(match).untilFreezeMs = 0;
  const entity = entityOf(match, "p1");
  entity.x = ACT_NATURAL_EXIT_X - 2;
  send(crowdFreezeFrame, room, "p1", { move: { x: 1, y: 0 } });
  assert.ok(freezeState(match).frozenMs > 0);
  assert.equal(room.game!.winnerId, "p1");
});

test("Hot Parcel: only the holder knows, and bumping a player passes it on", () => {
  const { room, match } = start(crowdHotParcel, 3);
  clearCrowd(match);
  crowdHotParcel.update!(room, 50);
  const state = parcelState(match);
  const holder = state.holder!;
  const other = ["p1", "p2", "p3"].find((id) => id !== holder)!;
  assert.equal(view(crowdHotParcel, room, holder).hud.holding, true);
  assert.equal(view(crowdHotParcel, room, other).hud.holding, false);
  assert.equal(view(crowdHotParcel, room, other).hud.fuseSeconds, undefined);

  standAt(match, holder, { x: 640, y: 300 });
  standAt(match, other, { x: 660, y: 300 });
  send(crowdHotParcel, room, holder, { act: true });
  assert.equal(state.holder, other);
  assert.ok(view(crowdHotParcel, room, "p1").events.some((event) => event.type === "bump"));

  // No handing it straight back.
  match.slots.get(other)!.actCooldownMs = 0;
  send(crowdHotParcel, room, other, { act: true });
  assert.equal(state.holder, other);
});

test("Hot Parcel: bumping an NPC wastes the move", () => {
  const { room, match } = start(crowdHotParcel, 2);
  clearCrowd(match);
  crowdHotParcel.update!(room, 50);
  const state = parcelState(match);
  const holder = state.holder!;
  const npc = match.entities.find((entity) => entity.brain)!;
  standAt(match, holder, { x: 640, y: 300 });
  npc.x = 660;
  npc.y = 300;
  send(crowdHotParcel, room, holder, { act: true });
  assert.equal(state.holder, holder);
  assert.equal(npc.dead, false);
});

test("Hot Parcel: when the fuse runs out the holder is out, and the last one standing wins", () => {
  const { room, match } = start(crowdHotParcel, 2);
  crowdHotParcel.update!(room, 50);
  const holder = parcelState(match).holder!;
  for (let tick = 0; tick < PARCEL_FUSE_MS[1] / 50 + 2 && !room.game!.winnerId; tick += 1) crowdHotParcel.update!(room, 50);
  assert.equal(entityOf(match, holder).dead, true);
  assert.equal(room.game!.winnerId, holder === "p1" ? "p2" : "p1");
});

test("Closing Time: the light shrinks, and lingering in the dark gets you caught", () => {
  const { room, match } = start(crowdClosingTime, 3);
  const zone = closingZone(match);
  assert.ok(zone.r > 700);
  match.tick = 1700;
  assert.equal(closingZone(match).r, CLOSING_END_RADIUS);
  match.tick = 600;

  const now = closingZone(match);
  const outsider = entityOf(match, "p1");
  outsider.x = now.x > 640 ? 30 : 1250;
  outsider.y = 690;
  standAt(match, "p2", { x: now.x, y: now.y });
  standAt(match, "p3", { x: now.x + 10, y: now.y });
  for (let tick = 0; tick < CLOSING_DARK_LIMIT_MS / 50 - 1; tick += 1) crowdClosingTime.update!(room, 50);
  assert.equal(outsider.dead, false);
  assert.ok(view(crowdClosingTime, room, "p1").hud.darkMs! > 0);
  crowdClosingTime.update!(room, 50);
  assert.equal(outsider.dead, true);
  assert.ok(view(crowdClosingTime, room, "p2").zone);
});
