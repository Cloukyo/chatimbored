export const ROOM_CODE_LENGTH = 5;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const DEFAULT_MINIGAME_ID = "button_race";
export const BUTTON_RACE_DURATION_MS = 10_000;
export const ACT_NATURAL_DURATION_MS = 90_000;
export const ACT_NATURAL_TICK_MS = 50;
export const ACT_NATURAL_NPC_COUNT = 40;
export const ACT_NATURAL_ARENA_WIDTH = 1200;
export const ACT_NATURAL_ARENA_HEIGHT = 620;
export const ACT_NATURAL_EXIT_X = 1120;
export const ACT_NATURAL_WALK_SPEED = 70;
export const ACT_NATURAL_RUN_SPEED = 145;
export const ACT_NATURAL_NPC_SPEED = 58;
export const LOOT_AND_LEAVE_DURATION_MS = 10 * 60_000;
export const LOOT_AND_LEAVE_TICK_MS = 45;
export const LOOT_AND_LEAVE_MOVE_COOLDOWN_TICKS = 1;
export const LOOT_AND_LEAVE_STARTING_LIVES = 3;
export const LOOT_AND_LEAVE_BASE_WIDTH = 40;
export const LOOT_AND_LEAVE_HEIGHT = 23;
export const LOOT_AND_LEAVE_MAX_PLAYERS = 4;

export const LOOT_AND_LEAVE_TILES = {
  EMPTY: 0,
  WALL: 1,
  DIRT: 2,
  ROCK: 3,
  GEM: 4,
  EXIT: 5,
  RUBY: 6,
  BOMB: 7,
} as const;
