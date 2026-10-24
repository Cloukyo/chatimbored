import type { GameSnapshot } from "../../../shared/message-types/protocol.js";
import { PILE_UP_ID, type RaceInput } from "../../../shared/race/protocol.js";
import { TRACKS } from "../../../shared/race/track.js";
import { freshRandom, type Random } from "../crowd/random.js";
import { RaceMatch } from "../race/RaceMatch.js";
import type { Room } from "../rooms/Room.js";
import type { Minigame } from "./Minigame.js";

const TICK_MS = 50;
// A safety net: a match normally ends long before this, when someone reaches the target.
const MATCH_LIMIT_MS = 20 * 60_000;

const matches = new WeakMap<Room, RaceMatch>();

let raceRandom: () => Random = freshRandom;
export function setRaceRandomForTests(factory: () => Random): void {
  raceRandom = factory;
}

export function raceMatchFor(room: Room): RaceMatch | undefined {
  return matches.get(room);
}

export const pileUp: Minigame = {
  id: PILE_UP_ID,
  name: "Pile-Up",
  // Bots fill the grid, so one person can play alone.
  minPlayers: 1,
  maxPlayers: 8,
  tickMs: TICK_MS,
  tickBroadcastOnly: true,

  setup(room: Room): GameSnapshot {
    const random = raceRandom();
    const asked = room.gameOptions?.trackId;
    const trackId = TRACKS.some((track) => track.id === asked) ? asked! : TRACKS[Math.floor(random() * TRACKS.length)].id;
    const match = new RaceMatch(
      room.players.map((player) => ({ id: player.id, name: player.displayName })),
      random,
      trackId,
    );
    matches.set(room, match);
    return {
      minigameId: PILE_UP_ID,
      name: "Pile-Up",
      endsAt: Date.now() + MATCH_LIMIT_MS,
      scores: Object.fromEntries(room.players.map((player) => [player.id, player.score])),
      race: match.viewState(),
    };
  },

  handleInput(room: Room, playerId: string | undefined, input: unknown): GameSnapshot {
    const match = matches.get(room);
    if (match && playerId && isRaceInput(input)) match.setInput(playerId, input);
    return room.game!;
  },

  update(room: Room, deltaMs: number): GameSnapshot {
    const match = matches.get(room);
    if (!match || !room.game) return room.game!;
    for (const player of room.players) match.setAway(player.id, Boolean(player.away));
    match.step(deltaMs / 1000);
    room.game.race = match.viewState();
    if (match.finished && match.matchWinner) room.game.winnerId = match.matchWinner;
    return room.game;
  },

  onPlayerLeft(room: Room, playerId: string): GameSnapshot {
    matches.get(room)?.removeCar(playerId);
    return room.game!;
  },

  finish(room: Room): GameSnapshot {
    const match = matches.get(room);
    if (!match || !room.game) throw new Error("No Pile-Up race is running.");
    match.timeout();
    room.game.race = match.viewState();
    room.game.winnerId = match.matchWinner;
    room.players.forEach((player) => {
      if (player.id === match.matchWinner) player.score += 1;
      player.isReady = false;
      room.game!.scores[player.id] = player.score;
    });
    return room.game;
  },
};

function isRaceInput(input: unknown): input is RaceInput {
  return Boolean(input && typeof input === "object" && (input as { kind?: unknown }).kind === "race");
}
