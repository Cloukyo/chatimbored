import type { CrowdResult, CrowdRole, CrowdVector } from "../../../shared/crowd/protocol.js";
import { type CrowdArena, snapDirection } from "../../../shared/crowd/movement.js";
import type { CrowdEntity, CrowdMatch, CrowdRules, CrowdSlot } from "./CrowdMatch.js";
import { type Random, pickWeighted } from "./random.js";

const E = snapDirection({ x: 1, y: 0 });
const NE = snapDirection({ x: 1, y: -1 });
const SE = snapDirection({ x: 1, y: 1 });
const N = snapDirection({ x: 0, y: -1 });
const S = snapDirection({ x: 0, y: 1 });
const W = snapDirection({ x: -1, y: 0 });
const NW = snapDirection({ x: -1, y: -1 });
const SW = snapDirection({ x: -1, y: 1 });
const STILL = { x: 0, y: 0 };
const ALL_DIRECTIONS = [E, NE, N, NW, W, SW, S, SE];

export const ACT_NATURAL_EXIT_X = 1180;
export const SILENT_WITNESS_KILL_TARGET = 5;
export const SILENT_WITNESS_KILL_RANGE = 34;
export const SILENT_WITNESS_SICK_MS = 2800;
export const SILENT_WITNESS_KILL_COOLDOWN_MS = 900;

// Act Natural: everyone starts in a crowd drifting right. First player through the exit wins;
// each player has one shot to stop someone they think is a rival.
export const actNaturalRules: CrowdRules = {
  mode: "act_natural",
  arena: { width: 1280, height: 720, exitX: ACT_NATURAL_EXIT_X },
  npcCount: 44,
  canRun: true,
  assignRoles: (playerIds) => new Map(playerIds.map((id) => [id, "runner" as CrowdRole])),
  shotsFor: () => 1,
  spawnPoint: (random, arena) => ({
    x: Math.round(40 + random() * 300),
    y: Math.round(60 + random() * (arena.height - 100)),
  }),
  npcPlan(entity, random) {
    if (random() < 0.4) return { direction: STILL, durationMs: between(random, 600, 2600) };
    // Near the exit the crowd mills about instead of walking through it.
    if (entity.x > ACT_NATURAL_EXIT_X - 120) {
      const direction = pickWeighted<CrowdVector>([[N, 3], [S, 3], [W, 2], [NW, 1], [SW, 1]], random);
      return { direction: awayFromEdges(entity, direction, actNaturalRules.arena), durationMs: between(random, 500, 1200) };
    }
    // Tuned so the crowd drifts right at roughly 12 px/s and reaches the exit late in the round.
    const direction = pickWeighted<CrowdVector>([[E, 4], [NE, 2], [SE, 2], [N, 3], [S, 3], [W, 1.4], [NW, 0.5], [SW, 0.5]], random);
    return { direction: awayFromEdges(entity, direction, actNaturalRules.arena), durationMs: between(random, 700, 2600) };
  },
  onShotHit(match, _shooter, target) {
    match.kill(target);
  },
  onTick(match) {
    const escaped = activeSlots(match).find((slot) => slot.entity.x >= ACT_NATURAL_EXIT_X);
    if (escaped) {
      match.emit({ type: "escaped", entity: escaped.entity.id });
      match.end({ winner: "player", winnerPlayerId: escaped.playerId });
      return;
    }
    if (activeSlots(match).length === 0) match.end({ winner: "none" });
  },
  onTimeout(match) {
    const leader = activeSlots(match).sort((a, b) => b.entity.x - a.entity.x)[0];
    return leader ? { winner: "player", winnerPlayerId: leader.playerId, reveal: [] } : { winner: "none", reveal: [] };
  },
};

// Silent Witness: one hidden Killer quietly poisons the crowd; Hunters each get one shot to find them.
export const silentWitnessRules: CrowdRules = {
  mode: "silent_witness",
  arena: { width: 1280, height: 720 },
  npcCount: 48,
  canRun: false,
  assignRoles(playerIds, random) {
    const killer = playerIds[Math.floor(random() * playerIds.length)];
    return new Map(playerIds.map((id) => [id, (id === killer ? "killer" : "hunter") as CrowdRole]));
  },
  shotsFor: (role) => (role === "hunter" ? 1 : 0),
  spawnPoint: (random, arena) => ({
    x: Math.round(60 + random() * (arena.width - 120)),
    y: Math.round(80 + random() * (arena.height - 140)),
  }),
  npcPlan(entity, random) {
    if (random() < 0.3) return { direction: STILL, durationMs: between(random, 600, 2600) };
    const direction = ALL_DIRECTIONS[Math.floor(random() * ALL_DIRECTIONS.length)];
    return { direction: awayFromEdges(entity, direction, silentWitnessRules.arena), durationMs: between(random, 600, 2600) };
  },
  onAct(match, slot) {
    if (slot.role !== "killer") return;
    const victim = match.entities
      .filter((entity) => entity !== slot.entity && !entity.dead && entity.sickMs === 0)
      .map((entity) => ({ entity, distance: Math.hypot(entity.x - slot.entity.x, entity.y - slot.entity.y) }))
      .filter((candidate) => candidate.distance <= SILENT_WITNESS_KILL_RANGE)
      .sort((a, b) => a.distance - b.distance)[0]?.entity;
    if (!victim) return;
    match.makeSick(victim, SILENT_WITNESS_SICK_MS);
    slot.actCooldownMs = SILENT_WITNESS_KILL_COOLDOWN_MS;
  },
  onShotHit(match, _shooter, target) {
    const targetSlot = match.slotForEntity(target);
    match.kill(target);
    if (targetSlot?.role === "killer") match.end({ winner: "hunters" });
  },
  onEntityDied(match, _entity, cause) {
    if (cause === "sick") witnessKills.set(match, (witnessKills.get(match) ?? 0) + 1);
  },
  onTick(match) {
    const killer = killerSlot(match);
    if ((witnessKills.get(match) ?? 0) >= SILENT_WITNESS_KILL_TARGET) {
      match.end({ winner: "killer", winnerPlayerId: killer?.playerId });
      return;
    }
    const huntersCanShoot = [...match.slots.values()].some(
      (slot) => slot.role === "hunter" && slot.connected && !slot.entity.dead && slot.shots > 0,
    );
    if (!huntersCanShoot) match.end({ winner: "killer", winnerPlayerId: killer?.playerId });
  },
  onPlayerLeft(match, slot) {
    if (slot.role === "killer") match.end({ winner: "hunters" });
  },
  onTimeout: (): CrowdResult => ({ winner: "hunters", reveal: [] }),
  hud: (match) => ({ kills: witnessKills.get(match) ?? 0, killTarget: SILENT_WITNESS_KILL_TARGET }),
};

const witnessKills = new WeakMap<CrowdMatch, number>();

function killerSlot(match: CrowdMatch): CrowdSlot | undefined {
  return [...match.slots.values()].find((slot) => slot.role === "killer");
}

// Players still in the race: alive and still connected.
function activeSlots(match: CrowdMatch): CrowdSlot[] {
  return match.livingSlots().filter((slot) => slot.connected);
}

function awayFromEdges(entity: CrowdEntity, direction: CrowdVector, arena: CrowdArena): CrowdVector {
  const margin = 70;
  let { x, y } = direction;
  if ((entity.x < margin && x < 0) || (entity.x > arena.width - margin && x > 0)) x = -x;
  if ((entity.y < margin + 30 && y < 0) || (entity.y > arena.height - margin && y > 0)) y = -y;
  return { x, y };
}

function between(random: Random, min: number, max: number): number {
  return Math.round(min + random() * (max - min));
}
