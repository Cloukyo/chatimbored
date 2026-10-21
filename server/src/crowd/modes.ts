import type { CrowdResult, CrowdRole, CrowdVector } from "../../../shared/crowd/protocol.js";
import { CROWD_TICK_MS, CROWD_WALK_SPEED, type CrowdArena, snapDirection } from "../../../shared/crowd/movement.js";
import type { CrowdEntity, CrowdMatch, CrowdRules, CrowdSlot } from "./CrowdMatch.js";
import { type Random, pickWeighted, shuffle } from "./random.js";

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
  npcPlan: (entity, random, arena) => wander(entity, random, arena),
  canAct: (_match, slot) => slot.role === "killer",
  onAct(match, slot) {
    if (slot.role !== "killer") return;
    const victim = match
      .visibleEntities()
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
    if (targetSlot?.role === "killer") match.end({ winner: "hunters", winnerRole: "hunter" });
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
    if (slot.role === "killer") match.end({ winner: "hunters", winnerRole: "hunter" });
  },
  onTimeout: (): CrowdResult => ({ winner: "hunters", winnerRole: "hunter", reveal: [] }),
  hud: (match) => ({ kills: witnessKills.get(match) ?? 0, killTarget: SILENT_WITNESS_KILL_TARGET }),
};

const witnessKills = new WeakMap<CrowdMatch, number>();

const PLAZA = { width: 1280, height: 720 };
const PROP_REACH = 40;
const STRIKE_RANGE = 30;

const anywhere = (random: Random, arena: CrowdArena): CrowdVector => ({
  x: Math.round(60 + random() * (arena.width - 120)),
  y: Math.round(80 + random() * (arena.height - 140)),
});

// Lantern Festival: everyone for themselves. Light all five lanterns, or be the last one standing.
// Lighting a lantern makes it flare for everyone, so watch who's standing next to one.
export const LANTERN_GOAL = 5;
export const LANTERN_COOLDOWN_MS = 600;
export const LANTERN_STRIKE_COOLDOWN_MS = 1500;
const LANTERNS = [
  { x: 210, y: 180 },
  { x: 1070, y: 180 },
  { x: 640, y: 390 },
  { x: 210, y: 620 },
  { x: 1070, y: 620 },
];

export const lanternFestivalRules: CrowdRules = {
  mode: "lantern_festival",
  arena: PLAZA,
  npcCount: 46,
  canRun: true,
  assignRoles: everyoneRunner,
  shotsFor: () => 0,
  spawnPoint: anywhere,
  props: () => LANTERNS.map((spot) => ({ kind: "lantern" as const, ...spot, on: false })),
  npcPlan: (entity, random, arena) => (random() < 0.25 ? visit(entity, LANTERNS, random) : wander(entity, random, arena)),
  canAct: () => true,
  onAct(match, slot) {
    const lantern = match.nearestProp(slot.entity, PROP_REACH);
    if (lantern && !slot.mine.has(lantern.id)) {
      slot.mine.add(lantern.id);
      match.emit({ type: "flare", prop: lantern.id });
      slot.actCooldownMs = LANTERN_COOLDOWN_MS;
      if (slot.mine.size >= LANTERN_GOAL) match.end({ winner: "player", winnerPlayerId: slot.playerId });
      return;
    }
    if (strikeNearest(match, slot)) slot.actCooldownMs = LANTERN_STRIKE_COOLDOWN_MS;
  },
  onShotHit: () => undefined,
  onTick: lastOneStanding,
  onTimeout: (match) => mostProgress(match, (slot) => slot.mine.size),
  hud: (_match, slot) => ({ progress: slot.mine.size, goal: LANTERN_GOAL }),
};

// Bell Ringers: a few Ringers hide in the crowd and must ring every bell between them.
// Lookouts watch from above with a handful of arrows. Rung bells stay rung, for everyone to see.
export const LOOKOUT_ARROWS = 2;
const BELLS = [
  { x: 170, y: 160 },
  { x: 1110, y: 160 },
  { x: 170, y: 640 },
  { x: 1110, y: 640 },
];

export const bellRingersRules: CrowdRules = {
  mode: "bell_ringers",
  arena: PLAZA,
  npcCount: 46,
  canRun: false,
  assignRoles(playerIds, random) {
    const ringers = new Set(shuffle([...playerIds], random).slice(0, Math.ceil(playerIds.length / 3)));
    return new Map(playerIds.map((id) => [id, (ringers.has(id) ? "ringer" : "lookout") as CrowdRole]));
  },
  shotsFor: (role) => (role === "lookout" ? LOOKOUT_ARROWS : 0),
  inCrowd: (role) => role !== "lookout",
  shotStyle: () => "aimed",
  // Ringers start in the middle band, away from the bells.
  spawnPoint: (random, arena) => ({
    x: Math.round(300 + random() * (arena.width - 600)),
    y: Math.round(120 + random() * (arena.height - 200)),
  }),
  props: () => BELLS.map((spot) => ({ kind: "bell" as const, ...spot, on: false })),
  npcPlan: (entity, random, arena) => (random() < 0.3 ? visit(entity, BELLS, random) : wander(entity, random, arena)),
  canAct: (_match, slot) => slot.role === "ringer",
  onAct(match, slot) {
    if (slot.role !== "ringer") return;
    const bell = match.nearestProp(slot.entity, PROP_REACH);
    if (!bell || bell.on) return;
    bell.on = true;
    slot.mine.add(bell.id);
    match.emit({ type: "flare", prop: bell.id });
    if (match.props.every((prop) => prop.on)) match.end({ winner: "ringers", winnerRole: "ringer" });
  },
  onShotHit(match, _shooter, target) {
    match.kill(target);
  },
  onTick(match) {
    const slots = [...match.slots.values()];
    if (!slots.some((slot) => slot.role === "ringer" && slot.connected && !slot.entity.dead)) {
      match.end({ winner: "lookouts", winnerRole: "lookout" });
      return;
    }
    if (!slots.some((slot) => slot.role === "lookout" && slot.connected && slot.shots > 0)) {
      match.end({ winner: "ringers", winnerRole: "ringer" });
    }
  },
  onTimeout: (): CrowdResult => ({ winner: "lookouts", winnerRole: "lookout", reveal: [] }),
  hud: (match) => ({ progress: match.props.filter((prop) => prop.on).length, goal: BELLS.length }),
};

// Heist Hour: crack three different vaults to win. Each crack sets off that vault's alarm for a few
// seconds, which everyone sees. One shot each for whoever was standing there.
export const HEIST_GOAL = 3;
export const VAULT_ALARM_MS = 5000;
const VAULTS = [
  { x: 640, y: 140 },
  { x: 640, y: 640 },
  { x: 170, y: 390 },
  { x: 1110, y: 390 },
];
const vaultAlarms = new WeakMap<CrowdMatch, Map<number, number>>();

export const heistHourRules: CrowdRules = {
  mode: "heist_hour",
  arena: PLAZA,
  npcCount: 46,
  canRun: true,
  assignRoles: everyoneRunner,
  shotsFor: () => 1,
  spawnPoint: anywhere,
  props: () => VAULTS.map((spot) => ({ kind: "vault" as const, ...spot, on: false })),
  npcPlan: (entity, random, arena) => (random() < 0.25 ? visit(entity, VAULTS, random) : wander(entity, random, arena)),
  canAct: () => true,
  onAct(match, slot) {
    const vault = match.nearestProp(slot.entity, PROP_REACH);
    if (!vault || vault.on || slot.mine.has(vault.id)) return;
    slot.mine.add(vault.id);
    vault.on = true;
    alarmsOf(match).set(vault.id, VAULT_ALARM_MS);
    match.emit({ type: "flare", prop: vault.id });
    if (slot.mine.size >= HEIST_GOAL) match.end({ winner: "player", winnerPlayerId: slot.playerId });
  },
  onShotHit(match, _shooter, target) {
    match.kill(target);
  },
  onTick(match) {
    const alarms = alarmsOf(match);
    for (const [id, remaining] of alarms) {
      if (remaining > CROWD_TICK_MS) {
        alarms.set(id, remaining - CROWD_TICK_MS);
        continue;
      }
      alarms.delete(id);
      match.props.find((prop) => prop.id === id)!.on = false;
    }
    if (activeSlots(match).length === 0) match.end({ winner: "none" });
  },
  onTimeout: (match) => mostProgress(match, (slot) => slot.mine.size),
  hud: (_match, slot) => ({ progress: slot.mine.size, goal: HEIST_GOAL }),
};

function alarmsOf(match: CrowdMatch): Map<number, number> {
  let alarms = vaultAlarms.get(match);
  if (!alarms) vaultAlarms.set(match, (alarms = new Map()));
  return alarms;
}

// Marked: everyone secretly hunts one other player and is hunted by someone else. Strike your mark
// to take over theirs. Strike anyone else and you're left reeling for a few seconds, in plain view.
export const MARKED_GOAL = 3;
export const MARKED_WRONG_STUN_MS = 3000;
export const MARKED_STRIKE_COOLDOWN_MS = 800;
export const MARKED_HINT_EVERY_MS = 8000;
export const MARKED_HINT_FUZZ = 70;
type MarkedState = { targets: Map<string, string>; marks: Map<string, number>; hints: Map<string, CrowdVector> };
const markedStates = new WeakMap<CrowdMatch, MarkedState>();

export const markedRules: CrowdRules = {
  mode: "marked",
  arena: PLAZA,
  npcCount: 44,
  canRun: false,
  assignRoles: everyoneRunner,
  shotsFor: () => 0,
  spawnPoint: anywhere,
  npcPlan: (entity, random, arena) => wander(entity, random, arena),
  canAct: () => true,
  onAct(match, slot) {
    const state = markedState(match);
    // Read the mark before striking: a death hands the victim's mark on to whoever hunted them.
    const mark = state.targets.get(slot.playerId);
    const victim = strikeNearest(match, slot);
    if (!victim) return;
    if (mark !== undefined && match.slotForEntity(victim)?.playerId === mark) {
      state.marks.set(slot.playerId, (state.marks.get(slot.playerId) ?? 0) + 1);
      slot.actCooldownMs = MARKED_STRIKE_COOLDOWN_MS;
      if ((state.marks.get(slot.playerId) ?? 0) >= MARKED_GOAL) match.end({ winner: "player", winnerPlayerId: slot.playerId });
      return;
    }
    match.stun(slot.entity, MARKED_WRONG_STUN_MS);
    slot.actCooldownMs = MARKED_WRONG_STUN_MS;
  },
  onShotHit: () => undefined,
  onEntityDied(match, entity) {
    const slot = match.slotForEntity(entity);
    if (slot) dropFromHunt(match, slot.playerId);
  },
  onPlayerLeft(match, slot) {
    dropFromHunt(match, slot.playerId);
  },
  onTick(match) {
    lastOneStanding(match);
    if (match.result || match.tick % (MARKED_HINT_EVERY_MS / CROWD_TICK_MS) !== 1) return;
    const state = markedState(match);
    for (const [hunter, target] of state.targets) {
      const entity = match.slots.get(target)!.entity;
      state.hints.set(hunter, {
        x: Math.round(entity.x + (match.random() * 2 - 1) * MARKED_HINT_FUZZ),
        y: Math.round(entity.y + (match.random() * 2 - 1) * MARKED_HINT_FUZZ),
      });
    }
  },
  onTimeout: (match) => mostProgress(match, (slot) => markedState(match).marks.get(slot.playerId) ?? 0),
  hud(match, slot) {
    const state = markedState(match);
    return {
      progress: state.marks.get(slot.playerId) ?? 0,
      goal: MARKED_GOAL,
      markName: state.targets.get(slot.playerId),
      hint: state.hints.get(slot.playerId),
    };
  },
};

export function markedState(match: CrowdMatch): MarkedState {
  let state = markedStates.get(match);
  if (!state) {
    // One loop through every player, so everyone is both hunter and hunted.
    const order = shuffle([...match.slots.keys()], match.random);
    const targets = new Map(order.map((id, index) => [id, order[(index + 1) % order.length]]));
    state = { targets, marks: new Map(), hints: new Map() };
    markedStates.set(match, state);
  }
  return state;
}

// Whoever was hunting the fallen player takes over their mark.
function dropFromHunt(match: CrowdMatch, playerId: string): void {
  const state = markedState(match);
  const inherited = state.targets.get(playerId);
  state.targets.delete(playerId);
  state.hints.delete(playerId);
  for (const [hunter, target] of state.targets) {
    if (target !== playerId) continue;
    if (inherited && inherited !== hunter) state.targets.set(hunter, inherited);
    else state.targets.delete(hunter);
    state.hints.delete(hunter);
  }
}

function everyoneRunner(playerIds: string[]): Map<string, CrowdRole> {
  return new Map(playerIds.map((id) => [id, "runner" as CrowdRole]));
}

// Kills whoever is closest within arm's reach. Returns them, if anyone was there.
function strikeNearest(match: CrowdMatch, slot: CrowdSlot): CrowdEntity | undefined {
  const victim = match.nearestEntity(slot.entity, STRIKE_RANGE);
  if (!victim) return undefined;
  match.emit({ type: "strike", at: { x: victim.x, y: victim.y } });
  match.kill(victim, "strike");
  return victim;
}

function lastOneStanding(match: CrowdMatch): void {
  const active = activeSlots(match);
  if (active.length === 0) match.end({ winner: "none" });
  else if (active.length === 1 && match.slots.size > 1) match.end({ winner: "player", winnerPlayerId: active[0].playerId });
}

function mostProgress(match: CrowdMatch, score: (slot: CrowdSlot) => number): CrowdResult {
  const ranked = activeSlots(match).sort((a, b) => score(b) - score(a));
  const [first, second] = ranked;
  if (!first || score(first) === 0 || (second && score(second) === score(first))) return { winner: "none", reveal: [] };
  return { winner: "player", winnerPlayerId: first.playerId, reveal: [] };
}

function wander(entity: CrowdEntity, random: Random, arena: CrowdArena) {
  if (random() < 0.3) return { direction: STILL, durationMs: between(random, 600, 2600) };
  const direction = ALL_DIRECTIONS[Math.floor(random() * ALL_DIRECTIONS.length)];
  return { direction: awayFromEdges(entity, direction, arena), durationMs: between(random, 600, 2600) };
}

// Strolls toward one of the map's landmarks, so players heading there have company.
function visit(entity: CrowdEntity, spots: CrowdVector[], random: Random) {
  const spot = spots[Math.floor(random() * spots.length)];
  const distance = Math.hypot(spot.x - entity.x, spot.y - entity.y);
  if (distance < PROP_REACH) return { direction: STILL, durationMs: between(random, 800, 2200) };
  const direction = snapDirection({ x: spot.x - entity.x, y: spot.y - entity.y });
  return { direction, durationMs: Math.min(3000, Math.round((distance / CROWD_WALK_SPEED) * 1000)) };
}

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
