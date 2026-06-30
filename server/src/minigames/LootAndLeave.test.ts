import assert from "node:assert/strict";
import test from "node:test";
import { lootAndLeave } from "./LootAndLeave.js";
import { buttonRace } from "./ButtonRace.js";
import { actNatural } from "./ActNatural.js";
import { Room } from "../rooms/Room.js";
import type { LootAndLeaveInput, LootAndLeaveState } from "../../../shared/message-types/protocol.js";

function makeRoom(playerCount = 2): Room {
  const room = new Room("CAVE1");
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

function input(overrides: Partial<LootAndLeaveInput> = {}): LootAndLeaveInput {
  return {
    movement: { x: 0, y: 0 },
    ...overrides,
  };
}

function state(room: Room): LootAndLeaveState {
  return room.game!.lootAndLeave!;
}

function tileIndex(cave: LootAndLeaveState["cave"], x: number, y: number): number {
  return y * cave.width + x;
}

function setTile(cave: LootAndLeaveState["cave"], x: number, y: number, tile: number): void {
  cave.tiles[tileIndex(cave, x, y)] = tile;
}

function getTile(cave: LootAndLeaveState["cave"], x: number, y: number): number {
  return cave.tiles[tileIndex(cave, x, y)];
}

function setupRoom(playerCount = 2): Room {
  const room = makeRoom(playerCount);
  room.game = lootAndLeave.setup(room);
  return room;
}

function placePlayerForTest(game: LootAndLeaveState, playerId = "p1", x = 5, y = 5): void {
  const player = game.players.find((candidate) => candidate.id === playerId)!;
  game.slimes = [];
  player.x = x;
  player.y = y;
  player.spawnX = x;
  player.spawnY = y;
  player.alive = true;
  player.escaped = false;
  player.out = false;
  setTile(game.cave, x, y, 0);
}

function advanceMoveCooldown(room: Room): void {
  lootAndLeave.update!(room, 50);
  lootAndLeave.update!(room, 50);
}

test("setup creates a level one cave for two to four players with one slime", () => {
  const room = setupRoom(3);
  const game = state(room);

  assert.equal(lootAndLeave.id, "loot_and_leave");
  assert.equal(lootAndLeave.name, "Loot & Leave");
  assert.equal(game.level, 1);
  assert.equal(game.players.length, 3);
  assert.equal(game.players.every((player) => player.lives === 3), true);
  assert.equal(game.slimes.length, 1);
  assert.equal(game.cave.width, 44);
  assert.equal(game.cave.height, 23);
  assert.ok(game.cave.tiles.length === game.cave.width * game.cave.height);
  assert.ok(game.exitUnlockThreshold > 0);
});

test("players spawn near the middle of the cave", () => {
  const room = setupRoom(4);
  const game = state(room);
  const centerX = Math.floor(game.cave.width / 2);
  const centerY = Math.floor(game.cave.height / 2);

  for (const player of game.players) {
    assert.ok(Math.abs(player.spawnX - centerX) <= 1);
    assert.ok(Math.abs(player.spawnY - centerY) <= 1);
  }
});

test("exit is placed in a random corner instead of a fixed right-side lane", () => {
  const corners = new Set<string>();

  for (let i = 0; i < 30; i += 1) {
    const room = setupRoom();
    const game = state(room);
    const nearLeftOrRight = game.exit.x <= 5 || game.exit.x >= game.cave.width - 6;
    const nearTopOrBottom = game.exit.y <= 5 || game.exit.y >= game.cave.height - 6;
    assert.equal(nearLeftOrRight && nearTopOrBottom, true);
    corners.add(`${game.exit.x < game.cave.width / 2 ? "L" : "R"}${game.exit.y < game.cave.height / 2 ? "T" : "B"}`);
  }

  assert.ok(corners.size > 1);
});

test("later levels increase danger with more rocks and slimes", () => {
  const room = setupRoom();
  const first = state(room);
  const firstRocks = first.cave.tiles.filter((tile) => tile === 3).length;
  const firstSlimes = first.slimes.length;

  first.players.forEach((player) => {
    player.escaped = true;
  });
  lootAndLeave.update!(room, 50);

  const second = state(room);
  const secondRocks = second.cave.tiles.filter((tile) => tile === 3).length;

  assert.equal(second.level, 2);
  assert.ok(secondRocks > firstRocks);
  assert.ok(second.slimes.length > firstSlimes);
});

test("movement enters empty tiles and digging clears dirt with a short cooldown", () => {
  const room = setupRoom();
  const game = state(room);
  placePlayerForTest(game, "p1", 5, 5);
  setTile(game.cave, 6, 5, 0);
  setTile(game.cave, 7, 5, 2);

  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, sequence: 1 }));
  lootAndLeave.update!(room, 50);
  assert.equal(game.players[0].x, 6);

  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, sequence: 2 }));
  advanceMoveCooldown(room);
  lootAndLeave.update!(room, 50);
  assert.equal(game.players[0].x, 7);
  assert.equal(getTile(game.cave, 7, 5), 0);
  assert.equal(game.lastEvent?.type, "dig");

  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, sequence: 3 }));
  lootAndLeave.update!(room, 50);
  assert.equal(game.players[0].x, 7);
});

test("one movement command moves exactly one tile", () => {
  const room = setupRoom();
  const game = state(room);
  placePlayerForTest(game, "p1", 5, 5);
  setTile(game.cave, 6, 5, 0);
  setTile(game.cave, 7, 5, 0);

  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, sequence: 1 }));
  advanceMoveCooldown(room);
  lootAndLeave.update!(room, 50);

  assert.equal(game.players[0].x, 6);
});

test("duplicate movement commands too close together do not move multiple tiles", () => {
  const room = setupRoom();
  const game = state(room);
  placePlayerForTest(game, "p1", 5, 5);
  setTile(game.cave, 6, 5, 0);
  setTile(game.cave, 7, 5, 0);

  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, sequence: 1 }));
  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, sequence: 1 }));
  advanceMoveCooldown(room);
  lootAndLeave.update!(room, 50);

  assert.equal(game.players[0].x, 6);
});

test("repeated valid movement commands move predictably after cooldown", () => {
  const room = setupRoom();
  const game = state(room);
  placePlayerForTest(game, "p1", 5, 5);
  setTile(game.cave, 6, 5, 0);
  setTile(game.cave, 7, 5, 0);
  setTile(game.cave, 8, 5, 0);

  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, sequence: 1 }));
  lootAndLeave.update!(room, 50);
  assert.equal(game.players[0].x, 6);

  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, sequence: 2 }));
  advanceMoveCooldown(room);
  assert.equal(game.players[0].x, 6);

  lootAndLeave.update!(room, 50);
  assert.equal(game.players[0].x, 7);
});

test("valid movement commands queued during cooldown apply in order", () => {
  const room = setupRoom();
  const game = state(room);
  placePlayerForTest(game, "p1", 5, 5);
  setTile(game.cave, 6, 5, 0);
  setTile(game.cave, 6, 6, 0);

  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, sequence: 1 }));
  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 0, y: 1 }, sequence: 2 }));
  lootAndLeave.update!(room, 50);
  assert.equal(game.players[0].x, 6);
  assert.equal(game.players[0].y, 5);

  advanceMoveCooldown(room);
  lootAndLeave.update!(room, 50);
  assert.equal(game.players[0].x, 6);
  assert.equal(game.players[0].y, 6);
});

test("blocked movement command does not move", () => {
  const room = setupRoom();
  const game = state(room);
  placePlayerForTest(game, "p1", 5, 5);
  setTile(game.cave, 6, 5, 1);

  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, sequence: 1 }));
  lootAndLeave.update!(room, 50);

  assert.equal(game.players[0].x, 5);
  assert.equal(game.players[0].y, 5);
});

test("falling rocks can roll sideways off supported obstacles", () => {
  const room = setupRoom();
  const game = state(room);
  placePlayerForTest(game, "p1", 2, 2);
  setTile(game.cave, 10, 6, 3);
  setTile(game.cave, 10, 7, 1);
  setTile(game.cave, 9, 6, 0);
  setTile(game.cave, 9, 7, 0);
  setTile(game.cave, 11, 6, 1);
  setTile(game.cave, 11, 7, 1);

  lootAndLeave.update!(room, 50);

  assert.equal(getTile(game.cave, 10, 6), 0);
  assert.equal(getTile(game.cave, 9, 6), 3);
});

test("gem pickup adds carried cash and unlocking exit depends on collected gems", () => {
  const room = setupRoom();
  const game = state(room);
  placePlayerForTest(game, "p1", 5, 5);
  game.exitUnlockThreshold = 1;
  setTile(game.cave, 6, 5, 4);

  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 1, y: 0 } }));
  lootAndLeave.update!(room, 50);

  assert.equal(game.players[0].carriedCash, 100);
  assert.equal(game.players[0].bankedCash, 0);
  assert.equal(game.exitUnlocked, true);
  assert.equal(game.lastEvent?.type, "exit_unlocked");
});

test("escaping banks carried cash and keeps banked cash safe", () => {
  const room = setupRoom();
  const game = state(room);
  const player = game.players[0];
  player.carriedCash = 300;
  game.exitUnlocked = true;
  player.x = game.exit.x;
  player.y = game.exit.y;

  lootAndLeave.update!(room, 50);

  assert.equal(player.escaped, true);
  assert.equal(player.carriedCash, 0);
  assert.equal(player.bankedCash, 300);
});

test("death drops carried cash into an ownable loot bag and resets carried cash", () => {
  const room = setupRoom();
  const game = state(room);
  placePlayerForTest(game, "p1", 5, 5);
  game.players[0].carriedCash = 500;
  setTile(game.cave, 5, 3, 3);
  setTile(game.cave, 5, 4, 0);
  setTile(game.cave, 5, 5, 0);

  for (let i = 0; i < 5; i += 1) lootAndLeave.update!(room, 50);

  assert.equal(game.players[0].lives, 2);
  assert.equal(game.players[0].carriedCash, 0);
  assert.equal(game.players[0].bankedCash, 0);
  assert.equal(game.lootBags.length, 1);
  assert.equal(game.lootBags[0].ownerId, "p1");
  assert.equal(game.lootBags[0].cash, 500);
});

test("recovering your own loot bag restores carried cash", () => {
  const room = setupRoom();
  const game = state(room);
  placePlayerForTest(game, "p1", 5, 5);
  setTile(game.cave, 6, 5, 0);
  game.lootBags = [{ id: "bag_p1", ownerId: "p1", x: 6, y: 5, cash: 250 }];

  lootAndLeave.handleInput(room, "p1", input({ movement: { x: 1, y: 0 } }));
  lootAndLeave.update!(room, 50);

  assert.equal(game.players[0].carriedCash, 250);
  assert.equal(game.lootBags.length, 0);
});

test("slime collision costs one life and respawns the player", () => {
  const room = setupRoom();
  const game = state(room);
  placePlayerForTest(game, "p1", 5, 5);
  game.slimes = [{ id: "s1", x: 6, y: 5, cooldownTicks: 0 }];

  lootAndLeave.update!(room, 300);

  assert.equal(game.players[0].lives, 2);
  assert.equal(game.players[0].x, game.players[0].spawnX);
});

test("level advances when all active players escape or are out", () => {
  const room = setupRoom();
  const game = state(room);
  game.players[0].escaped = true;
  game.players[1].out = true;

  lootAndLeave.update!(room, 50);

  assert.equal(state(room).level, 2);
});

test("match ends when everyone is out and winner is highest banked cash", () => {
  const room = setupRoom();
  const game = state(room);
  game.players[0].lives = 0;
  game.players[0].out = true;
  game.players[0].bankedCash = 100;
  game.players[1].lives = 0;
  game.players[1].out = true;
  game.players[1].bankedCash = 400;

  lootAndLeave.update!(room, 50);
  lootAndLeave.finish(room);

  assert.equal(room.game!.winnerId, "p2");
  assert.equal(room.players.find((player) => player.id === "p2")?.score, 400);
});

test("existing minigames still expose their ids", () => {
  assert.equal(buttonRace.id, "button_race");
  assert.equal(actNatural.id, "act_natural");
});
