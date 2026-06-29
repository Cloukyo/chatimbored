import assert from "node:assert/strict";
import test from "node:test";
import { ACT_NATURAL_DURATION_MS, ACT_NATURAL_EXIT_X } from "../../../shared/constants/platform.js";
import type { ActNaturalInput } from "../../../shared/message-types/protocol.js";
import { actNatural } from "./ActNatural.js";
import { Room } from "../rooms/Room.js";

function makeRoom(): Room {
  const room = new Room("TEST1");
  room.addPlayer({ id: "p1", displayName: "One", isHost: true, isReady: true, score: 0 });
  room.addPlayer({ id: "p2", displayName: "Two", isHost: false, isReady: true, score: 0 });
  return room;
}

function input(overrides: Partial<ActNaturalInput> = {}): ActNaturalInput {
  return {
    movement: { x: 0, y: 0 },
    aim: { x: 1, y: 0 },
    shoot: false,
    run: false,
    ...overrides,
  };
}

test("setup spawns players, creates a crowd, and exposes a 90 second round", () => {
  const room = makeRoom();
  const game = actNatural.setup(room);

  assert.equal(game.minigameId, "act_natural");
  assert.equal(game.name, "Act Natural");
  assert.equal(game.actNatural?.players.length, 2);
  assert.equal(game.actNatural?.npcs.length, 40);
  assert.ok(game.endsAt - Date.now() <= ACT_NATURAL_DURATION_MS);
  assert.ok(game.endsAt - Date.now() > ACT_NATURAL_DURATION_MS - 1000);
});

test("walking moves at crowd-like speed and running moves farther", () => {
  const room = makeRoom();
  room.game = actNatural.setup(room);

  const startX = room.game.actNatural!.players.find((player) => player.id === "p1")!.x;
  actNatural.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, run: false }));
  actNatural.update!(room, 1000);
  const walkedX = room.game.actNatural!.players.find((player) => player.id === "p1")!.x;

  actNatural.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, run: true }));
  actNatural.update!(room, 1000);
  const ranX = room.game.actNatural!.players.find((player) => player.id === "p1")!.x;

  assert.ok(walkedX > startX);
  assert.ok(ranX - walkedX > walkedX - startX);
});

test("tiny movement input inside the deadzone does not move the player", () => {
  const room = makeRoom();
  room.game = actNatural.setup(room);
  const player = room.game.actNatural!.players.find((candidate) => candidate.id === "p1")!;
  const start = { x: player.x, y: player.y };

  actNatural.handleInput(room, "p1", input({ movement: { x: 0.03, y: -0.05 } }));
  actNatural.update!(room, 1000);

  assert.equal(player.x, start.x);
  assert.equal(player.y, start.y);
});

test("shooting consumes exactly one shot and can kill another player", () => {
  const room = makeRoom();
  room.game = actNatural.setup(room);
  const state = room.game.actNatural!;
  const shooter = state.players.find((player) => player.id === "p1")!;
  const target = state.players.find((player) => player.id === "p2")!;
  target.x = shooter.x + 80;
  target.y = shooter.y;

  actNatural.handleInput(room, "p1", input({ aim: { x: 1, y: 0 }, shoot: true }));

  assert.equal(shooter.shotAvailable, false);
  assert.equal(target.alive, false);

  target.alive = true;
  actNatural.handleInput(room, "p1", input({ aim: { x: 1, y: 0 }, shoot: true }));
  assert.equal(target.alive, true);
});

test("first living player to reach the exit wins and ends the room", () => {
  const room = makeRoom();
  room.game = actNatural.setup(room);
  const player = room.game.actNatural!.players.find((candidate) => candidate.id === "p1")!;
  player.x = ACT_NATURAL_EXIT_X - 2;

  actNatural.handleInput(room, "p1", input({ movement: { x: 1, y: 0 }, run: true }));
  actNatural.update!(room, 1000);

  assert.equal(room.game.winnerId, "p1");
});
