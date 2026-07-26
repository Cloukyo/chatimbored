import assert from "node:assert/strict";
import test from "node:test";
import { LUCKY_SEVEN_TARGET_SCORE } from "../../../shared/constants/platform.js";
import type { LuckySevenInput } from "../../../shared/message-types/protocol.js";
import { Room } from "../rooms/Room.js";
import { luckySeven } from "./LuckySeven.js";
import { listMinigames } from "./registry.js";

function makeRoom(playerCount = 3): Room {
  const room = new Room("LUCKY");
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

function setupRoom(playerCount = 3): Room {
  const room = makeRoom(playerCount);
  room.game = luckySeven.setup(room);
  return room;
}

function input(action: LuckySevenInput["action"]): LuckySevenInput {
  return { action };
}

test("setup creates a multiplayer press-your-luck card round", () => {
	const room = setupRoom(4);
	const state = room.game!.luckySeven!;

  assert.equal(room.game!.minigameId, "lucky_seven");
  assert.equal(room.game!.name, "Lucky Seven");
  assert.equal(luckySeven.maxPlayers, 8);
  assert.equal(state.players.length, 4);
  assert.equal(state.targetScore, LUCKY_SEVEN_TARGET_SCORE);
	assert.ok(state.deckCount > 0);
	assert.ok(state.players.every((player) => player.roundState === "playing"));
});

test("deck order is not exposed in serialized game snapshots", () => {
	const room = setupRoom(2);
	const serialized = JSON.parse(JSON.stringify(room.game));

	assert.equal(serialized.luckySeven.deck, undefined);
	assert.ok(serialized.luckySeven.deckCount > 0);
});

test("hit deals a visible number card to the player", () => {
	const room = setupRoom();
	const player = room.game!.luckySeven!.players[0];

  luckySeven.handleInput(room, player.id, input("hit"));

  assert.equal(player.cards.length, 1);
  assert.equal(player.roundState, "playing");
  assert.equal(player.roundScore, player.cards[0].value);
  assert.equal(room.game!.luckySeven!.lastEvent?.type, "hit");
});

test("visible cards and scores are broadcast for every player", () => {
	const room = setupRoom(8);
	const state = room.game!.luckySeven!;
	state.deck = Array.from({ length: 8 }, (_unused, index) => ({ id: `forced_${index + 1}`, kind: "number" as const, value: index + 1 }));

	for (const player of state.players) {
		luckySeven.handleInput(room, player.id, input("hit"));
	}

	assert.equal(state.players.length, 8);
	assert.deepEqual(state.players.map((player) => player.cards.length), [1, 1, 1, 1, 1, 1, 1, 1]);
	assert.deepEqual(state.players.map((player) => player.roundScore), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("bonus cards add their effect value without creating duplicate number busts", () => {
	const room = setupRoom();
	const state = room.game!.luckySeven!;
	const player = state.players[0];
	state.deck = [
		{ id: "forced_5_a", kind: "number", value: 5 },
		{ id: "forced_plus_5", kind: "bonus", effect: "plus_5", label: "+5", bonusValue: 5 },
		{ id: "forced_5_b", kind: "number", value: 5 },
	];

	luckySeven.handleInput(room, player.id, input("hit"));
	luckySeven.handleInput(room, player.id, input("hit"));

	assert.equal(player.roundState, "playing");
	assert.equal(player.roundScore, 10);
	assert.equal(state.lastEvent?.card?.kind, "bonus");

	luckySeven.handleInput(room, player.id, input("hit"));

	assert.equal(player.roundState, "busted");
	assert.equal(player.roundScore, 0);
});

test("duplicate number card busts the player for the round", () => {
  const room = setupRoom();
  const state = room.game!.luckySeven!;
  const player = state.players[0];
  state.deck = [
    { id: "forced_6_a", kind: "number", value: 6 },
    { id: "forced_6_b", kind: "number", value: 6 },
  ];

  luckySeven.handleInput(room, player.id, input("hit"));
  luckySeven.handleInput(room, player.id, input("hit"));

  assert.equal(player.roundState, "busted");
  assert.equal(player.roundScore, 0);
  assert.equal(player.cards.length, 2);
  assert.equal(state.lastEvent?.type, "bust");
});

test("stay banks current round score and waits for the next round", () => {
  const room = setupRoom();
  const state = room.game!.luckySeven!;
  const player = state.players[0];
  state.deck = [{ id: "forced_9", kind: "number", value: 9 }];

  luckySeven.handleInput(room, player.id, input("hit"));
  luckySeven.handleInput(room, player.id, input("stay"));

  assert.equal(player.roundState, "stayed");
  assert.equal(player.totalScore, 9);
  assert.equal(room.game!.scores[player.id], 9);
  assert.equal(state.lastEvent?.type, "stay");
});

test("seven unique numbers gives a bonus and automatically banks", () => {
  const room = setupRoom();
  const state = room.game!.luckySeven!;
  const player = state.players[0];
  state.deck = [1, 2, 3, 4, 5, 6, 7].map((value) => ({ id: `forced_${value}`, kind: "number" as const, value }));

  for (let index = 0; index < 7; index += 1) {
    luckySeven.handleInput(room, player.id, input("hit"));
  }

  assert.equal(player.roundState, "stayed");
  assert.equal(player.totalScore, 43);
  assert.equal(player.roundScore, 43);
  assert.equal(state.lastEvent?.type, "lucky_seven");
});

test("round resets after all active players stay or bust", () => {
  const room = setupRoom(2);
  const state = room.game!.luckySeven!;
  state.deck = [
    { id: "p1_5", kind: "number", value: 5 },
    { id: "p2_8", kind: "number", value: 8 },
  ];

  luckySeven.handleInput(room, "p1", input("hit"));
  luckySeven.handleInput(room, "p1", input("stay"));
  luckySeven.handleInput(room, "p2", input("hit"));
  luckySeven.handleInput(room, "p2", input("stay"));

  assert.equal(state.round, 2);
  assert.ok(state.players.every((player) => player.roundState === "playing"));
  assert.ok(state.players.every((player) => player.cards.length === 0));
});

test("first player to target score wins the match", () => {
  const room = setupRoom();
  const state = room.game!.luckySeven!;
  const player = state.players[0];
  player.totalScore = LUCKY_SEVEN_TARGET_SCORE - 10;
  room.game!.scores[player.id] = player.totalScore;
  state.deck = [{ id: "winning_10", kind: "number", value: 10 }];

  luckySeven.handleInput(room, player.id, input("hit"));
  luckySeven.handleInput(room, player.id, input("stay"));

  assert.equal(room.game!.winnerId, player.id);
  assert.equal(state.status, "complete");
  assert.equal(state.lastEvent?.type, "game_over");
});

test("existing minigames still expose their ids with Lucky Seven", () => {
  const ids = listMinigames().map((minigame) => minigame.id);

  assert.ok(ids.includes("button_race"));
  assert.ok(ids.includes("act_natural"));
  assert.ok(ids.includes("loot_and_leave"));
  assert.ok(ids.includes("silent_witness"));
  assert.ok(ids.includes("lucky_seven"));
});
