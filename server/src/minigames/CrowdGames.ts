import type { CrowdInput } from "../../../shared/crowd/protocol.js";
import { CROWD_TICK_MS } from "../../../shared/crowd/movement.js";
import type { GameSnapshot } from "../../../shared/message-types/protocol.js";
import { CrowdMatch, type CrowdRules } from "../crowd/CrowdMatch.js";
import {
  actNaturalRules,
  bellRingersRules,
  closingTimeRules,
  freezeFrameRules,
  heistHourRules,
  hotParcelRules,
  lanternFestivalRules,
  markedRules,
  silentWitnessRules,
} from "../crowd/modes.js";
import { freshRandom, type Random } from "../crowd/random.js";
import type { Room } from "../rooms/Room.js";
import type { Minigame } from "./Minigame.js";

const CROWD_ROUND_MS = 90_000;

// Hidden state lives here, never on room.game, so nothing secret can reach a client by accident.
const matches = new WeakMap<Room, CrowdMatch>();

// Tests can swap in a seeded generator.
export let crowdRandom: () => Random = freshRandom;
export function setCrowdRandomForTests(factory: () => Random): void {
  crowdRandom = factory;
}

export function crowdMatchFor(room: Room): CrowdMatch | undefined {
  return matches.get(room);
}

function createCrowdMinigame(id: string, name: string, rules: CrowdRules): Minigame {
  return {
    id,
    name,
    minPlayers: 2,
    maxPlayers: 8,
    tickMs: CROWD_TICK_MS,
    tickBroadcastOnly: true,

    setup(room: Room): GameSnapshot {
      const night = room.night;
      let roundMs = CROWD_ROUND_MS;
      if (night) {
        // Party Night reshapes the round: fewer guests, twists, a host sitting out, ghosts.
        const round = night.prepareRound(rules);
        const match = new CrowdMatch(round.rules, round.playerIds, crowdRandom(), { ghosts: round.ghosts, observer: night.round });
        night.round!.begin(match);
        matches.set(room, match);
        roundMs = round.roundMs;
      } else {
        matches.set(room, new CrowdMatch(rules, room.players.map((player) => player.id), crowdRandom()));
      }
      return {
        minigameId: id,
        name,
        endsAt: Date.now() + roundMs,
        scores: Object.fromEntries(room.players.map((player) => [player.id, player.score])),
      };
    },

    handleInput(room: Room, playerId: string | undefined, input: unknown): GameSnapshot {
      const match = matches.get(room);
      if (!match || !playerId || !isCrowdInput(input)) return room.game!;
      if (playerId === room.night?.hostId) room.night.round?.hostInput(match, input);
      else match.queueInput(playerId, input);
      return room.game!;
    },

    update(room: Room): GameSnapshot {
      const match = matches.get(room);
      if (!match || !room.game) return room.game!;
      match.step();
      if (match.result) room.game.winnerId = winnerIdOf(match);
      return room.game;
    },

    onPlayerLeft(room: Room, playerId: string): GameSnapshot {
      const match = matches.get(room);
      match?.removePlayer(playerId);
      if (match?.result && room.game) room.game.winnerId = winnerIdOf(match);
      return room.game!;
    },

    finish(room: Room): GameSnapshot {
      const match = matches.get(room);
      if (!match || !room.game) throw new Error(`No ${name} round is running.`);
      match.timeout();
      room.game.winnerId = winnerIdOf(match);
      const winners = winningPlayerIds(match);
      room.players.forEach((player) => {
        if (winners.has(player.id)) player.score += 1;
        player.isReady = false;
        room.game!.scores[player.id] = player.score;
      });
      return room.game;
    },

    snapshotFor(room: Room, playerId: string): GameSnapshot | undefined {
      if (!room.game) return undefined;
      const match = matches.get(room);
      const night = room.night;
      let crowd = night?.hostId === playerId ? match?.spectatorView("host") : match?.viewFor(playerId);
      const round = night?.round;
      if (crowd && match && round) {
        const nameOf = (other: string) => room.players.find((player) => player.id === other)?.displayName ?? "Someone";
        crowd = { ...crowd, party: round.partyView(match, playerId, nameOf) };
      }
      return { ...room.game, scores: { ...room.game.scores }, crowd };
    },
  };
}

function winnerIdOf(match: CrowdMatch): string {
  const result = match.result!;
  return result.winnerPlayerId ?? result.winner;
}

function winningPlayerIds(match: CrowdMatch): Set<string> {
  const result = match.result!;
  if (result.winnerRole) {
    return new Set([...match.slots.values()].filter((slot) => slot.role === result.winnerRole).map((slot) => slot.playerId));
  }
  return new Set(result.winnerPlayerId ? [result.winnerPlayerId] : []);
}

function isCrowdInput(input: unknown): input is CrowdInput {
  return Boolean(input && typeof input === "object" && (input as { kind?: unknown }).kind === "crowd");
}

export const crowdActNatural = createCrowdMinigame("crowd_act_natural", "Act Natural", actNaturalRules);
export const crowdSilentWitness = createCrowdMinigame("crowd_silent_witness", "Silent Witness", silentWitnessRules);
export const crowdLanternFestival = createCrowdMinigame("crowd_lantern_festival", "Lantern Festival", lanternFestivalRules);
export const crowdBellRingers = createCrowdMinigame("crowd_bell_ringers", "Bell Ringers", bellRingersRules);
export const crowdHeistHour = createCrowdMinigame("crowd_heist_hour", "Heist Hour", heistHourRules);
export const crowdMarked = createCrowdMinigame("crowd_marked", "Marked", markedRules);
export const crowdFreezeFrame = createCrowdMinigame("crowd_freeze_frame", "Freeze Frame", freezeFrameRules);
export const crowdHotParcel = createCrowdMinigame("crowd_hot_parcel", "Hot Parcel", hotParcelRules);
export const crowdClosingTime = createCrowdMinigame("crowd_closing_time", "Closing Time", closingTimeRules);
// Party Night's finale. Only a night can start it; the night supplies the real rules.
export const LAST_DANCE_ID = "crowd_last_dance";
export const crowdLastDance = createCrowdMinigame(LAST_DANCE_ID, "Last Dance", { ...actNaturalRules, mode: "last_dance" });
