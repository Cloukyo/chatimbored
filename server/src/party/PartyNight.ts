import {
  HOST_MIN_PLAYERS,
  MANSION_ROOMS,
  NIGHT_LAYERS,
  NIGHT_OPTION_COUNT,
  NIGHT_POINTS,
  PERKS,
  TWISTS,
  type MansionRoom,
  type MansionRoomKey,
  type NightAward,
  type NightOptions,
  type NightRoundResult,
  type NightSnapshot,
  type NightStanding,
  type PerkKey,
  type TwistKey,
  defaultNightOptions,
  mansionRoom,
  roomsConnected,
} from "../../../shared/party/night.js";
import type { CrowdMatch, CrowdRules } from "../crowd/CrowdMatch.js";
import { type Random, shuffle } from "../crowd/random.js";
import { LAST_DANCE_MS, lastDanceRules } from "./lastDance.js";
import { NightRound, SUSPICION } from "./round.js";
import type { RoundScore } from "./scoring.js";

export const NIGHT_GUESTS = 60;
// Even a nearly empty party keeps enough guests to hide among.
export const MIN_GUESTS = 16;
export const ROUND_MS = 90_000;
const SHORT_ROUND_MS = 60_000;
const CROWDED_EXTRA = 12;
const INVITE_PENALTY = 2;
const LAST_PLACE_TIPS = 1;

// What happens after a round's results, in order.
export type NightPhase = "board" | "shop" | "mole_vote" | "finale_pick" | "night_over";

type PlayerStats = {
  shots: number;
  wasted: number;
  takedowns: number;
  timesDown: number;
  roundsSurvived: number;
  roundsWithInvite: number;
  baits: number;
  contracts: number;
};

// One Party Night: which rooms have been played, who owns what, who picks next, and every
// layer that carries over between rounds. Hidden parts (suspicion, the Mole, the invite holder)
// stay on the server; `snapshot` only shows what everyone may see.
export class PartyNight {
  readonly totalRounds: number;
  readonly options: NightOptions;
  readonly points = new Map<string, number>();
  readonly tips = new Map<string, number>();
  readonly claims = new Map<MansionRoomKey, string>();
  readonly played: MansionRoomKey[] = [];
  readonly perks = new Map<string, PerkKey>();
  readonly shopDone = new Set<string>();
  readonly suspicion = new Map<string, number>();
  readonly nemesis = new Map<string, string>();
  readonly twists: TwistKey[] = [];
  readonly backers = new Map<string, string>();
  readonly moleVotes = new Map<string, string>();
  readonly stats = new Map<string, PlayerStats>();
  offered: MansionRoomKey[] = [];
  pickerId?: string;
  current?: MansionRoomKey;
  lastRound?: NightRoundResult;
  guests = NIGHT_GUESTS;
  inviteHolder?: string;
  private inviteStreak = 0;
  hostId?: string;
  private readonly hostCounts = new Map<string, number>();
  mole?: { id: string; targetId: string };
  moleReveal?: NightSnapshot["moleReveal"];
  finalists?: string[];
  inFinale = false;
  finaleWinner?: string;
  round?: NightRound;
  private readonly rooms: readonly MansionRoom[];

  constructor(
    playerIds: string[],
    rounds: number,
    readonly sharedScreen: boolean,
    private readonly random: Random = Math.random,
    options: Partial<NightOptions> = {},
  ) {
    // A shared screen can't show anyone their secret words, so those rooms and layers sit the night out.
    this.rooms = MANSION_ROOMS.filter((room) => !(sharedScreen && room.needsPrivateText));
    this.totalRounds = Math.max(1, Math.min(rounds, this.rooms.length));
    const defaults = defaultNightOptions(sharedScreen);
    this.options = Object.fromEntries(
      NIGHT_LAYERS.map((layer) => [layer.key, (options[layer.key] ?? defaults[layer.key]) && !(sharedScreen && layer.needsPrivateText)]),
    ) as NightOptions;
    for (const id of playerIds) {
      this.points.set(id, 0);
      this.tips.set(id, 0);
      this.suspicion.set(id, 0);
      this.stats.set(id, { shots: 0, wasted: 0, takedowns: 0, timesDown: 0, roundsSurvived: 0, roundsWithInvite: 0, baits: 0, contracts: 0 });
    }
    if (this.options.invite) this.inviteHolder = shuffle(playerIds, random)[0];
    if (this.options.mole && playerIds.length >= 3) {
      const [id, targetId] = shuffle(playerIds, random);
      this.mole = { id, targetId };
    }
    this.offerRooms();
  }

  get over(): boolean {
    return this.played.length >= this.totalRounds && this.current === undefined;
  }

  get playerIds(): string[] {
    return [...this.points.keys()];
  }

  canPick(playerId: string, isHost: boolean): boolean {
    // The host can pick for anyone, so a picker who wandered off doesn't stall the night.
    return this.current === undefined && !this.over && (playerId === this.pickerId || isHost);
  }

  pick(key: string): MansionRoom {
    const room = mansionRoom(key);
    if (!room || !this.offered.includes(room.key)) throw new Error("That room isn't on offer.");
    this.current = room.key;
    this.offered = [];
    this.hostId = this.chooseHost();
    return room;
  }

  // Builds the round: which rules, who plays in the crowd, and the layers watching it.
  prepareRound(base: CrowdRules): { rules: CrowdRules; playerIds: string[]; ghosts: boolean; roundMs: number } {
    const finale = this.inFinale;
    const crowd = this.playerIds.filter((id) => id !== this.hostId);
    let rules = finale
      ? lastDanceRules(this.finalists!, Math.max(MIN_GUESTS, Math.min(48, this.guests)), (ids) => this.calmest(ids))
      : { ...base };
    if (!finale) {
      const extra = this.twists.includes("crowded") ? CROWDED_EXTRA : 0;
      const npcCount = this.options.emptyingParty ? Math.max(MIN_GUESTS, Math.min(base.npcCount, this.guests)) : base.npcCount;
      rules = { ...rules, npcCount: npcCount + extra };
      if (this.twists.includes("extra_shot")) rules.shotsFor = (role) => (base.shotsFor(role) > 0 ? base.shotsFor(role) + 1 : 0);
    }
    rules.npcPlan = this.crowdPlan(rules.npcPlan, crowd);
    this.round = new NightRound({
      options: this.options,
      sharedScreen: this.sharedScreen,
      suspicion: this.suspicion,
      inviteHolder: this.inviteHolder,
      invitePaused: this.current === "post_room" || finale,
      wantedId: this.leader(),
      nemesis: this.nemesis,
      hostId: this.hostId,
      perks: this.perks,
      finale,
      random: this.random,
    });
    const roundMs = finale ? LAST_DANCE_MS : this.twists.includes("short_fuse") ? SHORT_ROUND_MS : ROUND_MS;
    return { rules, playerIds: crowd, ghosts: this.options.ghosts || finale, roundMs };
  }

  recordRound(score: RoundScore, match?: CrowdMatch): void {
    const key = this.current;
    const outcome = match && this.round ? this.round.outcome(match) : undefined;
    const roundPoints = new Map<string, number>(this.playerIds.map((id) => [id, 0]));
    const add = (id: string, amount: number) => roundPoints.has(id) && roundPoints.set(id, roundPoints.get(id)! + amount);
    for (const [id, amount] of score.points) add(id, amount);
    for (const [id, amount] of outcome?.bonus ?? []) add(id, amount);

    if (this.inFinale) {
      this.finaleWinner = match?.result?.winnerPlayerId;
      for (const [backer, finalist] of this.backers) if (finalist === this.finaleWinner) add(backer, NIGHT_POINTS.backedFinalist);
    }

    if (outcome) {
      for (const [id, value] of outcome.suspicion) this.suspicion.set(id, value);
      for (const [victim, killer] of outcome.nemesis) this.nemesis.set(victim, killer);
      if (this.options.emptyingParty && !this.inFinale) this.guests = Math.max(MIN_GUESTS, this.guests - outcome.npcDeaths);
      if (this.options.invite && !this.inFinale && key !== "post_room" && outcome.inviteHolder) {
        this.inviteStreak = outcome.invitePassed ? 0 : this.inviteStreak + 1;
        this.inviteHolder = outcome.inviteHolder;
        add(outcome.inviteHolder, -(INVITE_PENALTY + this.inviteStreak));
        this.bumpStat(outcome.inviteHolder, "roundsWithInvite", 1);
      }
      for (const id of outcome.contractsDone) this.bumpStat(id, "contracts", 1);
    }
    if (match) this.recordStats(match);

    for (const [id, amount] of roundPoints) this.points.set(id, this.points.get(id)! + amount);
    // Tips follow what you earned, plus a little extra for whoever is last, and for ghosts who drew fire.
    if (this.options.shop) {
      for (const [id, amount] of roundPoints) this.tips.set(id, this.tips.get(id)! + Math.max(0, amount));
      const last = this.lastPlace();
      if (last) this.tips.set(last, this.tips.get(last)! + LAST_PLACE_TIPS);
      for (const slot of match?.slots.values() ?? []) if (this.tips.has(slot.playerId)) this.tips.set(slot.playerId, this.tips.get(slot.playerId)! + slot.baits);
    }
    this.perks.clear();

    const claimant = !this.inFinale && score.claimant && this.points.has(score.claimant) ? score.claimant : undefined;
    if (key && claimant) this.claims.set(key, claimant);
    if (key) {
      this.lastRound = { room: key, points: Object.fromEntries(roundPoints), claimedBy: claimant };
      this.played.push(key);
    }
    if (this.inFinale) this.lastRound = { room: "ballroom", points: Object.fromEntries(roundPoints) };
    if (this.options.twists && !this.inFinale && this.played.length < this.totalRounds) this.addTwist();
    this.current = undefined;
    this.round = undefined;
    this.hostId = undefined;
    if (!this.over) this.offerRooms();
    else {
      this.offered = [];
      this.pickerId = undefined;
    }
  }

  // A round that ended without a match (e.g. abandoned) still uses up the room.
  skipRound(): void {
    this.recordRound({ points: new Map() });
  }

  // Where the room goes once the host moves on from a round's results.
  afterResults(): NightPhase {
    if (this.finaleWinner !== undefined || this.inFinale) {
      this.inFinale = false;
      return "night_over";
    }
    if (!this.over) {
      if (this.options.shop) {
        this.shopDone.clear();
        return "shop";
      }
      return "board";
    }
    return this.afterRounds();
  }

  private afterRounds(): NightPhase {
    if (this.mole && !this.moleReveal) return "mole_vote";
    if (this.options.finale && this.playerIds.length >= 2 && !this.finalists) {
      this.finalists = this.standings().slice(0, 2).map((standing) => standing.playerId);
      this.backers.clear();
      return "finale_pick";
    }
    return "night_over";
  }

  buy(playerId: string, perk: PerkKey): void {
    const info = PERKS.find((candidate) => candidate.key === perk);
    if (!info || !this.perkAvailable(info)) throw new Error("That perk isn't for sale tonight.");
    if (this.shopDone.has(playerId)) throw new Error("You've already finished shopping.");
    const refund = this.perks.has(playerId) ? PERKS.find((candidate) => candidate.key === this.perks.get(playerId))!.cost : 0;
    const tips = (this.tips.get(playerId) ?? 0) + refund;
    if (tips < info.cost) throw new Error("Not enough tips.");
    this.tips.set(playerId, tips - info.cost);
    this.perks.set(playerId, perk);
    // Some perks act straight away.
    if (perk === "clean_slate") this.suspicion.set(playerId, 0);
    if (perk === "pass_invite" && this.inviteHolder === playerId) {
      const others = this.playerIds.filter((id) => id !== playerId);
      this.inviteHolder = others[Math.floor(this.random() * others.length)] ?? playerId;
      this.inviteStreak = 0;
    }
  }

  perkAvailable(info: (typeof PERKS)[number]): boolean {
    return !(info.needsPrivateText && this.sharedScreen) && (!info.needs || this.options[info.needs]);
  }

  // True once everyone has finished shopping.
  finishShopping(playerId: string): boolean {
    this.shopDone.add(playerId);
    return this.playerIds.every((id) => this.shopDone.has(id));
  }

  // True once everyone has voted; the reveal then scores the vote.
  voteMole(voterId: string, suspectId: string): boolean {
    if (!this.mole || this.moleReveal) throw new Error("There's no vote right now.");
    if (!this.points.has(suspectId) || suspectId === voterId) throw new Error("Vote for someone else in the room.");
    this.moleVotes.set(voterId, suspectId);
    return this.playerIds.every((id) => this.moleVotes.has(id));
  }

  revealMole(): NightPhase {
    const mole = this.mole!;
    const tally = new Map<string, number>();
    for (const suspect of this.moleVotes.values()) tally.set(suspect, (tally.get(suspect) ?? 0) + 1);
    const top = Math.max(0, ...tally.values());
    const accused = [...tally].filter(([, count]) => count === top).map(([id]) => id);
    const caught = accused.length === 1 && accused[0] === mole.id;
    const ranked = this.standings();
    const objectiveMet = ranked[ranked.length - 1]?.playerId === mole.targetId;
    for (const [voter, suspect] of this.moleVotes) {
      if (suspect === mole.id && voter !== mole.id) this.points.set(voter, this.points.get(voter)! + NIGHT_POINTS.moleCaughtVoter);
    }
    if (objectiveMet && !caught) this.points.set(mole.id, this.points.get(mole.id)! + NIGHT_POINTS.moleUnnoticed);
    this.moleReveal = { moleId: mole.id, targetId: mole.targetId, objectiveMet, caught };
    return this.afterRounds();
  }

  // True once every non-finalist has picked a finalist to back.
  back(playerId: string, finalistId: string): boolean {
    if (!this.finalists?.includes(finalistId)) throw new Error("Back one of the finalists.");
    if (this.finalists.includes(playerId)) throw new Error("Finalists don't back anyone.");
    this.backers.set(playerId, finalistId);
    return this.playerIds.every((id) => this.finalists!.includes(id) || this.backers.has(id));
  }

  startFinale(): void {
    this.inFinale = true;
    this.hostId = undefined;
  }

  removePlayer(playerId: string): void {
    for (const map of [this.points, this.tips, this.suspicion, this.perks, this.backers, this.moleVotes, this.stats]) map.delete(playerId);
    for (const [key, owner] of this.claims) if (owner === playerId) this.claims.delete(key);
    for (const [victim, killer] of this.nemesis) if (victim === playerId || killer === playerId) this.nemesis.delete(victim);
    this.shopDone.delete(playerId);
    if (this.pickerId === playerId) this.pickerId = this.lastPlace();
    if (this.inviteHolder === playerId) this.inviteHolder = this.playerIds[0];
    if (this.mole && (this.mole.id === playerId || this.mole.targetId === playerId)) this.mole = undefined;
  }

  standings(): NightStanding[] {
    const ranked = this.playerIds
      .map((playerId) => {
        const points = this.points.get(playerId)!;
        const owned = MANSION_ROOMS.filter((room) => this.claims.get(room.key) === playerId);
        const connectedPairs = owned.reduce(
          (pairs, room, index) => pairs + owned.slice(index + 1).filter((other) => roomsConnected(room, other)).length,
          0,
        );
        const total = points + owned.length * NIGHT_POINTS.claimedRoom + connectedPairs * NIGHT_POINTS.connectedPair;
        return { playerId, points, rooms: owned.length, connectedPairs, total };
      })
      .sort((a, b) => b.total - a.total || b.rooms - a.rooms);
    // The Last Dance decides the night, whatever the points say.
    const winner = ranked.findIndex((standing) => standing.playerId === this.finaleWinner);
    if (winner > 0) ranked.unshift(...ranked.splice(winner, 1));
    return ranked;
  }

  awards(): NightAward[] {
    const awards: NightAward[] = [];
    const roomsOf = (id: string) => [...this.claims.values()].filter((owner) => owner === id).length;
    // A clear leader on one measure, or no award at all.
    const award = (title: string, score: (id: string, stats: PlayerStats) => number, detail: (value: number) => string) => {
      const ranked = [...this.stats].map(([id, stats]) => ({ id, value: score(id, stats) })).sort((a, b) => b.value - a.value);
      const [first, second] = ranked;
      if (!first || first.value <= 0 || (second && second.value === first.value)) return;
      awards.push({ title, playerId: first.id, detail: detail(first.value) });
    };
    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
    award("Sharpshooter", (_id, stats) => stats.takedowns, (value) => plural(value, "takedown"));
    award("Most Paranoid", (_id, stats) => stats.wasted, (value) => plural(value, "wasted shot"));
    award("Best Actor", (_id, stats) => stats.roundsSurvived, (value) => `survived ${plural(value, "round")}`);
    award("Landlord", (id) => roomsOf(id), (value) => `${plural(value, "room")} claimed`);
    if (this.options.invite) award("Social Butterfly", (_id, stats) => stats.roundsWithInvite, (value) => `ended ${plural(value, "round")} holding the invite`);
    if (this.options.ghosts) award("Poltergeist", (_id, stats) => stats.baits, (value) => `drew ${plural(value, "shot")} as a ghost`);
    if (this.options.contracts) award("Professional", (_id, stats) => stats.contracts, (value) => `${plural(value, "contract")} done`);
    if (this.options.suspicion) award("Party Animal", (id) => this.suspicion.get(id) ?? 0, (value) => `ended the night on ${value} suspicion`);
    return awards;
  }

  // Everything public, plus `secret` for the one player it belongs to.
  snapshotFor(playerId: string, phaseOver: boolean): NightSnapshot {
    return {
      totalRounds: this.totalRounds,
      roundsPlayed: this.played.length,
      sharedScreen: this.sharedScreen,
      options: { ...this.options },
      guests: this.guests,
      points: Object.fromEntries(this.points),
      tips: Object.fromEntries(this.tips),
      perks: Object.fromEntries(this.perks),
      shopDone: [...this.shopDone],
      claims: Object.fromEntries(this.claims),
      played: [...this.played],
      offered: [...this.offered],
      pickerId: this.pickerId,
      current: this.current,
      lastRound: this.lastRound,
      twists: [...this.twists],
      hostId: this.hostId,
      wantedId: this.options.wanted ? this.leader() : undefined,
      nemesis: this.options.nemesis ? Object.fromEntries(this.nemesis) : {},
      finalists: this.finalists,
      backers: Object.fromEntries(this.backers),
      finaleWinner: this.finaleWinner,
      moleVoted: [...this.moleVotes.keys()],
      moleReveal: this.moleReveal,
      standings: phaseOver ? this.standings() : undefined,
      awards: phaseOver ? this.awards() : undefined,
      secret: this.mole?.id === playerId && !this.moleReveal ? { moleTargetId: this.mole.targetId } : undefined,
    };
  }

  private recordStats(match: CrowdMatch): void {
    for (const slot of match.slots.values()) {
      const stats = this.stats.get(slot.playerId);
      if (!stats) continue;
      stats.shots += slot.shotsFired;
      stats.wasted += slot.wastedShots;
      stats.takedowns += slot.takedowns.length;
      stats.baits += slot.baits;
      if (slot.entity.dead) stats.timesDown += 1;
      else if (!slot.entity.hidden) stats.roundsSurvived += 1;
    }
  }

  private bumpStat(playerId: string, key: keyof PlayerStats, amount: number): void {
    const stats = this.stats.get(playerId);
    if (stats) stats[key] += amount;
  }

  // Guests edge away from very suspicious players, and a restless crowd rarely stands still.
  private crowdPlan(plan: CrowdRules["npcPlan"], crowd: string[]): CrowdRules["npcPlan"] {
    const suspects = this.options.suspicion ? crowd.filter((id) => (this.suspicion.get(id) ?? 0) >= SUSPICION.avoidedAt) : [];
    const restless = this.twists.includes("restless");
    if (suspects.length === 0 && !restless) return plan;
    return (entity, random, arena, match) => {
      let next = plan(entity, random, arena, match);
      if (restless && next.direction.x === 0 && next.direction.y === 0 && random() < 0.7) next = plan(entity, random, arena, match);
      for (const id of suspects) {
        const slot = match.slots.get(id);
        if (!slot || slot.entity.dead || slot.entity.hidden) continue;
        const dx = entity.x - slot.entity.x;
        const dy = entity.y - slot.entity.y;
        if (Math.hypot(dx, dy) < 90 && random() < 0.6) {
          const length = Math.hypot(dx, dy) || 1;
          const away = { x: Math.sign(Math.round((dx / length) * 2)), y: Math.sign(Math.round((dy / length) * 2)) };
          const diagonal = away.x !== 0 && away.y !== 0 ? Math.SQRT1_2 : 1;
          return { direction: { x: away.x * diagonal, y: away.y * diagonal }, durationMs: 900 };
        }
      }
      return next;
    };
  }

  // Lowest suspicion wins a Last Dance where nobody was hit.
  private calmest(ids: string[]): string | undefined {
    const ranked = [...ids].sort((a, b) => (this.suspicion.get(a) ?? 0) - (this.suspicion.get(b) ?? 0));
    if (ranked.length >= 2 && this.suspicion.get(ranked[0]) === this.suspicion.get(ranked[1])) {
      const totals = new Map(this.standings().map((standing) => [standing.playerId, standing.total]));
      return ranked.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0))[0];
    }
    return ranked[0];
  }

  private chooseHost(): string | undefined {
    const ids = this.playerIds;
    if (!this.options.host || ids.length < HOST_MIN_PLAYERS) return undefined;
    const fewest = Math.min(...ids.map((id) => this.hostCounts.get(id) ?? 0));
    const candidates = shuffle(ids.filter((id) => (this.hostCounts.get(id) ?? 0) === fewest), this.random);
    const host = candidates[0];
    this.hostCounts.set(host, fewest + 1);
    return host;
  }

  // The clear points leader, if there is one.
  private leader(): string | undefined {
    const ranked = [...this.points].sort(([, a], [, b]) => b - a);
    if (!ranked[0] || ranked[0][1] <= 0 || (ranked[1] && ranked[1][1] === ranked[0][1])) return undefined;
    return ranked[0][0];
  }

  private addTwist(): void {
    const left = TWISTS.filter((twist) => !this.twists.includes(twist.key));
    if (left.length > 0) this.twists.push(left[Math.floor(this.random() * left.length)].key);
  }

  private offerRooms(): void {
    const open = this.rooms.filter((room) => !this.played.includes(room.key)).map((room) => room.key);
    this.offered = shuffle(open, this.random).slice(0, NIGHT_OPTION_COUNT);
    this.pickerId = this.lastPlace();
  }

  // Last place picks. Ties go to whoever owns fewer rooms, then to chance.
  private lastPlace(): string | undefined {
    const ids = this.playerIds;
    if (ids.length === 0) return undefined;
    const owned = (id: string) => [...this.claims.values()].filter((owner) => owner === id).length;
    const order = shuffle(ids, this.random).sort((a, b) => this.points.get(a)! - this.points.get(b)! || owned(a) - owned(b));
    return order[0];
  }
}
