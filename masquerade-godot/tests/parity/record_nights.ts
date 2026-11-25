// Records whole nights on the Node server's night rules, so the Godot port can be checked against them.
// Run from the repo root: server/node_modules/.bin/tsx masquerade-godot/tests/parity/record_nights.ts
// It writes nights.json; test_night_parity.gd replays the same nights with NightSession.
// The driver below mirrors NightSession (night_session.gd) step for step. Keep the two in step.
import { writeFileSync } from "node:fs";
import { PERKS, NIGHT_LAYERS, mansionRoom, type NightOptions } from "../../../shared/party/night.js";
import { CrowdMatch, type CrowdRules } from "../../../server/src/crowd/CrowdMatch.js";
import * as modes from "../../../server/src/crowd/modes.js";
import { seededRandom } from "../../../server/src/crowd/random.js";
import { PartyNight } from "../../../server/src/party/PartyNight.js";
import { scoreCrowdRound } from "../../../server/src/party/scoring.js";

const RULES: Record<string, CrowdRules> = {
  act_natural: modes.actNaturalRules,
  silent_witness: modes.silentWitnessRules,
  lantern_festival: modes.lanternFestivalRules,
  bell_ringers: modes.bellRingersRules,
  heist_hour: modes.heistHourRules,
  marked: modes.markedRules,
  freeze_frame: modes.freezeFrameRules,
  hot_parcel: modes.hotParcelRules,
  closing_time: modes.closingTimeRules,
};
const MOVES = [
  { x: 1, y: 0 }, { x: 0.7, y: -0.7 }, { x: 0, y: -1 }, { x: -0.5, y: -0.5 },
  { x: -1, y: 0 }, { x: -0.3, y: 0.9 }, { x: 0, y: 1 }, { x: 0.6, y: 0.6 }, { x: 0, y: 0 },
];
const ALL_ON = Object.fromEntries(NIGHT_LAYERS.map((layer) => [layer.key, true])) as NightOptions;

// Same as scripted_input() in test_parity.gd.
function scriptedInput(match: CrowdMatch, playerIndex: number, seq: number) {
  const tick = match.tick;
  const input: any = {
    kind: "crowd",
    seq,
    move: MOVES[Math.floor(tick / (20 + playerIndex * 7)) % MOVES.length],
    run: (tick + playerIndex * 13) % 90 < 30,
    act: (tick + playerIndex * 11) % 23 === 0,
  };
  if ((tick + playerIndex * 97) % 211 === 0) {
    const ids = match.visibleEntities().filter((e) => !e.dead).map((e) => e.id).sort((a, b) => a - b);
    if (ids.length > 0) {
      const target = match.entities.find((e) => e.id === ids[(tick * 7 + playerIndex) % ids.length])!;
      input.shoot = { x: target.x + 3, y: target.y - 2 };
      if (playerIndex % 2 === 0) input.shootAt = target.id;
    }
  }
  return input;
}

const or = <T>(value: T | undefined, fallback: T) => (value === undefined ? fallback : value);

// The parts of the night both sides must agree on, with "nothing" spelled the same way.
function summary(night: PartyNight, phase: string) {
  const snap = night.snapshotFor("p1", phase === "night_over");
  return {
    phase,
    points: snap.points,
    tips: snap.tips,
    claims: snap.claims,
    played: snap.played,
    offered: snap.offered,
    pickerId: or(snap.pickerId, ""),
    twists: snap.twists,
    guests: snap.guests,
    hostId: or(snap.hostId, ""),
    wantedId: or(snap.wantedId, ""),
    finalists: or(snap.finalists, []),
    finaleWinner: or(snap.finaleWinner, ""),
    moleReveal: or(snap.moleReveal, {}),
    suspicion: Object.fromEntries(night.suspicion),
    inviteHolder: or(night.inviteHolder, ""),
    standings: or(snap.standings, []),
    awards: or(snap.awards, []),
  };
}

function playNight(label: string, playerCount: number, rounds: number, shared: boolean, options: Partial<NightOptions>, seed: number) {
  const ids = Array.from({ length: playerCount }, (_u, i) => `p${i + 1}`);
  const night = new PartyNight(ids, rounds, shared, seededRandom(seed), options);
  let phase = "board";
  let match: CrowdMatch | undefined;
  let msLeft = 0;
  let matches = 0;
  const seqs = new Map<string, number>();
  const log: unknown[] = [summary(night, phase)];
  const rooms: unknown[] = [];

  const start = (base: CrowdRules) => {
    const prep = night.prepareRound(base);
    match = new CrowdMatch(prep.rules, prep.playerIds, seededRandom(seed * 100 + matches++), { ghosts: prep.ghosts, observer: night.round });
    night.round!.begin(match);
    msLeft = prep.roundMs;
    phase = "in_game";
  };

  for (let guard = 0; guard < 200 && phase !== "night_over"; guard += 1) {
    if (phase === "board") {
      const room = mansionRoom(night.offered[0])!;
      night.pick(room.key);
      start({ ...RULES[room.minigameId.replace("crowd_", "")] });
    } else if (phase === "in_game") {
      while (phase === "in_game") {
        ids.forEach((id, index) => {
          const seq = (seqs.get(id) ?? 0) + 1;
          seqs.set(id, seq);
          const input = scriptedInput(match!, index, seq);
          if (id === night.hostId && night.round) night.round.hostInput(match!, input);
          else match!.queueInput(id, input);
        });
        match!.step();
        msLeft = Math.max(0, msLeft - 50);
        if (match!.result || msLeft <= 0) {
          match!.timeout();
          night.recordRound(scoreCrowdRound(match!), match!);
          rooms.push({ mode: match!.rules.mode, endTick: match!.tick, winner: match!.result!.winner, winnerPlayerId: or(match!.result!.winnerPlayerId, ""), e: match!.spectatorView("host").e });
          phase = "results";
        }
      }
    } else if (phase === "results") {
      match = undefined;
      phase = night.afterResults();
    } else if (phase === "shop") {
      ids.forEach((id, index) => {
        try {
          night.buy(id, PERKS[(index + night.played.length) % PERKS.length].key);
        } catch {
          // Not enough tips, or not for sale tonight: same as an error string in Godot.
        }
        if (night.finishShopping(id)) phase = "board";
      });
    } else if (phase === "mole_vote") {
      ids.forEach((id, index) => {
        let done = false;
        try {
          done = night.voteMole(id, ids[(index + 1) % ids.length]);
        } catch {
          done = false;
        }
        if (done && phase === "mole_vote") phase = night.revealMole();
      });
    } else if (phase === "finale_pick") {
      let all = false;
      ids.forEach((id, index) => {
        try {
          if (night.back(id, night.finalists![index % 2])) all = true;
        } catch {
          // Finalists can't back anyone.
        }
      });
      night.startFinale();
      start({ ...modes.actNaturalRules, mode: "last_dance" });
      void all;
    }
    log.push(summary(night, phase));
  }
  return { label, playerCount, rounds, shared, options, seed, log, rooms };
}

const nights = [
  playNight("five players, every layer", 5, 4, false, ALL_ON, 11),
  playNight("three players, defaults", 3, 6, false, {}, 12),
  playNight("four on one screen, every layer", 4, 4, true, ALL_ON, 13),
];
writeFileSync(new URL("./nights.json", import.meta.url), JSON.stringify(nights));
for (const n of nights) console.log(n.label, "->", (n.log.at(-1) as any).phase, JSON.stringify((n.log.at(-1) as any).standings.map((s: any) => [s.playerId, s.total])), n.rooms.length, "rooms");
