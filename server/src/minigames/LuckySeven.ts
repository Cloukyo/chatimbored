import {
  LUCKY_SEVEN_BONUS,
  LUCKY_SEVEN_MAX_UNIQUE_CARDS,
  LUCKY_SEVEN_ROUND_MS,
  LUCKY_SEVEN_TARGET_SCORE,
} from "../../../shared/constants/platform.js";
import type { GameSnapshot, LuckySevenCard, LuckySevenEvent, LuckySevenInput, LuckySevenPlayerState } from "../../../shared/message-types/protocol.js";
import type { Room } from "../rooms/Room.js";
import type { Minigame } from "./Minigame.js";

export const luckySeven: Minigame = {
  id: "lucky_seven",
  name: "Lucky Seven",
  minPlayers: 2,
  maxPlayers: 8,

  setup(room: Room): GameSnapshot {
    const deck = createDeck(room.code, 1);
    const game: GameSnapshot = {
      minigameId: this.id,
      name: this.name,
      endsAt: Date.now() + LUCKY_SEVEN_ROUND_MS,
      scores: Object.fromEntries(room.players.map((player) => [player.id, 0])),
      luckySeven: {
        round: 1,
        deckCount: deck.length,
        players: room.players.map((player) => ({
          id: player.id,
          cards: [],
          roundState: "playing",
          roundScore: 0,
          totalScore: 0,
        })),
        targetScore: LUCKY_SEVEN_TARGET_SCORE,
        bonus: LUCKY_SEVEN_BONUS,
        status: "playing",
        lastEvent: event("round_start", "Round 1 begins."),
      },
    };
    setDeck(game.luckySeven!, deck);
    return game;
  },

  handleInput(room: Room, playerId: string | undefined, input: unknown): GameSnapshot {
    if (!room.game?.luckySeven || !playerId || !isLuckySevenInput(input)) return room.game!;
    const state = room.game.luckySeven;
    if (state.status === "complete" || room.game.winnerId) return room.game;
    const player = state.players.find((candidate) => candidate.id === playerId);
    if (!player || player.roundState !== "playing") return room.game;

	if (input.action === "stay") {
		state.lastEvent = event("stay", `${playerId} stayed.`, playerId);
		bankPlayer(room, player);
		finishRoundIfNeeded(room);
		return room.game;
	}

    const card = drawCard(room);
    player.cards.push(card);
    if (isDuplicateNumber(player.cards, card)) {
      player.roundState = "busted";
      player.roundScore = 0;
      state.lastEvent = event("bust", `${playerId} busted on ${cardLabel(card)}.`, playerId, card);
      finishRoundIfNeeded(room);
      return room.game;
    }

    player.roundScore = scoreCards(player.cards);
    state.lastEvent = event("hit", `${playerId} drew ${cardLabel(card)}.`, playerId, card);

	if (uniqueNumberCount(player.cards) >= LUCKY_SEVEN_MAX_UNIQUE_CARDS) {
		player.roundScore += LUCKY_SEVEN_BONUS;
		state.lastEvent = event("lucky_seven", `${playerId} hit Lucky Seven.`, playerId, card);
		bankPlayer(room, player);
		finishRoundIfNeeded(room);
	}

    return room.game;
  },

  finish(room: Room): GameSnapshot {
    if (!room.game?.luckySeven) throw new Error("No Lucky Seven round is running.");
    const state = room.game.luckySeven;
    if (!room.game.winnerId) {
      const leader = [...state.players].sort((a, b) => b.totalScore - a.totalScore)[0];
      room.game.winnerId = leader?.id;
      state.status = "complete";
      state.lastEvent = event("game_over", "Time is up.");
    }
    room.players.forEach((player) => {
      const cardPlayer = state.players.find((candidate) => candidate.id === player.id);
      player.score = cardPlayer?.totalScore ?? 0;
      player.isReady = false;
      room.game!.scores[player.id] = player.score;
    });
    return room.game;
  },
};

function drawCard(room: Room): LuckySevenCard {
  const state = room.game!.luckySeven!;
  let deck = getDeck(state);
  if (deck.length === 0) {
    deck = createDeck(room.code, state.round + state.players.reduce((sum, player) => sum + player.totalScore, 0));
    setDeck(state, deck);
  }
  const card = deck.shift()!;
  state.deckCount = deck.length;
  return card;
}

function bankPlayer(room: Room, player: LuckySevenPlayerState): void {
  player.roundState = "stayed";
  player.totalScore += player.roundScore;
  room.game!.scores[player.id] = player.totalScore;
  if (player.totalScore >= LUCKY_SEVEN_TARGET_SCORE) {
    room.game!.winnerId = player.id;
    room.game!.luckySeven!.status = "complete";
    room.game!.luckySeven!.lastEvent = event("game_over", `${player.id} reached ${LUCKY_SEVEN_TARGET_SCORE}.`, player.id);
  }
}

function finishRoundIfNeeded(room: Room): void {
  const state = room.game!.luckySeven!;
  if (state.status === "complete") return;
  if (state.players.some((player) => player.roundState === "playing")) return;
  state.round += 1;
  state.players.forEach((player) => {
    player.cards = [];
    player.roundScore = 0;
    player.roundState = "playing";
  });
  const deck = createDeck(room.code, state.round);
  setDeck(state, deck);
  state.deckCount = deck.length;
  state.lastEvent = event("round_start", `Round ${state.round} begins.`);
}

function getDeck(state: NonNullable<GameSnapshot["luckySeven"]>): LuckySevenCard[] {
  return state.deck ?? [];
}

function setDeck(state: NonNullable<GameSnapshot["luckySeven"]>, deck: LuckySevenCard[]): void {
  Object.defineProperty(state, "deck", {
    value: deck,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function createDeck(roomCode: string, round: number): LuckySevenCard[] {
  const cards: LuckySevenCard[] = [{ id: `r${round}_zero_0`, kind: "number", value: 0 }];
  for (let value = 1; value <= 12; value += 1) {
    for (let copy = 0; copy < value; copy += 1) {
      cards.push({ id: `r${round}_${value}_${copy}`, kind: "number", value });
    }
  }
  cards.push(
    { id: `r${round}_bonus_plus_5_a`, kind: "bonus", effect: "plus_5", label: "+5", bonusValue: 5 },
    { id: `r${round}_bonus_plus_5_b`, kind: "bonus", effect: "plus_5", label: "+5", bonusValue: 5 },
    { id: `r${round}_bonus_plus_10`, kind: "bonus", effect: "plus_10", label: "+10", bonusValue: 10 },
    { id: `r${round}_bonus_lucky_break`, kind: "bonus", effect: "lucky_break", label: "Lucky +7", bonusValue: 7 },
  );
  return shuffle(cards, seedFrom(roomCode, round));
}

function shuffle(cards: LuckySevenCard[], seed: number): LuckySevenCard[] {
  const result = [...cards];
  let state = seed || 1;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function seedFrom(roomCode: string, round: number): number {
  return roomCode.split("").reduce((sum, char) => sum + char.charCodeAt(0) * 31, round * 9973);
}

function isDuplicateNumber(cards: LuckySevenCard[], latest: LuckySevenCard): boolean {
  if (latest.kind !== "number") return false;
  return cards.filter((card) => card.kind === "number" && card.value === latest.value).length > 1;
}

function scoreCards(cards: LuckySevenCard[]): number {
  return cards.reduce((sum, card) => sum + (card.kind === "number" ? card.value : card.bonusValue), 0);
}

function uniqueNumberCount(cards: LuckySevenCard[]): number {
  return new Set(cards.filter((card) => card.kind === "number").map((card) => card.value)).size;
}

function isLuckySevenInput(input: unknown): input is LuckySevenInput {
  return Boolean(input && typeof input === "object" && "action" in input && ((input as LuckySevenInput).action === "hit" || (input as LuckySevenInput).action === "stay"));
}

function event(type: LuckySevenEvent["type"], message: string, playerId?: string, card?: LuckySevenCard): LuckySevenEvent {
  return { type, message, playerId, card };
}

function cardLabel(card: LuckySevenCard): string {
  return card.kind === "number" ? String(card.value) : card.label;
}
