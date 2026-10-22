import { CROWD_TICK_MS, snapDirection } from "../../../shared/crowd/movement.js";
import type { CrowdInput, CrowdPartyView, CrowdVector } from "../../../shared/crowd/protocol.js";
import { HOST_TRICKS, HOST_TRICKS_PER_ROUND, NIGHT_POINTS, type HostTrickKey, type NightOptions, type PerkKey } from "../../../shared/party/night.js";
import type { CrowdEntity, CrowdMatch, CrowdObserver, CrowdSlot } from "../crowd/CrowdMatch.js";
import { type Random, shuffle } from "../crowd/random.js";
import { CONTRACTS, Contract, type ContractKey } from "./contracts.js";

const ticks = (ms: number) => Math.round(ms / CROWD_TICK_MS);

export const SUSPICION = {
  max: 100,
  runningPerTick: 0.05,
  nearMiss: 15,
  nearBody: 10,
  cleanRound: -20,
  // From here on, nearby guests start edging away.
  avoidedAt: 50,
} as const;
const NEAR_MISS_RANGE = 40;
const NEAR_BODY_RANGE = 60;
const INVITE_REACH = 26;
const INVITE_COOLDOWN = ticks(3000);
const INVITE_NO_RETURN = ticks(6000);
const WANTED_EVERY = ticks(15_000);
const GLIMPSE_FOR = ticks(3000);
const TRICK_COOLDOWN = ticks(8000);
const TRICK_CREDIT = ticks(4000);
const TRICK_RANGE = { toast: 260, conga: 170, spotlight: 200 } as const;
const FLINCH_RANGE = 80;
const FLINCH_MS = 700;

// What the night tells a round when it starts.
export type RoundSetup = {
  options: NightOptions;
  sharedScreen: boolean;
  suspicion: ReadonlyMap<string, number>;
  inviteHolder?: string;
  invitePaused: boolean;
  wantedId?: string;
  nemesis: ReadonlyMap<string, string>;
  hostId?: string;
  perks: ReadonlyMap<string, PerkKey>;
  finale: boolean;
  random: Random;
};

// What the round hands back to the night when it ends.
export type RoundOutcome = {
  bonus: Map<string, number>;
  suspicion: Map<string, number>;
  inviteHolder?: string;
  invitePassed: boolean;
  nemesis: Map<string, string>;
  contractsDone: string[];
  npcDeaths: number;
};

// Party Night's layers for one round, watching the match from outside the mode.
export class NightRound implements CrowdObserver {
  private readonly contracts = new Map<string, Contract>();
  private readonly suspicionGained = new Map<string, number>();
  private readonly bonus = new Map<string, number>();
  private readonly nemesisUpdates = new Map<string, string>();
  private inviteHolder?: string;
  private invitePassed = false;
  private previousHolder?: string;
  private lastPassTick = -INVITE_COOLDOWN;
  private wantedHint?: string;
  private readonly glimpses = new Map<string, number>();
  private trick: HostTrickKey = "toast";
  private tricksLeft = HOST_TRICKS_PER_ROUND;
  private lastTrickTick = -TRICK_COOLDOWN;
  private hostPoints = 0;
  private npcDeaths = 0;

  constructor(readonly setup: RoundSetup) {
    this.inviteHolder = setup.inviteHolder;
  }

  // Called once the match exists, before the first tick.
  begin(match: CrowdMatch): void {
    const { options, random } = this.setup;
    const keys = shuffle(Object.keys(CONTRACTS) as ContractKey[], random);
    let index = 0;
    for (const slot of match.slots.values()) {
      const perk = this.setup.perks.get(slot.playerId);
      if (perk === "extra_shot" && slot.shots > 0) slot.shots += 1;
      if (perk === "glimpse") {
        const others = [...match.slots.values()].filter((other) => other !== slot && !other.entity.hidden);
        const seen = others[Math.floor(random() * others.length)];
        if (seen) this.glimpses.set(slot.playerId, seen.entity.id);
      }
      if (options.contracts && !this.setup.finale && !slot.entity.hidden) {
        this.contracts.set(slot.playerId, new Contract(keys[index % keys.length]));
        index += 1;
      }
    }
  }

  onTick(match: CrowdMatch): void {
    for (const [playerId, contract] of this.contracts) {
      const slot = match.slots.get(playerId);
      if (slot) contract.tick(match, slot);
    }
    if (this.setup.options.suspicion) {
      for (const slot of match.slots.values()) if (slot.entity.running && !slot.entity.dead) this.suspect(slot.playerId, SUSPICION.runningPerTick);
    }
    if (this.setup.options.invite && !this.setup.invitePaused) this.passInvite(match);
    if (this.setup.options.wanted && this.setup.wantedId && match.tick % WANTED_EVERY === 1) this.updateWanted(match);
  }

  onDeath(match: CrowdMatch, entity: CrowdEntity, victim: CrowdSlot | undefined, actor: CrowdSlot | undefined): void {
    if (!victim) {
      if (!match.ghostSlotFor(entity)) this.npcDeaths += 1;
    }
    for (const [playerId, contract] of this.contracts) {
      const slot = match.slots.get(playerId);
      if (slot && slot !== victim) contract.death(slot, entity);
    }
    if (this.setup.options.suspicion) {
      for (const slot of match.slots.values()) {
        if (slot === victim || slot.entity.dead || slot.entity.hidden) continue;
        if (Math.hypot(slot.entity.x - entity.x, slot.entity.y - entity.y) <= NEAR_BODY_RANGE) this.suspect(slot.playerId, SUSPICION.nearBody);
      }
    }
    if (!victim || !actor || victim === actor) return;
    if (this.setup.options.nemesis) {
      if (this.setup.nemesis.get(actor.playerId) === victim.playerId) this.add(actor.playerId, NIGHT_POINTS.takedown);
      this.nemesisUpdates.set(victim.playerId, actor.playerId);
    }
    if (this.setup.options.wanted && victim.playerId === this.setup.wantedId) this.add(actor.playerId, NIGHT_POINTS.wantedBounty);
    const hostId = this.setup.hostId;
    if (hostId && match.tick - this.lastTrickTick <= TRICK_CREDIT && this.hostPoints < NIGHT_POINTS.hostCap) {
      this.hostPoints += NIGHT_POINTS.hostTrick;
      this.add(hostId, NIGHT_POINTS.hostTrick);
    }
  }

  onShot(match: CrowdMatch, shooter: CrowdSlot, from: CrowdVector, to: CrowdVector, hit: CrowdEntity | undefined): void {
    if (this.setup.options.suspicion) {
      for (const slot of match.slots.values()) {
        const entity = slot.entity;
        if (slot === shooter || entity === hit || entity.dead || entity.hidden) continue;
        if (distanceToSegment(entity, from, to) <= NEAR_MISS_RANGE) this.suspect(slot.playerId, SUSPICION.nearMiss);
      }
    }
    // Last Dance: a miss makes the guests around the shooter flinch.
    if (this.setup.finale && (!hit || !match.slotForEntity(hit))) {
      for (const entity of match.entities) {
        if (!entity.brain || entity.dead) continue;
        if (Math.hypot(entity.x - shooter.entity.x, entity.y - shooter.entity.y) <= FLINCH_RANGE) match.stun(entity, FLINCH_MS);
      }
    }
  }

  // The Party Host's controls: act cycles the trick, a shot plays it at that spot.
  hostInput(match: CrowdMatch, input: CrowdInput): void {
    if (input.act) {
      const index = HOST_TRICKS.findIndex((trick) => trick.key === this.trick);
      this.trick = HOST_TRICKS[(index + 1) % HOST_TRICKS.length].key;
    }
    if (!input.shoot || this.tricksLeft <= 0 || match.tick - this.lastTrickTick < TRICK_COOLDOWN || match.result) return;
    this.tricksLeft -= 1;
    this.lastTrickTick = match.tick;
    playTrick(match, this.trick, input.shoot);
  }

  partyView(match: CrowdMatch, playerId: string, nameOf: (id: string) => string): CrowdPartyView {
    const view: CrowdPartyView = {};
    if (this.wantedHint && !this.setup.finale) view.wanted = this.wantedHint;
    // Who's hosting is public, so their trick can show even on a shared screen.
    if (playerId === this.setup.hostId) {
      view.trick = this.trick;
      view.tricksLeft = this.tricksLeft;
    }
    if (this.setup.sharedScreen) {
      if (this.inviteHolder === playerId && this.setup.options.invite && !this.setup.invitePaused) view.holdingInvite = true;
      return view;
    }
    const contract = this.contracts.get(playerId);
    if (contract) {
      view.contract = contract.text;
      view.contractDone = contract.done;
    }
    if (this.inviteHolder === playerId && this.setup.options.invite && !this.setup.invitePaused) view.holdingInvite = true;
    const glimpse = this.glimpses.get(playerId);
    if (glimpse && match.tick <= GLIMPSE_FOR) view.glimpse = glimpse;
    const nemesis = this.setup.options.nemesis ? this.setup.nemesis.get(playerId) : undefined;
    if (nemesis) view.nemesisName = nameOf(nemesis);
    if (playerId === this.setup.hostId) {
      view.players = [...match.slots.values()].filter((slot) => !slot.entity.dead && !slot.entity.hidden).map((slot) => slot.entity.id);
    }
    return view;
  }

  // The shared screen's host still needs to know which trick is loaded.
  outcome(match: CrowdMatch): RoundOutcome {
    const contractsDone: string[] = [];
    for (const [playerId, contract] of this.contracts) {
      const slot = match.slots.get(playerId);
      if (slot) contract.finish(match, slot);
      if (contract.done) {
        contractsDone.push(playerId);
        this.add(playerId, NIGHT_POINTS.contract);
      }
    }
    const suspicion = new Map<string, number>();
    for (const [playerId, base] of this.setup.suspicion) {
      const gained = this.suspicionGained.get(playerId) ?? 0;
      const next = gained > 0 ? base + gained : base + SUSPICION.cleanRound;
      suspicion.set(playerId, Math.max(0, Math.min(SUSPICION.max, Math.round(next))));
    }
    return {
      bonus: this.bonus,
      suspicion,
      inviteHolder: this.inviteHolder,
      invitePassed: this.invitePassed,
      nemesis: this.nemesisUpdates,
      contractsDone,
      npcDeaths: this.npcDeaths,
    };
  }

  private passInvite(match: CrowdMatch): void {
    const holder = this.inviteHolder ? match.slots.get(this.inviteHolder) : undefined;
    if (!holder || holder.entity.dead || holder.entity.hidden || match.tick - this.lastPassTick < INVITE_COOLDOWN) return;
    for (const slot of match.slots.values()) {
      const entity = slot.entity;
      if (slot === holder || entity.dead || entity.hidden || !slot.connected) continue;
      if (slot.playerId === this.previousHolder && match.tick - this.lastPassTick < INVITE_NO_RETURN) continue;
      if (Math.hypot(entity.x - holder.entity.x, entity.y - holder.entity.y) > INVITE_REACH) continue;
      this.previousHolder = holder.playerId;
      this.inviteHolder = slot.playerId;
      this.lastPassTick = match.tick;
      this.invitePassed = true;
      return;
    }
  }

  private updateWanted(match: CrowdMatch): void {
    const slot = match.slots.get(this.setup.wantedId!);
    if (!slot || slot.entity.dead || slot.entity.hidden) {
      this.wantedHint = undefined;
      return;
    }
    // Alternate between the two halves so the hints don't pin anyone down.
    const vertical = Math.floor(match.tick / WANTED_EVERY) % 2 === 0;
    this.wantedHint = vertical
      ? slot.entity.y < match.arena.height / 2 ? "north" : "south"
      : slot.entity.x < match.arena.width / 2 ? "west" : "east";
  }

  private suspect(playerId: string, amount: number): void {
    this.suspicionGained.set(playerId, (this.suspicionGained.get(playerId) ?? 0) + amount);
  }

  private add(playerId: string, amount: number): void {
    this.bonus.set(playerId, (this.bonus.get(playerId) ?? 0) + amount);
  }
}

// Tricks move the NPCs only. Any figure that doesn't play along is a person.
function playTrick(match: CrowdMatch, trick: HostTrickKey, at: CrowdVector): void {
  const range = TRICK_RANGE[trick];
  const heading = snapDirection({ x: match.random() < 0.5 ? 1 : -1, y: 0 });
  for (const entity of match.entities) {
    if (!entity.brain || entity.dead || entity.hidden) continue;
    const dx = at.x - entity.x;
    const dy = at.y - entity.y;
    if (Math.hypot(dx, dy) > range) continue;
    if (trick === "spotlight") {
      entity.direction = { x: 0, y: 0 };
      entity.brain.timerMs = 1500;
    } else if (trick === "toast") {
      entity.direction = snapDirection({ x: dx, y: dy });
      entity.brain.timerMs = 2000;
    } else {
      entity.direction = heading;
      entity.brain.timerMs = 3000;
    }
  }
}

function distanceToSegment(point: CrowdVector, start: CrowdVector, end: CrowdVector): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.001) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}
