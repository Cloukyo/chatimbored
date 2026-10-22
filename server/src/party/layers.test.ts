import assert from "node:assert/strict";
import test from "node:test";
import type { CrowdInput } from "../../../shared/crowd/protocol.js";
import { NIGHT_LAYERS, NIGHT_POINTS, type NightOptions } from "../../../shared/party/night.js";
import { CrowdMatch, type CrowdRules } from "../crowd/CrowdMatch.js";
import { actNaturalRules, silentWitnessRules } from "../crowd/modes.js";
import { seededRandom } from "../crowd/random.js";
import { setCrowdRandomForTests } from "../minigames/CrowdGames.js";
import { getMinigame } from "../minigames/registry.js";
import { RoomManager } from "../rooms/RoomManager.js";
import { MIN_GUESTS, NIGHT_GUESTS, PartyNight } from "./PartyNight.js";
import { SUSPICION } from "./round.js";
import { scoreCrowdRound } from "./scoring.js";

let seed = 500;
setCrowdRandomForTests(() => seededRandom(seed++));

const only = (...keys: Array<keyof NightOptions>) =>
  Object.fromEntries(NIGHT_LAYERS.map((layer) => [layer.key, keys.includes(layer.key)])) as NightOptions;

let seq = 0;
const input = (extra: Partial<CrowdInput> = {}): CrowdInput => ({ kind: "crowd", seq: ++seq, move: { x: 0, y: 0 }, run: false, act: false, ...extra });

// Starts a night round on `rules` the same way CrowdGames does.
function startRound(night: PartyNight, rules: CrowdRules = actNaturalRules): CrowdMatch {
  night.pick(night.offered[0]);
  const round = night.prepareRound(rules);
  const match = new CrowdMatch(round.rules, round.playerIds, seededRandom(seed++), { ghosts: round.ghosts, observer: night.round });
  night.round!.begin(match);
  return match;
}

function shoot(match: CrowdMatch, shooterId: string, targetId: string): void {
  const target = match.slots.get(targetId)!.entity;
  match.queueInput(shooterId, input({ shoot: { x: target.x, y: target.y } }));
  match.step();
}

// Puts two players' figures side by side, away from everyone else.
function pairUp(match: CrowdMatch, a: string, b: string): void {
  for (const entity of match.entities) {
    entity.x = 900;
    entity.y = 600;
  }
  Object.assign(match.slots.get(a)!.entity, { x: 200, y: 200 });
  Object.assign(match.slots.get(b)!.entity, { x: 215, y: 200 });
}

test("a player who goes down steers a ghost NPC, and shots wasted on it pay them tips", () => {
  const night = new PartyNight(["a", "b", "c"], 4, false, seededRandom(1), only("ghosts", "shop"));
  const match = startRound(night, { ...actNaturalRules, npcCount: 6 });
  shoot(match, "a", "b");
  const b = match.slots.get("b")!;
  assert.ok(b.entity.dead);
  const ghost = b.ghost!;
  assert.ok(ghost && !ghost.brain);
  assert.equal(match.viewFor("b")!.you, ghost.id);
  assert.equal(match.viewFor("b")!.ghost, true);

  const before = { x: ghost.x, y: ghost.y };
  for (let tick = 0; tick < 5; tick += 1) {
    match.queueInput("b", input({ move: { x: 1, y: 0 } }));
    match.step();
  }
  assert.ok(ghost.x > before.x);

  match.queueInput("c", input({ shoot: { x: ghost.x, y: ghost.y } }));
  Object.assign(match.slots.get("c")!.entity, { x: ghost.x - 30, y: ghost.y });
  for (const entity of match.entities) if (entity !== ghost && entity !== match.slots.get("c")!.entity) entity.y = 700;
  match.step();
  assert.ok(ghost.dead);
  assert.equal(b.baits, 1);
  assert.ok(b.ghost && b.ghost !== ghost, "gets a fresh NPC");
  assert.equal(match.slots.get("c")!.wastedShots, 1);

  match.timeout();
  night.recordRound(scoreCrowdRound(match), match);
  assert.ok(night.tips.get("b")! >= 1);
});

test("guests who die stay gone, down to a floor", () => {
  const night = new PartyNight(["a", "b"], 6, false, seededRandom(2), only("emptyingParty"));
  const match = startRound(night);
  assert.equal(match.entities.length - match.slots.size, Math.min(actNaturalRules.npcCount, NIGHT_GUESTS));
  const npcs = match.entities.filter((entity) => entity.brain).slice(0, 5);
  for (const npc of npcs) match.kill(npc);
  match.timeout();
  night.recordRound(scoreCrowdRound(match), match);
  assert.equal(night.guests, NIGHT_GUESTS - 5);

  night.guests = 3;
  const next = startRound(night);
  assert.equal(next.entities.length - next.slots.size, MIN_GUESTS);
});

test("the shop sells one perk per player, refunds a swap, and closes when everyone is done", () => {
  const night = new PartyNight(["a", "b"], 4, false, seededRandom(3), only("shop", "suspicion"));
  night.tips.set("a", 4);
  assert.throws(() => night.buy("b", "extra_shot"), /Not enough tips/);
  night.buy("a", "extra_shot");
  assert.equal(night.tips.get("a"), 1);
  night.suspicion.set("a", 40);
  night.buy("a", "clean_slate");
  assert.equal(night.tips.get("a"), 1);
  assert.equal(night.suspicion.get("a"), 0);
  assert.equal(night.finishShopping("a"), false);
  assert.equal(night.finishShopping("b"), true);
  assert.throws(() => night.buy("a", "extra_shot"));

  const shared = new PartyNight(["a", "b"], 4, true, seededRandom(3), only("shop"));
  shared.tips.set("a", 9);
  assert.throws(() => shared.buy("a", "glimpse"), /isn't for sale/);
});

test("an extra shot perk adds a shot next round, only in modes with shots", () => {
  const night = new PartyNight(["a", "b"], 4, false, seededRandom(4), only("shop"));
  night.tips.set("a", 5);
  night.buy("a", "extra_shot");
  const match = startRound(night);
  assert.equal(match.slots.get("a")!.shots, 2);
  assert.equal(match.slots.get("b")!.shots, 1);
});

test("contracts are checked from what the figure does and pay at the end", () => {
  const night = new PartyNight(["a", "b"], 4, false, seededRandom(5), only("contracts"));
  const match = startRound(night, { ...actNaturalRules, npcCount: 2 });
  const view = night.round!.partyView(match, "a", () => "");
  assert.ok(view.contract);
  for (let tick = 0; tick < 300; tick += 1) {
    match.queueInput("a", input());
    match.queueInput("b", input());
    match.step();
    if (match.result) break;
  }
  const stillOne = ["a", "b"].find((id) => night.round!.partyView(match, id, () => "").contract?.startsWith("Stand perfectly still"));
  if (stillOne) assert.equal(night.round!.partyView(match, stillOne, () => "").contractDone, true);
  match.timeout();
  const done = night.round!.outcome(match).contractsDone;
  if (stillOne) assert.ok(done.includes(stillOne));
});

test("a near miss raises suspicion, a clean round lowers it, and suspicious players get a wide berth", () => {
  const night = new PartyNight(["a", "b", "c"], 4, false, seededRandom(6), only("suspicion"));
  night.suspicion.set("c", 30);
  const match = startRound(night, { ...actNaturalRules, npcCount: 0 });
  Object.assign(match.slots.get("a")!.entity, { x: 100, y: 300 });
  Object.assign(match.slots.get("b")!.entity, { x: 400, y: 330 });
  Object.assign(match.slots.get("c")!.entity, { x: 1000, y: 600 });
  match.queueInput("a", input({ shoot: { x: 600, y: 300 } }));
  match.step();
  match.timeout();
  night.recordRound(scoreCrowdRound(match), match);
  assert.equal(night.suspicion.get("b"), SUSPICION.nearMiss);
  assert.equal(night.suspicion.get("c"), 30 + SUSPICION.cleanRound);

  night.suspicion.set("a", 80);
  const next = startRound(night, { ...actNaturalRules, npcCount: 1, npcPlan: () => ({ direction: { x: 0, y: 0 }, durationMs: 1000 }) });
  const npc = next.entities.find((entity) => entity.brain)!;
  Object.assign(next.slots.get("a")!.entity, { x: 500, y: 400 });
  Object.assign(npc, { x: 540, y: 400 });
  let away = 0;
  for (let trial = 0; trial < 40; trial += 1) {
    const plan = next.rules.npcPlan(npc, seededRandom(trial), next.arena, next);
    if (plan.direction.x > 0) away += 1;
  }
  assert.ok(away > 10, `edged away ${away} times`);
});

test("the cursed invite passes on contact and costs whoever ends the round holding it", () => {
  const night = new PartyNight(["a", "b"], 4, false, seededRandom(7), only("invite"));
  night.inviteHolder = "a";
  const match = startRound(night, { ...actNaturalRules, npcCount: 0 });
  pairUp(match, "a", "b");
  match.step();
  assert.equal(night.round!.partyView(match, "b", () => "").holdingInvite, true);
  assert.equal(night.round!.partyView(match, "a", () => "").holdingInvite, undefined);
  match.timeout();
  const pointsBefore = scoreCrowdRound(match).points.get("b")!;
  night.recordRound(scoreCrowdRound(match), match);
  assert.equal(night.inviteHolder, "b");
  assert.equal(night.points.get("b"), pointsBefore - 2);

  // Held again without passing: the penalty grows.
  const next = startRound(night, { ...actNaturalRules, npcCount: 0 });
  next.timeout();
  const base = scoreCrowdRound(next).points.get("b")!;
  const total = night.points.get("b")!;
  night.recordRound(scoreCrowdRound(next), next);
  assert.equal(night.points.get("b"), total + base - 3);
});

test("taking out the Wanted leader pays a bounty, and your nemesis pays double", () => {
  const night = new PartyNight(["a", "b", "c"], 4, false, seededRandom(8), only("wanted", "nemesis"));
  night.points.set("b", 10);
  night.nemesis.set("a", "b");
  const match = startRound(night, { ...actNaturalRules, npcCount: 0 });
  shoot(match, "a", "b");
  match.timeout();
  const outcome = night.round!.outcome(match);
  assert.equal(outcome.bonus.get("a"), NIGHT_POINTS.wantedBounty + NIGHT_POINTS.takedown);
  assert.equal(outcome.nemesis.get("b"), "a");
});

test("with five players one of them hosts, sits out, and scores when a trick precedes a takedown", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const night = new PartyNight(ids, 4, false, seededRandom(9), only("host"));
  const match = startRound(night, { ...actNaturalRules, npcCount: 10 });
  const host = night.hostId!;
  assert.ok(host);
  assert.equal(match.slots.has(host), false);
  assert.equal(match.slots.size, 4);

  const npc = match.entities.find((entity) => entity.brain)!;
  Object.assign(npc, { x: 300, y: 300, direction: { x: 0, y: 0 } });
  night.round!.hostInput(match, input({ act: true, shoot: { x: 300, y: 300 } }));
  assert.equal(night.round!.partyView(match, host, () => "").trick, "conga");
  assert.notDeepEqual(npc.direction, { x: 0, y: 0 });
  assert.equal(night.round!.partyView(match, host, () => "").tricksLeft, 2);

  const [first, second] = [...match.slots.keys()];
  shoot(match, first, second);
  assert.equal(night.round!.outcome(match).bonus.get(host), NIGHT_POINTS.hostTrick);
});

test("the Party Host keeps seeing the round once it's over", () => {
  const manager = new RoomManager(seededRandom(21));
  const { room, player: first } = manager.createRoom("P0");
  const others = [1, 2, 3, 4].map((index) => manager.joinRoom(room.code, `P${index}`).player);
  const finished = () => manager.finishGame(room);
  for (const other of others) manager.handleRoomMessage(other.id, { type: "PLAYER_READY", isReady: true }, finished);
  manager.handleRoomMessage(first.id, { type: "START_NIGHT", rounds: 4, sharedScreen: false, options: only("host") }, finished);
  manager.handleRoomMessage(first.id, { type: "PICK_ROOM", roomKey: room.night!.offered[0] }, finished);
  const hostId = room.night!.hostId!;
  const minigame = getMinigame(room.selectedMinigameId)!;
  assert.equal(minigame.snapshotFor!(room, hostId)!.crowd!.role, "host");
  manager.finishGame(room);
  assert.equal(room.night!.hostId, undefined);
  assert.ok(minigame.snapshotFor!(room, hostId)!.crowd!.result);
});

test("twists stack up after each round", () => {
  const night = new PartyNight(["a", "b"], 4, false, seededRandom(10), only("twists"));
  for (let round = 0; round < 2; round += 1) night.recordRound(scoreCrowdRound(startRound(night)), undefined);
  assert.equal(night.twists.length, 2);
  assert.notEqual(night.twists[0], night.twists[1]);
});

test("the Mole vote pays those who caught them, or the Mole if they got away with it", () => {
  const night = new PartyNight(["a", "b", "c"], 4, false, seededRandom(11), only("mole"));
  const { id: mole, targetId } = night.mole!;
  assert.equal(night.snapshotFor(mole, false).secret?.moleTargetId, targetId);
  assert.equal(night.snapshotFor(targetId, false).secret, undefined);
  const others = ["a", "b", "c"].filter((id) => id !== mole);
  for (const id of others) night.points.set(id, 5);
  night.points.set(targetId, 0);
  night.points.set(mole, 5);
  assert.equal(night.voteMole(others[0], mole), false);
  assert.equal(night.voteMole(others[1], mole), false);
  assert.equal(night.voteMole(mole, others[0]), true);
  night.revealMole();
  assert.equal(night.moleReveal!.caught, true);
  assert.equal(night.points.get(others[0]), (others[0] === targetId ? 0 : 5) + NIGHT_POINTS.moleCaughtVoter);
  assert.equal(night.points.get(mole), 5);
});

test("a full night with every layer runs through the shop, the vote and the Last Dance", () => {
  const manager = new RoomManager(seededRandom(12));
  const { room, player: host } = manager.createRoom("Host");
  const guests = ["G1", "G2"].map((name) => manager.joinRoom(room.code, name).player);
  const finished = () => manager.finishGame(room);
  for (const guest of guests) manager.handleRoomMessage(guest.id, { type: "PLAYER_READY", isReady: true }, finished);
  const all = { ...only(), ...Object.fromEntries(NIGHT_LAYERS.map((layer) => [layer.key, true])) } as NightOptions;
  manager.handleRoomMessage(host.id, { type: "START_NIGHT", rounds: 4, sharedScreen: false, options: all }, finished);
  const ids = [host.id, ...guests.map((guest) => guest.id)];

  for (let round = 1; round <= 4; round += 1) {
    assert.equal(room.phase, "board");
    manager.handleRoomMessage(room.night!.pickerId!, { type: "PICK_ROOM", roomKey: room.night!.offered[0] }, finished);
    manager.finishGame(room);
    manager.handleRoomMessage(host.id, { type: "NEXT_ROUND" }, finished);
    if (round < 4) {
      assert.equal(room.phase, "shop");
      for (const id of ids) manager.handleRoomMessage(id, { type: "NIGHT_ACTION", action: { kind: "done" } }, finished);
    }
  }
  assert.equal(room.night!.twists.length, 3);

  assert.equal(room.phase, "mole_vote");
  const mole = room.night!.mole!.id;
  for (const id of ids) {
    const suspect = id === mole ? ids.find((other) => other !== id)! : mole;
    manager.handleRoomMessage(id, { type: "NIGHT_ACTION", action: { kind: "vote", playerId: suspect } }, finished);
  }
  assert.equal(room.night!.moleReveal!.caught, true);

  assert.equal(room.phase, "finale_pick");
  const finalists = room.night!.finalists!;
  const backer = ids.find((id) => !finalists.includes(id))!;
  manager.handleRoomMessage(backer, { type: "NIGHT_ACTION", action: { kind: "back", playerId: finalists[0] } }, finished);
  assert.equal(room.phase, "in_game");
  assert.equal(room.selectedMinigameId, "crowd_last_dance");

  const game = room.game!;
  manager.finishGame(room);
  assert.equal(room.phase, "results");
  manager.handleRoomMessage(host.id, { type: "NEXT_ROUND" }, finished);
  assert.equal(room.phase, "night_over");
  const night = room.nightFor(host.id)!;
  assert.equal(night.standings!.length, 3);
  assert.ok(night.awards);
  if (night.finaleWinner) assert.equal(night.standings![0].playerId, night.finaleWinner);
  assert.ok(game);
});

test("Last Dance: backers ghost from the start, and hitting the other finalist wins", () => {
  const night = new PartyNight(["a", "b", "c"], 1, false, seededRandom(13), only("finale"));
  night.finalists = ["a", "b"];
  night.backers.set("c", "a");
  night.startFinale();
  const round = night.prepareRound(actNaturalRules);
  const match = new CrowdMatch(round.rules, round.playerIds, seededRandom(14), { ghosts: round.ghosts, observer: night.round });
  night.round!.begin(match);
  assert.equal(match.rules.mode, "last_dance");
  assert.ok(match.slots.get("c")!.ghost);
  assert.ok(match.slots.get("c")!.entity.hidden);
  for (const entity of match.entities) if (entity.brain) entity.y = 700;
  Object.assign(match.slots.get("a")!.entity, { x: 300, y: 300 });
  Object.assign(match.slots.get("b")!.entity, { x: 500, y: 300 });
  shoot(match, "a", "b");
  assert.equal(match.result?.winnerPlayerId, "a");
  night.recordRound(scoreCrowdRound(match), match);
  assert.equal(night.finaleWinner, "a");
  assert.ok(night.points.get("c")! >= NIGHT_POINTS.backedFinalist);
  assert.equal(night.standings()[0].playerId, "a");
});

test("silent witness under a night still credits the right side", () => {
  const night = new PartyNight(["a", "b", "c", "d"], 4, false, seededRandom(15), only("ghosts"));
  const match = startRound(night, { ...silentWitnessRules, npcCount: 4 });
  assert.equal(match.slots.size, 4);
  match.timeout();
  night.recordRound(scoreCrowdRound(match), match);
  assert.equal(night.played.length, 1);
});
