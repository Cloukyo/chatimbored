import {
  MAX_POINTS,
  MAX_STROKES,
  type ArtRef,
  type BrawlView,
  type ForgerView,
  type RoastEntry,
  type RoastView,
  type ScribbleGameKey,
  type ScribbleInput,
  type ScribbleMode,
  type ScribbleStep,
  type ScribbleView,
  type Stroke,
  playerInk,
} from "../../../shared/scribble/protocol.js";
import { shuffle, type Random } from "../crowd/random.js";
import { BRAWL_WHO, BRAWL_WITH, FORGER_WORDS, ROAST_PROMPTS } from "./cards.js";

// How long each step lasts, in ms.
export const STEP_MS: Record<ScribbleStep, number> = {
  intro: 6_000,
  draw: 80_000,
  caption: 35_000,
  vote: 30_000,
  scores: 9_000,
  secret: 7_000,
  turns: 15_000, // per turn
  accuse: 40_000,
  guess: 25_000,
  reveal: 10_000,
  pick: 20_000,
  fight: 15_000,
  ko: 5_000,
  final: 0,
};
// Devices send what they have when their clock hits zero; this is how long the server waits for it.
export const GRACE_MS = 2_500;
const GRACE_STEPS = new Set<ScribbleStep>(["draw", "caption", "guess"]);

export const POINTS = {
  roastVote: 100,
  forgerEscapes: 400,
  forgerGuesses: 250,
  artistsCatch: 150,
  goodEye: 50,
  brawlWin: 100,
  champion: 200,
};
export const FORGER_LAPS = 2;
const HAND_SIZE = 3;
const MAX_TEXT = 60;

type Part = { game: ScribbleGameKey; blind: boolean[] };
type Seat = { id: string; name: string; color: number; points: number; away: boolean; gone: boolean };

type RoastRound = {
  prompts: Map<string, string>;
  art: Map<string, ArtRef>; // artist -> drawing
  captionFor: Map<string, string>; // captioner -> artist
  captions: Map<string, { text: string; by: string }>; // artist -> caption
  order: string[]; // artists, in gallery order
  drawingVotes: Map<string, string>; // voter -> artist
  captionVotes: Map<string, string>; // voter -> artist whose drawing has the caption
};

type ForgerRound = {
  forgerId: string;
  category: string;
  word: string;
  order: string[];
  turn: number; // index into laps * order
  strokes: (Stroke & { by: string })[];
  live?: Stroke & { by: string };
  votes: Map<string, string>;
  accusedId?: string;
  guess?: string;
  guessRight?: boolean;
  outcome?: ForgerView["outcome"];
};

type BrawlRound = {
  hands: Map<string, { who: string[]; with: string[] }>;
  picks: Map<string, { who: number; with: number }>;
  art: Map<string, ArtRef>;
  names: Map<string, string>;
  queue: string[];
  champId?: string;
  challengerId?: string;
  votes: Map<string, string>;
  winnerId?: string;
  coinFlip?: boolean;
  wins: Map<string, number>;
};

export class ScribbleMatch {
  readonly mode: ScribbleMode;
  readonly parts: Part[];
  private readonly seats: Seat[];
  private partIndex = 0;
  private round = 0;
  step: ScribbleStep = "intro";
  private clock = 0;
  private deadline = 0;
  private readonly done = new Set<string>();
  private gains = new Map<string, number>();
  private readonly art = new Map<ArtRef, Stroke[]>();
  private readonly sentArt = new Map<string, Set<ArtRef>>();
  private artCount = 0;
  private roast?: RoastRound;
  private forger?: ForgerRound;
  private brawl?: BrawlRound;
  private lastForger = "";
  private readonly usedPrompts = new Set<string>();
  private readonly usedWords = new Set<string>();
  finished = false;
  winnerId?: string;
  // Goes up whenever anything anyone can see changes, so the server only sends a snapshot then.
  version = 0;

  constructor(
    entrants: { id: string; name: string }[],
    private readonly random: Random,
    mode: ScribbleMode,
    options: { blind?: boolean } = {},
  ) {
    this.mode = mode;
    const blind = options.blind !== false;
    const parts: Record<ScribbleMode, Part[]> = {
      night: [
        { game: "roast", blind: [false] },
        { game: "forger", blind: [false] },
        { game: "roast", blind: [blind] },
        { game: "brawl", blind: [false] },
      ],
      roast: [{ game: "roast", blind: [false, blind] }],
      forger: [{ game: "forger", blind: [false, false] }],
      brawl: [{ game: "brawl", blind: [false] }],
    };
    this.parts = parts[mode];
    this.seats = entrants.map((entrant, index) => ({ ...entrant, color: index, points: 0, away: false, gone: false }));
    this.enter("intro");
  }

  get game(): ScribbleGameKey {
    return this.parts[this.partIndex].game;
  }

  get blind(): boolean {
    return this.parts[this.partIndex].blind[this.round] ?? false;
  }

  // Everyone still playing and connected: the people a step waits for.
  private get active(): string[] {
    return this.seats.filter((seat) => !seat.gone && !seat.away).map((seat) => seat.id);
  }

  private get present(): string[] {
    return this.seats.filter((seat) => !seat.gone).map((seat) => seat.id);
  }

  private seat(id: string): Seat | undefined {
    return this.seats.find((seat) => seat.id === id && !seat.gone);
  }

  private name(id: string): string {
    return this.seats.find((seat) => seat.id === id)?.name ?? "Someone";
  }

  // Time ------------------------------------------------------------------------

  tick(deltaMs: number): void {
    if (this.finished) return;
    this.clock += deltaMs;
    const end = this.deadline + (GRACE_STEPS.has(this.step) ? GRACE_MS : 0);
    if (this.clock >= end) this.timeUp();
  }

  setAway(id: string, away: boolean): void {
    const seat = this.seat(id);
    if (!seat || seat.away === away) return;
    seat.away = away;
    this.changed();
    if (away) this.afterSomeoneLeft(id);
  }

  remove(id: string): void {
    const seat = this.seat(id);
    if (!seat) return;
    seat.gone = true;
    this.sentArt.delete(id);
    this.changed();
    if (this.present.length < 2) {
      this.end();
      return;
    }
    this.afterSomeoneLeft(id);
  }

  private afterSomeoneLeft(id: string): void {
    if (this.step === "turns" && this.turnId() === id) this.nextTurn();
    else if (this.step === "fight" && (this.brawl?.champId === id || this.brawl?.challengerId === id)) this.settleFight(this.brawl.champId === id ? this.brawl.challengerId : this.brawl.champId);
    else if (this.step === "guess" && this.forger?.forgerId === id) this.enter("reveal");
    else this.checkAllDone();
  }

  private changed(): void {
    this.version += 1;
  }

  // Input ------------------------------------------------------------------------

  input(playerId: string, input: ScribbleInput, isHost: boolean): void {
    if (this.finished) return;
    if (input.action === "skip") {
      if (isHost) this.timeUp();
      return;
    }
    if (input.action === "resend") {
      this.sentArt.delete(playerId);
      this.changed();
      return;
    }
    if (!this.seat(playerId)) return;
    switch (input.action) {
      case "drawing":
        return this.takeDrawing(playerId, input.strokes, input.name);
      case "text":
        return this.takeText(playerId, input.text);
      case "vote":
        return this.takeVote(playerId, input.slot, input.target);
      case "pick":
        return this.takePick(playerId, input.who, input.with);
      case "stroke":
        return this.takeStroke(playerId, input.stroke, input.done);
    }
  }

  private takeDrawing(playerId: string, strokes: Stroke[], name?: string): void {
    if (this.step !== "draw") return;
    const round = this.game === "roast" ? this.roast : this.brawl;
    if (!round) return;
    round.art.set(playerId, this.storeArt(strokes));
    if (this.brawl && name !== undefined) this.brawl.names.set(playerId, cleanText(name, 24));
    this.markDone(playerId);
  }

  private takeText(playerId: string, raw: string): void {
    const text = cleanText(raw, MAX_TEXT);
    if (!text) return;
    if (this.step === "caption" && this.roast) {
      const artist = this.roast.captionFor.get(playerId);
      if (!artist) return;
      this.roast.captions.set(artist, { text, by: playerId });
      this.markDone(playerId);
    } else if (this.step === "guess" && this.forger && this.forger.forgerId === playerId) {
      this.forger.guess = text;
      this.forger.guessRight = sameWord(text, this.forger.word);
      this.enter("reveal");
    }
  }

  private takeVote(playerId: string, slot: string, target: string): void {
    if (this.step === "vote" && this.roast) {
      const round = this.roast;
      // Votes name a drawing, since artists stay anonymous while voting.
      const artist = [...round.art.entries()].find(([, art]) => art === target)?.[0];
      if (!artist) return;
      if (slot === "drawing" && artist !== playerId) round.drawingVotes.set(playerId, artist);
      else if (slot === "caption" && round.captions.has(artist) && round.captions.get(artist)!.by !== playerId) round.captionVotes.set(playerId, artist);
      else return;
      this.changed();
      // Done once both votes are in, or the one that's possible.
      const canCaption = [...round.captions.values()].some((caption) => caption.by !== playerId);
      if (round.drawingVotes.has(playerId) && (round.captionVotes.has(playerId) || !canCaption)) this.markDone(playerId);
    } else if (this.step === "accuse" && this.forger && slot === "suspect") {
      if (target === playerId || !this.forger.order.includes(target)) return;
      this.forger.votes.set(playerId, target);
      this.markDone(playerId);
    } else if (this.step === "fight" && this.brawl && slot === "fighter") {
      const { champId, challengerId } = this.brawl;
      if (playerId === champId || playerId === challengerId) return;
      if (target !== champId && target !== challengerId) return;
      this.brawl.votes.set(playerId, target);
      this.markDone(playerId);
    }
  }

  private takePick(playerId: string, who: number, withIndex: number): void {
    if (this.step !== "pick" || !this.brawl) return;
    const hand = this.brawl.hands.get(playerId);
    if (!hand || !hand.who[who] || !hand.with[withIndex]) return;
    this.brawl.picks.set(playerId, { who, with: withIndex });
    this.markDone(playerId);
  }

  private takeStroke(playerId: string, stroke: Stroke, done: boolean): void {
    if (this.step !== "turns" || !this.forger || this.turnId() !== playerId) return;
    // Everyone draws in their own colour, so you can see who drew what.
    this.forger.live = { ...stroke, c: playerInk(this.seat(playerId)!.color), by: playerId };
    this.changed();
    if (done) this.nextTurn();
  }

  private storeArt(strokes: Stroke[]): ArtRef {
    const id = `a${++this.artCount}`;
    let points = 0;
    const kept: Stroke[] = [];
    for (const stroke of strokes.slice(0, MAX_STROKES)) {
      points += stroke.p.length / 2;
      if (points > MAX_POINTS) break;
      kept.push(stroke);
    }
    this.art.set(id, kept);
    return id;
  }

  private markDone(playerId: string): void {
    this.done.add(playerId);
    this.changed();
    this.checkAllDone();
  }

  // Who the current step waits for.
  private waitingOn(): string[] {
    const active = this.active;
    switch (this.step) {
      case "caption":
        return active.filter((id) => this.roast?.captionFor.has(id));
      case "accuse":
        return active.filter((id) => this.forger?.order.includes(id));
      case "fight":
        return active.filter((id) => id !== this.brawl?.champId && id !== this.brawl?.challengerId);
      case "draw":
      case "vote":
      case "pick":
        return active;
      default:
        return [];
    }
  }

  private checkAllDone(): void {
    if (!["draw", "caption", "vote", "pick", "accuse", "fight"].includes(this.step)) return;
    const waiting = this.waitingOn();
    if (waiting.length > 0 && waiting.every((id) => this.done.has(id))) this.timeUp();
    else if (waiting.length === 0 && this.step === "fight") this.timeUp();
  }

  // Steps ------------------------------------------------------------------------

  private enter(step: ScribbleStep, ms = STEP_MS[step]): void {
    this.step = step;
    this.deadline = this.clock + ms;
    this.done.clear();
    if (step !== "scores" && step !== "reveal" && step !== "ko") this.gains = new Map();
    this.changed();
    switch (step) {
      case "draw":
        if (this.game === "roast") this.dealRoast();
        break;
      case "caption":
        this.assignCaptions();
        break;
      case "vote":
        this.roast!.order = shuffle([...this.roast!.art.keys()], this.random);
        break;
      case "scores":
        // Brawl points land fight by fight.
        if (this.game === "roast") this.scoreRoast();
        break;
      case "secret":
        this.dealForger();
        break;
      case "turns":
        this.startTurn();
        break;
      case "reveal":
        this.scoreForger();
        break;
      case "pick":
        this.dealBrawl();
        break;
      case "fight":
        this.brawl!.votes.clear();
        this.brawl!.winnerId = undefined;
        this.brawl!.coinFlip = false;
        this.checkAllDone();
        break;
    }
  }

  private timeUp(): void {
    switch (this.step) {
      case "intro":
        return this.enter(this.game === "roast" ? "draw" : this.game === "forger" ? "secret" : "pick");
      case "draw":
        if (this.game === "brawl") return this.startBrawlFights();
        return this.roast!.art.size >= 2 ? this.enter("caption") : this.nextRound();
      case "caption":
        return this.enter("vote");
      case "vote":
        return this.enter("scores");
      case "scores":
        return this.nextRound();
      case "secret":
        return this.enter("turns");
      case "turns":
        return this.nextTurn();
      case "accuse":
        return this.accuse();
      case "guess":
        return this.enter("reveal");
      case "reveal":
        return this.nextRound();
      case "pick":
        return this.enter("draw");
      case "fight":
        return this.settleFight();
      case "ko":
        return this.nextFight();
      case "final":
        return;
    }
  }

  private nextRound(): void {
    const part = this.parts[this.partIndex];
    if (this.round + 1 < part.blind.length) {
      this.round += 1;
    } else if (this.partIndex + 1 < this.parts.length) {
      this.partIndex += 1;
      this.round = 0;
    } else {
      this.end();
      return;
    }
    this.roast = undefined;
    this.forger = undefined;
    this.brawl = undefined;
    this.enter("intro");
  }

  end(): void {
    this.finished = true;
    this.step = "final";
    const ranked = this.seats.filter((seat) => !seat.gone).sort((a, b) => b.points - a.points);
    this.winnerId = ranked[0]?.id;
    this.changed();
  }

  private award(id: string | undefined, points: number): void {
    const seat = id ? this.seat(id) : undefined;
    if (!seat) return;
    seat.points += points;
    this.gains.set(seat.id, (this.gains.get(seat.id) ?? 0) + points);
  }

  // Roast Portraits ----------------------------------------------------------------

  private dealRoast(): void {
    const drawers = this.present;
    // Everyone is roasted once, and never by themselves when there's anyone else.
    const targets = derangement(drawers, this.random);
    const prompts = new Map<string, string>();
    const fresh = shuffle(ROAST_PROMPTS.filter((prompt) => !this.usedPrompts.has(prompt)), this.random);
    const pool = fresh.length >= drawers.length ? fresh : shuffle(ROAST_PROMPTS, this.random);
    drawers.forEach((id, index) => {
      const target = targets[index];
      const others = drawers.filter((other) => other !== id && other !== target);
      const template = pool.find((prompt) => !prompt.includes("{B}") || others.length > 0) ?? pool[0];
      pool.splice(pool.indexOf(template), 1);
      this.usedPrompts.add(template);
      const partner = others[Math.floor(this.random() * others.length)];
      prompts.set(id, template.replace("{A}", this.name(target)).replace("{B}", partner ? this.name(partner) : "their twin"));
    });
    this.roast = {
      prompts,
      art: new Map(),
      captionFor: new Map(),
      captions: new Map(),
      order: [],
      drawingVotes: new Map(),
      captionVotes: new Map(),
    };
  }

  private assignCaptions(): void {
    const round = this.roast!;
    const artists = [...round.art.keys()];
    const writers = this.present;
    // Each writer gets someone else's drawing; drawings go round so each one gets a caption where possible.
    const shuffled = shuffle(artists, this.random);
    writers.forEach((writer, index) => {
      const choices = shuffled.filter((artist) => artist !== writer);
      if (choices.length === 0) return;
      const untaken = choices.filter((artist) => ![...round.captionFor.values()].includes(artist));
      const pickFrom = untaken.length > 0 ? untaken : choices;
      round.captionFor.set(writer, pickFrom[index % pickFrom.length]);
    });
  }

  private scoreRoast(): void {
    const round = this.roast!;
    for (const artist of round.drawingVotes.values()) this.award(artist, POINTS.roastVote);
    for (const artist of round.captionVotes.values()) this.award(round.captions.get(artist)?.by, POINTS.roastVote);
  }

  private roastView(viewerId: string, show: (art: ArtRef) => void): RoastView | undefined {
    const round = this.roast;
    if (!round) return undefined;
    if (this.step === "draw") return { prompt: round.prompts.get(viewerId) };
    if (this.step === "caption") {
      const artist = round.captionFor.get(viewerId);
      if (!artist) return {};
      const art = round.art.get(artist)!;
      show(art);
      return { toCaption: { art, prompt: round.prompts.get(artist) ?? "" } };
    }
    const revealed = this.step === "scores";
    const count = (votes: Map<string, string>, artist: string) => [...votes.values()].filter((value) => value === artist).length;
    const artOf = (artist?: string) => (artist ? round.art.get(artist) : undefined);
    const entries: RoastEntry[] = round.order.map((artist) => {
      const art = round.art.get(artist)!;
      show(art);
      const caption = round.captions.get(artist);
      // While voting, names stay hidden, except your own so you know what you can't vote for.
      return {
        art,
        artistId: revealed || artist === viewerId ? artist : "",
        prompt: round.prompts.get(artist) ?? "",
        caption: caption?.text,
        captionBy: revealed || caption?.by === viewerId ? caption?.by : undefined,
        drawingVotes: revealed ? count(round.drawingVotes, artist) : undefined,
        captionVotes: revealed ? count(round.captionVotes, artist) : undefined,
      };
    });
    return { entries, myVotes: { drawing: artOf(round.drawingVotes.get(viewerId)), caption: artOf(round.captionVotes.get(viewerId)) } };
  }

  // The Forger ----------------------------------------------------------------------

  private dealForger(): void {
    const players = this.present;
    const candidates = players.filter((id) => id !== this.lastForger);
    const forgerId = (candidates.length > 0 ? candidates : players)[Math.floor(this.random() * (candidates.length || players.length))];
    this.lastForger = forgerId;
    const deck = FORGER_WORDS[Math.floor(this.random() * FORGER_WORDS.length)];
    const fresh = deck.words.filter((word) => !this.usedWords.has(word));
    const words = fresh.length > 0 ? fresh : deck.words;
    const word = words[Math.floor(this.random() * words.length)];
    this.usedWords.add(word);
    // The forger never goes first: with a blank page there's nothing to copy.
    let order = shuffle(players, this.random);
    if (order[0] === forgerId && order.length > 1) order = [...order.slice(1), forgerId];
    this.forger = { forgerId, category: deck.category, word, order, turn: 0, strokes: [], votes: new Map() };
  }

  private turnId(): string | undefined {
    const round = this.forger;
    if (!round || this.step !== "turns") return undefined;
    return round.order[round.turn % round.order.length];
  }

  private startTurn(): void {
    const round = this.forger!;
    // Skip anyone who has left or dropped out.
    while (round.turn < round.order.length * FORGER_LAPS && !this.active.includes(round.order[round.turn % round.order.length])) round.turn += 1;
    if (round.turn >= round.order.length * FORGER_LAPS) {
      this.enter("accuse");
      return;
    }
    this.deadline = this.clock + STEP_MS.turns;
    this.changed();
  }

  private nextTurn(): void {
    const round = this.forger!;
    if (round.live && round.live.p.length >= 2) round.strokes.push(round.live);
    round.live = undefined;
    round.turn += 1;
    this.startTurn();
  }

  private accuse(): void {
    const round = this.forger!;
    const tally = new Map<string, number>();
    for (const suspect of round.votes.values()) tally.set(suspect, (tally.get(suspect) ?? 0) + 1);
    const top = Math.max(0, ...tally.values());
    const leaders = [...tally.entries()].filter(([, votes]) => votes === top).map(([id]) => id);
    // A tie, or nobody voting, lets the forger slip away.
    round.accusedId = leaders.length === 1 ? leaders[0] : undefined;
    if (round.accusedId === round.forgerId && this.seat(round.forgerId) && !this.seat(round.forgerId)!.away) this.enter("guess");
    else this.enter("reveal");
  }

  private scoreForger(): void {
    const round = this.forger!;
    const caught = round.accusedId === round.forgerId;
    round.outcome = !caught ? "escaped" : round.guessRight ? "guessed" : "caught";
    if (round.outcome === "escaped") this.award(round.forgerId, POINTS.forgerEscapes);
    else if (round.outcome === "guessed") this.award(round.forgerId, POINTS.forgerGuesses);
    else for (const id of round.order) if (id !== round.forgerId) this.award(id, POINTS.artistsCatch);
    for (const [voter, suspect] of round.votes) if (suspect === round.forgerId && voter !== round.forgerId) this.award(voter, POINTS.goodEye);
  }

  private forgerView(viewerId: string): ForgerView | undefined {
    const round = this.forger;
    if (!round) return undefined;
    const isForger = viewerId === round.forgerId;
    const isArtist = round.order.includes(viewerId) && !isForger;
    const revealed = this.step === "reveal";
    const tallied = revealed || this.step === "guess";
    const votes: Record<string, number> = {};
    if (tallied) for (const suspect of round.votes.values()) votes[suspect] = (votes[suspect] ?? 0) + 1;
    return {
      category: round.category,
      word: isArtist || revealed ? round.word : undefined,
      youAreForger: isForger || undefined,
      order: round.order,
      turnId: this.turnId(),
      lap: Math.min(FORGER_LAPS, Math.floor(round.turn / round.order.length) + 1),
      laps: FORGER_LAPS,
      strokes: round.strokes,
      live: round.live,
      myVote: round.votes.get(viewerId),
      accusedId: tallied ? round.accusedId : undefined,
      forgerId: tallied && (revealed || round.accusedId === round.forgerId) ? round.forgerId : undefined,
      votes: tallied ? votes : undefined,
      guess: revealed ? round.guess : undefined,
      guessRight: revealed ? round.guessRight : undefined,
      outcome: revealed ? round.outcome : undefined,
    };
  }

  // Doodle Brawl ---------------------------------------------------------------------

  private dealBrawl(): void {
    const who = shuffle(BRAWL_WHO, this.random);
    const withs = shuffle(BRAWL_WITH, this.random);
    const hands = new Map<string, { who: string[]; with: string[] }>();
    this.present.forEach((id, index) => {
      const take = <T>(deck: T[]) => Array.from({ length: HAND_SIZE }, (_, slot) => deck[(index * HAND_SIZE + slot) % deck.length]);
      hands.set(id, { who: take(who), with: take(withs) });
    });
    this.brawl = { hands, picks: new Map(), art: new Map(), names: new Map(), queue: [], votes: new Map(), wins: new Map() };
  }

  private cardsFor(id: string): { who: string; with: string } | undefined {
    const round = this.brawl;
    const hand = round?.hands.get(id);
    if (!round || !hand) return undefined;
    // Too slow to pick: the first card of each.
    const pick = round.picks.get(id) ?? { who: 0, with: 0 };
    return { who: hand.who[pick.who], with: hand.with[pick.with] };
  }

  private startBrawlFights(): void {
    const round = this.brawl!;
    for (const id of this.present) if (!round.art.has(id)) round.art.set(id, this.storeArt([]));
    const fighters = shuffle([...round.art.keys()].filter((id) => this.seat(id)), this.random);
    if (fighters.length < 2) return this.nextRound();
    round.champId = fighters[0];
    round.challengerId = fighters[1];
    round.queue = fighters.slice(2);
    this.enter("fight");
  }

  private settleFight(forcedWinner?: string): void {
    const round = this.brawl!;
    const { champId, challengerId } = round;
    if (!champId || !challengerId) return;
    let winner = forcedWinner;
    if (!winner) {
      const champVotes = [...round.votes.values()].filter((id) => id === champId).length;
      const challengerVotes = [...round.votes.values()].filter((id) => id === challengerId).length;
      round.coinFlip = champVotes === challengerVotes;
      winner = round.coinFlip ? (this.random() < 0.5 ? champId : challengerId) : champVotes > challengerVotes ? champId : challengerId;
    }
    round.winnerId = winner;
    round.wins.set(winner, (round.wins.get(winner) ?? 0) + 1);
    this.award(winner, POINTS.brawlWin);
    this.enter("ko");
  }

  private nextFight(): void {
    const round = this.brawl!;
    round.champId = round.winnerId;
    const next = round.queue.find((id) => this.seat(id));
    round.queue = round.queue.slice(next ? round.queue.indexOf(next) + 1 : round.queue.length);
    if (!next || !round.champId || !this.seat(round.champId)) {
      this.award(round.champId, POINTS.champion);
      this.enter("scores");
      return;
    }
    round.challengerId = next;
    this.enter("fight");
  }

  private brawlView(viewerId: string, show: (art: ArtRef) => void): BrawlView | undefined {
    const round = this.brawl;
    if (!round) return undefined;
    if (this.step === "pick") return { hand: round.hands.get(viewerId), picked: round.picks.get(viewerId) };
    if (this.step === "draw") return { cards: this.cardsFor(viewerId) };
    const fighters = [...round.art.entries()].map(([id, art]) => {
      show(art);
      const cards = this.cardsFor(id) ?? { who: "A mystery", with: "with nothing" };
      return { id, art, name: round.names.get(id) || this.name(id), ...cards };
    });
    const votes: Record<string, number> = {};
    if (this.step !== "fight") for (const id of round.votes.values()) votes[id] = (votes[id] ?? 0) + 1;
    return {
      fighters,
      champId: round.champId,
      challengerId: round.challengerId,
      queue: round.queue,
      myVote: round.votes.get(viewerId),
      votes: this.step === "fight" ? undefined : votes,
      winnerId: this.step === "fight" ? undefined : round.winnerId,
      coinFlip: this.step === "fight" ? undefined : round.coinFlip,
      wins: Object.fromEntries(round.wins),
    };
  }

  // Views ----------------------------------------------------------------------------

  // What one device may see. Drawings it was already sent are left out.
  view(viewerId: string): ScribbleView {
    const sent = this.sentArt.get(viewerId) ?? new Set<ArtRef>();
    this.sentArt.set(viewerId, sent);
    const art: Record<ArtRef, Stroke[]> = {};
    const show = (ref: ArtRef) => {
      if (sent.has(ref)) return;
      sent.add(ref);
      art[ref] = this.art.get(ref) ?? [];
    };
    const waiting = new Set(this.waitingOn());
    const msLeft = Math.max(0, Math.round(this.deadline - this.clock));
    return {
      mode: this.mode,
      game: this.game,
      part: this.partIndex + 1,
      parts: this.parts.length,
      round: this.round + 1,
      rounds: this.parts[this.partIndex].blind.length,
      step: this.step,
      msLeft: this.step === "final" ? 0 : msLeft,
      blind: this.blind,
      players: this.seats
        .filter((seat) => !seat.gone)
        .map((seat) => ({
          id: seat.id,
          name: seat.name,
          color: seat.color,
          points: seat.points,
          done: this.done.has(seat.id) || (!waiting.has(seat.id) && this.waitsForAnyone()),
          away: seat.away,
        })),
      gains: this.gains.size > 0 ? Object.fromEntries(this.gains) : undefined,
      roast: this.game === "roast" ? this.roastView(viewerId, show) : undefined,
      forger: this.game === "forger" ? this.forgerView(viewerId) : undefined,
      brawl: this.game === "brawl" ? this.brawlView(viewerId, show) : undefined,
      art: Object.keys(art).length > 0 ? art : undefined,
    };
  }

  private waitsForAnyone(): boolean {
    return ["draw", "caption", "vote", "pick", "accuse", "fight"].includes(this.step);
  }
}

// Every item moved to a different slot, so nobody gets themselves.
function derangement<T>(items: T[], random: Random): T[] {
  if (items.length < 2) return [...items];
  const order = shuffle(items, random);
  // Rotating a shuffled list by one never leaves anything in place.
  const target = new Map(order.map((item, index) => [item, order[(index + 1) % order.length]]));
  return items.map((item) => target.get(item)!);
}

export function cleanText(raw: string, max: number): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, max);
}

// Forgiving: case, spacing, punctuation, a plural s, or one typo in a longer word.
export function sameWord(guess: string, word: string): boolean {
  const norm = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");
  const a = norm(guess);
  const b = norm(word);
  if (!a) return false;
  if (a === b) return true;
  return b.length > 4 && editDistance(a, b) <= 1;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}
