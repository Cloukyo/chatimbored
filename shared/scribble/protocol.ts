// Scribble Scrap: the drawing party game. Everyone draws on their own phone or browser.
// On a couch, one device joins as the TV (a "screen" seat): it shows the reveals and never draws or votes.

export const SCRIBBLE_ID = "scribble_scrap";

// Every drawing lives on this fixed canvas, whatever size the device draws at.
export const CANVAS_W = 800;
export const CANVAS_H = 600;

export const INK = ["#1b1b1f", "#e8463a", "#f39a2b", "#f4d03f", "#3fae5a", "#3d7fe0", "#8e5bd8", "#f28cb8", "#8b5a3c", "#ffffff"];
export const BRUSHES = [4, 9, 18, 36];
// Each player's own ink, for The Forger's shared canvas and name tags: never black or white.
export function playerInk(color: number): number {
  return (color % 8) + 1;
}

// Limits the server enforces on a drawing.
export const MAX_STROKES = 400;
export const MAX_POINTS = 5000;
export const MAX_STROKE_POINTS = 800;
export const MAX_TEXT = 60;

// One pen-down to pen-up. p is flat [x0, y0, x1, y1, ...] in canvas units, rounded to whole numbers.
export type Stroke = { c: number; b: number; p: number[] };

export type ScribbleMode = "night" | "roast" | "forger" | "brawl";
export type ScribbleGameKey = "roast" | "forger" | "brawl";

export const MODES: { key: ScribbleMode; name: string; blurb: string; minutes: string }[] = [
  { key: "night", name: "Full night", blurb: "Roast Portraits, The Forger, a blind Roast, then the Doodle Brawl.", minutes: "about 12 min" },
  { key: "roast", name: "Roast Portraits", blurb: "Draw your friends doing terrible things. Caption someone else's. Vote.", minutes: "about 5 min" },
  { key: "forger", name: "The Forger", blurb: "One shared picture, one stroke each. One of you doesn't know what it is.", minutes: "about 5 min" },
  { key: "brawl", name: "Doodle Brawl", blurb: "Draw a fighter from two cards. Winner stays on.", minutes: "about 4 min" },
];

export const GAME_NAMES: Record<ScribbleGameKey, string> = {
  roast: "Roast Portraits",
  forger: "The Forger",
  brawl: "Doodle Brawl",
};

// What happens right now. Each game uses its own steps; "intro" and "final" are shared.
export type ScribbleStep =
  | "intro"
  | "draw" // roast and brawl: everyone draws at once
  | "caption" // roast: write a caption for someone else's drawing
  | "vote" // roast: best drawing and best caption
  | "scores" // roast and brawl: who got what this round
  | "secret" // forger: look at your word
  | "turns" // forger: one stroke each, in turn
  | "accuse" // forger: vote for the forger
  | "guess" // forger: caught, one guess at the word
  | "reveal" // forger: what happened
  | "pick" // brawl: pick your two cards
  | "fight" // brawl: one match, everyone else votes
  | "ko" // brawl: the match result
  | "final"; // the game is over

export type ScribblePlayer = { id: string; name: string; color: number; points: number; done: boolean; away: boolean };

// Drawings are sent once per device and then referred to by id, since a gallery can be large.
export type ArtRef = string;

export type RoastEntry = {
  art: ArtRef;
  // Empty while voting, except on your own drawing.
  artistId: string;
  prompt: string;
  caption?: string;
  captionBy?: string;
  // Filled in from the scores step on.
  drawingVotes?: number;
  captionVotes?: number;
};

export type RoastView = {
  // While drawing: your prompt.
  prompt?: string;
  // While captioning: the drawing you caption. Its artist isn't named until the votes.
  toCaption?: { art: ArtRef; prompt: string };
  // From the vote on. Artists stay hidden until the scores.
  entries?: RoastEntry[];
  myVotes?: { drawing?: ArtRef; caption?: ArtRef };
};

export type ForgerView = {
  category: string;
  // Only artists see the word, until the reveal.
  word?: string;
  youAreForger?: boolean;
  order: string[];
  turnId?: string;
  lap: number;
  laps: number;
  strokes: (Stroke & { by: string })[];
  live?: Stroke & { by: string };
  myVote?: string;
  // From the reveal (and the guess) on.
  accusedId?: string;
  forgerId?: string;
  votes?: Record<string, number>;
  guess?: string;
  guessRight?: boolean;
  outcome?: "escaped" | "guessed" | "caught";
};

export type Fighter = { id: string; art: ArtRef; name: string; who: string; with: string };

export type BrawlView = {
  hand?: { who: string[]; with: string[] };
  picked?: { who: number; with: number };
  // While drawing: your two cards.
  cards?: { who: string; with: string };
  fighters?: Fighter[];
  // The champion stays on; challengers come in this order.
  champId?: string;
  challengerId?: string;
  queue?: string[];
  myVote?: string;
  votes?: Record<string, number>;
  winnerId?: string;
  coinFlip?: boolean;
  wins?: Record<string, number>;
};

export type ScribbleView = {
  mode: ScribbleMode;
  game: ScribbleGameKey;
  // Which part of the night (1-based) and how many parts there are.
  part: number;
  parts: number;
  round: number;
  rounds: number;
  step: ScribbleStep;
  // Time left in this step when the snapshot was made. Clients count down from when it arrives.
  msLeft: number;
  blind: boolean;
  players: ScribblePlayer[];
  // Points each player gained in the last scored step.
  gains?: Record<string, number>;
  // Drawings this device hasn't been sent yet.
  art?: Record<ArtRef, Stroke[]>;
  roast?: RoastView;
  forger?: ForgerView;
  brawl?: BrawlView;
};

export type ScribbleInput =
  | { kind: "scribble"; action: "drawing"; strokes: Stroke[]; name?: string }
  | { kind: "scribble"; action: "text"; text: string }
  | { kind: "scribble"; action: "vote"; slot: "drawing" | "caption" | "suspect" | "fighter"; target: string }
  | { kind: "scribble"; action: "pick"; who: number; with: number }
  // The Forger: the stroke being drawn so far; done when the pen lifts.
  | { kind: "scribble"; action: "stroke"; stroke: Stroke; done: boolean }
  // This device lost some drawings (a refresh): send them all again.
  | { kind: "scribble"; action: "resend" }
  // Host only: move on without the stragglers.
  | { kind: "scribble"; action: "skip" };
