import type { Room } from "../rooms/Room.js";
import type { GameSnapshot } from "../../../shared/message-types/protocol.js";

export type Minigame = {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  tickMs?: number;
  setup(room: Room): GameSnapshot;
  handleInput(room: Room, playerId: string | undefined, input: unknown): GameSnapshot;
  update?(room: Room, deltaMs: number): GameSnapshot;
  finish(room: Room): GameSnapshot;
};
