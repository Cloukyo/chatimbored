import {
  LOOT_AND_LEAVE_BASE_WIDTH,
  LOOT_AND_LEAVE_DURATION_MS,
  LOOT_AND_LEAVE_HEIGHT,
  LOOT_AND_LEAVE_MOVE_COOLDOWN_TICKS,
  LOOT_AND_LEAVE_STARTING_LIVES,
  LOOT_AND_LEAVE_TICK_MS,
  LOOT_AND_LEAVE_TILES,
} from "../../../shared/constants/platform.js";
import type {
  GameSnapshot,
  LootAndLeaveEvent,
  LootAndLeaveInput,
  LootAndLeavePlayerState,
  LootAndLeaveSlimeState,
  LootAndLeaveState,
  Vector2Payload,
} from "../../../shared/message-types/protocol.js";
import type { Room } from "../rooms/Room.js";
import type { Minigame } from "./Minigame.js";

const T = LOOT_AND_LEAVE_TILES;
const WOBBLE_TICKS = 3;
const EARTHQUAKE_WARNING_TICKS = 24;
const SLIME_TICK_INTERVAL = 6;
const SLIME_HIT_COOLDOWN_TICKS = 12;
const MAX_THREAT_LEVEL = 5;
const GEM_CASH = 100;
const RUBY_CASH = 500;

type Direction = { x: -1 | 0 | 1; y: -1 | 0 | 1 };
type MovementCommand = { direction: Direction; sequence?: number };
type RoomInputState = {
  pending: Map<string, MovementCommand[]>;
  lastSequences: Map<string, number>;
};
const MAX_PENDING_MOVES = 2;

const roomInputs = new Map<string, RoomInputState>();

export const lootAndLeave: Minigame = {
  id: "loot_and_leave",
  name: "Loot & Leave",
  minPlayers: 2,
  maxPlayers: 4,
  tickMs: LOOT_AND_LEAVE_TICK_MS,

  setup(room: Room): GameSnapshot {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const state = createLevel(room.players.map((player) => player.id), 1, seed);
    roomInputs.set(room.code, { pending: new Map(), lastSequences: new Map() });
    return {
      minigameId: this.id,
      name: this.name,
      endsAt: Date.now() + LOOT_AND_LEAVE_DURATION_MS,
      scores: Object.fromEntries(room.players.map((player) => [player.id, 0])),
      lootAndLeave: state,
    };
  },

  handleInput(room: Room, playerId: string | undefined, input: unknown): GameSnapshot {
    if (!room.game?.lootAndLeave || !playerId || !isLootInput(input)) return room.game!;
    const player = room.game.lootAndLeave.players.find((candidate) => candidate.id === playerId);
    if (!player || !player.alive || player.escaped || player.out || room.game.winnerId) return room.game;
    const movement = cardinal(input.movement);
    if (movement.x === 0 && movement.y === 0) return room.game;
    const inputs = roomInputs.get(room.code);
    if (!inputs) return room.game;
    const sequence = readInputSequence(input.sequence);
    if (sequence !== undefined) {
      const lastSequence = inputs.lastSequences.get(playerId) ?? 0;
      if (sequence <= lastSequence) return room.game;
      inputs.lastSequences.set(playerId, sequence);
    }
    const queue = inputs.pending.get(playerId) ?? [];
    queue.push({ direction: movement, sequence });
    inputs.pending.set(playerId, queue.slice(-MAX_PENDING_MOVES));
    return room.game;
  },

  update(room: Room, deltaMs: number): GameSnapshot {
    const game = room.game?.lootAndLeave;
    if (!game || room.game?.winnerId) return room.game!;

    const ticks = Math.max(1, Math.floor(deltaMs / LOOT_AND_LEAVE_TICK_MS));
    for (let i = 0; i < ticks && !room.game?.winnerId; i += 1) {
      step(room, game);
    }
    return room.game!;
  },

  finish(room: Room): GameSnapshot {
    if (!room.game?.lootAndLeave) throw new Error("No Loot & Leave round is running.");
    room.game.winnerId = room.game.winnerId ?? winnerId(room.game.lootAndLeave.players);
    room.players.forEach((player) => {
      const state = room.game?.lootAndLeave?.players.find((candidate) => candidate.id === player.id);
      player.score = (state?.bankedCash ?? 0) + (state?.carriedCash ?? 0);
      player.isReady = false;
    });
    roomInputs.delete(room.code);
    return room.game;
  },
};

function step(room: Room, game: LootAndLeaveState): void {
  game.tick += 1;
  game.earthquakeWarning = false;
  game.lastEvent = undefined;

  applyPlayerCommands(room, game);
  updateThreat(game);
  applyEarthquake(game);
  applyGravity(game);
  updateSlimes(game);
  checkExit(game);

  const standing = game.players.filter((player) => player.alive && !player.out && !player.escaped);
  if (standing.length === 1 && game.players.some((player) => player.out)) {
    room.game!.winnerId = standing[0]!.id;
    game.lastEvent = event("match_over", "Last explorer standing.", standing[0]!.x, standing[0]!.y, standing[0]!.id);
    return;
  }

  if (game.players.every((player) => player.out)) {
    room.game!.winnerId = winnerId(game.players);
    game.lastEvent = event("match_over", "Expedition over.");
    return;
  }

  const active = game.players.filter((player) => !player.out);
  if (active.length > 0 && active.every((player) => player.escaped)) {
    if (game.level >= 5) {
      room.game!.winnerId = winnerId(game.players);
      game.lastEvent = event("match_over", "Level five cleared.");
      return;
    }
    const next = createLevel(
      game.players.map((player) => player.id),
      game.level + 1,
      nextSeed(game.seed, game.level),
      game.players,
    );
    room.game!.lootAndLeave = next;
  }
}

function applyPlayerCommands(room: Room, game: LootAndLeaveState): void {
  const inputs = roomInputs.get(room.code);
  if (!inputs) return;
  for (const player of game.players) {
    if (!player.alive || player.escaped || player.out) continue;
    if (player.moveCooldownTicks > 0) {
      player.moveCooldownTicks -= 1;
      continue;
    }
    const queue = inputs.pending.get(player.id);
    const command = queue?.shift();
    if (!command) continue;
    if (queue && queue.length > 0) inputs.pending.set(player.id, queue);
    else inputs.pending.delete(player.id);
    const direction = command.direction;
    if (direction.x === 0 && direction.y === 0) continue;
    tryMove(game, player, direction);
    player.moveCooldownTicks = Math.max(player.moveCooldownTicks, LOOT_AND_LEAVE_MOVE_COOLDOWN_TICKS);
  }
}

function tryMove(game: LootAndLeaveState, player: LootAndLeavePlayerState, direction: Direction): void {
  const target = { x: player.x + direction.x, y: player.y + direction.y };
  if (Math.abs(direction.x) + Math.abs(direction.y) !== 1 || !inBounds(game, target.x, target.y)) return;
  player.facing = direction;

  if (slimeAt(game, target.x, target.y)) {
    damagePlayer(game, player, "slime_hit");
    return;
  }

  const tile = getTile(game, target.x, target.y);
  if (tile === T.WALL || tile === T.ROCK || tile === T.BOMB) return;
  if (tile === T.DIRT) {
    setTile(game, target.x, target.y, T.EMPTY);
    player.moveCooldownTicks = 1;
    game.lastEvent = event("dig", "Digging through dirt.", target.x, target.y, player.id);
  } else if (tile === T.GEM || tile === T.RUBY) {
    setTile(game, target.x, target.y, T.EMPTY);
    const cash = tile === T.RUBY ? RUBY_CASH : GEM_CASH;
    player.carriedCash += cash;
    game.gemsCollected += tile === T.RUBY ? 5 : 1;
    game.lastEvent = event("gem", `Collected $${cash}.`, target.x, target.y, player.id, cash);
  }

  player.x = target.x;
  player.y = target.y;
  recoverLootBag(game, player);
}

function applyGravity(game: LootAndLeaveState): void {
  const moved = new Set<string>();
  for (let y = game.cave.height - 2; y >= 1; y -= 1) {
    for (let x = 1; x < game.cave.width - 1; x += 1) {
      const key = posKey(x, y);
      const tile = getTile(game, x, y);
      if (moved.has(key) || !isFallingObject(tile)) continue;
      const below = { x, y: y + 1 };
      const rock = game as LootAndLeaveState & { rockWobbleTicks?: Record<string, number>; fallingRocks?: Record<string, boolean> };
      rock.rockWobbleTicks ??= {};
      rock.fallingRocks ??= {};
      const isFalling = Boolean(rock.fallingRocks[key]);
      const player = playerAt(game, below.x, below.y);
      const belowTile = getTile(game, below.x, below.y);

      if (player && isFalling) {
        if (tile === T.BOMB) explodeBomb(game, x, y);
        else {
          damagePlayer(game, player, "player_hit");
          moveRock(game, x, y, below.x, below.y, false, moved, tile);
        }
      } else if (player) {
        delete rock.rockWobbleTicks[key];
        delete rock.fallingRocks[key];
      } else if (slimeAt(game, below.x, below.y) && isFalling) {
        if (tile === T.BOMB) explodeBomb(game, x, y);
        else {
          game.slimes = game.slimes.filter((slime) => slime.x !== below.x || slime.y !== below.y);
          moveRock(game, x, y, below.x, below.y, false, moved, tile);
        }
      } else if (belowTile === T.EMPTY) {
        const wobble = rock.rockWobbleTicks[key] ?? 0;
        if (isFalling || wobble >= WOBBLE_TICKS) {
          moveRock(game, x, y, below.x, below.y, true, moved, tile);
        } else {
          rock.rockWobbleTicks[key] = wobble + 1;
        }
      } else {
        if (tile === T.BOMB && isFalling) {
          explodeBomb(game, x, y);
        } else {
          if (isFalling) game.lastEvent = event("rock_impact", "Rock landed.", x, y);
          delete rock.rockWobbleTicks[key];
          delete rock.fallingRocks[key];
          tryRollRock(game, x, y, belowTile, moved, tile);
        }
      }
    }
  }
}

function tryRollRock(game: LootAndLeaveState, x: number, y: number, belowTile: number, moved: Set<string>, tile: number): void {
  if (!canRollOff(belowTile)) return;
  const directions = (game.seed + game.tick + x + y) % 2 === 0 ? [1, -1] : [-1, 1];
  for (const dx of directions) {
    const side = { x: x + dx, y };
    const diagonal = { x: x + dx, y: y + 1 };
    if (isClearForRock(game, side.x, side.y) && isClearForRock(game, diagonal.x, diagonal.y)) {
      moveRock(game, x, y, side.x, side.y, true, moved, tile);
      return;
    }
  }
}

function canRollOff(tile: number): boolean {
  return tile === T.ROCK || tile === T.BOMB || tile === T.GEM || tile === T.RUBY || tile === T.WALL || tile === T.DIRT;
}

function isClearForRock(game: LootAndLeaveState, x: number, y: number): boolean {
  return getTile(game, x, y) === T.EMPTY && !playerAt(game, x, y) && !slimeAt(game, x, y);
}

function moveRock(
  game: LootAndLeaveState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  falling: boolean,
  moved: Set<string>,
  tile: number,
): void {
  const rock = game as LootAndLeaveState & { rockWobbleTicks?: Record<string, number>; fallingRocks?: Record<string, boolean> };
  rock.rockWobbleTicks ??= {};
  rock.fallingRocks ??= {};
  delete rock.rockWobbleTicks[posKey(fromX, fromY)];
  delete rock.fallingRocks[posKey(fromX, fromY)];
  setTile(game, fromX, fromY, T.EMPTY);
  setTile(game, toX, toY, tile);
  moved.add(posKey(toX, toY));
  if (falling) rock.fallingRocks[posKey(toX, toY)] = true;
  else game.lastEvent = event("rock_impact", "Rock landed.", toX, toY);
}

function isFallingObject(tile: number): boolean {
  return tile === T.ROCK || tile === T.BOMB;
}

function explodeBomb(game: LootAndLeaveState, x: number, y: number): void {
  const rock = game as LootAndLeaveState & { rockWobbleTicks?: Record<string, number>; fallingRocks?: Record<string, boolean> };
  rock.rockWobbleTicks ??= {};
  rock.fallingRocks ??= {};
  for (let py = y - 1; py <= y + 1; py += 1) {
    for (let px = x - 1; px <= x + 1; px += 1) {
      if (!inBounds(game, px, py)) continue;
      const tile = getTile(game, px, py);
      if (tile === T.WALL || tile === T.EXIT) continue;
      const player = playerAt(game, px, py);
      if (player) damagePlayer(game, player, "player_hit");
      game.slimes = game.slimes.filter((slime) => slime.x !== px || slime.y !== py);
      delete rock.rockWobbleTicks[posKey(px, py)];
      delete rock.fallingRocks[posKey(px, py)];
      setTile(game, px, py, T.EMPTY);
    }
  }
  game.lastEvent = event("bomb_explode", "Bomb exploded.", x, y);
}

function updateSlimes(game: LootAndLeaveState): void {
  for (const slime of game.slimes) {
    if (slime.cooldownTicks > 0) slime.cooldownTicks -= 1;
    const touching = playerAt(game, slime.x, slime.y) ?? adjacentPlayer(game, slime.x, slime.y);
    if (touching && slime.cooldownTicks <= 0) {
      damagePlayer(game, touching, "slime_hit");
      slime.cooldownTicks = SLIME_HIT_COOLDOWN_TICKS;
    }
  }
  if (game.tick % SLIME_TICK_INTERVAL !== 0) return;
  for (const slime of game.slimes) {
    const target = nearestVulnerablePlayer(game, slime);
    if (!target) continue;
    const direction = slimeDirection(game, slime, target);
    const next = { x: slime.x + direction.x, y: slime.y + direction.y };
    const player = playerAt(game, next.x, next.y);
    if (player && slime.cooldownTicks <= 0) {
      damagePlayer(game, player, "slime_hit");
      slime.cooldownTicks = SLIME_HIT_COOLDOWN_TICKS;
      continue;
    }
    if (getTile(game, next.x, next.y) === T.EMPTY && !slimeAt(game, next.x, next.y)) {
      slime.x = next.x;
      slime.y = next.y;
    }
  }
}

function damagePlayer(game: LootAndLeaveState, player: LootAndLeavePlayerState, type: LootAndLeaveEvent["type"]): void {
  if (!player.alive || player.out || player.escaped) return;
  if (player.carriedCash > 0) {
    game.lootBags = game.lootBags.filter((bag) => bag.ownerId !== player.id);
    game.lootBags.push({ id: `bag_${player.id}`, ownerId: player.id, x: player.x, y: player.y, cash: player.carriedCash });
    player.carriedCash = 0;
  }
  player.lives = Math.max(0, player.lives - 1);
  if (player.lives <= 0) {
    player.alive = false;
    player.out = true;
    player.escaped = false;
  } else {
    player.x = player.spawnX;
    player.y = player.spawnY;
    player.moveCooldownTicks = 0;
  }
  game.lastEvent = event(type, `${player.id} lost a life.`, player.x, player.y, player.id);
}

function recoverLootBag(game: LootAndLeaveState, player: LootAndLeavePlayerState): void {
  const bag = game.lootBags.find((candidate) => candidate.x === player.x && candidate.y === player.y);
  if (!bag) return;
  player.carriedCash += bag.cash;
  game.lootBags = game.lootBags.filter((candidate) => candidate !== bag);
  game.lastEvent = event("loot_recover", `Recovered $${bag.cash}.`, player.x, player.y, player.id, bag.cash);
}

function checkExit(game: LootAndLeaveState): void {
  if (!game.exitUnlocked && game.gemsCollected >= game.exitUnlockThreshold) {
    game.exitUnlocked = true;
    game.message = "Exit unlocked. Leave now or get greedy.";
    game.lastEvent = event("exit_unlocked", game.message, game.exit.x, game.exit.y);
  }
  if (!game.exitUnlocked) return;
  for (const player of game.players) {
    if (!player.alive || player.out || player.escaped) continue;
    if (player.x === game.exit.x && player.y === game.exit.y) {
      player.bankedCash += player.carriedCash;
      player.carriedCash = 0;
      player.escaped = true;
      game.lastEvent = event("escaped", `${player.id} escaped with banked cash.`, player.x, player.y, player.id);
    }
  }
}

function createLevel(
  playerIds: string[],
  level: number,
  seed: number,
  previousPlayers: LootAndLeavePlayerState[] = [],
): LootAndLeaveState {
  const rng = mulberry32(seed + level * 101);
  const width = LOOT_AND_LEAVE_BASE_WIDTH + Math.max(0, playerIds.length - 2) * 4;
  const height = LOOT_AND_LEAVE_HEIGHT;
  const cave: LootAndLeaveState["cave"] = { width, height, tiles: Array.from({ length: width * height }, () => T.DIRT) };
  const set = (x: number, y: number, tile: number) => {
    cave.tiles[y * width + x] = tile;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) set(x, y, T.WALL);
    }
  }

  const spawn = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  const exit = chooseCornerExit(rng, width, height);
  carveRoom(cave, spawn.x, spawn.y, 2, 1);
  carveRoom(cave, exit.x, exit.y, 2, 1);
  carveTunnel(cave, spawn, exit);
  set(exit.x, exit.y, T.EXIT);

  const gemTarget = 12 + level * 4 + playerIds.length * 3;
  const rockTarget = 10 + level * 7;
  const bombTarget = level + 1;
  const slimeTarget = level + 1;
  placeTiles(cave, rng, gemTarget, T.GEM, spawn, exit);
  placeTiles(cave, rng, Math.max(1, level), T.RUBY, spawn, exit);
  placeRocks(cave, rng, rockTarget, spawn, exit);
  placeBombs(cave, rng, bombTarget, spawn, exit);

  const players = playerIds.map((id, index) => {
    const previous = previousPlayers.find((candidate) => candidate.id === id);
    const x = spawn.x + (index % 2);
    const y = spawn.y + Math.floor(index / 2);
    return {
      id,
      x,
      y,
      spawnX: x,
      spawnY: y,
      lives: previous?.lives ?? LOOT_AND_LEAVE_STARTING_LIVES,
      carriedCash: 0,
      bankedCash: previous?.bankedCash ?? 0,
      alive: !previous?.out,
      escaped: false,
      out: previous?.out ?? false,
      moveCooldownTicks: 0,
      facing: { x: 1, y: 0 },
    };
  });

  const slimes: LootAndLeaveSlimeState[] = [];
  for (let index = 0; index < slimeTarget; index += 1) {
    const pos = findEmpty(cave, rng, spawn, exit);
    slimes.push({ id: `slime_${level}_${index}`, x: pos.x, y: pos.y, cooldownTicks: 0 });
  }

  return {
    level,
    seed,
    tick: 0,
    cave,
    players,
    slimes,
    lootBags: [],
    exit,
    exitUnlocked: false,
    exitUnlockThreshold: 3 + Math.floor(rng() * 4) + level,
    gemsCollected: 0,
    threatLevel: 0,
    earthquakeWarning: false,
    nextEarthquakeTick: scheduleEarthquakeTick(0, level, 0, seed),
    earthquakeWarningTick: Math.max(1, scheduleEarthquakeTick(0, level, 0, seed) - EARTHQUAKE_WARNING_TICKS),
    message: `Level ${level}. Grab loot and find the exit.`,
    lastEvent: event("level_start", `Level ${level}.`),
  };
}

function placeBombs(cave: LootAndLeaveState["cave"], rng: () => number, count: number, spawn: { x: number; y: number }, exit: { x: number; y: number }): void {
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < 5000) {
    attempts += 1;
    const x = 2 + Math.floor(rng() * (cave.width - 4));
    const y = 2 + Math.floor(rng() * (cave.height - 5));
    if (distance({ x, y }, spawn) < 6 || distance({ x, y }, exit) < 4) continue;
    if (cave.tiles[y * cave.width + x] !== T.DIRT) continue;
    if (cave.tiles[(y + 1) * cave.width + x] !== T.DIRT && cave.tiles[(y + 1) * cave.width + x] !== T.WALL) continue;
    cave.tiles[y * cave.width + x] = T.BOMB;
    placed += 1;
  }
}

function chooseCornerExit(rng: () => number, width: number, height: number): { x: number; y: number } {
  const corners = [
    { x: 4, y: 4 },
    { x: width - 5, y: 4 },
    { x: 4, y: height - 5 },
    { x: width - 5, y: height - 5 },
  ];
  return corners[Math.floor(rng() * corners.length)]!;
}

function carveTunnel(cave: LootAndLeaveState["cave"], from: { x: number; y: number }, to: { x: number; y: number }): void {
  const pos = { ...from };
  while (pos.x !== to.x) {
    pos.x += Math.sign(to.x - pos.x);
    clearTunnelCell(cave, pos.x, pos.y);
  }
  while (pos.y !== to.y) {
    pos.y += Math.sign(to.y - pos.y);
    clearTunnelCell(cave, pos.x, pos.y);
  }
}

function clearTunnelCell(cave: LootAndLeaveState["cave"], x: number, y: number): void {
  for (const offset of [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
  ]) {
    const px = x + offset.x;
    const py = y + offset.y;
    if (px > 1 && py > 1 && px < cave.width - 2 && py < cave.height - 2) {
      cave.tiles[py * cave.width + px] = T.EMPTY;
    }
  }
}

function placeTiles(
  cave: LootAndLeaveState["cave"],
  rng: () => number,
  count: number,
  tile: number,
  spawn: { x: number; y: number },
  exit: { x: number; y: number },
): void {
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < 5000) {
    attempts += 1;
    const x = 2 + Math.floor(rng() * (cave.width - 4));
    const y = 2 + Math.floor(rng() * (cave.height - 4));
    if (distance({ x, y }, spawn) < 4 || distance({ x, y }, exit) < 3 || getTile({ cave } as LootAndLeaveState, x, y) !== T.DIRT) {
      continue;
    }
    setTile({ cave } as LootAndLeaveState, x, y, tile);
    placed += 1;
  }
}

function placeRocks(cave: LootAndLeaveState["cave"], rng: () => number, count: number, spawn: { x: number; y: number }, exit: { x: number; y: number }): void {
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < 5000) {
    attempts += 1;
    const x = 2 + Math.floor(rng() * (cave.width - 4));
    const y = 2 + Math.floor(rng() * (cave.height - 5));
    if (distance({ x, y }, spawn) < 5 || distance({ x, y }, exit) < 3) continue;
    if (cave.tiles[y * cave.width + x] !== T.DIRT) continue;
    if (cave.tiles[(y + 1) * cave.width + x] !== T.DIRT && cave.tiles[(y + 1) * cave.width + x] !== T.WALL) continue;
    cave.tiles[y * cave.width + x] = T.ROCK;
    placed += 1;
  }
}

function carveRoom(cave: LootAndLeaveState["cave"], centerX: number, centerY: number, rx: number, ry: number): void {
  for (let y = centerY - ry; y <= centerY + ry; y += 1) {
    for (let x = centerX - rx; x <= centerX + rx; x += 1) {
      if (x > 0 && y > 0 && x < cave.width - 1 && y < cave.height - 1) cave.tiles[y * cave.width + x] = T.EMPTY;
    }
  }
}

function findEmpty(cave: LootAndLeaveState["cave"], rng: () => number, spawn: { x: number; y: number }, exit: { x: number; y: number }): { x: number; y: number } {
  for (let attempts = 0; attempts < 1000; attempts += 1) {
    const x = 2 + Math.floor(rng() * (cave.width - 4));
    const y = 2 + Math.floor(rng() * (cave.height - 4));
    if (distance({ x, y }, spawn) < 7 || distance({ x, y }, exit) < 4) continue;
    if (cave.tiles[y * cave.width + x] === T.DIRT) cave.tiles[y * cave.width + x] = T.EMPTY;
    if (cave.tiles[y * cave.width + x] === T.EMPTY) return { x, y };
  }
  return { x: exit.x - 3, y: exit.y };
}

function updateThreat(game: LootAndLeaveState): void {
  const next = Math.min(MAX_THREAT_LEVEL, Math.floor(game.gemsCollected / Math.max(2, game.exitUnlockThreshold)));
  if (next > game.threatLevel) {
    game.threatLevel = next;
    game.message = `Threat ${next}. The cave is waking up.`;
  }
}

function applyEarthquake(game: LootAndLeaveState): void {
  if (game.nextEarthquakeTick <= 0) {
    scheduleNextEarthquake(game);
    return;
  }
  if (game.tick >= game.earthquakeWarningTick && game.tick < game.nextEarthquakeTick) {
    game.earthquakeWarning = true;
    if (!game.lastEvent) game.lastEvent = event("earthquake", "The cave trembles...");
    return;
  }
  if (game.tick < game.nextEarthquakeTick) return;

  const quake = shatterDirtClusters(game);
  scheduleNextEarthquake(game);
  game.earthquakeWarning = false;
  game.lastEvent = event(
    "earthquake",
    quake.broken > 0 ? `Earthquake! ${quake.broken} tiles crumbled.` : "Earthquake!",
    quake.x,
    quake.y,
  );
}

function scheduleNextEarthquake(game: LootAndLeaveState): void {
  game.nextEarthquakeTick = scheduleEarthquakeTick(game.tick, game.level, game.threatLevel, game.seed);
  game.earthquakeWarningTick = Math.max(game.tick + 1, game.nextEarthquakeTick - EARTHQUAKE_WARNING_TICKS);
}

function scheduleEarthquakeTick(tick: number, level: number, threatLevel: number, seed: number): number {
  const interval = Math.max(55, 230 - level * 18 - threatLevel * 24);
  return tick + interval + Math.floor(seededNoise(seed + tick * 19 + level * 37 + threatLevel * 53) * 24);
}

function shatterDirtClusters(game: LootAndLeaveState): { broken: number; x?: number; y?: number } {
  const clusters = 1 + Math.floor(game.threatLevel / 2) + Math.floor(Math.max(game.level - 1, 0) / 2);
  let broken = 0;
  let firstCenter: { x: number; y: number } | undefined;
  for (let i = 0; i < clusters; i += 1) {
    const center = chooseQuakeCenter(game, i);
    if (!center) continue;
    firstCenter ??= center;
    broken += clearQuakeCluster(game, center, i);
  }
  return { broken, x: firstCenter?.x, y: firstCenter?.y };
}

function chooseQuakeCenter(game: LootAndLeaveState, salt: number): { x: number; y: number } | undefined {
  const bombs = bombPositions(game);
  if (bombs.length > 0) {
    const bomb = bombs[Math.floor(seededNoise(game.seed + game.tick * 31 + salt) * bombs.length)]!;
    for (const offset of [
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 },
    ]) {
      const pos = { x: bomb.x + offset.x, y: bomb.y + offset.y };
      if (isSafeDirtToCrumble(game, pos.x, pos.y)) return pos;
    }
  }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const noise = seededNoise(game.seed + game.tick * 101 + salt * 997 + attempt * 17);
    const x = 1 + Math.floor(noise * (game.cave.width - 2));
    const y = 1 + Math.floor(seededNoise(game.seed + game.tick * 131 + salt * 571 + attempt * 29) * (game.cave.height - 2));
    if (isSafeDirtToCrumble(game, x, y)) return { x, y };
  }
  return undefined;
}

function clearQuakeCluster(game: LootAndLeaveState, center: { x: number; y: number }, salt: number): number {
  let broken = 0;
  const offsets = [
    { x: 0, y: 0 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
  ];
  offsets.forEach((offset, index) => {
    if (index > 0 && seededNoise(game.seed + game.tick * 71 + salt * 11 + index * 23) > 0.62) return;
    const x = center.x + offset.x;
    const y = center.y + offset.y;
    if (!isSafeDirtToCrumble(game, x, y)) return;
    setTile(game, x, y, T.EMPTY);
    broken += 1;
  });
  return broken;
}

function isSafeDirtToCrumble(game: LootAndLeaveState, x: number, y: number): boolean {
  if (!inBounds(game, x, y) || getTile(game, x, y) !== T.DIRT) return false;
  if (playerAt(game, x, y) || (game.exit.x === x && game.exit.y === y)) return false;
  if (game.players.some((player) => player.spawnX === x && player.spawnY === y)) return false;
  return true;
}

function bombPositions(game: LootAndLeaveState): { x: number; y: number }[] {
  const bombs: { x: number; y: number }[] = [];
  for (let y = 1; y < game.cave.height - 1; y += 1) {
    for (let x = 1; x < game.cave.width - 1; x += 1) {
      if (getTile(game, x, y) === T.BOMB) bombs.push({ x, y });
    }
  }
  return bombs;
}

function nearestVulnerablePlayer(game: LootAndLeaveState, slime: LootAndLeaveSlimeState): LootAndLeavePlayerState | undefined {
  return game.players
    .filter((player) => player.alive && !player.escaped && !player.out)
    .sort((a, b) => distance(a, slime) - distance(b, slime))[0];
}

function slimeDirection(game: LootAndLeaveState, slime: LootAndLeaveSlimeState, target: LootAndLeavePlayerState): Direction {
  const chase = seededNoise(game.seed + game.tick + slime.x * 17 + slime.y * 31) > 0.28;
  if (!chase) {
    return [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ][Math.floor(seededNoise(game.seed + game.tick * 3 + slime.x) * 4)] as Direction;
  }
  const dx = Math.sign(target.x - slime.x) as -1 | 0 | 1;
  const dy = Math.sign(target.y - slime.y) as -1 | 0 | 1;
  return Math.abs(target.x - slime.x) >= Math.abs(target.y - slime.y) ? { x: dx, y: 0 } : { x: 0, y: dy };
}

function winnerId(players: LootAndLeavePlayerState[]): string | undefined {
  return [...players].sort((a, b) => b.bankedCash - a.bankedCash || b.carriedCash - a.carriedCash)[0]?.id;
}

function isLootInput(input: unknown): input is LootAndLeaveInput {
  return Boolean(input && typeof input === "object" && "movement" in input);
}

function readInputSequence(sequence: unknown): number | undefined {
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) return undefined;
  return sequence;
}

function cardinal(vector: Vector2Payload): Direction {
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) return { x: 0, y: 0 };
  if (Math.abs(vector.x) < 0.1 && Math.abs(vector.y) < 0.1) return { x: 0, y: 0 };
  if (Math.abs(vector.x) >= Math.abs(vector.y)) return { x: Math.sign(vector.x) as -1 | 1, y: 0 };
  return { x: 0, y: Math.sign(vector.y) as -1 | 1 };
}

function getTile(game: LootAndLeaveState, x: number, y: number): number {
  if (!inBounds(game, x, y)) return T.WALL;
  return game.cave.tiles[y * game.cave.width + x] ?? T.WALL;
}

function setTile(game: LootAndLeaveState, x: number, y: number, tile: number): void {
  if (inBounds(game, x, y)) game.cave.tiles[y * game.cave.width + x] = tile;
}

function inBounds(game: LootAndLeaveState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < game.cave.width && y < game.cave.height;
}

function playerAt(game: LootAndLeaveState, x: number, y: number): LootAndLeavePlayerState | undefined {
  return game.players.find((player) => player.x === x && player.y === y && player.alive && !player.escaped && !player.out);
}

function adjacentPlayer(game: LootAndLeaveState, x: number, y: number): LootAndLeavePlayerState | undefined {
  return game.players.find(
    (player) =>
      player.alive &&
      !player.escaped &&
      !player.out &&
      Math.abs(player.x - x) + Math.abs(player.y - y) === 1,
  );
}

function slimeAt(game: LootAndLeaveState, x: number, y: number): LootAndLeaveSlimeState | undefined {
  return game.slimes.find((slime) => slime.x === x && slime.y === y);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function posKey(x: number, y: number): string {
  return `${x},${y}`;
}

function event(type: LootAndLeaveEvent["type"], message: string, x?: number, y?: number, playerId?: string, cash?: number): LootAndLeaveEvent {
  return { type, message, x, y, playerId, cash };
}

function nextSeed(seed: number, level: number): number {
  return Math.abs((seed * 1103515245 + level * 12345) % 2147483647);
}

function seededNoise(seed: number): number {
  const x = Math.sin(seed * 999) * 10000;
  return x - Math.floor(x);
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
