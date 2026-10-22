import { NIGHT_POINTS } from "../../../shared/party/night.js";
import type { CrowdMatch, CrowdSlot } from "../crowd/CrowdMatch.js";
import type { Random } from "../crowd/random.js";

export type RoundScore = {
  points: Map<string, number>;
  // Who claims the room: the solo winner, or the top scorer on the winning team (ties drawn at random).
  claimant?: string;
};

// Points for one finished crowd round. Works from the result and the match's bookkeeping,
// so the modes themselves don't need to know about Party Night.
export function scoreCrowdRound(match: CrowdMatch): RoundScore {
  const result = match.result ?? match.timeout();
  const slots = [...match.slots.values()];
  const points = new Map<string, number>(slots.map((slot) => [slot.playerId, 0]));
  const add = (playerId: string, amount: number) => points.set(playerId, (points.get(playerId) ?? 0) + amount);

  const winners = slots.filter((slot) =>
    result.winnerRole ? slot.role === result.winnerRole : slot.playerId === result.winnerPlayerId,
  );
  for (const slot of winners) add(slot.playerId, result.winnerRole ? NIGHT_POINTS.teamWin : NIGHT_POINTS.soloWin);

  for (const slot of slots) {
    const opponents = slot.takedowns.filter((victimId) => isOpponent(slot, match.slots.get(victimId)));
    add(slot.playerId, opponents.length * NIGHT_POINTS.takedown);
    // Lookouts never stand in the crowd, so surviving isn't an achievement for them.
    if (!slot.entity.dead && !slot.entity.hidden && slot.connected) add(slot.playerId, NIGHT_POINTS.survive);
  }

  return { points, claimant: claimantOf(winners, points, Boolean(result.winnerRole), match.random) };
}

// In free-for-all modes everyone is a "runner", so any other player counts. Otherwise only the other side does.
function isOpponent(slot: CrowdSlot, victim: CrowdSlot | undefined): boolean {
  if (!victim) return false;
  return slot.role === "runner" || victim.role !== slot.role;
}

function claimantOf(winners: CrowdSlot[], points: Map<string, number>, team: boolean, random: Random): string | undefined {
  if (!team) return winners[0]?.playerId;
  const best = Math.max(...winners.map((slot) => points.get(slot.playerId) ?? 0));
  const top = winners.filter((slot) => (points.get(slot.playerId) ?? 0) === best);
  return top[Math.floor(random() * top.length)]?.playerId;
}
