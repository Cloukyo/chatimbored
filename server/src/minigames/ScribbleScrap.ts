import type { GameSnapshot } from "../../../shared/message-types/protocol.js";
import { SCRIBBLE_ID, type ScribbleInput } from "../../../shared/scribble/protocol.js";
import { freshRandom, type Random } from "../crowd/random.js";
import type { Room } from "../rooms/Room.js";
import { ScribbleMatch } from "../scribble/ScribbleMatch.js";
import type { Minigame } from "./Minigame.js";

// Fast enough for The Forger's live strokes; snapshots only go out when something changed.
const TICK_MS = 100;
// A safety net: a game ends long before this.
const MATCH_LIMIT_MS = 45 * 60_000;

const matches = new WeakMap<Room, ScribbleMatch>();
const broadcastVersions = new WeakMap<Room, number>();

let scribbleRandom: () => Random = freshRandom;
export function setScribbleRandomForTests(factory: () => Random): void {
  scribbleRandom = factory;
}

export function scribbleMatchFor(room: Room): ScribbleMatch | undefined {
  return matches.get(room);
}

export const scribbleScrap: Minigame = {
  id: SCRIBBLE_ID,
  name: "Scribble Scrap",
  minPlayers: 3,
  maxPlayers: 8,
  tickMs: TICK_MS,
  tickBroadcastOnly: true,

  setup(room: Room): GameSnapshot {
    const players = room.players.filter((player) => !player.screen);
    const match = new ScribbleMatch(
      players.map((player) => ({ id: player.id, name: player.displayName })),
      scribbleRandom(),
      room.gameOptions?.scribbleMode ?? "night",
      { blind: room.gameOptions?.blind },
    );
    matches.set(room, match);
    broadcastVersions.delete(room);
    return {
      minigameId: SCRIBBLE_ID,
      name: "Scribble Scrap",
      endsAt: Date.now() + MATCH_LIMIT_MS,
      scores: Object.fromEntries(room.players.map((player) => [player.id, player.score])),
    };
  },

  handleInput(room: Room, playerId: string | undefined, input: unknown): GameSnapshot {
    const match = matches.get(room);
    if (match && playerId && isScribbleInput(input)) match.input(playerId, input, room.hostId === playerId);
    return room.game!;
  },

  update(room: Room, deltaMs: number): GameSnapshot {
    const match = matches.get(room);
    if (!match || !room.game) return room.game!;
    for (const player of room.players) if (!player.screen) match.setAway(player.id, Boolean(player.away));
    match.tick(deltaMs);
    if (match.finished && match.winnerId) room.game.winnerId = match.winnerId;
    return room.game;
  },

  shouldBroadcast(room: Room): boolean {
    const match = matches.get(room);
    if (!match || broadcastVersions.get(room) === match.version) return false;
    broadcastVersions.set(room, match.version);
    return true;
  },

  onPlayerLeft(room: Room, playerId: string): GameSnapshot {
    const match = matches.get(room);
    match?.remove(playerId);
    if (match?.finished && room.game) room.game.winnerId = match.winnerId;
    return room.game!;
  },

  finish(room: Room): GameSnapshot {
    const match = matches.get(room);
    if (!match || !room.game) throw new Error("No Scribble Scrap game is running.");
    if (!match.finished) match.end();
    room.game.winnerId = match.winnerId;
    room.players.forEach((player) => {
      if (player.id === match.winnerId) player.score += 1;
      player.isReady = Boolean(player.screen);
      room.game!.scores[player.id] = player.score;
    });
    return room.game;
  },

  snapshotFor(room: Room, playerId: string): GameSnapshot | undefined {
    const match = matches.get(room);
    if (!room.game) return undefined;
    return { ...room.game, scores: { ...room.game.scores }, scribble: match?.view(playerId) };
  },
};

function isScribbleInput(input: unknown): input is ScribbleInput {
  return Boolean(input && typeof input === "object" && (input as { kind?: unknown }).kind === "scribble");
}
