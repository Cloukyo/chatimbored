import {
  SILENT_WITNESS_ARENA_HEIGHT,
  SILENT_WITNESS_ARENA_WIDTH,
  SILENT_WITNESS_DURATION_MS,
  SILENT_WITNESS_KILL_COOLDOWN_MS,
  SILENT_WITNESS_KILL_DELAY_MS,
  SILENT_WITNESS_KILL_RANGE,
  SILENT_WITNESS_KILL_TARGET,
  SILENT_WITNESS_NPC_COUNT,
  SILENT_WITNESS_NPC_SPEED,
  SILENT_WITNESS_PLAYER_SPEED,
  SILENT_WITNESS_TICK_MS,
} from "../../../shared/constants/platform.js";
import type {
  GameSnapshot,
  SilentWitnessEvent,
  SilentWitnessInput,
  SilentWitnessNpcState,
  SilentWitnessPlayerState,
  SilentWitnessShotResult,
  SilentWitnessState,
  Vector2Payload,
} from "../../../shared/message-types/protocol.js";
import type { Room } from "../rooms/Room.js";
import type { Minigame } from "./Minigame.js";

const PLAYER_RADIUS = 16;
const NPC_RADIUS = 15;
const SHOT_WIDTH = 22;
const MOVEMENT_DEADZONE = 0.16;
const MIN_X = 40;
const MAX_X = SILENT_WITNESS_ARENA_WIDTH - 40;
const MIN_Y = 50;
const MAX_Y = SILENT_WITNESS_ARENA_HEIGHT - 50;

const playerMovement = new Map<string, Vector2Payload>();
const roundElapsedMs = new Map<string, number>();

export const silentWitness: Minigame = {
  id: "silent_witness",
  name: "Silent Witness",
  minPlayers: 2,
  maxPlayers: 8,
  tickMs: SILENT_WITNESS_TICK_MS,

  setup(room: Room): GameSnapshot {
    playerMovement.clear();
    roundElapsedMs.set(room.code, 0);
    const killerId = chooseKiller(room);
    return {
      minigameId: this.id,
      name: this.name,
      endsAt: Date.now() + SILENT_WITNESS_DURATION_MS,
      scores: Object.fromEntries(room.players.map((player) => [player.id, 0])),
      silentWitness: {
        arena: { width: SILENT_WITNESS_ARENA_WIDTH, height: SILENT_WITNESS_ARENA_HEIGHT },
        killerId,
        players: room.players.map((player, index) => ({
          id: player.id,
          role: player.id === killerId ? "killer" : "hunter",
          x: 180 + (index % 4) * 38,
          y: laneY(index, room.players.length),
          alive: true,
          shotAvailable: player.id !== killerId,
          aim: { x: 1, y: 0 },
          killCooldownMs: 0,
        })),
        npcs: createNpcs(),
        publicKillCount: 0,
        killTarget: SILENT_WITNESS_KILL_TARGET,
      },
    };
  },

  handleInput(room: Room, playerId: string | undefined, input: unknown): GameSnapshot {
    if (!room.game?.silentWitness || !playerId || !isSilentWitnessInput(input)) return room.game!;
    const state = room.game.silentWitness;
    if (room.game.winnerId || state.result) return room.game;
    const player = state.players.find((candidate) => candidate.id === playerId);
    if (!player || !player.alive) return room.game;

    player.aim = normalize(input.aim, player.aim);
    playerMovement.set(playerId, normalizeMovement(input.movement));

    if (input.shoot && player.role === "hunter" && player.shotAvailable) {
      player.shotAvailable = false;
      state.lastShot = resolveShot(state, player, input);
      state.lastEvent = event("shot", "A hunter fired.", state.lastShot.end.x, state.lastShot.end.y, player.id, state.lastShot.targetId);
      if (state.lastShot.hitType === "killer" && state.lastShot.targetId) {
        const killer = state.players.find((candidate) => candidate.id === state.lastShot?.targetId);
        if (killer) killer.alive = false;
        state.result = "hunters";
        room.game.winnerId = player.id;
        state.lastEvent = event("killer_hit", "The Killer was identified.", state.lastShot.end.x, state.lastShot.end.y, player.id, state.lastShot.targetId);
      }
    }

    if (input.kill && player.role === "killer" && player.killCooldownMs <= 0) {
      const npc = nearestKillableNpc(state, player);
      if (npc) {
        npc.state = "dying";
        npc.dyingMs = SILENT_WITNESS_KILL_DELAY_MS;
        player.killCooldownMs = SILENT_WITNESS_KILL_COOLDOWN_MS;
        state.lastEvent = event("kill_marked", "Someone in the crowd looks unwell.", npc.x, npc.y, player.id, npc.id);
      }
    }

    return room.game;
  },

  update(room: Room, deltaMs: number): GameSnapshot {
    if (!room.game?.silentWitness || room.game.winnerId) return room.game!;
    const state = room.game.silentWitness;
    const seconds = deltaMs / 1000;
    const elapsedMs = (roundElapsedMs.get(room.code) ?? 0) + deltaMs;
    roundElapsedMs.set(room.code, elapsedMs);

    for (const player of state.players) {
      if (!player.alive) continue;
      player.killCooldownMs = Math.max(0, player.killCooldownMs - deltaMs);
      const movement = playerMovement.get(player.id) ?? { x: 0, y: 0 };
      player.x = clamp(player.x + movement.x * SILENT_WITNESS_PLAYER_SPEED * seconds, MIN_X, MAX_X);
      player.y = clamp(player.y + movement.y * SILENT_WITNESS_PLAYER_SPEED * seconds, MIN_Y, MAX_Y);
    }

    for (const npc of state.npcs) {
      updateNpc(npc, deltaMs, seconds);
      if (npc.state === "dying") {
        npc.dyingMs = Math.max(0, npc.dyingMs - deltaMs);
        if (npc.dyingMs <= 0) {
          npc.state = "dead";
          npc.speedX = 0;
          npc.speedY = 0;
          state.publicKillCount += 1;
          state.lastEvent = event("npc_dead", "A body was discovered.", npc.x, npc.y, undefined, npc.id);
        }
      }
    }

    if (state.publicKillCount >= state.killTarget) {
      state.result = "killer";
      room.game.winnerId = state.killerId;
      state.lastEvent = event("round_over", "The Killer escaped suspicion.");
    } else if (elapsedMs >= SILENT_WITNESS_DURATION_MS || Date.now() >= room.game.endsAt) {
      state.result = "hunters";
      room.game.winnerId = "hunters";
      state.lastEvent = event("round_over", "The Hunters survived the round.");
    }

    return room.game;
  },

  finish(room: Room): GameSnapshot {
    if (!room.game?.silentWitness) throw new Error("No Silent Witness round is running.");
    roundElapsedMs.delete(room.code);
    const state = room.game.silentWitness;
    if (!state.result) {
      state.result = state.publicKillCount >= state.killTarget ? "killer" : "hunters";
      room.game.winnerId = state.result === "killer" ? state.killerId : "hunters";
    }
    room.players.forEach((player) => {
      player.score = state.result === "killer" ? (player.id === state.killerId ? 1 : 0) : player.id === state.killerId ? 0 : 1;
      player.isReady = false;
      if (room.game) room.game.scores[player.id] = player.score;
    });
    return room.game;
  },
};

function chooseKiller(room: Room): string {
  const seed = room.code.split("").reduce((sum, char) => sum + char.charCodeAt(0), room.players.length * 17);
  return room.players[seed % room.players.length].id;
}

function createNpcs(): SilentWitnessNpcState[] {
  return Array.from({ length: SILENT_WITNESS_NPC_COUNT }, (_unused, index) => {
    const npc: SilentWitnessNpcState = {
      id: `witness_npc_${index}`,
      x: 90 + deterministicNoise(index * 31) * (SILENT_WITNESS_ARENA_WIDTH - 180),
      y: MIN_Y + deterministicNoise(index * 53) * (MAX_Y - MIN_Y),
      state: "alive",
      dyingMs: 0,
      speedX: 0,
      speedY: 0,
      behaviorTimer: 0,
    };
    setNpcBehavior(npc, index);
    return npc;
  });
}

function updateNpc(npc: SilentWitnessNpcState, deltaMs: number, seconds: number): void {
  if (npc.state === "dead") return;
  npc.behaviorTimer -= deltaMs;
  if (npc.behaviorTimer <= 0) setNpcBehavior(npc, npc.x * 0.41 + npc.y * 0.19 + npc.id.length);
  npc.x = clamp(npc.x + npc.speedX * seconds, MIN_X, MAX_X);
  npc.y = clamp(npc.y + npc.speedY * seconds, MIN_Y, MAX_Y);
  if (npc.x <= MIN_X || npc.x >= MAX_X) npc.speedX *= -0.65;
  if (npc.y <= MIN_Y || npc.y >= MAX_Y) npc.speedY *= -0.65;
}

function setNpcBehavior(npc: SilentWitnessNpcState, seed: number): void {
  npc.behaviorTimer = 700 + deterministicNoise(seed * 67) * 2400;
  const stopRoll = deterministicNoise(seed * 29);
  if (stopRoll < 0.16) {
    npc.speedX = 0;
    npc.speedY = 0;
    return;
  }
  const angle = deterministicNoise(seed * 43) * Math.PI * 2;
  const speed = SILENT_WITNESS_NPC_SPEED * (0.55 + deterministicNoise(seed * 71) * 0.65);
  npc.speedX = Math.cos(angle) * speed;
  npc.speedY = Math.sin(angle) * speed;
}

function nearestKillableNpc(state: SilentWitnessState, killer: SilentWitnessPlayerState): SilentWitnessNpcState | undefined {
  return state.npcs
    .filter((npc) => npc.state === "alive")
    .map((npc) => ({ npc, distance: Math.hypot(npc.x - killer.x, npc.y - killer.y) }))
    .filter((candidate) => candidate.distance <= SILENT_WITNESS_KILL_RANGE)
    .sort((a, b) => a.distance - b.distance)[0]?.npc;
}

function resolveShot(state: SilentWitnessState, shooter: SilentWitnessPlayerState, input: SilentWitnessInput): SilentWitnessShotResult {
  const start = { x: shooter.x, y: shooter.y };
  const end = shotEnd(start, shooter, input);
  let bestHit: SilentWitnessShotResult = { shooterId: shooter.id, start, end, hitType: "miss" };
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const target of state.players) {
    if (target.id === shooter.id || !target.alive) continue;
    const hit = segmentHit(start, end, target, SHOT_WIDTH + PLAYER_RADIUS);
    if (hit && hit.distance < bestDistance) {
      bestDistance = hit.distance;
      bestHit = {
        shooterId: shooter.id,
        start,
        end: hit.point,
        hitType: target.role === "killer" ? "killer" : "hunter",
        targetId: target.id,
      };
    }
  }

  for (const npc of state.npcs) {
    if (npc.state === "dead") continue;
    const hit = segmentHit(start, end, npc, SHOT_WIDTH + NPC_RADIUS);
    if (hit && hit.distance < bestDistance) {
      bestDistance = hit.distance;
      bestHit = { shooterId: shooter.id, start, end: hit.point, hitType: "npc", targetId: npc.id };
    }
  }

  return bestHit;
}

function shotEnd(start: Vector2Payload, shooter: SilentWitnessPlayerState, input: SilentWitnessInput): Vector2Payload {
  if (input.targetPoint) {
    return {
      x: clamp(input.targetPoint.x, 0, SILENT_WITNESS_ARENA_WIDTH),
      y: clamp(input.targetPoint.y, 0, SILENT_WITNESS_ARENA_HEIGHT),
    };
  }
  const aim = normalize(input.aim, shooter.aim);
  const range = Math.hypot(SILENT_WITNESS_ARENA_WIDTH, SILENT_WITNESS_ARENA_HEIGHT);
  return {
    x: clamp(start.x + aim.x * range, 0, SILENT_WITNESS_ARENA_WIDTH),
    y: clamp(start.y + aim.y * range, 0, SILENT_WITNESS_ARENA_HEIGHT),
  };
}

function segmentHit(start: Vector2Payload, end: Vector2Payload, target: { x: number; y: number }, radius: number): { distance: number; point: Vector2Payload } | undefined {
  const segment = { x: end.x - start.x, y: end.y - start.y };
  const lengthSquared = segment.x * segment.x + segment.y * segment.y;
  if (lengthSquared < 0.001) return undefined;
  const toTarget = { x: target.x - start.x, y: target.y - start.y };
  const t = clamp((toTarget.x * segment.x + toTarget.y * segment.y) / lengthSquared, 0, 1);
  const point = { x: start.x + segment.x * t, y: start.y + segment.y * t };
  if (Math.hypot(target.x - point.x, target.y - point.y) > radius) return undefined;
  return { distance: Math.hypot(point.x - start.x, point.y - start.y), point };
}

function isSilentWitnessInput(input: unknown): input is SilentWitnessInput {
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

function event(type: SilentWitnessEvent["type"], message: string, x?: number, y?: number, playerId?: string, targetId?: string): SilentWitnessEvent {
  return { type, message, x, y, playerId, targetId };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function deterministicNoise(seed: number): number {
  const x = Math.sin(seed * 999) * 10000;
  return x - Math.floor(x);
}
