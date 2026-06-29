import {
  ACT_NATURAL_ARENA_HEIGHT,
  ACT_NATURAL_ARENA_WIDTH,
  ACT_NATURAL_DURATION_MS,
  ACT_NATURAL_EXIT_X,
  ACT_NATURAL_NPC_COUNT,
  ACT_NATURAL_NPC_SPEED,
  ACT_NATURAL_RUN_SPEED,
  ACT_NATURAL_WALK_SPEED,
} from "../../../shared/constants/platform.js";
import type {
  ActNaturalInput,
  ActNaturalNpcState,
  ActNaturalPlayerState,
  ActNaturalShotResult,
  GameSnapshot,
  Vector2Payload,
} from "../../../shared/message-types/protocol.js";
import type { Room } from "../rooms/Room.js";
import type { Minigame } from "./Minigame.js";

const PLAYER_RADIUS = 16;
const SHOT_WIDTH = 22;
const SPAWN_X = 80;
const MIN_Y = 60;
const MAX_Y = ACT_NATURAL_ARENA_HEIGHT - 60;
const MOVEMENT_DEADZONE = 0.16;
const NPC_RADIUS = 15;

export const actNatural: Minigame = {
  id: "act_natural",
  name: "Act Natural",
  minPlayers: 2,
  maxPlayers: 8,

  setup(room: Room): GameSnapshot {
    return {
      minigameId: this.id,
      name: this.name,
      endsAt: Date.now() + ACT_NATURAL_DURATION_MS,
      scores: Object.fromEntries(room.players.map((player) => [player.id, 0])),
      actNatural: {
        arena: {
          width: ACT_NATURAL_ARENA_WIDTH,
          height: ACT_NATURAL_ARENA_HEIGHT,
          exitX: ACT_NATURAL_EXIT_X,
        },
        players: room.players.map((player, index) => ({
          id: player.id,
          x: SPAWN_X + (index % 3) * 18,
          y: laneY(index, room.players.length),
          alive: true,
          shotAvailable: true,
          aim: { x: 1, y: 0 },
          running: false,
        })),
        npcs: createNpcs(),
      },
    };
  },

  handleInput(room: Room, playerId: string | undefined, input: unknown): GameSnapshot {
    if (!room.game?.actNatural || !playerId || !isActNaturalInput(input)) return room.game!;
    const player = room.game.actNatural.players.find((candidate) => candidate.id === playerId);
    if (!player || !player.alive || room.game.winnerId) return room.game;

    player.aim = normalize(input.aim, player.aim);
    player.running = input.run;
    player.x = clamp(player.x, 0, ACT_NATURAL_ARENA_WIDTH);
    player.y = clamp(player.y, MIN_Y, MAX_Y);
    playerMovement.set(playerId, normalizeMovement(input.movement));

    if (input.shoot && player.shotAvailable) {
      player.shotAvailable = false;
      room.game.actNatural.lastShot = resolveShot(room.game.actNatural.players, room.game.actNatural.npcs, player, input);
    }

    return room.game;
  },

  update(room: Room, deltaMs: number): GameSnapshot {
    if (!room.game?.actNatural || room.game.winnerId) return room.game!;
    const seconds = deltaMs / 1000;

    // Player and NPC positions are advanced only on the server; clients render snapshots.
    for (const player of room.game.actNatural.players) {
      if (!player.alive) continue;
      const movement = playerMovement.get(player.id) ?? { x: 0, y: 0 };
      const speed = player.running ? ACT_NATURAL_RUN_SPEED : ACT_NATURAL_WALK_SPEED;
      player.x = clamp(player.x + movement.x * speed * seconds, 0, ACT_NATURAL_ARENA_WIDTH);
      player.y = clamp(player.y + movement.y * speed * seconds, MIN_Y, MAX_Y);
      if (player.x >= ACT_NATURAL_EXIT_X) {
        room.game.winnerId = player.id;
      }
    }

    for (const npc of room.game.actNatural.npcs) {
      npc.x += npc.speed * seconds;
      npc.y = clamp(npc.y + npc.drift * seconds, MIN_Y, MAX_Y);
      if (npc.x > ACT_NATURAL_ARENA_WIDTH + 30) {
        npc.x = -20;
        npc.y = MIN_Y + deterministicNoise(npc.id.length + npc.y) * (MAX_Y - MIN_Y);
      }
    }

    return room.game;
  },

  finish(room: Room): GameSnapshot {
    if (!room.game?.actNatural) throw new Error("No Act Natural round is running.");
    if (!room.game.winnerId) room.game.winnerId = closestLivingPlayer(room.game.actNatural.players);

    room.players.forEach((player) => {
      player.score = player.id === room.game?.winnerId ? 1 : 0;
      player.isReady = false;
    });
    return room.game;
  },
};

const playerMovement = new Map<string, Vector2Payload>();

function createNpcs(): ActNaturalNpcState[] {
  return Array.from({ length: ACT_NATURAL_NPC_COUNT }, (_unused, index) => ({
    id: `npc_${index}`,
    x: 20 + deterministicNoise(index * 17) * 260,
    y: MIN_Y + deterministicNoise(index * 31) * (MAX_Y - MIN_Y),
    speed: ACT_NATURAL_NPC_SPEED + (deterministicNoise(index * 47) - 0.5) * 18,
    drift: (deterministicNoise(index * 59) - 0.5) * 22,
  }));
}

function resolveShot(
  players: ActNaturalPlayerState[],
  npcs: ActNaturalNpcState[],
  shooter: ActNaturalPlayerState,
  input: ActNaturalInput,
): ActNaturalShotResult {
  const start = { x: shooter.x, y: shooter.y };
  const end = shotEnd(start, shooter, input);
  let bestHit: ActNaturalShotResult = { shooterId: shooter.id, start, end, hitType: "miss" };
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const target of players) {
    if (target.id === shooter.id || !target.alive) continue;
    const hit = segmentHit(start, end, target, SHOT_WIDTH + PLAYER_RADIUS);
    if (hit && hit.distance < bestDistance) {
      bestDistance = hit.distance;
      bestHit = { shooterId: shooter.id, start, end: hit.point, hitType: "player", targetId: target.id };
    }
  }

  for (const npc of npcs) {
    const hit = segmentHit(start, end, npc, SHOT_WIDTH + NPC_RADIUS);
    if (hit && hit.distance < bestDistance) {
      bestDistance = hit.distance;
      bestHit = { shooterId: shooter.id, start, end: hit.point, hitType: "npc", targetId: npc.id };
    }
  }

  if (bestHit.hitType === "player" && bestHit.targetId) {
    const target = players.find((player) => player.id === bestHit.targetId);
    if (target) target.alive = false;
  }

  return bestHit;
}

function shotEnd(start: Vector2Payload, shooter: ActNaturalPlayerState, input: ActNaturalInput): Vector2Payload {
  if (input.targetPoint) {
    return {
      x: clamp(input.targetPoint.x, 0, ACT_NATURAL_ARENA_WIDTH),
      y: clamp(input.targetPoint.y, 0, ACT_NATURAL_ARENA_HEIGHT),
    };
  }

  const aim = normalize(input.aim, shooter.aim);
  const range = Math.hypot(ACT_NATURAL_ARENA_WIDTH, ACT_NATURAL_ARENA_HEIGHT);
  return {
    x: clamp(start.x + aim.x * range, 0, ACT_NATURAL_ARENA_WIDTH),
    y: clamp(start.y + aim.y * range, 0, ACT_NATURAL_ARENA_HEIGHT),
  };
}

function segmentHit(
  start: Vector2Payload,
  end: Vector2Payload,
  target: { x: number; y: number },
  radius: number,
): { distance: number; point: Vector2Payload } | undefined {
  const segment = { x: end.x - start.x, y: end.y - start.y };
  const lengthSquared = segment.x * segment.x + segment.y * segment.y;
  if (lengthSquared < 0.001) return undefined;

  const toTarget = { x: target.x - start.x, y: target.y - start.y };
  const t = clamp((toTarget.x * segment.x + toTarget.y * segment.y) / lengthSquared, 0, 1);
  const closest = { x: start.x + segment.x * t, y: start.y + segment.y * t };
  const distanceToLine = Math.hypot(target.x - closest.x, target.y - closest.y);
  if (distanceToLine > radius) return undefined;

  return {
    distance: Math.hypot(closest.x - start.x, closest.y - start.y),
    point: closest,
  };
}

function closestLivingPlayer(players: ActNaturalPlayerState[]): string | undefined {
  return players.filter((player) => player.alive).sort((a, b) => b.x - a.x)[0]?.id;
}

function isActNaturalInput(input: unknown): input is ActNaturalInput {
  return Boolean(input && typeof input === "object" && "movement" in input && "aim" in input);
}

function normalize(vector: Vector2Payload, fallback: Vector2Payload): Vector2Payload {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length < 0.001) return fallback;
  return { x: vector.x / length, y: vector.y / length };
}

function normalizeMovement(vector: Vector2Payload): Vector2Payload {
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length < MOVEMENT_DEADZONE) return { x: 0, y: 0 };
  return { x: vector.x / length, y: vector.y / length };
}

function laneY(index: number, total: number): number {
  const step = (MAX_Y - MIN_Y) / Math.max(1, total);
  return MIN_Y + step * (index + 0.5);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function deterministicNoise(seed: number): number {
  const x = Math.sin(seed * 999) * 10000;
  return x - Math.floor(x);
}
