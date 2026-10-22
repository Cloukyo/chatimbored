import { CROWD_TICK_MS, snapDirection } from "../../../shared/crowd/movement.js";
import type { CrowdResult, CrowdRole, CrowdZone } from "../../../shared/crowd/protocol.js";
import type { CrowdMatch, CrowdRules } from "../crowd/CrowdMatch.js";
import { PLAZA, wander } from "../crowd/modes.js";

export const LAST_DANCE_MS = 75_000;
export const LAST_DANCE_START_RADIUS = 620;
export const LAST_DANCE_END_RADIUS = 110;
const CENTER = { x: PLAZA.width / 2, y: PLAZA.height / 2 + 20 };

export function lastDanceZone(match: CrowdMatch): CrowdZone {
  const t = Math.min(1, (match.tick * CROWD_TICK_MS) / (LAST_DANCE_MS - 5000));
  return { ...CENTER, r: Math.round(LAST_DANCE_START_RADIUS - (LAST_DANCE_START_RADIUS - LAST_DANCE_END_RADIUS) * t) };
}

// The finale: two finalists, one shot each, a dance floor that keeps shrinking.
// Everyone else watches as a ghost steering one of the guests.
// `tiebreak` picks the winner if nobody is hit (lower suspicion), given both finalists.
export function lastDanceRules(finalists: string[], guests: number, tiebreak: (ids: string[]) => string | undefined): CrowdRules {
  const isFinalist = (role: CrowdRole) => role === "runner";
  return {
    mode: "last_dance",
    arena: PLAZA,
    npcCount: guests,
    canRun: false,
    assignRoles: (playerIds) => new Map(playerIds.map((id) => [id, (finalists.includes(id) ? "runner" : "backer") as CrowdRole])),
    shotsFor: (role) => (isFinalist(role) ? 1 : 0),
    inCrowd: isFinalist,
    spawnPoint: (random) => ({
      x: Math.round(CENTER.x + (random() * 2 - 1) * 380),
      y: Math.round(CENTER.y + (random() * 2 - 1) * 220),
    }),
    zone: lastDanceZone,
    onStart(match) {
      for (const slot of match.slots.values()) if (slot.role === "backer") match.makeGhost(slot);
    },
    npcPlan(entity, random, arena, match) {
      const zone = lastDanceZone(match);
      if (Math.hypot(entity.x - zone.x, entity.y - zone.y) > zone.r * 0.7 && random() < 0.75) {
        return { direction: snapDirection({ x: zone.x - entity.x, y: zone.y - entity.y }), durationMs: 900 };
      }
      return wander(entity, random, arena);
    },
    onShotHit(match, shooter, target) {
      match.kill(target);
      const hit = match.slotForEntity(target);
      if (hit && isFinalist(hit.role)) match.end({ winner: "player", winnerPlayerId: shooter.playerId });
    },
    onTick(match) {
      const left = [...match.slots.values()].filter((slot) => isFinalist(slot.role) && slot.connected && !slot.entity.dead);
      if (left.length === 1) match.end({ winner: "player", winnerPlayerId: left[0].playerId });
      else if (left.length === 0) match.end({ winner: "none" });
    },
    onTimeout(match): CrowdResult {
      const left = [...match.slots.values()].filter((slot) => isFinalist(slot.role) && !slot.entity.dead).map((slot) => slot.playerId);
      const winner = left.length === 1 ? left[0] : tiebreak(left);
      return winner ? { winner: "player", winnerPlayerId: winner, reveal: [] } : { winner: "none", reveal: [] };
    },
  };
}
