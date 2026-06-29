import { BUTTON_RACE_DURATION_MS } from "../../../shared/constants/platform.js";
import type { GameSnapshot } from "../../../shared/message-types/protocol.js";
import type { Room } from "../rooms/Room.js";
import type { Minigame } from "./Minigame.js";

export const buttonRace: Minigame = {
  id: "button_race",
  name: "Button Race",
  minPlayers: 2,
  maxPlayers: 8,

  setup(room: Room): GameSnapshot {
    const scores = Object.fromEntries(room.players.map((player) => [player.id, 0]));
    return {
      minigameId: this.id,
      name: this.name,
      endsAt: Date.now() + BUTTON_RACE_DURATION_MS,
      scores,
    };
  },

  handleInput(room: Room, playerId: string, input: string): GameSnapshot {
    if (input === "PRESS" && room.game && room.game.endsAt > Date.now()) {
      room.game.scores[playerId] = (room.game.scores[playerId] ?? 0) + 1;
    }
    return room.game!;
  },

  finish(room: Room): GameSnapshot {
    if (!room.game) throw new Error("No game is running.");

    let winnerId: string | undefined;
    let winningScore = -1;

    for (const [playerId, score] of Object.entries(room.game.scores)) {
      if (score > winningScore) {
        winnerId = playerId;
        winningScore = score;
      }
    }

    room.game.winnerId = winnerId;
    room.players.forEach((player) => {
      player.score = room.game?.scores[player.id] ?? 0;
      player.isReady = false;
    });
    return room.game;
  },
};
