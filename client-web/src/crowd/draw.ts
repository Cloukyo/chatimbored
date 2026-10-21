import { CROWD_STATE, type CrowdEntityState, type CrowdVector } from "../../../shared/crowd/protocol.js";

export type Arena = { width: number; height: number; exitX?: number };

export type Figure = {
  id: number;
  x: number;
  y: number;
  facing: number;
  state: CrowdEntityState;
};

export type View2D = { scale: number; offsetX: number; offsetY: number };

const COAT = "#56627a";
const COAT_SHADE = "#46506a";
const SKIN = "#e3bd96";
const HAT = "#2c2f3a";
const LEGS = "#30333d";
const SICK_SKIN = "#a9c48a";
const DEAD = "#7d7f86";

// `top` keeps the arena clear of the HUD bar.
export function fitArena(canvasWidth: number, canvasHeight: number, arena: Arena, top: number): View2D {
  const scale = Math.min(canvasWidth / arena.width, (canvasHeight - top) / arena.height);
  return {
    scale,
    offsetX: (canvasWidth - arena.width * scale) / 2,
    offsetY: top + (canvasHeight - top - arena.height * scale) / 2,
  };
}

export function toWorld(view: View2D, screen: CrowdVector): CrowdVector {
  return { x: (screen.x - view.offsetX) / view.scale, y: (screen.y - view.offsetY) / view.scale };
}

// The plaza is drawn once per arena and reused every frame.
export function paintFloor(arena: Arena): HTMLCanvasElement {
  const floor = document.createElement("canvas");
  floor.width = arena.width;
  floor.height = arena.height;
  const ctx = floor.getContext("2d")!;
  ctx.fillStyle = "#6f7768";
  ctx.fillRect(0, 0, arena.width, arena.height);

  const tile = 40;
  for (let y = 0; y < arena.height; y += tile) {
    for (let x = 0; x < arena.width; x += tile) {
      const shade = hash(x * 7 + y * 13) * 14 - 7;
      ctx.fillStyle = `rgb(${111 + shade} ${119 + shade} ${104 + shade})`;
      ctx.fillRect(x + 1, y + 1, tile - 2, tile - 2);
    }
  }

  ctx.strokeStyle = "rgb(40 44 38 / 55%)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, arena.width - 6, arena.height - 6);

  if (arena.exitX !== undefined) {
    const stripe = 18;
    for (let y = 0; y < arena.height; y += stripe * 2) {
      ctx.fillStyle = "#d9a441";
      ctx.fillRect(arena.exitX, y, 8, stripe);
      ctx.fillStyle = "#2d2a22";
      ctx.fillRect(arena.exitX, y + stripe, 8, stripe);
    }
    ctx.fillStyle = "rgb(217 164 65 / 14%)";
    ctx.fillRect(arena.exitX + 8, 0, arena.width - arena.exitX - 8, arena.height);
    ctx.save();
    ctx.translate(arena.exitX + 50, arena.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = "rgb(236 230 214 / 55%)";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("E X I T", 0, 0);
    ctx.restore();
  }
  return floor;
}

export function drawFigure(ctx: CanvasRenderingContext2D, figure: Figure, time: number, highlight: boolean): void {
  const { x, y, state } = figure;
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = "rgb(0 0 0 / 22%)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  if (highlight) {
    ctx.strokeStyle = "rgb(224 166 74 / 85%)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15, 6.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (state === CROWD_STATE.DEAD) {
    drawFallen(ctx, figure.facing);
    ctx.restore();
    return;
  }

  const moving = state === CROWD_STATE.WALK || state === CROWD_STATE.RUN;
  const stride = state === CROWD_STATE.RUN ? 19 : 11;
  const phase = moving ? time * stride * 0.001 * Math.PI + figure.id : 0;
  const swing = moving ? Math.sin(phase) * (state === CROWD_STATE.RUN ? 5 : 3.5) : 0;
  const bob = moving ? Math.abs(Math.sin(phase)) * 1.5 : 0;
  const sick = state === CROWD_STATE.SICK;
  const wobble = sick ? Math.sin(time * 0.012 + figure.id) * 0.12 : 0;
  const lean = state === CROWD_STATE.RUN ? Math.cos((figure.facing * Math.PI) / 4) * 0.18 : 0;
  ctx.rotate(wobble + lean);

  ctx.fillStyle = LEGS;
  ctx.fillRect(-5 + swing * 0.3, -11, 4, 11 - Math.max(0, swing) * 0.4);
  ctx.fillRect(1 - swing * 0.3, -11, 4, 11 - Math.max(0, -swing) * 0.4);

  ctx.translate(0, -bob);
  ctx.fillStyle = COAT;
  roundRect(ctx, -8, -26, 16, 16, 5);
  ctx.fillStyle = COAT_SHADE;
  ctx.fillRect(-8, -14, 16, 3);

  const dx = Math.cos((figure.facing * Math.PI) / 4);
  const dy = Math.sin((figure.facing * Math.PI) / 4);
  ctx.fillStyle = sick ? SICK_SKIN : SKIN;
  ctx.beginPath();
  ctx.arc(dx * 1.2, -32, 7, 0, Math.PI * 2);
  ctx.fill();

  if (dy < 0.6) {
    // Facing away shows only the back of the head.
    ctx.fillStyle = "#1f2128";
    if (dy > -0.6) {
      ctx.fillRect(dx * 3.6 - 1, -34, 2, 2.4);
      if (Math.abs(dx) < 0.9) ctx.fillRect(dx * 3.6 - 5 + (dx > 0 ? 3 : 1), -34, 2, 2.4);
    }
  }

  ctx.fillStyle = HAT;
  ctx.beginPath();
  ctx.ellipse(dx * 1.2, -37, 9, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(dx * 1.2 - 5.5, -44, 11, 7);

  ctx.restore();
}

export function drawNameTag(ctx: CanvasRenderingContext2D, figure: Figure, text: string, color: string): void {
  ctx.save();
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  const width = ctx.measureText(text).width + 12;
  ctx.fillStyle = "rgb(20 24 22 / 82%)";
  roundRect(ctx, figure.x - width / 2, figure.y - 66, width, 19, 6);
  ctx.fillStyle = color;
  ctx.fillText(text, figure.x, figure.y - 52);
  ctx.restore();
}

export function drawShot(ctx: CanvasRenderingContext2D, from: CrowdVector, to: CrowdVector, age: number): void {
  const life = 1 - age;
  ctx.save();
  ctx.strokeStyle = `rgb(255 226 120 / ${life})`;
  ctx.lineWidth = 3 * life + 1;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y - 18);
  ctx.lineTo(to.x, to.y - 18);
  ctx.stroke();
  ctx.fillStyle = `rgb(255 170 70 / ${life * 0.8})`;
  ctx.beginPath();
  ctx.arc(from.x, from.y - 18, 10 * life + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawPuff(ctx: CanvasRenderingContext2D, at: CrowdVector, age: number): void {
  ctx.save();
  ctx.strokeStyle = `rgb(236 230 214 / ${(1 - age) * 0.8})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(at.x, at.y - 10, 10 + age * 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawFallen(ctx: CanvasRenderingContext2D, facing: number): void {
  const side = Math.cos((facing * Math.PI) / 4) >= 0 ? 1 : -1;
  ctx.scale(side, 1);
  ctx.fillStyle = DEAD;
  roundRect(ctx, -14, -9, 18, 10, 4);
  ctx.beginPath();
  ctx.arc(9, -5, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#2a2c33";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(7, -8);
  ctx.lineTo(11, -4);
  ctx.moveTo(11, -8);
  ctx.lineTo(7, -4);
  ctx.stroke();
  ctx.fillStyle = HAT;
  ctx.fillRect(15, -10, 6, 9);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
