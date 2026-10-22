import {
  MANSION_ROOMS,
  NIGHT_OPTION_COUNT,
  NIGHT_POINTS,
  type MansionRoom,
  type MansionRoomKey,
  type NightRoundResult,
  type NightSnapshot,
  type NightStanding,
  mansionRoom,
  roomsConnected,
} from "../../../shared/party/night.js";
import { type Random, shuffle } from "../crowd/random.js";
import type { RoundScore } from "./scoring.js";

// One Party Night: which rooms have been played, who owns what, and who picks next.
// Everything here is public, so the whole snapshot can go to every player.
export class PartyNight {
  readonly totalRounds: number;
  readonly points = new Map<string, number>();
  readonly claims = new Map<MansionRoomKey, string>();
  readonly played: MansionRoomKey[] = [];
  options: MansionRoomKey[] = [];
  pickerId?: string;
  current?: MansionRoomKey;
  lastRound?: NightRoundResult;
  private readonly rooms: readonly MansionRoom[];

  constructor(
    playerIds: string[],
    rounds: number,
    readonly sharedScreen: boolean,
    private readonly random: Random = Math.random,
  ) {
    // A shared screen can't show anyone their secret words, so those rooms sit the night out.
    this.rooms = MANSION_ROOMS.filter((room) => !(sharedScreen && room.needsPrivateText));
    this.totalRounds = Math.max(1, Math.min(rounds, this.rooms.length));
    for (const id of playerIds) this.points.set(id, 0);
    this.offerRooms();
  }

  get over(): boolean {
    return this.played.length >= this.totalRounds && this.current === undefined;
  }

  canPick(playerId: string, isHost: boolean): boolean {
    // The host can pick for anyone, so a picker who wandered off doesn't stall the night.
    return this.current === undefined && !this.over && (playerId === this.pickerId || isHost);
  }

  pick(key: string): MansionRoom {
    const room = mansionRoom(key);
    if (!room || !this.options.includes(room.key)) throw new Error("That room isn't on offer.");
    this.current = room.key;
    this.options = [];
    return room;
  }

  recordRound(score: RoundScore): void {
    const key = this.current;
    if (!key) return;
    for (const [playerId, amount] of score.points) {
      if (this.points.has(playerId)) this.points.set(playerId, this.points.get(playerId)! + amount);
    }
    const claimant = score.claimant && this.points.has(score.claimant) ? score.claimant : undefined;
    if (claimant) this.claims.set(key, claimant);
    this.lastRound = { room: key, points: Object.fromEntries(score.points), claimedBy: claimant };
    this.played.push(key);
    this.current = undefined;
    this.offerRooms();
  }

  // A round that ended with nobody scoring (e.g. abandoned) still uses up the room.
  skipRound(): void {
    this.recordRound({ points: new Map() });
  }

  removePlayer(playerId: string): void {
    this.points.delete(playerId);
    for (const [key, owner] of this.claims) if (owner === playerId) this.claims.delete(key);
    if (this.pickerId === playerId) this.pickerId = this.lastPlace();
  }

  standings(): NightStanding[] {
    return [...this.points.entries()]
      .map(([playerId, points]) => {
        const owned = MANSION_ROOMS.filter((room) => this.claims.get(room.key) === playerId);
        const connectedPairs = owned.reduce(
          (pairs, room, index) => pairs + owned.slice(index + 1).filter((other) => roomsConnected(room, other)).length,
          0,
        );
        const total = points + owned.length * NIGHT_POINTS.claimedRoom + connectedPairs * NIGHT_POINTS.connectedPair;
        return { playerId, points, rooms: owned.length, connectedPairs, total };
      })
      .sort((a, b) => b.total - a.total || b.rooms - a.rooms);
  }

  snapshot(): NightSnapshot {
    return {
      totalRounds: this.totalRounds,
      roundsPlayed: this.played.length,
      sharedScreen: this.sharedScreen,
      points: Object.fromEntries(this.points),
      claims: Object.fromEntries(this.claims),
      played: [...this.played],
      options: [...this.options],
      pickerId: this.pickerId,
      current: this.current,
      lastRound: this.lastRound,
      standings: this.over ? this.standings() : undefined,
    };
  }

  private offerRooms(): void {
    if (this.over) {
      this.options = [];
      this.pickerId = undefined;
      return;
    }
    const open = this.rooms.filter((room) => !this.played.includes(room.key)).map((room) => room.key);
    this.options = shuffle(open, this.random).slice(0, NIGHT_OPTION_COUNT);
    this.pickerId = this.lastPlace();
  }

  // Last place picks. Ties go to whoever owns fewer rooms, then to chance.
  private lastPlace(): string | undefined {
    const ids = [...this.points.keys()];
    if (ids.length === 0) return undefined;
    const owned = (id: string) => [...this.claims.values()].filter((owner) => owner === id).length;
    const order = shuffle(ids, this.random).sort((a, b) => this.points.get(a)! - this.points.get(b)! || owned(a) - owned(b));
    return order[0];
  }
}
