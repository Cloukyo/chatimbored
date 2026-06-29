export const MESSAGE_TYPES = {
  CREATE_ROOM: "CREATE_ROOM",
  JOIN_ROOM: "JOIN_ROOM",
  LEAVE_ROOM: "LEAVE_ROOM",
  ROOM_STATE: "ROOM_STATE",
  PLAYER_READY: "PLAYER_READY",
  START_GAME: "START_GAME",
  PLAYER_INPUT: "PLAYER_INPUT",
  GAME_STATE: "GAME_STATE",
  GAME_OVER: "GAME_OVER",
  RETURN_TO_LOBBY: "RETURN_TO_LOBBY",
  ERROR: "ERROR",
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

export type PlayerSnapshot = {
  id: string;
  displayName: string;
  isHost: boolean;
  isReady: boolean;
  score: number;
};

export type RoomPhase = "lobby" | "in_game" | "results";

export type RoomSnapshot = {
  code: string;
  phase: RoomPhase;
  hostId: string;
  selectedMinigameId: string;
  players: PlayerSnapshot[];
  game?: GameSnapshot;
};

export type GameSnapshot = {
  minigameId: string;
  name: string;
  endsAt: number;
  scores: Record<string, number>;
  winnerId?: string;
};

export type ClientMessage =
  | { type: "CREATE_ROOM"; displayName: string }
  | { type: "JOIN_ROOM"; roomCode: string; displayName: string }
  | { type: "LEAVE_ROOM" }
  | { type: "PLAYER_READY"; isReady: boolean }
  | { type: "START_GAME"; minigameId?: string }
  | { type: "PLAYER_INPUT"; input: "PRESS" }
  | { type: "RETURN_TO_LOBBY" };

export type ServerMessage =
  | { type: "ROOM_STATE"; room: RoomSnapshot; playerId: string }
  | { type: "GAME_STATE"; game: GameSnapshot }
  | { type: "GAME_OVER"; game: GameSnapshot; winnerId?: string }
  | { type: "RETURN_TO_LOBBY"; room: RoomSnapshot }
  | { type: "ERROR"; message: string };
