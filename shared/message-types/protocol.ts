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
  silentWitness?: SilentWitnessState;
  luckySeven?: LuckySevenState;
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

export type SilentWitnessRole = "killer" | "hunter";
export type SilentWitnessResult = "killer" | "hunters";
export type SilentWitnessNpcStatus = "alive" | "dying" | "dead";

export type SilentWitnessPlayerState = {
  id: string;
  role: SilentWitnessRole;
  x: number;
  y: number;
  alive: boolean;
  shotAvailable: boolean;
  aim: Vector2Payload;
  killCooldownMs: number;
};

export type SilentWitnessNpcState = {
  id: string;
  x: number;
  y: number;
  state: SilentWitnessNpcStatus;
  dyingMs: number;
  speedX: number;
  speedY: number;
  behaviorTimer: number;
};

export type SilentWitnessShotResult = {
  shooterId: string;
  start: Vector2Payload;
  end: Vector2Payload;
  hitType: "killer" | "hunter" | "npc" | "miss";
  targetId?: string;
};

export type SilentWitnessEvent = {
  type: "kill_marked" | "npc_dead" | "shot" | "killer_hit" | "round_over";
  x?: number;
  y?: number;
  playerId?: string;
  targetId?: string;
  message: string;
};

export type SilentWitnessState = {
  arena: { width: number; height: number };
  killerId: string;
  players: SilentWitnessPlayerState[];
  npcs: SilentWitnessNpcState[];
  publicKillCount: number;
  killTarget: number;
  result?: SilentWitnessResult;
  lastShot?: SilentWitnessShotResult;
  lastEvent?: SilentWitnessEvent;
};

export type SilentWitnessInput = {
  movement: Vector2Payload;
  aim: Vector2Payload;
  targetPoint?: Vector2Payload;
  shoot: boolean;
  kill: boolean;
};

export type LuckySevenNumberCard = {
  id: string;
  kind: "number";
  value: number;
};

export type LuckySevenModifierCard = {
  id: string;
  kind: "modifier";
  effect: "plus" | "x2";
  label: string;
  value?: number;
};

export type LuckySevenActionCard = {
  id: string;
  kind: "action";
  effect: "freeze" | "flip_three" | "second_chance";
  label: string;
};

export type LuckySevenCard = LuckySevenNumberCard | LuckySevenModifierCard | LuckySevenActionCard;

export type LuckySevenRoundState = "playing" | "stayed" | "frozen" | "busted";

export type LuckySevenPlayerState = {
  id: string;
  cards: LuckySevenCard[];
  roundState: LuckySevenRoundState;
  roundScore: number;
  totalScore: number;
  hasSecondChance: boolean;
};

export type LuckySevenEvent = {
  sequence: number;
  type:
    | "round_start"
    | "requested_hit"
    | "requested_stay"
    | "card_drawn"
    | "stay"
    | "bust"
    | "second_chance"
    | "freeze"
    | "flip_three"
    | "lucky_seven"
    | "round_summary"
    | "game_over";
  playerId?: string;
  card?: LuckySevenCard;
  message: string;
};

export type LuckySevenRoundSummary = {
  id: string;
  roundPoints: number;
  totalScore: number;
  result: LuckySevenRoundState;
};

export type LuckySevenFinalResult = {
  id: string;
  rank: number;
  totalScore: number;
};

export type LuckySevenState = {
  round: number;
  deck?: LuckySevenCard[];
  deckCount: number;
  discardPile: LuckySevenCard[];
  players: LuckySevenPlayerState[];
  dealerId: string;
  activePlayerId?: string;
  pendingDecision?: "hit" | "stay";
  turnState: "awaiting_player" | "awaiting_dealer" | "round_summary" | "complete";
  targetScore: number;
  bonus: number;
  status: "playing" | "complete";
  roundSummary?: LuckySevenRoundSummary[];
  finalResults?: LuckySevenFinalResult[];
  lastEvent?: LuckySevenEvent;
};

export type LuckySevenInput = {
  action: "request_hit" | "request_stay" | "dealer_deal" | "dealer_confirm_stay" | "continue";
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

export type PlayerInputPayload = "PRESS" | ActNaturalInput | LootAndLeaveInput | SilentWitnessInput | LuckySevenInput;

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
