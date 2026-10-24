import assert from "node:assert/strict";
import test from "node:test";
import type { Stroke } from "../../../shared/scribble/protocol.js";
import { seededRandom } from "../crowd/random.js";
import { parseClientMessage } from "../messages/validation.js";
import { scribbleScrap, scribbleMatchFor, setScribbleRandomForTests } from "../minigames/ScribbleScrap.js";
import { Room } from "../rooms/Room.js";
import { FORGER_LAPS, GRACE_MS, POINTS, STEP_MS, ScribbleMatch, sameWord } from "./ScribbleMatch.js";

const LINE: Stroke = { c: 0, b: 1, p: [10, 10, 200, 150] };

function game(mode: "night" | "roast" | "forger" | "brawl", people = 4, seed = 3): ScribbleMatch {
  const entrants = Array.from({ length: people }, (_, index) => ({ id: `p${index + 1}`, name: `Player ${index + 1}` }));
  return new ScribbleMatch(entrants, seededRandom(seed), mode);
}

const ids = (match: ScribbleMatch) => match.view("tv").players.map((player) => player.id);

function pastIntro(match: ScribbleMatch): void {
  assert.equal(match.step, "intro");
  match.tick(STEP_MS.intro);
}

function playRoast(match: ScribbleMatch): void {
  pastIntro(match);
  assert.equal(match.step, "draw");
  for (const id of ids(match)) match.input(id, { kind: "scribble", action: "drawing", strokes: [LINE] }, false);
  assert.equal(match.step, "caption");
  for (const id of ids(match)) {
    assert.ok(match.view(id).roast?.toCaption, `${id} has a drawing to caption`);
    match.input(id, { kind: "scribble", action: "text", text: `caption by ${id}` }, false);
  }
  assert.equal(match.step, "vote");
  for (const id of ids(match)) {
    const entries = match.view(id).roast!.entries!;
    const other = entries.find((entry) => entry.artistId !== id)!;
    const otherCaption = entries.find((entry) => entry.caption && entry.captionBy !== id)!;
    match.input(id, { kind: "scribble", action: "vote", slot: "drawing", target: other.art }, false);
    match.input(id, { kind: "scribble", action: "vote", slot: "caption", target: otherCaption.art }, false);
  }
  assert.equal(match.step, "scores");
  match.tick(STEP_MS.scores);
}

test("Roast Portraits: everyone draws someone else, captions someone else's drawing, and votes", () => {
  const match = game("roast");
  pastIntro(match);
  const prompts = ids(match).map((id) => match.view(id).roast!.prompt!);
  assert.equal(new Set(prompts).size, 4, "every prompt is different");
  for (const [index, prompt] of prompts.entries()) assert.ok(!prompt.includes(`Player ${index + 1}`), `nobody draws themselves: ${prompt}`);
  for (const id of ids(match)) match.input(id, { kind: "scribble", action: "drawing", strokes: [LINE] }, false);
  for (const id of ids(match)) match.input(id, { kind: "scribble", action: "text", text: "a caption" }, false);
  assert.equal(match.step, "vote");
  // Artists stay anonymous while voting, apart from your own drawing.
  const entries = match.view("p1").roast!.entries!;
  assert.equal(entries.filter((entry) => entry.artistId).length, 1);
  assert.equal(entries.find((entry) => entry.artistId)!.artistId, "p1");
  // You can't vote for your own drawing.
  const mine = entries.find((entry) => entry.artistId === "p1")!;
  match.input("p1", { kind: "scribble", action: "vote", slot: "drawing", target: mine.art }, false);
  assert.equal(match.view("p1").roast!.myVotes!.drawing, undefined);
  // Everyone votes for p1's drawing (p1 votes for p2's).
  for (const id of ids(match)) {
    const target = id === "p1" ? match.view("p2").roast!.entries!.find((entry) => entry.artistId === "p2")!.art : mine.art;
    match.input(id, { kind: "scribble", action: "vote", slot: "drawing", target }, false);
  }
  match.tick(STEP_MS.vote);
  assert.equal(match.step, "scores");
  const p1 = match.view("p1").players.find((player) => player.id === "p1")!;
  assert.equal(p1.points, 3 * POINTS.roastVote);
  assert.ok(match.view("tv").roast!.entries!.every((entry) => entry.artistId), "names are revealed at the scores");
});

test("Roast Portraits: the second round is blind, and drawings left unsent at the buzzer wait for the grace period", () => {
  const match = game("roast");
  playRoast(match);
  pastIntro(match);
  assert.equal(match.view("p1").blind, true);
  match.tick(STEP_MS.draw);
  assert.equal(match.step, "draw", "still collecting");
  match.input("p1", { kind: "scribble", action: "drawing", strokes: [LINE] }, false);
  match.input("p2", { kind: "scribble", action: "drawing", strokes: [LINE] }, false);
  match.tick(GRACE_MS);
  assert.equal(match.step, "caption");
  match.tick(STEP_MS.caption + GRACE_MS);
  match.tick(STEP_MS.vote);
  match.tick(STEP_MS.scores);
  assert.equal(match.finished, true);
});

test("Drawings are only sent to a device once, unless it asks again", () => {
  const match = game("roast");
  pastIntro(match);
  for (const id of ids(match)) match.input(id, { kind: "scribble", action: "drawing", strokes: [LINE] }, false);
  assert.equal(Object.keys(match.view("p1").art ?? {}).length, 1);
  assert.equal(match.view("p1").art, undefined);
  match.input("p1", { kind: "scribble", action: "resend" }, false);
  assert.equal(Object.keys(match.view("p1").art ?? {}).length, 1);
});

function playForgerToAccuse(match: ScribbleMatch): string[] {
  pastIntro(match);
  assert.equal(match.step, "secret");
  match.tick(STEP_MS.secret);
  assert.equal(match.step, "turns");
  const order = match.view("tv").forger!.order;
  for (let turn = 0; turn < order.length * FORGER_LAPS; turn += 1) {
    const view = match.view("tv").forger!;
    assert.equal(view.turnId, order[turn % order.length]);
    match.input(view.turnId!, { kind: "scribble", action: "stroke", stroke: { ...LINE, p: [turn, turn] }, done: false }, false);
    match.input(view.turnId!, { kind: "scribble", action: "stroke", stroke: LINE, done: true }, false);
  }
  assert.equal(match.step, "accuse");
  assert.equal(match.view("tv").forger!.strokes.length, order.length * FORGER_LAPS);
  return order;
}

function forgerOf(match: ScribbleMatch): string {
  return ids(match).find((id) => match.view(id).forger!.youAreForger)!;
}

test("The Forger: only artists see the word, and the forger never goes first", () => {
  const match = game("forger");
  pastIntro(match);
  const forger = forgerOf(match);
  for (const id of ids(match)) assert.equal(Boolean(match.view(id).forger!.word), id !== forger);
  assert.equal(match.view("tv").forger!.word, undefined, "the TV never shows the word early");
  assert.notEqual(match.view("tv").forger!.order[0], forger);
});

test("The Forger: caught, then a right guess still pays the forger", () => {
  const match = game("forger");
  playForgerToAccuse(match);
  const forger = forgerOf(match);
  for (const id of ids(match)) {
    const suspect = id === forger ? ids(match).find((other) => other !== forger)! : forger;
    match.input(id, { kind: "scribble", action: "vote", slot: "suspect", target: suspect }, false);
  }
  assert.equal(match.step, "guess");
  const word = match.view(ids(match).find((id) => id !== forger)!).forger!.word!;
  match.input(forger, { kind: "scribble", action: "text", text: word.toUpperCase() + "s" }, false);
  assert.equal(match.step, "reveal");
  const view = match.view("tv");
  assert.equal(view.forger!.outcome, "guessed");
  assert.equal(view.gains![forger], POINTS.forgerGuesses);
  for (const id of ids(match)) if (id !== forger) assert.equal(view.gains![id], POINTS.goodEye);
});

test("The Forger: a tied vote lets the forger escape", () => {
  const match = game("forger", 4, 11);
  playForgerToAccuse(match);
  const forger = forgerOf(match);
  const others = ids(match).filter((id) => id !== forger);
  match.input(others[0], { kind: "scribble", action: "vote", slot: "suspect", target: others[1] }, false);
  match.input(others[1], { kind: "scribble", action: "vote", slot: "suspect", target: others[2] }, false);
  match.tick(STEP_MS.accuse);
  assert.equal(match.step, "reveal");
  assert.equal(match.view("tv").forger!.outcome, "escaped");
  assert.equal(match.view("tv").gains![forger], POINTS.forgerEscapes);
});

test("The Forger: a player who drops out loses their turns instead of stalling the game", () => {
  const match = game("forger");
  pastIntro(match);
  match.tick(STEP_MS.secret);
  const order = match.view("tv").forger!.order;
  match.setAway(order[1], true);
  match.input(order[0], { kind: "scribble", action: "stroke", stroke: LINE, done: true }, false);
  assert.equal(match.view("tv").forger!.turnId, order[2]);
  match.tick(STEP_MS.turns);
  assert.equal(match.view("tv").forger!.turnId, order[3]);
});

test("Doodle Brawl: pick cards, draw, and the winner stays on", () => {
  const match = game("brawl");
  pastIntro(match);
  assert.equal(match.step, "pick");
  for (const id of ids(match)) {
    assert.equal(match.view(id).brawl!.hand!.who.length, 3);
    match.input(id, { kind: "scribble", action: "pick", who: 1, with: 2 }, false);
  }
  assert.equal(match.step, "draw");
  const cards = match.view("p1").brawl!.cards!;
  for (const id of ids(match)) match.input(id, { kind: "scribble", action: "drawing", strokes: [LINE], name: `Champ ${id}` }, false);
  assert.equal(match.step, "fight");
  const first = match.view("tv").brawl!;
  assert.equal(first.fighters!.find((fighter) => fighter.id === "p1")!.who, cards.who);
  // Fighters can't vote; everyone else backs the challenger.
  for (const id of ids(match)) match.input(id, { kind: "scribble", action: "vote", slot: "fighter", target: first.challengerId! }, false);
  assert.equal(match.step, "ko");
  assert.equal(match.view("tv").brawl!.winnerId, first.challengerId);
  match.tick(STEP_MS.ko);
  assert.equal(match.step, "fight");
  assert.equal(match.view("tv").brawl!.champId, first.challengerId);
  // Nobody votes: a coin flip decides.
  match.tick(STEP_MS.fight);
  assert.equal(match.view("tv").brawl!.coinFlip, true);
  match.tick(STEP_MS.ko);
  match.tick(STEP_MS.fight);
  match.tick(STEP_MS.ko);
  assert.equal(match.step, "scores");
  match.tick(STEP_MS.scores);
  assert.equal(match.finished, true);
  const total = match.view("tv").players.reduce((sum, player) => sum + player.points, 0);
  assert.equal(total, 3 * POINTS.brawlWin + POINTS.champion);
});

test("A full night runs Roast, Forger, a blind Roast and the Brawl, then names a winner", () => {
  const match = game("night", 3);
  const seen: string[] = [];
  for (let guard = 0; guard < 2000 && !match.finished; guard += 1) {
    const view = match.view("tv");
    if (view.step === "intro") seen.push(`${view.game}${view.blind ? " blind" : ""}`);
    match.tick(1000);
  }
  assert.equal(match.finished, true);
  assert.deepEqual(seen.filter((entry, index) => entry !== seen[index - 1]), ["roast", "forger", "roast blind", "brawl"]);
  assert.ok(match.winnerId);
});

test("Leaving down to one player ends the game", () => {
  const match = game("night", 3);
  match.remove("p1");
  assert.equal(match.finished, false);
  match.remove("p2");
  assert.equal(match.finished, true);
  assert.equal(match.winnerId, "p3");
});

test("Guesses forgive case, plurals and one typo", () => {
  assert.ok(sameWord("Giraffes", "giraffe"));
  assert.ok(sameWord("hot-air balloon", "hot air balloon"));
  assert.ok(sameWord("girafe", "giraffe"));
  assert.ok(!sameWord("bat", "cat"));
  assert.ok(!sameWord("", "cat"));
});

test("The room runs Scribble Scrap with a TV seat that never plays", () => {
  setScribbleRandomForTests(() => seededRandom(5));
  const room = new Room("ABCDE");
  room.addPlayer({ id: "tv", displayName: "TV", isHost: false, isReady: true, score: 0, screen: true });
  for (const id of ["a", "b", "c"]) room.addPlayer({ id, displayName: id, isHost: false, isReady: true, score: 0 });
  assert.ok(room.canStart("tv", scribbleScrap), "the TV can host");
  room.gameOptions = { scribbleMode: "forger" };
  room.game = scribbleScrap.setup(room);
  const match = scribbleMatchFor(room)!;
  assert.deepEqual(ids(match).sort(), ["a", "b", "c"]);
  assert.equal(scribbleScrap.shouldBroadcast!(room), true);
  assert.equal(scribbleScrap.shouldBroadcast!(room), false, "nothing new to send");
  scribbleScrap.handleInput(room, "tv", { kind: "scribble", action: "skip" });
  assert.equal(match.step, "secret");
  assert.equal(scribbleScrap.snapshotFor!(room, "tv")!.scribble!.forger!.word, undefined);
});

test("Room checks: a TV seat doesn't count towards the player minimum", () => {
  const room = new Room("ABCDE");
  room.addPlayer({ id: "tv", displayName: "TV", isHost: false, isReady: true, score: 0, screen: true });
  room.addPlayer({ id: "a", displayName: "a", isHost: false, isReady: true, score: 0 });
  room.addPlayer({ id: "b", displayName: "b", isHost: false, isReady: true, score: 0 });
  assert.equal(room.canStart("tv", scribbleScrap), false);
});

test("Validation clamps strokes and rejects junk", () => {
  const message = parseClientMessage({
    type: "PLAYER_INPUT",
    input: { kind: "scribble", action: "drawing", strokes: [{ c: 1, b: 0, p: [-5, 9999, 10.4, 20.6] }] },
  });
  assert.deepEqual(message, { type: "PLAYER_INPUT", input: { kind: "scribble", action: "drawing", strokes: [{ c: 1, b: 0, p: [0, 600, 10, 21] }], name: undefined } });
  assert.throws(() => parseClientMessage({ type: "PLAYER_INPUT", input: { kind: "scribble", action: "drawing", strokes: [{ c: 99, b: 0, p: [] }] } }));
  assert.throws(() => parseClientMessage({ type: "PLAYER_INPUT", input: { kind: "scribble", action: "stroke", stroke: { c: 0, b: 0, p: [1, 2, 3] } } }));
  assert.throws(() => parseClientMessage({ type: "START_GAME", scribbleMode: "chess" }));
  assert.deepEqual(parseClientMessage({ type: "JOIN_ROOM", roomCode: "abcde", displayName: "TV", screen: true }), { type: "JOIN_ROOM", roomCode: "ABCDE", displayName: "TV", screen: true });
});
