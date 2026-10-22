import assert from "node:assert/strict";
import test from "node:test";
import { seededRandom } from "../crowd/random.js";
import { crowdMatchFor, setCrowdRandomForTests } from "../minigames/CrowdGames.js";
import { RoomManager } from "./RoomManager.js";

setCrowdRandomForTests(() => seededRandom(7));

test("a dropped player keeps their seat and takes it back with their resume token", () => {
  const manager = new RoomManager(seededRandom(3));
  const { room, player: host } = manager.createRoom("Host");
  const { player: guest } = manager.joinRoom(room.code, "Guest");
  const token = manager.resumeTokenFor(guest.id)!;
  assert.ok(token);

  manager.disconnect(guest.id);
  assert.equal(room.players.find((player) => player.id === guest.id)?.away, true);
  assert.ok(manager.isAway(guest.id));

  const resumed = manager.resume(token);
  assert.equal(resumed.player.id, guest.id);
  assert.equal(resumed.player.away, false);
  assert.equal(room.players.length, 2);

  manager.leave(guest.id);
  assert.throws(() => manager.resume(token), /seat has gone/);
  assert.equal(room.hostId, host.id);
});

test("while away mid-round a player's figure walks with the crowd, then answers to them again", () => {
  const manager = new RoomManager(seededRandom(4));
  const { room, player: host } = manager.createRoom("Host");
  const { player: guest } = manager.joinRoom(room.code, "Guest");
  manager.handleRoomMessage(guest.id, { type: "PLAYER_READY", isReady: true }, () => {});
  manager.handleRoomMessage(host.id, { type: "START_GAME", minigameId: "crowd_act_natural" }, () => {});
  const match = crowdMatchFor(room)!;
  const slot = match.slots.get(guest.id)!;

  manager.disconnect(guest.id);
  assert.ok(slot.entity.brain, "steered like an NPC while away");
  manager.resume(manager.resumeTokenFor(guest.id)!);
  assert.equal(slot.entity.brain, undefined);
  assert.equal(slot.away, false);
  room.returnToLobby();
});

test("players can change their name in the lobby only", () => {
  const manager = new RoomManager(seededRandom(5));
  const { room, player } = manager.createRoom("Pad 1");
  manager.rename(player.id, "Countess");
  assert.equal(room.players[0].displayName, "Countess");
});
