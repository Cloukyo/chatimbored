import assert from "node:assert/strict";
import test from "node:test";
import { SILENT_WITNESS_DURATION_MS, SILENT_WITNESS_KILL_TARGET } from "../../../shared/constants/platform.js";
import type { SilentWitnessInput } from "../../../shared/message-types/protocol.js";
import { silentWitness } from "./SilentWitness.js";
import { listMinigames } from "./registry.js";
import { Room } from "../rooms/Room.js";

function makeRoom(playerCount = 3): Room {
  const room = new Room("WATCH");
  for (let index = 0; index < playerCount; index += 1) {
    room.addPlayer({
      id: `p${index + 1}`,
      displayName: `Player ${index + 1}`,
      isHost: index === 0,
      isReady: true,
      score: 0,
    });
  }
  return room;
}

function input(overrides: Partial<SilentWitnessInput> = {}): SilentWitnessInput {
  return {
    movement: { x: 0, y: 0 },
    aim: { x: 1, y: 0 },
    shoot: false,
    kill: false,
    ...overrides,
  };
}

function setupRoom(playerCount = 3): Room {
  const room = makeRoom(playerCount);
  room.game = silentWitness.setup(room);
  return room;
}

function killerId(room: Room): string {
  return room.game!.silentWitness!.killerId;
}

function hunterId(room: Room): string {
  return room.game!.silentWitness!.players.find((player) => player.role === "hunter")!.id;
}

test("setup assigns exactly one Killer and all other players are Hunters", () => {
  const room = setupRoom(4);
  const state = room.game!.silentWitness!;

  assert.equal(room.game!.minigameId, "silent_witness");
  assert.equal(room.game!.name, "Silent Witness");
  assert.ok(room.game!.endsAt - Date.now() <= SILENT_WITNESS_DURATION_MS);
  assert.equal(state.players.filter((player) => player.role === "killer").length, 1);
  assert.equal(state.players.filter((player) => player.role === "hunter").length, 3);
  assert.equal(state.players.find((player) => player.id === state.killerId)?.role, "killer");
});

test("setup spawns an NPC crowd", () => {
  const room = setupRoom();
  const state = room.game!.silentWitness!;

  assert.ok(state.npcs.length >= 40);
  assert.ok(state.npcs.every((npc) => npc.state === "alive"));
});

test("player movement works and tiny movement is ignored", () => {
  const room = setupRoom();
  const player = room.game!.silentWitness!.players[0];
  const start = { x: player.x, y: player.y };

  silentWitness.handleInput(room, player.id, input({ movement: { x: 0.02, y: 0.03 } }));
  silentWitness.update!(room, 1000);
  assert.equal(player.x, start.x);
  assert.equal(player.y, start.y);

  silentWitness.handleInput(room, player.id, input({ movement: { x: 1, y: 0 } }));
  silentWitness.update!(room, 1000);
  assert.ok(player.x > start.x);
});

test("Killer can mark nearby NPC for delayed death", () => {
  const room = setupRoom();
  const state = room.game!.silentWitness!;
  const killer = state.players.find((player) => player.id === killerId(room))!;
  const npc = state.npcs[0];
  npc.x = killer.x + 10;
  npc.y = killer.y;

  silentWitness.handleInput(room, killer.id, input({ kill: true }));

  assert.equal(npc.state, "dying");
  assert.equal(state.publicKillCount, 0);
  assert.equal(state.lastEvent?.type, "kill_marked");
});

test("Killer cannot kill NPC outside range", () => {
  const room = setupRoom();
  const state = room.game!.silentWitness!;
  const killer = state.players.find((player) => player.id === killerId(room))!;
  const npc = state.npcs[0];
  npc.x = killer.x + 300;
  npc.y = killer.y;

  silentWitness.handleInput(room, killer.id, input({ kill: true }));

  assert.equal(npc.state, "alive");
  assert.equal(state.publicKillCount, 0);
});

test("NPC death is delayed before becoming publicly dead", () => {
  const room = setupRoom();
  const state = room.game!.silentWitness!;
  const killer = state.players.find((player) => player.id === killerId(room))!;
  const npc = state.npcs[0];
  npc.x = killer.x + 8;
  npc.y = killer.y;

  silentWitness.handleInput(room, killer.id, input({ kill: true }));
  silentWitness.update!(room, 1000);
  assert.equal(npc.state, "dying");
  assert.equal(state.publicKillCount, 0);

  silentWitness.update!(room, 3000);
  assert.equal(npc.state, "dead");
  assert.equal(state.publicKillCount, 1);
  assert.equal(state.lastEvent?.type, "npc_dead");
});

test("Killer wins after reaching the kill target", () => {
  const room = setupRoom();
  const state = room.game!.silentWitness!;
  const killer = state.players.find((player) => player.id === killerId(room))!;

  for (let index = 0; index < SILENT_WITNESS_KILL_TARGET; index += 1) {
    const npc = state.npcs[index];
    npc.x = killer.x + 8;
    npc.y = killer.y;
    killer.killCooldownMs = 0;
    silentWitness.handleInput(room, killer.id, input({ kill: true }));
    silentWitness.update!(room, 4000);
  }

  assert.equal(room.game!.winnerId, killer.id);
  assert.equal(state.result, "killer");
});

test("Hunter shooting Killer ends round with Hunters win", () => {
  const room = setupRoom();
  const state = room.game!.silentWitness!;
  const hunter = state.players.find((player) => player.id === hunterId(room))!;
  const killer = state.players.find((player) => player.id === killerId(room))!;
  killer.x = hunter.x + 180;
  killer.y = hunter.y;
  state.npcs.forEach((npc, index) => {
    npc.x = 900 + index;
    npc.y = 40;
  });

  silentWitness.handleInput(room, hunter.id, input({ shoot: true, targetPoint: { x: killer.x + 50, y: killer.y } }));

  assert.equal(hunter.shotAvailable, false);
  assert.equal(killer.alive, false);
  assert.equal(room.game!.winnerId, hunter.id);
  assert.equal(state.result, "hunters");
  assert.equal(state.lastShot?.hitType, "killer");
});

test("Hunter shooting NPC wastes shot", () => {
  const room = setupRoom();
  const state = room.game!.silentWitness!;
  const hunter = state.players.find((player) => player.id === hunterId(room))!;
  const npc = state.npcs[0];
  npc.x = hunter.x + 120;
  npc.y = hunter.y;

  silentWitness.handleInput(room, hunter.id, input({ shoot: true, targetPoint: { x: npc.x + 50, y: npc.y } }));

  assert.equal(hunter.shotAvailable, false);
  assert.equal(room.game!.winnerId, undefined);
  assert.equal(state.lastShot?.hitType, "npc");
});

test("timer ending before kill target gives Hunters win", () => {
  const room = setupRoom();

  silentWitness.update!(room, SILENT_WITNESS_DURATION_MS + 1000);

  assert.equal(room.game!.winnerId, "hunters");
  assert.equal(room.game!.silentWitness!.result, "hunters");
});

test("existing minigames still expose their ids with Silent Witness", () => {
  const ids = listMinigames().map((minigame) => minigame.id);

  assert.ok(ids.includes("button_race"));
  assert.ok(ids.includes("act_natural"));
  assert.ok(ids.includes("loot_and_leave"));
  assert.ok(ids.includes("silent_witness"));
});
