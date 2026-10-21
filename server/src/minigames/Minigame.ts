import type { Room } from "../rooms/Room.js";
import type { GameSnapshot } from "../../../shared/message-types/protocol.js";

export type Minigame = {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  tickMs?: number;
  // Tick-driven games stream GAME_STATE from the tick loop only; inputs don't trigger extra broadcasts.
  tickBroadcastOnly?: boolean;
  setup(room: Room): GameSnapshot;
  handleInput(room: Room, playerId: string | undefined, input: unknown): GameSnapshot;
  onPlayerLeft?(room: Room, playerId: string): GameSnapshot;
  update?(room: Room, deltaMs: number): GameSnapshot;
  finish(room: Room): GameSnapshot;
  // Per-player view of the game, for games that hide information from some players.
  snapshotFor?(room: Room, playerId: string): GameSnapshot | undefined;
};
