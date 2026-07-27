import assert from "node:assert/strict";
import test from "node:test";
import { LUCKY_SEVEN_TARGET_SCORE } from "../../../shared/constants/platform.js";
import type { LuckySevenCard, LuckySevenInput } from "../../../shared/message-types/protocol.js";
import { Room } from "../rooms/Room.js";
import { RoomManager } from "../rooms/RoomManager.js";
import { luckySeven } from "./LuckySeven.js";
import { listMinigames } from "./registry.js";

type TestState = NonNullable<NonNullable<Room["game"]>["luckySeven"]> & Record<string, any>;

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

function send(room: Room, playerId: string, action: string): void {
  luckySeven.handleInput(room, playerId, { action } as LuckySevenInput);
}

function input(action: string): LuckySevenInput {
  return { action } as LuckySevenInput;
}

function stateOf(room: Room): TestState {
  return room.game!.luckySeven! as TestState;
}

function forceDeck(room: Room, cards: LuckySevenCard[]): void {
  stateOf(room).deck = cards;
  stateOf(room).deckCount = cards.length;
}

function requestAndDeal(room: Room, playerId: string, dealerId = stateOf(room).dealerId): void {
  send(room, playerId, "request_hit");
  send(room, dealerId, "dealer_deal");
}

function requestAndStay(room: Room, playerId: string, dealerId = stateOf(room).dealerId): void {
  send(room, playerId, "request_stay");
  send(room, dealerId, "dealer_confirm_stay");
}

test("setup creates an eight-player-capable dealer table", () => {
  const room = setupRoom(4);
  const state = stateOf(room);

  assert.equal(room.game!.minigameId, "lucky_seven");
  assert.equal(luckySeven.maxPlayers, 8);
  assert.equal(state.players.length, 4);
  assert.equal(state.dealerId, "p1");
  assert.equal(state.activePlayerId, "p2");
  assert.equal(state.turnState, "awaiting_player");
  assert.equal(state.targetScore, LUCKY_SEVEN_TARGET_SCORE);
});

test("deck has the original 94-card composition and stays private", () => {
  const room = setupRoom(2);
  const state = stateOf(room);
  const deck = state.deck as LuckySevenCard[];
  const numbers = deck.filter((card) => card.kind === "number");
  const modifiers = deck.filter((card) => card.kind === "modifier");
  const actions = deck.filter((card) => card.kind === "action");

  assert.equal(deck.length, 94);
  assert.equal(numbers.length, 79);
  assert.equal(modifiers.length, 6);
  assert.equal(actions.length, 9);
  for (let value = 0; value <= 12; value += 1) {
    assert.equal(numbers.filter((card) => card.value === value).length, Math.max(1, value));
  }
  assert.deepEqual(modifiers.map((card) => card.label).sort(), ["+10", "+2", "+4", "+6", "+8", "x2"]);
  assert.deepEqual(
    actions.reduce<Record<string, number>>((counts, card) => {
      counts[card.effect] = (counts[card.effect] ?? 0) + 1;
      return counts;
    }, {}),
    { freeze: 3, flip_three: 3, second_chance: 3 },
  );
  assert.equal(JSON.parse(JSON.stringify(room.game)).luckySeven.deck, undefined);
});

test("only the active player can ask and only the dealer can deal", () => {
  const room = setupRoom(3);
  const state = stateOf(room);

  send(room, "p3", "request_hit");
  assert.equal(state.turnState, "awaiting_player");

  send(room, "p2", "request_hit");
  assert.equal(state.turnState, "awaiting_dealer");
  assert.equal(state.pendingDecision, "hit");

  send(room, "p3", "dealer_deal");
  assert.equal(state.players[1].cards.length, 0);

  send(room, "p1", "dealer_deal");
  assert.equal(state.players[1].cards.length, 1);
  assert.equal(state.turnState, "awaiting_player");
});

test("dealer confirms stay and play advances clockwise", () => {
  const room = setupRoom(3);
  const state = stateOf(room);
  forceDeck(room, [{ id: "five", kind: "number", value: 5 }]);

  requestAndDeal(room, "p2");
  send(room, "p2", "request_stay");
  send(room, "p3", "dealer_confirm_stay");
  assert.equal(state.players[1].roundState, "playing");

  send(room, "p1", "dealer_confirm_stay");
  assert.equal(state.players[1].roundState, "stayed");
  assert.equal(state.players[1].totalScore, 5);
  assert.equal(state.activePlayerId, "p3");
});

test("modifiers score after number multiplication and never bust", () => {
  const room = setupRoom(2);
  const state = stateOf(room);
  forceDeck(room, [
    { id: "n6", kind: "number", value: 6 },
    { id: "x2", kind: "modifier", effect: "x2", label: "x2" },
    { id: "plus10", kind: "modifier", effect: "plus", label: "+10", value: 10 },
  ]);

  requestAndDeal(room, "p2");
  requestAndDeal(room, "p2");
  requestAndDeal(room, "p2");

  assert.equal(state.players[1].roundState, "playing");
  assert.equal(state.players[1].roundScore, 22);
});

test("Second Chance consumes itself and the duplicate instead of busting", () => {
  const room = setupRoom(2);
  const state = stateOf(room);
  forceDeck(room, [
    { id: "chance", kind: "action", effect: "second_chance", label: "Second Chance" },
    { id: "six-a", kind: "number", value: 6 },
    { id: "six-b", kind: "number", value: 6 },
  ]);

  requestAndDeal(room, "p2");
  requestAndDeal(room, "p2");
  requestAndDeal(room, "p2");

  assert.equal(state.players[1].roundState, "playing");
  assert.equal(state.players[1].hasSecondChance, false);
  assert.deepEqual(state.players[1].cards.map((card: LuckySevenCard) => card.id), ["six-a"]);
  assert.ok(state.discardPile.some((card: LuckySevenCard) => card.id === "chance"));
  assert.ok(state.discardPile.some((card: LuckySevenCard) => card.id === "six-b"));
  assert.equal(state.lastEvent.type, "second_chance");
});

test("a second duplicate busts after Second Chance is spent", () => {
  const room = setupRoom(2);
  forceDeck(room, [
    { id: "chance", kind: "action", effect: "second_chance", label: "Second Chance" },
    { id: "six-a", kind: "number", value: 6 },
    { id: "six-b", kind: "number", value: 6 },
    { id: "six-c", kind: "number", value: 6 },
  ]);

  requestAndDeal(room, "p2");
  requestAndDeal(room, "p2");
  requestAndDeal(room, "p2");
  requestAndDeal(room, "p2");

  assert.equal(stateOf(room).players[1].roundState, "busted");
  assert.equal(stateOf(room).players[1].roundScore, 0);
});

test("Freeze banks the active player and advances the turn", () => {
  const room = setupRoom(3);
  const state = stateOf(room);
  forceDeck(room, [
    { id: "seven", kind: "number", value: 7 },
    { id: "freeze", kind: "action", effect: "freeze", label: "Freeze" },
  ]);

  requestAndDeal(room, "p2");
  requestAndDeal(room, "p2");

  assert.equal(state.players[1].roundState, "frozen");
  assert.equal(state.players[1].totalScore, 7);
  assert.equal(state.activePlayerId, "p3");
  assert.equal(state.lastEvent.type, "freeze");
});

test("Flip Three resolves three draws on the server", () => {
  const room = setupRoom(3);
  const state = stateOf(room);
  forceDeck(room, [
    { id: "flip", kind: "action", effect: "flip_three", label: "Flip Three" },
    { id: "two", kind: "number", value: 2 },
    { id: "three", kind: "number", value: 3 },
    { id: "four", kind: "number", value: 4 },
  ]);

  requestAndDeal(room, "p2");

  assert.deepEqual(state.players[1].cards.map((card: LuckySevenCard) => card.id), ["two", "three", "four"]);
  assert.equal(state.players[1].roundScore, 9);
  assert.equal(state.turnState, "awaiting_player");
  assert.equal(state.lastEvent.type, "flip_three");
});

test("seven unique number cards award fifteen and end that player's round", () => {
  const room = setupRoom(2);
  const state = stateOf(room);
  forceDeck(room, [1, 2, 3, 4, 5, 6, 7].map((value) => ({ id: `n${value}`, kind: "number", value })));

  for (let index = 0; index < 7; index += 1) requestAndDeal(room, "p2");

  assert.equal(state.players[1].roundState, "stayed");
  assert.equal(state.players[1].roundScore, 43);
  assert.equal(state.players[1].totalScore, 43);
  assert.equal(state.lastEvent.type, "lucky_seven");
});

test("round pauses on a summary and rotates the dealer when continued", () => {
  const room = setupRoom(2);
  const state = stateOf(room);
  forceDeck(room, [
    { id: "p2-five", kind: "number", value: 5 },
    { id: "p1-eight", kind: "number", value: 8 },
  ]);

  requestAndDeal(room, "p2");
  requestAndStay(room, "p2");
  requestAndDeal(room, "p1");
  requestAndStay(room, "p1");

  assert.equal(state.turnState, "round_summary");
  assert.deepEqual(state.roundSummary.map((row: any) => row.roundPoints), [8, 5]);

  send(room, "p1", "continue");
  assert.equal(state.round, 2);
  assert.equal(state.dealerId, "p2");
  assert.equal(state.activePlayerId, "p1");
  assert.equal(state.turnState, "awaiting_player");
  assert.ok(state.players.every((player: any) => player.cards.length === 0));
});

test("continuing a round preserves the real match deadline and discarded cards", () => {
  const room = setupRoom(2);
  const state = stateOf(room);
  const matchEndsAt = room.game!.endsAt;
  forceDeck(room, [
    { id: "p2-five", kind: "number", value: 5 },
    { id: "p1-eight", kind: "number", value: 8 },
    { id: "still-in-deck", kind: "number", value: 9 },
  ]);

  requestAndDeal(room, "p2");
  requestAndStay(room, "p2");
  requestAndDeal(room, "p1");
  requestAndStay(room, "p1");
  send(room, "p1", "continue");

  assert.equal(room.game!.endsAt, matchEndsAt);
  assert.equal(state.deckCount, 1);
  assert.deepEqual(state.discardPile.map((card: LuckySevenCard) => card.id).sort(), ["p1-eight", "p2-five"]);
});

test("a departing dealer or active player cannot stall the table", () => {
  const dealerRoom = setupRoom(3);
  (luckySeven as any).onPlayerLeft?.(dealerRoom, "p1");
  assert.equal(stateOf(dealerRoom).dealerId, "p2");
  assert.equal(stateOf(dealerRoom).activePlayerId, "p2");

  const activeRoom = setupRoom(3);
  (luckySeven as any).onPlayerLeft?.(activeRoom, "p2");
  assert.equal(stateOf(activeRoom).dealerId, "p1");
  assert.equal(stateOf(activeRoom).activePlayerId, "p3");
  assert.equal(stateOf(activeRoom).turnState, "awaiting_player");
});

test("target score produces ranked final results after the round", () => {
  const room = setupRoom(2);
  const state = stateOf(room);
  state.players[1].totalScore = LUCKY_SEVEN_TARGET_SCORE - 5;
  state.players[0].totalScore = 170;
  forceDeck(room, [
    { id: "p2-five", kind: "number", value: 5 },
    { id: "p1-ten", kind: "number", value: 10 },
  ]);

  requestAndDeal(room, "p2");
  requestAndStay(room, "p2");
  requestAndDeal(room, "p1");
  requestAndStay(room, "p1");

  assert.equal(state.status, "complete");
  assert.equal(room.game!.winnerId, "p2");
  assert.deepEqual(state.finalResults.map((row: any) => row.id), ["p2", "p1"]);
  assert.deepEqual(state.finalResults.map((row: any) => row.rank), [1, 2]);
});

test("RoomManager immediately transitions a Lucky Seven winner to results", () => {
  const manager = new RoomManager();
  const first = manager.createRoom("Dealer");
  const second = manager.joinRoom(first.room.code, "Player");
  first.room.setReady(second.player.id, true);
  manager.handleRoomMessage(first.player.id, { type: "START_GAME", minigameId: "lucky_seven" }, () => {});
  const state = stateOf(first.room);
  state.players[1].totalScore = LUCKY_SEVEN_TARGET_SCORE - 5;
  forceDeck(first.room, [
    { id: "winning-five", kind: "number", value: 5 },
    { id: "dealer-zero", kind: "number", value: 0 },
  ]);
  let finished = 0;
  const onFinished = (room: Room): void => {
    finished += 1;
    manager.finishGame(room);
  };

  manager.handleRoomMessage(second.player.id, { type: "PLAYER_INPUT", input: input("request_hit") }, onFinished);
  manager.handleRoomMessage(first.player.id, { type: "PLAYER_INPUT", input: input("dealer_deal") }, onFinished);
  manager.handleRoomMessage(second.player.id, { type: "PLAYER_INPUT", input: input("request_stay") }, onFinished);
  manager.handleRoomMessage(first.player.id, { type: "PLAYER_INPUT", input: input("dealer_confirm_stay") }, onFinished);
  manager.handleRoomMessage(first.player.id, { type: "PLAYER_INPUT", input: input("request_hit") }, onFinished);
  manager.handleRoomMessage(first.player.id, { type: "PLAYER_INPUT", input: input("dealer_deal") }, onFinished);
  manager.handleRoomMessage(first.player.id, { type: "PLAYER_INPUT", input: input("request_stay") }, onFinished);
  manager.handleRoomMessage(first.player.id, { type: "PLAYER_INPUT", input: input("dealer_confirm_stay") }, onFinished);

  try {
    assert.equal(finished, 1);
    assert.equal(first.room.phase, "results");
  } finally {
    first.room.returnToLobby();
  }
});

test("existing minigames remain registered", () => {
  const ids = listMinigames().map((minigame) => minigame.id);

  assert.ok(ids.includes("button_race"));
  assert.ok(ids.includes("act_natural"));
  assert.ok(ids.includes("loot_and_leave"));
  assert.ok(ids.includes("silent_witness"));
  assert.ok(ids.includes("lucky_seven"));
});
