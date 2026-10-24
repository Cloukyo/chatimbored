import {
  CROWD_STATE,
  type CrowdEntityState,
  type CrowdEvent,
  type CrowdInput,
  type CrowdModeId,
  type CrowdProp,
  type CrowdResult,
  type CrowdRole,
  type CrowdVector,
  type CrowdView,
  type CrowdZone,
} from "../../../shared/crowd/protocol.js";
import { CROWD_TICK_MS, type CrowdArena, facingOf, snapDirection, stepPosition } from "../../../shared/crowd/movement.js";
import { type Random, shuffle } from "./random.js";

const MAX_QUEUED_INPUTS = 4;
const EVENT_WINDOW_TICKS = 40;
// A shot at a floor point hits whoever stands within this of it.
const SHOT_HIT_RADIUS = 16;
// How far a named target may have moved from where the shooter saw them, which covers network lag.
const NAMED_TARGET_DRIFT = 160;

export type CrowdEntity = {
  id: number;
  x: number;
  y: number;
  facing: number;
  direction: CrowdVector;
  running: boolean;
  dead: boolean;
  sickMs: number;
  // Frozen in place but alive, e.g. after a clumsy strike.
  stunMs: number;
  // Lookouts have an entity for bookkeeping, but it never appears in the crowd.
  hidden: boolean;
  // NPC brain; players have none unless they leave mid-round.
  brain?: { timerMs: number };
};

export type CrowdSlot = {
  playerId: string;
  entity: CrowdEntity;
  role: CrowdRole;
  shots: number;
  actCooldownMs: number;
  // Props this player has used, e.g. lanterns they lit.
  mine: Set<number>;
  queue: CrowdInput[];
  lastDirection: CrowdVector;
  lastRun: boolean;
  ack: number;
  connected: boolean;
  // Lost their connection for now: their figure wanders like the crowd until they're back.
  away?: boolean;
  // Other players this player took down with a shot or a strike, for scoring across rounds.
  takedowns: string[];
  shotsFired: number;
  // Shots that didn't take down another player.
  wastedShots: number;
  // Party Night: once down, a player can steer one NPC around as a ghost.
  ghost?: CrowdEntity;
  // Shots other players wasted on this player's ghost.
  baits: number;
};

export type CrowdMatchOptions = {
  // Players who go down take over an NPC instead of sitting out.
  ghosts?: boolean;
  observer?: CrowdObserver;
};

// Lets a layer on top of the modes (Party Night) watch a round without the modes knowing.
export type CrowdObserver = {
  onTick?(match: CrowdMatch): void;
  onDeath?(match: CrowdMatch, entity: CrowdEntity, victim: CrowdSlot | undefined, actor: CrowdSlot | undefined): void;
  onShot?(match: CrowdMatch, shooter: CrowdSlot, from: CrowdVector, to: CrowdVector, hit: CrowdEntity | undefined): void;
};

export type CrowdRules = {
  mode: CrowdModeId;
  arena: CrowdArena;
  npcCount: number;
  canRun: boolean;
  assignRoles(playerIds: string[], random: Random): Map<string, CrowdRole>;
  shotsFor(role: CrowdRole): number;
  // Roles that don't walk in the crowd. Defaults to everyone walking.
  inCrowd?(role: CrowdRole): boolean;
  // "aimed" shots land on the clicked point (from above); "ray" shots fly from the shooter's figure.
  shotStyle?(role: CrowdRole): "ray" | "aimed";
  props?(arena: CrowdArena, random: Random): Omit<CrowdProp, "id">[];
  canAct?(match: CrowdMatch, slot: CrowdSlot): boolean;
  onStart?(match: CrowdMatch): void;
  spawnPoint(random: Random, arena: CrowdArena): CrowdVector;
  // Picks the next thing an NPC does: a direction to walk, or stand still for a while.
  npcPlan(entity: CrowdEntity, random: Random, arena: CrowdArena, match: CrowdMatch): { direction: CrowdVector; durationMs: number };
  zone?(match: CrowdMatch): CrowdZone | undefined;
  onAct?(match: CrowdMatch, slot: CrowdSlot): void;
  onShotHit(match: CrowdMatch, shooter: CrowdSlot, target: CrowdEntity): void;
  onEntityDied?(match: CrowdMatch, entity: CrowdEntity, cause: CrowdDeathCause): void;
  onTick(match: CrowdMatch): void;
  onPlayerLeft?(match: CrowdMatch, slot: CrowdSlot): void;
  onTimeout(match: CrowdMatch): CrowdResult;
  hud?(match: CrowdMatch, slot: CrowdSlot): CrowdView["hud"];
};

export type CrowdDeathCause = "shot" | "sick" | "strike";

type StoredEvent = { tick: number; event: CrowdEvent };

export class CrowdMatch {
  readonly entities: CrowdEntity[] = [];
  readonly slots = new Map<string, CrowdSlot>();
  readonly props: CrowdProp[];
  readonly random: Random;
  tick = 0;
  result?: CrowdResult;
  private readonly events: StoredEvent[] = [];
  private nextEventId = 1;
  private packedTick = -1;
  private packed: number[] = [];
  // Whoever's shot or strike is being resolved, so a death can be credited to them.
  private actor?: CrowdSlot;

  constructor(
    readonly rules: CrowdRules,
    playerIds: string[],
    random: Random,
    readonly options: CrowdMatchOptions = {},
  ) {
    this.random = random;
    const total = rules.npcCount + playerIds.length;
    const ids = shuffle(
      Array.from({ length: total }, (_unused, index) => index + 1),
      random,
    );
    const roles = rules.assignRoles(playerIds, random);
    this.props = (rules.props?.(rules.arena, random) ?? []).map((prop, index) => ({ ...prop, id: index + 1 }));

    for (let index = 0; index < total; index += 1) {
      const spawn = rules.spawnPoint(random, rules.arena);
      const entity: CrowdEntity = {
        id: ids[index],
        x: spawn.x,
        y: spawn.y,
        facing: Math.floor(random() * 8),
        direction: { x: 0, y: 0 },
        running: false,
        dead: false,
        sickMs: 0,
        stunMs: 0,
        hidden: false,
      };
      this.entities.push(entity);
      const playerId = playerIds[index - rules.npcCount];
      if (index < rules.npcCount || playerId === undefined) {
        entity.brain = { timerMs: random() * 1200 };
        continue;
      }
      const role = roles.get(playerId) ?? "runner";
      entity.hidden = rules.inCrowd?.(role) === false;
      this.slots.set(playerId, {
        playerId,
        entity,
        role,
        shots: rules.shotsFor(role),
        actCooldownMs: 0,
        mine: new Set(),
        queue: [],
        lastDirection: { x: 0, y: 0 },
        lastRun: false,
        ack: 0,
        connected: true,
        takedowns: [],
        shotsFired: 0,
        wastedShots: 0,
        baits: 0,
      });
    }
    rules.onStart?.(this);
  }

  get arena(): CrowdArena {
    return this.rules.arena;
  }

  queueInput(playerId: string, input: CrowdInput): void {
    const slot = this.slots.get(playerId);
    if (!slot || input.seq <= slot.ack || slot.queue.some((queued) => queued.seq === input.seq)) return;
    slot.queue.push(input);
    // Keep latency bounded if a client bursts inputs after a stall; the newest inputs win.
    while (slot.queue.length > MAX_QUEUED_INPUTS) {
      const dropped = slot.queue.shift()!;
      slot.ack = Math.max(slot.ack, dropped.seq);
    }
  }

  step(): void {
    if (this.result) return;
    this.tick += 1;

    for (const slot of this.slots.values()) {
      slot.actCooldownMs = Math.max(0, slot.actCooldownMs - CROWD_TICK_MS);
      const input = slot.queue.shift();
      if (input) {
        slot.ack = input.seq;
        slot.lastDirection = snapDirection(input.move);
        slot.lastRun = input.run && this.rules.canRun;
      }
      const entity = slot.entity;
      if (slot.ghost) {
        if (!slot.away) this.moveGhost(slot);
        continue;
      }
      if (entity.dead || entity.brain) continue;
      if (entity.hidden) {
        if (input?.shoot && slot.shots > 0) this.shoot(slot, input.shoot, input.shootAt);
        if (this.result) return;
        continue;
      }
      if (entity.sickMs > 0 || entity.stunMs > 0) {
        entity.direction = { x: 0, y: 0 };
        entity.running = false;
        continue;
      }
      entity.direction = slot.lastDirection;
      entity.running = slot.lastRun && (slot.lastDirection.x !== 0 || slot.lastDirection.y !== 0);
      this.move(entity);
      if (!input) continue;
      if (input.shoot && slot.shots > 0) this.shoot(slot, input.shoot, input.shootAt);
      if (this.result) return;
      if (input.act && slot.actCooldownMs <= 0) this.withActor(slot, () => this.rules.onAct?.(this, slot));
    }

    for (const entity of this.entities) {
      if (entity.dead || entity.hidden) continue;
      if (entity.stunMs > 0) {
        entity.stunMs = Math.max(0, entity.stunMs - CROWD_TICK_MS);
        entity.direction = { x: 0, y: 0 };
        continue;
      }
      if (entity.sickMs > 0) {
        entity.sickMs = Math.max(0, entity.sickMs - CROWD_TICK_MS);
        if (entity.sickMs === 0) this.kill(entity, "sick");
        continue;
      }
      if (!entity.brain) continue;
      entity.brain.timerMs -= CROWD_TICK_MS;
      if (entity.brain.timerMs <= 0) {
        const plan = this.rules.npcPlan(entity, this.random, this.arena, this);
        entity.direction = plan.direction;
        entity.brain.timerMs = plan.durationMs;
      }
      this.move(entity);
    }

    if (!this.result) this.rules.onTick(this);
    if (!this.result) this.options.observer?.onTick?.(this);
  }

  timeout(): CrowdResult {
    if (!this.result) this.result = this.rules.onTimeout(this);
    return this.result;
  }

  end(result: Omit<CrowdResult, "reveal">): void {
    if (this.result) return;
    this.result = { ...result, reveal: [] };
  }

  removePlayer(playerId: string): void {
    const slot = this.slots.get(playerId);
    if (!slot || !slot.connected) return;
    slot.connected = false;
    slot.queue = [];
    // A player who leaves keeps wandering as part of the crowd, so their body doesn't give anything away.
    if (!slot.entity.dead && !slot.entity.hidden) slot.entity.brain = { timerMs: 0 };
    if (slot.ghost && !slot.ghost.dead) slot.ghost.brain = { timerMs: 0 };
    slot.ghost = undefined;
    this.rules.onPlayerLeft?.(this, slot);
  }

  setAway(playerId: string, away: boolean): void {
    const slot = this.slots.get(playerId);
    if (!slot || !slot.connected || Boolean(slot.away) === away) return;
    slot.away = away;
    slot.queue = [];
    slot.lastDirection = { x: 0, y: 0 };
    slot.lastRun = false;
    for (const entity of [slot.entity, slot.ghost]) {
      if (!entity || entity.dead || entity.hidden) continue;
      entity.brain = away ? { timerMs: 0 } : undefined;
      if (!away) {
        entity.direction = { x: 0, y: 0 };
        entity.running = false;
      }
    }
  }

  slotForEntity(entity: CrowdEntity): CrowdSlot | undefined {
    for (const slot of this.slots.values()) if (slot.entity === entity) return slot;
    return undefined;
  }

  // Everything a player can see and touch: lookouts excluded.
  visibleEntities(): CrowdEntity[] {
    return this.entities.filter((entity) => !entity.hidden);
  }

  nearestEntity(from: CrowdEntity, range: number): CrowdEntity | undefined {
    let best: { entity: CrowdEntity; distance: number } | undefined;
    for (const entity of this.entities) {
      if (entity === from || entity.dead || entity.hidden) continue;
      const distance = Math.hypot(entity.x - from.x, entity.y - from.y);
      if (distance <= range && (!best || distance < best.distance)) best = { entity, distance };
    }
    return best?.entity;
  }

  nearestProp(from: CrowdEntity, range: number): CrowdProp | undefined {
    let best: { prop: CrowdProp; distance: number } | undefined;
    for (const prop of this.props) {
      const distance = Math.hypot(prop.x - from.x, prop.y - from.y);
      if (distance <= range && (!best || distance < best.distance)) best = { prop, distance };
    }
    return best?.prop;
  }

  stun(entity: CrowdEntity, durationMs: number): void {
    if (entity.dead) return;
    entity.stunMs = Math.max(entity.stunMs, durationMs);
    entity.direction = { x: 0, y: 0 };
    entity.running = false;
  }

  livingSlots(): CrowdSlot[] {
    return [...this.slots.values()].filter((slot) => !slot.entity.dead);
  }

  makeSick(entity: CrowdEntity, durationMs: number): void {
    if (entity.dead || entity.sickMs > 0) return;
    entity.sickMs = durationMs;
    entity.direction = { x: 0, y: 0 };
  }

  kill(entity: CrowdEntity, cause: CrowdDeathCause = "shot"): void {
    if (entity.dead) return;
    entity.dead = true;
    entity.sickMs = 0;
    entity.stunMs = 0;
    entity.direction = { x: 0, y: 0 };
    entity.running = false;
    this.emit({ type: "down", entity: entity.id });
    const victim = this.slotForEntity(entity);
    if (victim && this.actor && victim !== this.actor) this.actor.takedowns.push(victim.playerId);
    const haunted = this.ghostSlotFor(entity);
    if (haunted) {
      if (this.actor && this.actor !== haunted) haunted.baits += 1;
      haunted.ghost = undefined;
      this.makeGhost(haunted);
    }
    this.rules.onEntityDied?.(this, entity, cause);
    this.options.observer?.onDeath?.(this, entity, victim, this.actor);
    if (victim && this.options.ghosts && victim.connected) this.makeGhost(victim);
  }

  // Hands a player who is out of the round a random NPC to steer.
  makeGhost(slot: CrowdSlot): void {
    // Not another ghost, and not a player who is away and only walking like the crowd for now.
    const taken = new Set([...this.slots.values()].flatMap((other) => (other.away ? [other.ghost, other.entity] : [other.ghost])));
    const free = this.entities.filter((entity) => entity.brain && !entity.dead && !entity.hidden && !taken.has(entity));
    if (free.length === 0) return;
    const ghost = free[Math.floor(this.random() * free.length)];
    ghost.brain = undefined;
    slot.ghost = ghost;
  }

  ghostSlotFor(entity: CrowdEntity): CrowdSlot | undefined {
    for (const slot of this.slots.values()) if (slot.ghost === entity) return slot;
    return undefined;
  }

  // Ghosts walk at crowd pace and can't run, shoot or act.
  private moveGhost(slot: CrowdSlot): void {
    const ghost = slot.ghost!;
    if (ghost.dead || ghost.stunMs > 0 || ghost.sickMs > 0) return;
    ghost.direction = slot.lastDirection;
    ghost.running = false;
    this.move(ghost);
  }

  emit(event: DistributiveOmit<CrowdEvent, "id">): void {
    this.events.push({ tick: this.tick, event: { ...event, id: this.nextEventId++ } as CrowdEvent });
    while (this.events.length > 0 && this.events[0].tick < this.tick - EVENT_WINDOW_TICKS) this.events.shift();
  }

  viewFor(playerId: string): CrowdView | undefined {
    const slot = this.slots.get(playerId);
    if (!slot) return undefined;
    return {
      mode: this.rules.mode,
      arena: this.arena,
      tick: this.tick,
      you: slot.ghost ? slot.ghost.id : slot.entity.hidden ? 0 : slot.entity.id,
      ghost: slot.ghost ? true : undefined,
      ack: slot.ack,
      role: slot.role,
      alive: !slot.entity.dead,
      shots: slot.shots,
      canAct: slot.actCooldownMs <= 0 && slot.entity.stunMs <= 0 && (this.rules.canAct?.(this, slot) ?? false),
      canRun: this.rules.canRun,
      e: this.packEntities(),
      events: this.events.filter((stored) => stored.tick >= this.tick - EVENT_WINDOW_TICKS).map((stored) => stored.event),
      props: this.props,
      zone: this.rules.zone?.(this),
      mine: [...slot.mine],
      hud: this.rules.hud?.(this, slot) ?? {},
      result: this.result ? { ...this.result, reveal: this.reveal() } : undefined,
    };
  }

  private withActor(slot: CrowdSlot, resolve: () => void): void {
    this.actor = slot;
    try {
      resolve();
    } finally {
      this.actor = undefined;
    }
  }

  // For someone watching from outside the crowd, like Party Night's host.
  spectatorView(role: CrowdRole): CrowdView {
    return {
      mode: this.rules.mode,
      arena: this.arena,
      tick: this.tick,
      you: 0,
      ack: 0,
      role,
      alive: true,
      shots: 0,
      canAct: false,
      canRun: false,
      e: this.packEntities(),
      events: this.events.filter((stored) => stored.tick >= this.tick - EVENT_WINDOW_TICKS).map((stored) => stored.event),
      props: this.props,
      zone: this.rules.zone?.(this),
      mine: [],
      hud: {},
      result: this.result ? { ...this.result, reveal: this.reveal() } : undefined,
    };
  }

  private reveal(): CrowdResult["reveal"] {
    return [...this.slots.values()].map((slot) => ({
      entity: slot.entity.id,
      playerId: slot.playerId,
      role: slot.role,
      alive: !slot.entity.dead,
    }));
  }

  private packEntities(): number[] {
    if (this.packedTick === this.tick) return this.packed;
    // Sorted by id so the list order doesn't leak which entities were created as players.
    const sorted = this.visibleEntities().sort((a, b) => a.id - b.id);
    this.packed = sorted.flatMap((entity) => [entity.id, entity.x, entity.y, entity.facing, stateOf(entity)]);
    this.packedTick = this.tick;
    return this.packed;
  }

  private move(entity: CrowdEntity): void {
    const next = stepPosition(entity, entity.direction, entity.running, this.arena);
    entity.x = next.x;
    entity.y = next.y;
    entity.facing = facingOf(entity.direction, entity.facing);
  }

  private shoot(slot: CrowdSlot, point: CrowdVector, targetId?: number): void {
    slot.shots -= 1;
    slot.shotsFired += 1;
    const before = slot.takedowns.length;
    this.resolveShot(slot, point, targetId);
    if (slot.takedowns.length === before) slot.wastedShots += 1;
  }

  // Aiming isn't a skill here: whoever the player pointed at is shot, and nobody in between gets in the way.
  // "Aimed" shots (Lookouts, from above) drop as an arrow; the rest fly from the shooter's figure.
  private resolveShot(slot: CrowdSlot, point: CrowdVector, targetId?: number): void {
    const hit = this.shotTarget(slot, point, targetId);
    const to = hit ? { x: hit.x, y: hit.y } : { x: Math.round(point.x), y: Math.round(point.y) };
    const aimed = this.rules.shotStyle?.(slot.role) === "aimed";
    const from = aimed ? to : { x: slot.entity.x, y: slot.entity.y };
    // An arrow is drawn falling in from the top of the screen.
    this.emit({ type: "shot", from: aimed ? { x: to.x - 60, y: -40 } : from, to });
    this.options.observer?.onShot?.(this, slot, from, to, hit);
    if (hit) this.withActor(slot, () => this.rules.onShotHit(this, slot, hit));
  }

  // The entity the client named, if it's still there to be shot near where they saw it; otherwise whoever stands closest to the point.
  private shotTarget(slot: CrowdSlot, point: CrowdVector, targetId?: number): CrowdEntity | undefined {
    const shootable = (entity: CrowdEntity) => entity !== slot.entity && !entity.dead && !entity.hidden;
    const named = targetId === undefined ? undefined : this.entities.find((entity) => entity.id === targetId);
    if (named && shootable(named) && Math.hypot(named.x - point.x, named.y - point.y) <= NAMED_TARGET_DRIFT) return named;
    let best: { entity: CrowdEntity; distance: number } | undefined;
    for (const entity of this.entities) {
      if (!shootable(entity)) continue;
      const distance = Math.hypot(entity.x - point.x, entity.y - point.y);
      if (distance <= SHOT_HIT_RADIUS && (!best || distance < best.distance)) best = { entity, distance };
    }
    return best?.entity;
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function stateOf(entity: CrowdEntity): CrowdEntityState {
  if (entity.dead) return CROWD_STATE.DEAD;
  if (entity.sickMs > 0) return CROWD_STATE.SICK;
  if (entity.stunMs > 0) return CROWD_STATE.STUNNED;
  if (entity.direction.x === 0 && entity.direction.y === 0) return CROWD_STATE.IDLE;
  return entity.running ? CROWD_STATE.RUN : CROWD_STATE.WALK;
}

