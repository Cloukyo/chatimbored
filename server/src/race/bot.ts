import { pointAt } from "../../../shared/race/track.js";
import type { Random } from "../crowd/random.js";
import { wrapAngle, type Car, type RaceMatch } from "./RaceMatch.js";

// Drives the bots that fill an empty grid, and anyone whose connection has dropped. Mashed's bots were famously dim,
// so these don't try too hard either.
export type BotBrain = {
  // Where across the road this bot likes to be, -1 to 1.
  lane: number;
  laneTimer: number;
  stuckFor: number;
  reverseFor: number;
  // Set when the bot wants to use its weapon this tick.
  fire: boolean;
  // How this bot will get off the line next round.
  launch: "none" | "early" | "perfect";
};

const LOOK_AHEAD = 200;

export function botInput(car: Car, match: RaceMatch, dt: number, random: Random): { steer: number; throttle: number } {
  const brain = car.brain;
  brain.laneTimer -= dt;
  if (brain.laneTimer <= 0) {
    brain.lane = (random() - 0.5) * 1.1;
    brain.laneTimer = 2 + random() * 3;
  }
  // Dazzled by a flash bang: flail.
  if (car.confusedLeft > 0) return { steer: Math.sin(match.tick * 0.7 + car.color), throttle: 0.6 };
  const speed = Math.hypot(car.vx, car.vy);
  const aim = pointAt(match.track, car.lapS + LOOK_AHEAD + speed * 0.35);
  const across = brain.lane * aim.halfWidth * 0.6;
  const targetX = aim.x - aim.ty * across;
  const targetY = aim.y + aim.tx * across;
  const turn = wrapAngle(Math.atan2(targetY - car.y, targetX - car.x) - car.angle);

  // Wedged against something: back out with the wheel the other way.
  if (brain.reverseFor > 0) {
    brain.reverseFor -= dt;
    return { steer: -Math.sign(turn), throttle: -1 };
  }
  brain.stuckFor = speed < 25 && match.phase === "racing" && car.stallLeft <= 0 ? brain.stuckFor + dt : 0;
  if (brain.stuckFor > 1.2) {
    brain.stuckFor = 0;
    brain.reverseFor = 0.8;
  }

  if (car.weapon && random() < dt * 2.5) brain.fire = wantsToFire(car, match);
  // Lift off for sharp corners, and brake for the sharpest.
  const throttle = Math.abs(turn) > 1 && speed > 200 ? -0.6 : Math.abs(turn) > 0.6 && speed > 260 ? 0 : 1;
  return { steer: Math.max(-1, Math.min(1, turn * 2.4)), throttle };
}

function wantsToFire(car: Car, match: RaceMatch): boolean {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const others = match.cars.filter((other) => other !== car && other.state === "driving");
  // Is anyone within range in this direction? "side" means alongside rather than ahead or behind.
  const near = (range: number, where: "ahead" | "behind" | "side" | "any") =>
    others.some((other) => {
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const distance = Math.hypot(dx, dy);
      if (distance > range) return false;
      const facing = (dx * fx + dy * fy) / (distance || 1);
      if (where === "ahead") return facing > 0.75;
      if (where === "behind") return facing < -0.6;
      if (where === "side") return Math.abs(facing) < 0.6;
      return true;
    });
  switch (car.weapon) {
    case "missile":
    case "machinegun":
    case "mortar":
      return Boolean(car.lock);
    case "shotgun":
      return near(150, "side");
    case "mines":
    case "drums":
    case "oil":
    case "flamethrower":
      return near(260, "behind");
    case "flashbang":
      return near(400, "any");
    default:
      return false;
  }
}
