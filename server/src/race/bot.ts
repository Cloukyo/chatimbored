import { pointAt } from "../../../shared/race/track.js";
import type { Random } from "../crowd/random.js";
import { CAR_RADIUS, wrapAngle, type Car, type RaceMatch } from "./RaceMatch.js";

// Drives the bots that fill an empty grid, and anyone whose connection has dropped.
export type BotBrain = {
  // Where across the road this bot likes to be, -1 to 1.
  lane: number;
  laneTimer: number;
  stuckFor: number;
  reverseFor: number;
  // Set when the bot wants to use its weapon this tick.
  fire: boolean;
};

const LOOK_AHEAD = 200;

export function botInput(car: Car, match: RaceMatch, dt: number, random: Random): { steer: number; throttle: number } {
  const brain = car.brain;
  brain.laneTimer -= dt;
  if (brain.laneTimer <= 0) {
    brain.lane = (random() - 0.5) * 1.1;
    brain.laneTimer = 2 + random() * 3;
  }
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
  brain.stuckFor = speed < 25 && match.phase === "racing" ? brain.stuckFor + dt : 0;
  if (brain.stuckFor > 1.2) {
    brain.stuckFor = 0;
    brain.reverseFor = 0.8;
  }

  if (car.weapon && random() < dt * 2.5) brain.fire = wantsToFire(car, match, Math.abs(turn));
  // Lift off for sharp corners, and brake for the sharpest.
  const throttle = Math.abs(turn) > 1 && speed > 200 ? -0.6 : Math.abs(turn) > 0.6 && speed > 260 ? 0 : 1;
  return { steer: Math.max(-1, Math.min(1, turn * 2.4)), throttle };
}

function wantsToFire(car: Car, match: RaceMatch, turn: number): boolean {
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  const others = match.cars.filter((other) => other !== car && other.state === "driving");
  const near = (range: number, ahead: boolean | undefined) =>
    others.some((other) => {
      const dx = other.x - car.x;
      const dy = other.y - car.y;
      const distance = Math.hypot(dx, dy);
      if (distance > range) return false;
      if (ahead === undefined) return true;
      const facing = (dx * fx + dy * fy) / (distance || 1);
      return ahead ? facing > 0.75 : facing < -0.5;
    });
  switch (car.weapon) {
    case "rocket":
      return near(650, true);
    case "mines":
    case "oil":
      return near(320, false);
    case "shockwave":
      return near(CAR_RADIUS * 9, undefined);
    case "nitro":
      return turn < 0.25;
    default:
      return false;
  }
}
