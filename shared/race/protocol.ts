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

// The nine pickups, after Mashed's: four that fire forwards, four that leave something behind, and the flash bang.
export type WeaponKind = "missile" | "machinegun" | "shotgun" | "mortar" | "mines" | "drums" | "oil" | "flamethrower" | "flashbang";

export const WEAPON_NAMES: Record<WeaponKind, string> = {
  missile: "Homing missile",
  machinegun: "Machine gun",
  shotgun: "Shotgun",
  mortar: "Mortar",
  mines: "Proximity mines",
  drums: "Drum bombs",
  oil: "Oil slick",
  flamethrower: "Flamethrower",
  flashbang: "Flash bang",
};

// Weapons that lock on: the car shows a laser sight that turns red on a target.
export const LOCKING_WEAPONS: WeaponKind[] = ["missile", "machinegun", "mortar"];

// "out": left behind this round. "falling": went over the edge and is about to be dropped back on.
export type CarState = "driving" | "falling" | "out";

export type RaceCar = {
  id: string;
  name: string;
  // Index into the car colours and bodies, fixed for the whole match.
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
  // On fire from a flamethrower: hard to steer.
  burning: boolean;
  // The flamethrower is pouring out of the back of this car.
  flaming: boolean;
  // Stalled on the line after revving too early.
  stalled: boolean;
  // The car a locking weapon has in its sights.
  lock?: string;
  // Off the screen: seconds left to get back on before the car blows up. 0 when it's fine.
  warn: number;
  // Knocked out this round: where this player is aiming an air strike, and whether one is ready.
  strike?: { x: number; y: number; ready: boolean };
};

export type ShotKind = "missile" | "bullet" | "mortar" | "drum" | "strike";

// Anything thrown or fired. A mortar or an air strike is in the air, coming down on (tx, ty).
export type RaceShot = { id: number; kind: ShotKind; x: number; y: number; z: number; angle: number; tx?: number; ty?: number };
export type RaceMine = { id: number; x: number; y: number; armed: boolean };
export type RaceSlick = { id: number; x: number; y: number; radius: number };
export type RaceCrate = { id: number; x: number; y: number };

export type RaceEvent =
  | { id: number; type: "boom"; x: number; y: number; radius: number }
  | { id: number; type: "pickup"; car: string; weapon: WeaponKind }
  | { id: number; type: "fire"; car: string; weapon: WeaponKind }
  | { id: number; type: "hit"; x: number; y: number }
  | { id: number; type: "crash"; x: number; y: number; force: number }
  | { id: number; type: "splash"; car: string; x: number; y: number }
  | { id: number; type: "burn"; car: string }
  | { id: number; type: "flash"; x: number; y: number }
  | { id: number; type: "turbo"; car: string }
  | { id: number; type: "stall"; car: string }
  | { id: number; type: "out"; car: string; x: number; y: number }
  | { id: number; type: "round"; winner?: string; second?: string; first?: string }
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
  shots: RaceShot[];
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
