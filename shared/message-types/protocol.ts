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
  actNatural?: ActNaturalState;
  lootAndLeave?: LootAndLeaveState;
};

export type Vector2Payload = {
  x: number;
  y: number;
};

export type ActNaturalPlayerState = {
  id: string;
  x: number;
  y: number;
  alive: boolean;
  shotAvailable: boolean;
  aim: Vector2Payload;
  running: boolean;
};

export type ActNaturalNpcState = {
  id: string;
  x: number;
  y: number;
  speed: number;
  drift: number;
  behaviorTimer: number;
};

export type ActNaturalShotResult = {
  shooterId: string;
  start: Vector2Payload;
  end: Vector2Payload;
  hitType: "player" | "npc" | "miss";
  targetId?: string;
};

export type ActNaturalState = {
  arena: { width: number; height: number; exitX: number };
  players: ActNaturalPlayerState[];
  npcs: ActNaturalNpcState[];
  lastShot?: ActNaturalShotResult;
};

export type ActNaturalInput = {
  movement: Vector2Payload;
  aim: Vector2Payload;
  targetPoint?: Vector2Payload;
  shoot: boolean;
  run: boolean;
};

export type LootAndLeavePlayerState = {
  id: string;
  x: number;
  y: number;
  spawnX: number;
  spawnY: number;
  lives: number;
  carriedCash: number;
  bankedCash: number;
  alive: boolean;
  escaped: boolean;
  out: boolean;
  moveCooldownTicks: number;
  facing: Vector2Payload;
};

export type LootAndLeaveSlimeState = {
  id: string;
  x: number;
  y: number;
  cooldownTicks: number;
};

export type LootAndLeaveBagState = {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  cash: number;
};

export type LootAndLeaveEvent = {
  type:
    | "gem"
    | "dig"
    | "loot_drop"
    | "loot_recover"
    | "player_hit"
    | "rock_impact"
    | "bomb_explode"
    | "slime_hit"
    | "earthquake"
    | "exit_unlocked"
    | "escaped"
    | "level_start"
    | "match_over";
  x?: number;
  y?: number;
  playerId?: string;
  cash?: number;
  message: string;
};

export type LootAndLeaveState = {
  level: number;
  seed: number;
  tick: number;
  cave: { width: number; height: number; tiles: number[] };
  players: LootAndLeavePlayerState[];
  slimes: LootAndLeaveSlimeState[];
  lootBags: LootAndLeaveBagState[];
  exit: { x: number; y: number };
  exitUnlocked: boolean;
  exitUnlockThreshold: number;
  gemsCollected: number;
  threatLevel: number;
  earthquakeWarning: boolean;
  nextEarthquakeTick: number;
  earthquakeWarningTick: number;
  message: string;
  lastEvent?: LootAndLeaveEvent;
};

export type LootAndLeaveInput = {
  movement: Vector2Payload;
  sequence?: number;
};

export type PlayerInputPayload = "PRESS" | ActNaturalInput | LootAndLeaveInput;

export type ClientMessage =
  | { type: "CREATE_ROOM"; displayName: string }
  | { type: "JOIN_ROOM"; roomCode: string; displayName: string }
  | { type: "LEAVE_ROOM" }
  | { type: "PLAYER_READY"; isReady: boolean }
  | { type: "START_GAME"; minigameId?: string }
  | { type: "PLAYER_INPUT"; input: PlayerInputPayload }
  | { type: "RETURN_TO_LOBBY" };

export type ServerMessage =
  | { type: "ROOM_STATE"; room: RoomSnapshot; playerId: string }
  | { type: "GAME_STATE"; game: GameSnapshot }
  | { type: "GAME_OVER"; game: GameSnapshot; winnerId?: string }
  | { type: "RETURN_TO_LOBBY"; room: RoomSnapshot }
  | { type: "ERROR"; message: string };
