// Records full rounds on the Node server's crowd rules, so the Godot port can be checked against them.
// Run from the repo root: npx tsx masquerade-godot/tests/parity/record.ts
// It writes masquerade-godot/tests/parity/rounds.json; test_parity.gd replays the same rounds in Godot.
import { writeFileSync } from "node:fs";
import { CrowdMatch, type CrowdRules } from "../../../server/src/crowd/CrowdMatch.js";
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
} from "../../../server/src/crowd/modes.js";
import { seededRandom } from "../../../server/src/crowd/random.js";

const MODES: Record<string, CrowdRules> = {
  act_natural: actNaturalRules,
  silent_witness: silentWitnessRules,
  lantern_festival: lanternFestivalRules,
  bell_ringers: bellRingersRules,
  heist_hour: heistHourRules,
  marked: markedRules,
  freeze_frame: freezeFrameRules,
  hot_parcel: hotParcelRules,
  closing_time: closingTimeRules,
};
const TICKS = 1800;
const SNAPSHOT_EVERY = 100;
const PLAYERS = ["p1", "p2", "p3", "p4"];
const MOVES = [
  { x: 1, y: 0 }, { x: 0.7, y: -0.7 }, { x: 0, y: -1 }, { x: -0.5, y: -0.5 },
  { x: -1, y: 0 }, { x: -0.3, y: 0.9 }, { x: 0, y: 1 }, { x: 0.6, y: 0.6 }, { x: 0, y: 0 },
];

// The same scripted players as scripted_input() in test_parity.gd. Keep the two in step.
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

const rounds = [];
for (const [mode, rules] of Object.entries(MODES)) {
  for (const seed of [7, 2024]) {
    const match = new CrowdMatch(rules, PLAYERS, seededRandom(seed));
    const seqs = PLAYERS.map(() => 0);
    const snapshots: Record<string, unknown> = {};
    for (let step = 0; step < TICKS && !match.result; step += 1) {
      PLAYERS.forEach((id, index) => match.queueInput(id, scriptedInput(match, index, ++seqs[index])));
      match.step();
      if (match.tick % SNAPSHOT_EVERY === 0 || match.result) {
        snapshots[match.tick] = { e: match.viewFor("p1")!.e, hud: PLAYERS.map((id) => match.viewFor(id)!.hud) };
      }
    }
    const result = match.timeout();
    const roles = Object.fromEntries([...match.slots.values()].map((slot) => [slot.playerId, slot.role]));
    rounds.push({ mode, seed, endTick: match.tick, result: { ...result, reveal: undefined }, roles, snapshots });
  }
}
writeFileSync(new URL("./rounds.json", import.meta.url), JSON.stringify(rounds));
console.log(rounds.map((r) => `${r.mode}/${r.seed}: tick ${r.endTick}, ${r.result.winner} ${r.result.winnerPlayerId ?? ""}`).join("\n"));
