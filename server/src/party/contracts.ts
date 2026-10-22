import type { CrowdMatch, CrowdSlot } from "../crowd/CrowdMatch.js";
import { CROWD_TICK_MS } from "../../../shared/crowd/movement.js";

const STILL_TICKS = 5000 / CROWD_TICK_MS;
const MOVING_TICKS = 12_000 / CROWD_TICK_MS;
const BODY_RANGE = 90;
const CENTRE_RANGE = 170;

export type ContractKey = "still" | "quarters" | "body" | "moving" | "centre";

export const CONTRACTS: Record<ContractKey, string> = {
  still: "Stand perfectly still for 5 seconds in a row.",
  quarters: "Set foot in all four quarters of the room.",
  body: "Be close by when someone drops.",
  moving: "Keep walking for 12 seconds without stopping.",
  centre: "Finish the round near the middle of the room.",
};

// One player's side mission for one round. Checked by the server from what their figure does.
export class Contract {
  done = false;
  private streak = 0;
  private readonly quarters = new Set<number>();

  constructor(readonly key: ContractKey) {}

  get text(): string {
    return CONTRACTS[this.key];
  }

  tick(match: CrowdMatch, slot: CrowdSlot): void {
    const entity = slot.entity;
    if (this.done || entity.dead || entity.hidden) return;
    const moving = entity.direction.x !== 0 || entity.direction.y !== 0;
    if (this.key === "still") {
      this.streak = moving ? 0 : this.streak + 1;
      if (this.streak >= STILL_TICKS) this.done = true;
    } else if (this.key === "moving") {
      this.streak = moving ? this.streak + 1 : 0;
      if (this.streak >= MOVING_TICKS) this.done = true;
    } else if (this.key === "quarters") {
      this.quarters.add((entity.x < match.arena.width / 2 ? 0 : 1) + (entity.y < match.arena.height / 2 ? 0 : 2));
      if (this.quarters.size === 4) this.done = true;
    }
  }

  death(slot: CrowdSlot, at: { x: number; y: number }): void {
    const entity = slot.entity;
    if (this.done || this.key !== "body" || entity.dead || entity.hidden) return;
    if (Math.hypot(entity.x - at.x, entity.y - at.y) <= BODY_RANGE) this.done = true;
  }

  finish(match: CrowdMatch, slot: CrowdSlot): void {
    const entity = slot.entity;
    if (this.done || this.key !== "centre" || entity.dead || entity.hidden) return;
    if (Math.hypot(entity.x - match.arena.width / 2, entity.y - match.arena.height / 2) <= CENTRE_RANGE) this.done = true;
  }
}
