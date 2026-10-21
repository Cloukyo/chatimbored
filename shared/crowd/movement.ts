// Movement rules shared by the server simulation and client-side prediction.
// Both sides must step positions identically or prediction will snap.
import type { CrowdVector } from "./protocol.js";

export const CROWD_TICK_MS = 50;
export const CROWD_TICK_SECONDS = CROWD_TICK_MS / 1000;
export const CROWD_WALK_SPEED = 72;
export const CROWD_RUN_SPEED = 150;
export const CROWD_EDGE_MARGIN = 24;
// Figures are drawn upward from their feet, so keep feet further from the top edge.
export const CROWD_TOP_MARGIN = 52;
export const CROWD_MOVE_DEADZONE = 0.2;

export type CrowdArena = { width: number; height: number; exitX?: number };

// Snaps any input to one of 8 directions (or none). NPCs move the same way, so direction alone is no tell.
export function snapDirection(move: CrowdVector): CrowdVector {
  const length = Math.hypot(move.x, move.y);
  if (!Number.isFinite(length) || length < CROWD_MOVE_DEADZONE) return { x: 0, y: 0 };
  const octant = Math.round(Math.atan2(move.y, move.x) / (Math.PI / 4));
  const angle = octant * (Math.PI / 4);
  return { x: roundUnit(Math.cos(angle)), y: roundUnit(Math.sin(angle)) };
}

// Facing index 0-7 clockwise from east (screen y points down).
export function facingOf(direction: CrowdVector, fallback: number): number {
  if (direction.x === 0 && direction.y === 0) return fallback;
  return (Math.round(Math.atan2(direction.y, direction.x) / (Math.PI / 4)) + 8) % 8;
}

export function stepPosition(position: CrowdVector, direction: CrowdVector, running: boolean, arena: CrowdArena): CrowdVector {
  const speed = running ? CROWD_RUN_SPEED : CROWD_WALK_SPEED;
  return {
    x: clamp(round1(position.x + direction.x * speed * CROWD_TICK_SECONDS), CROWD_EDGE_MARGIN, arena.width - CROWD_EDGE_MARGIN),
    y: clamp(round1(position.y + direction.y * speed * CROWD_TICK_SECONDS), CROWD_TOP_MARGIN, arena.height - CROWD_EDGE_MARGIN),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Positions travel on the wire at 0.1px precision; rounding here keeps prediction and server in lockstep.
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundUnit(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
