import {
  LUCKY_SEVEN_BONUS,
  LUCKY_SEVEN_MAX_UNIQUE_CARDS,
  LUCKY_SEVEN_ROUND_MS,
  LUCKY_SEVEN_TARGET_SCORE,
} from "../../../shared/constants/platform.js";
import { randomInt } from "node:crypto";
import type {
  GameSnapshot,
  LuckySevenCard,
  LuckySevenEvent,
  LuckySevenFinalResult,
  LuckySevenInput,
  LuckySevenPlayerState,
  LuckySevenState,
} from "../../../shared/message-types/protocol.js";
import type { Room } from "../rooms/Room.js";
import type { Minigame } from "./Minigame.js";

export const luckySeven: Minigame = {
  id: "lucky_seven",
  name: "Lucky Seven",
  minPlayers: 2,
  maxPlayers: 8,

  setup(room: Room): GameSnapshot {
    const deck = createDeck(room.code, 1);
    const dealerId = room.players[0]?.id ?? "";
    const game: GameSnapshot = {
      minigameId: this.id,
      name: this.name,
      endsAt: Date.now() + LUCKY_SEVEN_ROUND_MS,
      scores: Object.fromEntries(room.players.map((player) => [player.id, 0])),
      luckySeven: {
        round: 1,
        deckCount: deck.length,
        discardPile: [],
        players: room.players.map((player) => ({
          id: player.id,
          cards: [],
          roundState: "playing",
          roundScore: 0,
          totalScore: 0,
          hasSecondChance: false,
        })),
        dealerId,
        activePlayerId: nextPlayerId(room.players.map((player) => player.id), dealerId),
        turnState: "awaiting_player",
        targetScore: LUCKY_SEVEN_TARGET_SCORE,
        bonus: LUCKY_SEVEN_BONUS,
        status: "playing",
        lastEvent: {
          sequence: 1,
          type: "round_start",
          message: "Round 1 begins.",
        },
      },
    };
    setDeck(game.luckySeven!, deck);
    return game;
  },

  handleInput(room: Room, playerId: string | undefined, input: unknown): GameSnapshot {
    if (!room.game?.luckySeven || !playerId || !isLuckySevenInput(input)) return room.game!;
    const state = room.game.luckySeven;
    if (state.status === "complete") return room.game;

    if (input.action === "continue") {
      if (playerId === state.dealerId && state.turnState === "round_summary") startNextRound(room);
      return room.game;
    }

    const activePlayer = state.players.find((player) => player.id === state.activePlayerId);
    if (!activePlayer || activePlayer.roundState !== "playing") return room.game;

    if (input.action === "request_hit" || input.action === "request_stay") {
      if (state.turnState !== "awaiting_player" || playerId !== activePlayer.id) return room.game;
      state.pendingDecision = input.action === "request_hit" ? "hit" : "stay";
      state.turnState = "awaiting_dealer";
      setEvent(
        state,
        input.action === "request_hit" ? "requested_hit" : "requested_stay",
        input.action === "request_hit" ? `${playerId} says hit me.` : `${playerId} wants to stay.`,
        playerId,
      );
      return room.game;
    }

    if (state.turnState !== "awaiting_dealer" || playerId !== state.dealerId) return room.game;
    if (input.action === "dealer_confirm_stay" && state.pendingDecision === "stay") {
      bankPlayer(room, activePlayer, "stayed");
      setEvent(state, "stay", `${activePlayer.id} stayed.`, activePlayer.id);
      advanceTurn(room, activePlayer.id);
      return room.game;
    }
    if (input.action === "dealer_deal" && state.pendingDecision === "hit") {
      state.pendingDecision = undefined;
      resolveDraw(room, activePlayer);
      if (
        state.status === "playing"
        && state.activePlayerId === activePlayer.id
        && activePlayer.roundState === "playing"
      ) {
        state.turnState = "awaiting_player";
      }
    }
    return room.game;
  },

  onPlayerLeft(room: Room, playerId: string): GameSnapshot {
    if (!room.game?.luckySeven) return room.game!;
    const state = room.game.luckySeven;
    const departedIndex = state.players.findIndex((player) => player.id === playerId);
    if (departedIndex < 0) return room.game;
    const wasDealer = state.dealerId === playerId;
    const wasActive = state.activePlayerId === playerId;
    state.players.splice(departedIndex, 1);
    delete room.game.scores[playerId];

    if (state.players.length === 0) {
      state.activePlayerId = undefined;
      return room.game;
    }
    if (wasDealer) state.dealerId = state.players[departedIndex % state.players.length].id;
    if (wasActive && state.turnState !== "round_summary" && state.turnState !== "complete") {
      state.pendingDecision = undefined;
      const next = findPlayingPlayer(state, departedIndex);
      if (next) {
        state.activePlayerId = next.id;
        state.turnState = "awaiting_player";
      } else {
        finishRound(room);
      }
    }
    return room.game;
  },

  finish(room: Room): GameSnapshot {
    if (!room.game?.luckySeven) throw new Error("No Lucky Seven round is running.");
    const state = room.game.luckySeven;
    if (!room.game.winnerId) completeMatch(room, "Time is up.");
    syncRoomScores(room);
    return room.game;
  },
};

function resolveDraw(room: Room, player: LuckySevenPlayerState): void {
  const state = room.game!.luckySeven!;
  const card = drawCard(room);

  if (card.kind === "action") {
    if (card.effect === "second_chance") {
      if (player.hasSecondChance) {
        state.discardPile.push(card);
      } else {
        player.cards.push(card);
        player.hasSecondChance = true;
      }
      setEvent(state, "card_drawn", `${player.id} drew Second Chance.`, player.id, card);
      return;
    }

    state.discardPile.push(card);
    if (card.effect === "freeze") {
      bankPlayer(room, player, "frozen");
      setEvent(state, "freeze", `${player.id} was frozen and banks their points.`, player.id, card);
      advanceTurn(room, player.id);
      return;
    }

    for (let draw = 0; draw < 3 && player.roundState === "playing"; draw += 1) {
      resolveDraw(room, player);
    }
    if (player.roundState === "playing") {
      setEvent(state, "flip_three", `${player.id} completed Flip Three.`, player.id, card);
    }
    return;
  }

  if (card.kind === "number" && hasDuplicateNumber(player.cards, card.value)) {
    if (player.hasSecondChance) {
      consumeSecondChance(state, player, card);
      setEvent(state, "second_chance", `${player.id} used Second Chance.`, player.id, card);
      return;
    }
    player.cards.push(card);
    player.roundState = "busted";
    player.roundScore = 0;
    setEvent(state, "bust", `${player.id} busted on ${card.value}.`, player.id, card);
    advanceTurn(room, player.id);
    return;
  }

  player.cards.push(card);
  player.roundScore = scoreCards(player.cards);
  setEvent(state, "card_drawn", `${player.id} drew ${cardLabel(card)}.`, player.id, card);

  if (uniqueNumberCount(player.cards) >= LUCKY_SEVEN_MAX_UNIQUE_CARDS) {
    player.roundScore += LUCKY_SEVEN_BONUS;
    bankPlayer(room, player, "stayed", true);
    setEvent(state, "lucky_seven", `${player.id} hit Lucky Seven.`, player.id, card);
    advanceTurn(room, player.id);
  }
}

function consumeSecondChance(state: LuckySevenState, player: LuckySevenPlayerState, duplicate: LuckySevenCard): void {
  const chanceIndex = player.cards.findIndex((card) => card.kind === "action" && card.effect === "second_chance");
  if (chanceIndex >= 0) {
    const [chance] = player.cards.splice(chanceIndex, 1);
    state.discardPile.push(chance);
  }
  state.discardPile.push(duplicate);
  player.hasSecondChance = false;
  player.roundScore = scoreCards(player.cards);
}

function bankPlayer(
  room: Room,
  player: LuckySevenPlayerState,
  roundState: "stayed" | "frozen",
  scoreAlreadyIncludesBonus = false,
): void {
  player.roundState = roundState;
  if (!scoreAlreadyIncludesBonus) player.roundScore = scoreCards(player.cards);
  player.totalScore += player.roundScore;
  room.game!.scores[player.id] = player.totalScore;
}

function advanceTurn(room: Room, completedPlayerId: string): void {
  const state = room.game!.luckySeven!;
  state.pendingDecision = undefined;
  const startIndex = state.players.findIndex((player) => player.id === completedPlayerId);
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const candidate = state.players[(startIndex + offset) % state.players.length];
    if (candidate.roundState === "playing") {
      state.activePlayerId = candidate.id;
      state.turnState = "awaiting_player";
      return;
    }
  }
  finishRound(room);
}

function finishRound(room: Room): void {
  const state = room.game!.luckySeven!;
  state.activePlayerId = undefined;
  state.pendingDecision = undefined;
  state.roundSummary = state.players.map((player) => ({
    id: player.id,
    roundPoints: player.roundState === "busted" ? 0 : player.roundScore,
    totalScore: player.totalScore,
    result: player.roundState,
  }));

  if (state.players.some((player) => player.totalScore >= LUCKY_SEVEN_TARGET_SCORE)) {
    completeMatch(room, `Round ${state.round} decides the game.`);
    return;
  }

  state.turnState = "round_summary";
  setEvent(state, "round_summary", `Round ${state.round} complete.`);
}

function startNextRound(room: Room): void {
  const state = room.game!.luckySeven!;
  for (const player of state.players) {
    state.discardPile.push(...player.cards);
  }
  state.round += 1;
  state.dealerId = nextPlayerId(state.players.map((player) => player.id), state.dealerId);
  state.players.forEach((player) => {
    player.cards = [];
    player.roundState = "playing";
    player.roundScore = 0;
    player.hasSecondChance = false;
  });
  state.roundSummary = undefined;
  state.activePlayerId = nextPlayerId(state.players.map((player) => player.id), state.dealerId);
  state.turnState = "awaiting_player";
  setEvent(state, "round_start", `Round ${state.round} begins.`);
}

function completeMatch(room: Room, message: string): void {
  const state = room.game!.luckySeven!;
  const ranked = [...state.players].sort((a, b) => b.totalScore - a.totalScore || a.id.localeCompare(b.id));
  state.finalResults = ranked.map<LuckySevenFinalResult>((player, index) => ({
    id: player.id,
    rank: index + 1,
    totalScore: player.totalScore,
  }));
  room.game!.winnerId = ranked[0]?.id;
  state.status = "complete";
  state.turnState = "complete";
  state.activePlayerId = undefined;
  setEvent(state, "game_over", message, room.game!.winnerId);
  syncRoomScores(room);
}

function syncRoomScores(room: Room): void {
  const state = room.game!.luckySeven!;
  room.players.forEach((roomPlayer) => {
    const player = state.players.find((candidate) => candidate.id === roomPlayer.id);
    roomPlayer.score = player?.totalScore ?? 0;
    roomPlayer.isReady = false;
    room.game!.scores[roomPlayer.id] = roomPlayer.score;
  });
}

function drawCard(room: Room): LuckySevenCard {
  const state = room.game!.luckySeven!;
  let deck = getDeck(state);
  if (deck.length === 0) {
    deck = state.discardPile.length > 0
      ? shuffle(state.discardPile.splice(0))
      : createDeck(room.code, state.round + 101);
    setDeck(state, deck);
  }
  const card = deck.shift()!;
  state.deckCount = deck.length;
  return card;
}

function getDeck(state: LuckySevenState): LuckySevenCard[] {
  return state.deck ?? [];
}

function setDeck(state: LuckySevenState, deck: LuckySevenCard[]): void {
  Object.defineProperty(state, "deck", {
    value: deck,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function createDeck(roomCode: string, round: number): LuckySevenCard[] {
  const cards: LuckySevenCard[] = [{ id: `r${round}_0_0`, kind: "number", value: 0 }];
  for (let value = 1; value <= 12; value += 1) {
    for (let copy = 0; copy < value; copy += 1) {
      cards.push({ id: `r${round}_${value}_${copy}`, kind: "number", value });
    }
  }
  for (const value of [2, 4, 6, 8, 10]) {
    cards.push({ id: `r${round}_plus_${value}`, kind: "modifier", effect: "plus", label: `+${value}`, value });
  }
  cards.push({ id: `r${round}_x2`, kind: "modifier", effect: "x2", label: "x2" });
  for (let copy = 0; copy < 3; copy += 1) {
    cards.push(
      { id: `r${round}_freeze_${copy}`, kind: "action", effect: "freeze", label: "Freeze" },
      { id: `r${round}_flip_three_${copy}`, kind: "action", effect: "flip_three", label: "Flip Three" },
      { id: `r${round}_second_chance_${copy}`, kind: "action", effect: "second_chance", label: "Second Chance" },
    );
  }
  return shuffle(cards);
}

function scoreCards(cards: LuckySevenCard[]): number {
  const numberTotal = cards.reduce((sum, card) => sum + (card.kind === "number" ? card.value : 0), 0);
  const multiplier = cards.some((card) => card.kind === "modifier" && card.effect === "x2") ? 2 : 1;
  const modifiers = cards.reduce(
    (sum, card) => sum + (card.kind === "modifier" && card.effect === "plus" ? card.value ?? 0 : 0),
    0,
  );
  return numberTotal * multiplier + modifiers;
}

function hasDuplicateNumber(cards: LuckySevenCard[], value: number): boolean {
  return cards.some((card) => card.kind === "number" && card.value === value);
}

function uniqueNumberCount(cards: LuckySevenCard[]): number {
  return new Set(cards.filter((card) => card.kind === "number").map((card) => card.value)).size;
}

function nextPlayerId(playerIds: string[], currentId: string): string {
  if (playerIds.length === 0) return "";
  const currentIndex = Math.max(0, playerIds.indexOf(currentId));
  return playerIds[(currentIndex + 1) % playerIds.length];
}

function findPlayingPlayer(state: LuckySevenState, startIndex: number): LuckySevenPlayerState | undefined {
  for (let offset = 0; offset < state.players.length; offset += 1) {
    const candidate = state.players[(startIndex + offset) % state.players.length];
    if (candidate.roundState === "playing") return candidate;
  }
  return undefined;
}

function setEvent(
  state: LuckySevenState,
  type: LuckySevenEvent["type"],
  message: string,
  playerId?: string,
  card?: LuckySevenCard,
): void {
  state.lastEvent = {
    sequence: (state.lastEvent?.sequence ?? 0) + 1,
    type,
    message,
    playerId,
    card,
  };
}

function shuffle(cards: LuckySevenCard[]): LuckySevenCard[] {
  const result = [...cards];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function cardLabel(card: LuckySevenCard): string {
  return card.kind === "number" ? String(card.value) : card.label;
}

function isLuckySevenInput(input: unknown): input is LuckySevenInput {
  if (!input || typeof input !== "object" || !("action" in input)) return false;
  return [
    "request_hit",
    "request_stay",
    "dealer_deal",
    "dealer_confirm_stay",
    "continue",
  ].includes(String((input as LuckySevenInput).action));
}
