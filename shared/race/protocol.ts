// Wire types for Pile-Up, the top-down party racer. Shared by the server and the web client.
// Everyone sees the same thing, so one view goes to every player.

export const PILE_UP_ID = "pile_up";

export type RaceInput = {
  kind: "race";
  // -1 full left to 1 full right.
  steer: number;
  // -1 brake and reverse to 1 full throttle.
  throttle: number;
  // Counts every press of fire. The server fires once for each increase, so a dropped or repeated packet can't lose or double a shot.
  fires: number;
};

export type WeaponKind = "rocket" | "mines" | "oil" | "shockwave" | "nitro";

export const WEAPON_NAMES: Record<WeaponKind, string> = {
  rocket: "Rocket",
  mines: "Mines",
  oil: "Oil slick",
  shockwave: "Shockwave",
  nitro: "Nitro",
};

// "out": off the back of the screen this round. "falling": went over the edge and is about to be dropped back on.
export type CarState = "driving" | "falling" | "out";

export type RaceCar = {
  id: string;
  name: string;
  // Index into the car colours, fixed for the whole match.
  color: number;
  bot: boolean;
  x: number;
  y: number;
  // Heading in radians, 0 is along +x.
  angle: number;
  vx: number;
  vy: number;
  state: CarState;
  // Points in the match, out of the target.
  points: number;
  weapon?: WeaponKind;
  ammo: number;
  boosting: boolean;
  // Seconds left spinning from a hit or an oil slick.
  dizzy: number;
  // Height off the ground after a blast or a big shunt, and how far it has flipped over while up there.
  z: number;
  roll: number;
  // Just dropped back on after a fall: weapons and bumps pass through it for a moment.
  ghost: boolean;
};

export type RaceRocket = { id: number; x: number; y: number; angle: number };
export type RaceMine = { id: number; x: number; y: number; armed: boolean };
export type RaceSlick = { id: number; x: number; y: number; radius: number };
export type RaceCrate = { id: number; x: number; y: number };

export type RaceEvent =
  | { id: number; type: "boom"; x: number; y: number; radius: number }
  | { id: number; type: "pickup"; car: string; weapon: WeaponKind }
  | { id: number; type: "fire"; car: string; weapon: WeaponKind }
  | { id: number; type: "crash"; x: number; y: number; force: number }
  | { id: number; type: "splash"; car: string; x: number; y: number }
  | { id: number; type: "out"; car: string; x: number; y: number }
  | { id: number; type: "round"; winner?: string }
  | { id: number; type: "go" };

export type RacePhase = "countdown" | "racing" | "round_over" | "match_over";

export type RaceView = {
  trackId: string;
  phase: RacePhase;
  // Milliseconds left in this phase (the countdown, or the pause after a round).
  phaseMs: number;
  round: number;
  target: number;
  // Increases every server tick, so the client can order and interpolate snapshots.
  tick: number;
  // The shared screen in world units. A car that leaves it is out of the round.
  view: { x: number; y: number; width: number; height: number };
  // The screen is closing in, late in a round.
  shrinking: boolean;
  cars: RaceCar[];
  rockets: RaceRocket[];
  mines: RaceMine[];
  slicks: RaceSlick[];
  crates: RaceCrate[];
  // Recent events, kept for a second or so; each has a unique id so the client plays it once.
  events: RaceEvent[];
  // This round's order of elimination, first out first.
  outOrder: string[];
  roundWinner?: string;
  matchWinner?: string;
};
