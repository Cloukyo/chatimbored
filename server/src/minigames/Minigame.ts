import type { Room } from "../rooms/Room.js";
import type { GameSnapshot } from "../../../shared/message-types/protocol.js";

export type Minigame = {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  setup(room: Room): GameSnapshot;
  handleInput(room: Room, playerId: string, input: string): GameSnapshot;
  finish(room: Room): GameSnapshot;
};
