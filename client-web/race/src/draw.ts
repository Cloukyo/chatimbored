import type { RaceCar, RaceEvent, RaceView, WeaponKind } from "../../../shared/race/protocol.js";
import { VERGE_WIDTH, locate, pointAt, trackById, type Track, type TrackTheme } from "../../../shared/race/track.js";
import { sound } from "./sound.js";

export const CAR_COLORS = ["#ff5a4e", "#3fa7ff", "#7bd33f", "#ffcf3f", "#c77dff", "#ff8c2e", "#2fe0c8", "#ff7ac3"];

const CAR_LENGTH = 34;
const CAR_WIDTH = 20;
// Snapshots arrive 20 times a second; drawing a little in the past lets every frame sit between two of them.
const INTERPOLATION_MS = 100;
const FALL_MS = 900;

const WEAPON_ICONS: Record<WeaponKind, string> = { rocket: "🚀", mines: "💣", oil: "🛢️", shockwave: "💥", nitro: "🔥" };
const BONKS = ["BONK!", "CLANG!", "WHAM!", "CRUNCH!", "BOINK!", "THUD!", "DOINK!"];
const BYES = ["SEE YA!", "BYE!", "WRECKED!", "YEET!", "OOPS!", "NOPE!", "LATER!", "TOAST!"];
const FALLS: Record<TrackTheme, string[]> = {
  quarry: ["AAAAH!", "WHEEE!", "OH NO"],
  harbour: ["SPLOOSH!", "GLUG GLUG", "SPLASH!"],
  summit: ["WHEEE!", "AAAAH!", "BYE BYE"],
};

const THEMES: Record<TrackTheme, { ground: string; speck: string; verge: string; road: string; rim: string; deco: string[] }> = {
  quarry: { ground: "#3b2a1c", speck: "#2e2015", verge: "#b98a52", road: "#5d5a58", rim: "#e0b276", deco: ["🪨", "🪨", "🚧", "🛢️"] },
  harbour: { ground: "#1d5f8c", speck: "#2a75a8", verge: "#d8c58e", road: "#4f5560", rim: "#f2f2f2", deco: ["⛵", "🛟", "🐟", "🦆"] },
  summit: { ground: "#2c3b57", speck: "#3a4c6e", verge: "#e9f1f7", road: "#596170", rim: "#ffffff", deco: ["🌲", "🌲", "⛄", "🪨"] },
};

type Snapshot = { at: number; view: RaceView };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; grow: number };
type Popup = { x: number; y: number; text: string; life: number; color: string; size: number; tilt: number };
type Yeet = { car: RaceCar; x: number; y: number; life: number; spin: number; text: string; dirX: number; dirY: number };
type Skid = { x1: number; y1: number; x2: number; y2: number; life: number };
type Eyes = { x: number; y: number; vx: number; vy: number; lastVx: number; lastVy: number };
type Banner = { text: string; sub?: string; life: number; max: number; color: string };

type TrackArt = {
  verge: Path2D;
  road: Path2D;
  rimDrop: Path2D;
  walls: Path2D;
  dashes: Path2D;
  start: { x: number; y: number; angle: number; width: number };
  deco: Array<{ x: number; y: number; icon: string; size: number }>;
};

const arts = new Map<string, TrackArt>();

export class RaceRenderer {
  private readonly context: CanvasRenderingContext2D;
  private snapshots: Snapshot[] = [];
  private seenEvents = new Set<number>();
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private yeets: Yeet[] = [];
  private skids: Skid[] = [];
  private skidEnds = new Map<string, { x: number; y: number }>();
  private eyes = new Map<string, Eyes>();
  private fallingSince = new Map<string, number>();
  private banner?: Banner;
  private shake = 0;
  private lastFrame = 0;
  private lastCountdown = 0;
  private lastPhase = "";

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext("2d")!;
  }

  reset(): void {
    this.snapshots = [];
    this.seenEvents.clear();
    this.particles = [];
    this.popups = [];
    this.yeets = [];
    this.skids = [];
    this.skidEnds.clear();
    this.eyes.clear();
    this.fallingSince.clear();
    this.banner = undefined;
    this.lastPhase = "";
  }

  latest(): RaceView | undefined {
    return this.snapshots[this.snapshots.length - 1]?.view;
  }

  push(view: RaceView): void {
    const last = this.latest();
    if (last && view.tick <= last.tick) return;
    const now = performance.now();
    this.snapshots.push({ at: now, view });
    if (this.snapshots.length > 30) this.snapshots.shift();
    for (const event of view.events) {
      if (this.seenEvents.has(event.id)) continue;
      this.seenEvents.add(event.id);
      this.onEvent(event, view);
    }
    if (this.seenEvents.size > 500) this.seenEvents = new Set([...this.seenEvents].slice(-200));
    for (const car of view.cars) {
      if (car.state === "falling" && !this.fallingSince.has(car.id)) this.fallingSince.set(car.id, now);
      if (car.state !== "falling") this.fallingSince.delete(car.id);
    }
    this.onPhase(view);
  }

  frame(now: number): void {
    const dt = Math.min(0.05, this.lastFrame ? (now - this.lastFrame) / 1000 : 0);
    this.lastFrame = now;
    const view = this.sample(now - INTERPOLATION_MS);
    const ctx = this.context;
    const { width, height } = this.resize();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!view) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      return;
    }
    const track = trackById(view.trackId);
    const theme = THEMES[track.def.theme];
    const art = trackArt(track);
    const scale = Math.min(width / view.view.width, height / view.view.height);
    this.shake = Math.max(0, this.shake - dt * 40);
    const shakeX = (Math.random() - 0.5) * this.shake;
    const shakeY = (Math.random() - 0.5) * this.shake;

    ctx.fillStyle = theme.ground;
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2 + shakeX, height / 2 + shakeY);
    ctx.scale(scale, scale);
    ctx.translate(-view.view.x, -view.view.y);
    const visible = { left: view.view.x - width / scale / 2, top: view.view.y - height / scale / 2, right: view.view.x + width / scale / 2, bottom: view.view.y + height / scale / 2 };

    this.drawGround(theme, visible, now);
    for (const item of art.deco) {
      if (item.x < visible.left - 60 || item.x > visible.right + 60 || item.y < visible.top - 60 || item.y > visible.bottom + 60) continue;
      ctx.font = `${item.size}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const bob = track.def.theme === "harbour" ? Math.sin(now / 600 + item.x) * 3 : 0;
      ctx.fillText(item.icon, item.x, item.y + bob);
    }
    this.drawTrack(art, theme);
    this.drawSkids(dt);

    for (const slick of view.slicks) {
      ctx.fillStyle = "rgba(10, 10, 14, 0.85)";
      blob(ctx, slick.x, slick.y, slick.radius, slick.id);
      ctx.fillStyle = "rgba(120, 90, 200, 0.25)";
      blob(ctx, slick.x - 8, slick.y - 6, slick.radius * 0.5, slick.id + 3);
    }
    for (const crate of view.crates) this.drawCrate(crate.x, crate.y, now);
    for (const mine of view.mines) {
      ctx.fillStyle = "#222";
      circle(ctx, mine.x, mine.y, 9);
      ctx.fillStyle = mine.armed && Math.floor(now / 250) % 2 === 0 ? "#ff3b2f" : "#661410";
      circle(ctx, mine.x, mine.y, 4);
    }

    const cars = [...view.cars].sort((a, b) => a.z - b.z);
    for (const car of cars) if (car.state !== "out") this.drawShadow(car);
    for (const car of cars) this.updateSkids(car);
    for (const car of cars) if (car.state !== "out") this.drawCar(car, now, dt);
    for (const rocket of view.rockets) this.drawRocket(rocket.x, rocket.y, rocket.angle);
    this.drawParticles(dt);
    for (const car of cars) if (car.state === "driving") this.drawTag(car, view);
    this.drawPopups(dt);
    ctx.restore();

    this.drawScreenEdge(view, scale, width, height, now);
    this.drawYeets(dt, width, height, scale);
    this.drawHud(view, width);
    this.drawBanner(dt, width, height);
  }

  // Where a world point lands on the canvas right now, for things that leave the world (a yeeted car).
  private toScreen(x: number, y: number, view: RaceView, scale: number, width: number, height: number): { x: number; y: number } {
    return { x: width / 2 + (x - view.view.x) * scale, y: height / 2 + (y - view.view.y) * scale };
  }

  private onEvent(event: RaceEvent, view: RaceView): void {
    const theme = trackById(view.trackId).def.theme;
    const carOf = (id: string) => view.cars.find((car) => car.id === id);
    switch (event.type) {
      case "boom": {
        this.shake = Math.min(28, this.shake + event.radius / 8);
        for (let index = 0; index < 26; index += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 60 + Math.random() * event.radius * 2.2;
          const fire = index < 14;
          this.particles.push({
            x: event.x,
            y: event.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: fire ? 0.45 : 1.1,
            max: fire ? 0.45 : 1.1,
            size: fire ? 12 + Math.random() * 14 : 10 + Math.random() * 10,
            color: fire ? pick(["#ffef7a", "#ffb23f", "#ff6b2e"]) : "rgba(70,70,70,0.7)",
            grow: fire ? -10 : 26,
          });
        }
        if (Math.random() < 0.5) this.popup(event.x, event.y - 30, pick(["KABOOM!", "BOOM!", "KA-BLAM!"]), "#ffcf3f", 34);
        sound.play("boom", Math.min(1, event.radius / 120));
        break;
      }
      case "crash": {
        this.shake = Math.min(20, this.shake + event.force / 60);
        for (let index = 0; index < 8; index += 1) {
          const angle = Math.random() * Math.PI * 2;
          this.particles.push({ x: event.x, y: event.y, vx: Math.cos(angle) * 220, vy: Math.sin(angle) * 220, life: 0.3, max: 0.3, size: 4, color: "#fff6a8", grow: -8 });
        }
        if (event.force > 180) this.popup(event.x, event.y - 20, pick(BONKS), "#ffffff", 18 + Math.min(16, event.force / 30));
        sound.play("bonk", Math.min(1, event.force / 400));
        break;
      }
      case "pickup": {
        const car = carOf(event.car);
        if (car) this.popup(car.x, car.y - 34, `${WEAPON_ICONS[event.weapon]}`, "#fff", 26);
        sound.play("pickup");
        break;
      }
      case "fire":
        sound.play(event.weapon === "nitro" ? "honk" : "fire");
        break;
      case "splash": {
        this.popup(event.x, event.y - 20, pick(FALLS[theme]), theme === "harbour" ? "#bfe7ff" : "#ffffff", 26);
        if (theme === "harbour") {
          for (let index = 0; index < 14; index += 1) {
            const angle = Math.random() * Math.PI * 2;
            this.particles.push({ x: event.x, y: event.y, vx: Math.cos(angle) * 140, vy: Math.sin(angle) * 140, life: 0.6, max: 0.6, size: 6, color: "#d6f1ff", grow: -4 });
          }
        }
        sound.play(theme === "harbour" ? "splash" : "whistle");
        break;
      }
      case "out": {
        const car = carOf(event.car);
        if (car) {
          // Thrown away from the middle of the screen, as if the screen spat it out.
          const dx = event.x - view.view.x;
          const dy = event.y - view.view.y;
          const length = Math.hypot(dx, dy) || 1;
          this.yeets.push({ car: { ...car, x: event.x, y: event.y }, x: event.x, y: event.y, life: 1.6, spin: (Math.random() < 0.5 ? -1 : 1) * 14, text: pick(BYES), dirX: dx / length, dirY: dy / length });
        }
        this.shake = Math.min(24, this.shake + 10);
        sound.play("whistle");
        break;
      }
      case "round": {
        if (view.matchWinner) break;
        const winner = event.winner ? carOf(event.winner) : undefined;
        this.setBanner(winner ? `${winner.name.toUpperCase()} SURVIVES!` : "NOBODY SURVIVES!", winner ? CAR_COLORS[winner.color] : "#fff", 3, "+1 point");
        sound.play("fanfare");
        break;
      }
      case "go":
        this.setBanner("GO!", "#7bd33f", 0.8);
        sound.play("go");
        break;
    }
  }

  private onPhase(view: RaceView): void {
    if (view.phase === "countdown") {
      const count = Math.ceil(view.phaseMs / 1000);
      if (count !== this.lastCountdown && count > 0 && count <= 3) {
        this.setBanner(String(count), "#ffcf3f", 0.9, this.lastPhase === "countdown" ? undefined : `Round ${view.round}`);
        sound.play("beep");
      }
      this.lastCountdown = count;
    } else {
      this.lastCountdown = 0;
    }
    if (view.phase === "match_over" && this.lastPhase !== "match_over") {
      const winner = view.cars.find((car) => car.id === view.matchWinner);
      this.setBanner(winner ? `${winner.name.toUpperCase()} WINS!` : "GAME OVER", winner ? CAR_COLORS[winner.color] : "#fff", 3.5, "Champion of the pile-up");
      sound.play("fanfare");
    }
    this.lastPhase = view.phase;
  }

  private setBanner(text: string, color: string, seconds: number, sub?: string): void {
    this.banner = { text, sub, life: seconds, max: seconds, color };
  }

  private popup(x: number, y: number, text: string, color: string, size: number): void {
    this.popups.push({ x, y, text, color, size, life: 1, tilt: (Math.random() - 0.5) * 0.5 });
  }

  private sample(renderAt: number): RaceView | undefined {
    const list = this.snapshots;
    if (list.length === 0) return undefined;
    if (list.length === 1 || renderAt <= list[0].at) return list[0].view;
    let index = list.findIndex((snapshot) => snapshot.at > renderAt);
    if (index === -1) return list[list.length - 1].view;
    const before = list[index - 1];
    const after = list[index];
    const t = (renderAt - before.at) / (after.at - before.at || 1);
    return blend(before.view, after.view, t);
  }

  private resize(): { width: number; height: number } {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(this.canvas.clientWidth * ratio);
    const height = Math.round(this.canvas.clientHeight * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return { width, height };
  }

  private drawGround(theme: (typeof THEMES)[TrackTheme], visible: { left: number; top: number; right: number; bottom: number }, now: number): void {
    const ctx = this.context;
    ctx.fillStyle = theme.speck;
    const step = 90;
    for (let x = Math.floor(visible.left / step) * step; x < visible.right; x += step) {
      for (let y = Math.floor(visible.top / step) * step; y < visible.bottom; y += step) {
        const jitter = hash(x, y);
        if (theme === THEMES.harbour) {
          const drift = Math.sin(now / 900 + jitter * 6) * 8;
          ctx.fillRect(x + jitter * 60 + drift, y + hash(y, x) * 60, 22, 3);
        } else {
          circle(ctx, x + jitter * 70, y + hash(y, x) * 70, 3 + jitter * 6);
        }
      }
    }
  }

  private drawTrack(art: TrackArt, theme: (typeof THEMES)[TrackTheme]): void {
    const ctx = this.context;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.save();
    ctx.translate(0, 10);
    ctx.fill(art.verge, "evenodd");
    ctx.restore();
    ctx.fillStyle = theme.verge;
    ctx.fill(art.verge, "evenodd");
    ctx.strokeStyle = theme.rim;
    ctx.lineWidth = 4;
    ctx.stroke(art.rimDrop);
    ctx.fillStyle = theme.road;
    ctx.fill(art.road, "evenodd");
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 4;
    ctx.setLineDash([26, 26]);
    ctx.stroke(art.dashes);
    ctx.setLineDash([]);
    // Tyre walls, red and white.
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 14;
    ctx.stroke(art.walls);
    ctx.strokeStyle = "#e8e8e8";
    ctx.lineWidth = 9;
    ctx.stroke(art.walls);
    ctx.strokeStyle = "#e0312b";
    ctx.setLineDash([14, 14]);
    ctx.stroke(art.walls);
    ctx.setLineDash([]);
    ctx.lineCap = "butt";
    const start = art.start;
    ctx.save();
    ctx.translate(start.x, start.y);
    ctx.rotate(start.angle);
    const cells = 8;
    const size = (start.width * 2) / cells;
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < cells; column += 1) {
        ctx.fillStyle = (row + column) % 2 === 0 ? "#fff" : "#111";
        ctx.fillRect(row * size * 0.6 - size * 0.6, -start.width + column * size, size * 0.6, size);
      }
    }
    ctx.restore();
  }

  // Tyre marks wherever a car slides sideways.
  private updateSkids(car: RaceCar): void {
    const speed = Math.hypot(car.vx, car.vy);
    const forward = speed > 0 ? (car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle)) / speed : 1;
    const sliding = car.state === "driving" && car.z <= 2 && speed > 120 && (forward < 0.93 || car.dizzy > 0);
    if (!sliding) {
      this.skidEnds.delete(car.id);
      return;
    }
    const back = CAR_LENGTH * 0.35;
    const x = car.x - Math.cos(car.angle) * back;
    const y = car.y - Math.sin(car.angle) * back;
    const last = this.skidEnds.get(car.id);
    if (last && Math.hypot(last.x - x, last.y - y) < 60) this.skids.push({ x1: last.x, y1: last.y, x2: x, y2: y, life: 8 });
    this.skidEnds.set(car.id, { x, y });
    if (this.skids.length > 900) this.skids.splice(0, this.skids.length - 900);
  }

  private drawSkids(dt: number): void {
    const ctx = this.context;
    ctx.strokeStyle = "rgba(20,20,20,0.35)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (const skid of this.skids) {
      skid.life -= dt;
      ctx.moveTo(skid.x1, skid.y1);
      ctx.lineTo(skid.x2, skid.y2);
    }
    ctx.stroke();
    this.skids = this.skids.filter((skid) => skid.life > 0);
  }

  private drawShadow(car: RaceCar): void {
    const ctx = this.context;
    const shrink = this.fallScale(car);
    if (shrink < 1) return;
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.12, 0.35 - car.z / 400)})`;
    ctx.save();
    ctx.translate(car.x + 4, car.y + 6);
    ctx.rotate(car.angle);
    const size = 1 / (1 + car.z / 160);
    ctx.scale(size, size);
    roundRect(ctx, -CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH, 7);
    ctx.fill();
    ctx.restore();
  }

  private fallScale(car: RaceCar): number {
    const since = this.fallingSince.get(car.id);
    if (car.state !== "falling" || since === undefined) return 1;
    return Math.max(0, 1 - (performance.now() - since) / FALL_MS);
  }

  private drawCar(car: RaceCar, now: number, dt: number): void {
    const ctx = this.context;
    const color = CAR_COLORS[car.color % CAR_COLORS.length];
    const fall = this.fallScale(car);
    const lift = 1 + car.z / 110;
    ctx.save();
    ctx.translate(car.x, car.y - car.z * 0.7);
    if (car.state === "falling") ctx.rotate((1 - fall) * 9);
    ctx.rotate(car.angle);
    ctx.scale(lift * fall, lift * fall);
    if (car.ghost) ctx.globalAlpha = Math.floor(now / 90) % 2 === 0 ? 0.35 : 0.8;

    if (car.boosting) {
      const flicker = 10 + Math.random() * 14;
      ctx.fillStyle = "#ffb23f";
      ctx.beginPath();
      ctx.moveTo(-CAR_LENGTH / 2, -6);
      ctx.lineTo(-CAR_LENGTH / 2 - flicker, 0);
      ctx.lineTo(-CAR_LENGTH / 2, 6);
      ctx.fill();
    }

    // Flipping over: squash across the car, and show the underside once it's past halfway.
    const flip = Math.cos(car.roll);
    ctx.scale(1, Math.abs(flip) < 0.15 ? 0.15 * Math.sign(flip || 1) : flip);
    if (flip < 0) {
      ctx.fillStyle = "#2a2a2a";
      roundRect(ctx, -CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH, 6);
      ctx.fill();
      ctx.fillStyle = "#111";
      for (const [x, y] of WHEELS) {
        roundRect(ctx, x - 5, y - 4, 10, 8, 2);
        ctx.fill();
      }
      ctx.fillStyle = "#666";
      ctx.fillRect(-CAR_LENGTH / 2 + 4, -2, CAR_LENGTH - 8, 4);
      ctx.restore();
      return;
    }

    ctx.fillStyle = "#111";
    for (const [x, y] of WHEELS) {
      roundRect(ctx, x - 5, y - 3, 10, 6, 2);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    roundRect(ctx, -CAR_LENGTH / 2, -CAR_WIDTH / 2 + 1, CAR_LENGTH, CAR_WIDTH - 2, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    roundRect(ctx, -CAR_LENGTH / 2 + 4, -CAR_WIDTH / 2 + 3, CAR_LENGTH - 14, 4, 2);
    ctx.fill();
    // Big googly eyes on the windscreen. They wobble with every bump.
    const eyes = this.wobble(car, dt);
    for (const side of [-1, 1]) {
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.2;
      circle(ctx, 7, side * 4.6, 4.6);
      ctx.stroke();
      ctx.fillStyle = "#000";
      circle(ctx, 7 + eyes.x, side * 4.6 + eyes.y, 2.1);
    }
    ctx.restore();

    if (car.dizzy > 0 && car.state === "driving") {
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let index = 0; index < 3; index += 1) {
        const angle = now / 180 + (index * Math.PI * 2) / 3;
        ctx.fillText("⭐", car.x + Math.cos(angle) * 16, car.y - car.z * 0.7 - 22 + Math.sin(angle) * 5);
      }
    }
  }

  // The pupils lag behind the car's movement on a spring, so a hit makes them roll around.
  private wobble(car: RaceCar, dt: number): { x: number; y: number } {
    let eyes = this.eyes.get(car.id);
    if (!eyes) {
      eyes = { x: 0, y: 0, vx: 0, vy: 0, lastVx: car.vx, lastVy: car.vy };
      this.eyes.set(car.id, eyes);
    }
    if (dt <= 0) return eyes;
    const cos = Math.cos(-car.angle);
    const sin = Math.sin(-car.angle);
    const ax = (car.vx - eyes.lastVx) / dt;
    const ay = (car.vy - eyes.lastVy) / dt;
    eyes.lastVx = car.vx;
    eyes.lastVy = car.vy;
    const localX = ax * cos - ay * sin;
    const localY = ax * sin + ay * cos;
    eyes.vx += (-localX * 0.004 - eyes.x * 60 - eyes.vx * 4) * dt;
    eyes.vy += (-localY * 0.004 - eyes.y * 60 - eyes.vy * 4 + (car.dizzy > 0 ? Math.sin(performance.now() / 60) * 40 : 0)) * dt;
    eyes.x += eyes.vx * dt;
    eyes.y += eyes.vy * dt;
    const length = Math.hypot(eyes.x, eyes.y);
    if (length > 2.4) {
      eyes.x = (eyes.x / length) * 2.4;
      eyes.y = (eyes.y / length) * 2.4;
    }
    return eyes;
  }

  private drawTag(car: RaceCar, view: RaceView): void {
    const ctx = this.context;
    const y = car.y - car.z * 0.7 - 26;
    const nearEdge =
      Math.abs(car.x - view.view.x) > view.view.width / 2 - 70 || Math.abs(car.y - view.view.y) > view.view.height / 2 - 70;
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const label = car.weapon ? `${WEAPON_ICONS[car.weapon]}${car.ammo > 1 ? `×${car.ammo}` : ""} ${car.name}` : car.name;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000";
    ctx.strokeText(label, car.x, y);
    ctx.fillStyle = nearEdge && Math.floor(performance.now() / 150) % 2 === 0 ? "#ff4a3a" : CAR_COLORS[car.color % CAR_COLORS.length];
    ctx.fillText(label, car.x, y);
  }

  private drawCrate(x: number, y: number, now: number): void {
    const ctx = this.context;
    const bob = Math.sin(now / 250 + x) * 3;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(Math.sin(now / 500 + y) * 0.2);
    ctx.fillStyle = "#c8873e";
    ctx.strokeStyle = "#5a3510";
    ctx.lineWidth = 2.5;
    ctx.fillRect(-13, -13, 26, 26);
    ctx.strokeRect(-13, -13, 26, 26);
    ctx.fillStyle = "#fff4c2";
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", 0, 1);
    ctx.restore();
  }

  private drawRocket(x: number, y: number, angle: number): void {
    const ctx = this.context;
    this.particles.push({ x: x - Math.cos(angle) * 12, y: y - Math.sin(angle) * 12, vx: 0, vy: 0, life: 0.5, max: 0.5, size: 6, color: "rgba(220,220,220,0.6)", grow: 16 });
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = "#ddd";
    roundRect(ctx, -10, -4, 20, 8, 4);
    ctx.fill();
    ctx.fillStyle = "#e0312b";
    ctx.beginPath();
    ctx.moveTo(10, -4);
    ctx.lineTo(16, 0);
    ctx.lineTo(10, 4);
    ctx.fill();
    ctx.fillStyle = "#ffb23f";
    ctx.beginPath();
    ctx.moveTo(-10, -3);
    ctx.lineTo(-18 - Math.random() * 6, 0);
    ctx.lineTo(-10, 3);
    ctx.fill();
    ctx.restore();
  }

  private drawParticles(dt: number): void {
    const ctx = this.context;
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.exp(-3 * dt);
      particle.vy *= Math.exp(-3 * dt);
      particle.size = Math.max(0.5, particle.size + particle.grow * dt);
      ctx.globalAlpha = Math.max(0, particle.life / particle.max);
      ctx.fillStyle = particle.color;
      circle(ctx, particle.x, particle.y, particle.size);
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((particle) => particle.life > 0);
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  private drawPopups(dt: number): void {
    const ctx = this.context;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const popup of this.popups) {
      popup.life -= dt * 0.9;
      popup.y -= 30 * dt;
      const pop = popup.life > 0.85 ? 1 + (popup.life - 0.85) * 4 : 1;
      ctx.save();
      ctx.translate(popup.x, popup.y);
      ctx.rotate(popup.tilt);
      ctx.scale(pop, pop);
      ctx.globalAlpha = Math.min(1, popup.life * 2);
      ctx.font = `900 ${popup.size}px "Arial Black", Impact, system-ui, sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#000";
      ctx.strokeText(popup.text, 0, 0);
      ctx.fillStyle = popup.color;
      ctx.fillText(popup.text, 0, 0);
      ctx.restore();
    }
    this.popups = this.popups.filter((popup) => popup.life > 0);
  }

  // Outside the shared screen is the danger zone: hatched, so everyone can see where the edge is.
  private drawScreenEdge(view: RaceView, scale: number, width: number, height: number, now: number): void {
    const ctx = this.context;
    const left = width / 2 - (view.view.width / 2) * scale;
    const top = height / 2 - (view.view.height / 2) * scale;
    const right = width - left;
    const bottom = height - top;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    if (left > 1) {
      ctx.fillRect(0, 0, left, height);
      ctx.fillRect(right, 0, width - right, height);
    }
    if (top > 1) {
      ctx.fillRect(left, 0, right - left, top);
      ctx.fillRect(left, bottom, right - left, height - bottom);
    }
    if (view.shrinking) {
      ctx.strokeStyle = Math.floor(now / 300) % 2 === 0 ? "rgba(255,74,58,0.9)" : "rgba(255,207,63,0.9)";
      ctx.lineWidth = 6;
      ctx.strokeRect(left + 3, top + 3, right - left - 6, bottom - top - 6);
    }
  }

  private drawYeets(dt: number, width: number, height: number, scale: number): void {
    const ctx = this.context;
    const latest = this.latest();
    for (const yeet of this.yeets) {
      yeet.life -= dt;
      const t = 1 - yeet.life / 1.6;
      const start = latest ? this.toScreen(yeet.x, yeet.y, latest, scale, width, height) : { x: width / 2, y: height / 2 };
      // Clamp the start to the screen so the car visibly bursts out of the edge it fell off.
      const x = Math.max(40, Math.min(width - 40, start.x)) - yeet.dirX * t * 120 + (width / 2 - start.x) * t * 0.6;
      const y = Math.max(40, Math.min(height - 40, start.y)) - 300 * t + 500 * t * t - yeet.dirY * t * 80;
      const size = scale * (1.5 + t * 6);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(yeet.spin * t);
      ctx.scale(size, size);
      ctx.globalAlpha = Math.min(1, yeet.life * 2);
      ctx.fillStyle = CAR_COLORS[yeet.car.color % CAR_COLORS.length];
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      roundRect(ctx, -CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      circle(ctx, 7, -4.6, 4.6);
      circle(ctx, 7, 4.6, 4.6);
      ctx.fillStyle = "#000";
      // Eyes crossed, naturally.
      circle(ctx, 8, -3, 2);
      circle(ctx, 8, 3, 2);
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = Math.min(1, yeet.life * 2);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `900 ${Math.round(28 + t * 20)}px "Arial Black", Impact, system-ui, sans-serif`;
      ctx.lineWidth = 6;
      ctx.strokeStyle = "#000";
      const label = `${yeet.text} ${yeet.car.name.toUpperCase()}`;
      const labelX = Math.max(180, Math.min(width - 180, x));
      const labelY = Math.max(60, Math.min(height - 60, y - 60));
      ctx.strokeText(label, labelX, labelY);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, labelX, labelY);
      ctx.restore();
    }
    this.yeets = this.yeets.filter((yeet) => yeet.life > 0);
  }

  private drawHud(view: RaceView, width: number): void {
    const ctx = this.context;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const chip = Math.min(190 * ratio, (width - 20 * ratio) / view.cars.length);
    const top = 10 * ratio;
    const startX = (width - chip * view.cars.length) / 2;
    view.cars.forEach((car, index) => {
      const x = startX + index * chip;
      ctx.globalAlpha = car.state === "out" ? 0.45 : 1;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      roundRect(ctx, x + 3 * ratio, top, chip - 6 * ratio, 40 * ratio, 8 * ratio);
      ctx.fill();
      ctx.fillStyle = CAR_COLORS[car.color % CAR_COLORS.length];
      roundRect(ctx, x + 9 * ratio, top + 8 * ratio, 12 * ratio, 12 * ratio, 3 * ratio);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${12 * ratio}px system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(fit(ctx, car.state === "out" ? `💀 ${car.name}` : car.name, chip - 34 * ratio), x + 26 * ratio, top + 14 * ratio);
      for (let point = 0; point < view.target; point += 1) {
        ctx.fillStyle = point < car.points ? CAR_COLORS[car.color % CAR_COLORS.length] : "rgba(255,255,255,0.18)";
        circle(ctx, x + 15 * ratio + point * 13 * ratio, top + 30 * ratio, 4.5 * ratio);
      }
    });
    ctx.globalAlpha = 1;
  }

  private drawBanner(dt: number, width: number, height: number): void {
    const banner = this.banner;
    if (!banner) return;
    banner.life -= dt;
    if (banner.life <= 0) {
      this.banner = undefined;
      return;
    }
    const ctx = this.context;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const age = banner.max - banner.life;
    const pop = age < 0.15 ? 0.4 + (age / 0.15) * 0.8 : age < 0.3 ? 1.2 - ((age - 0.15) / 0.15) * 0.2 : 1;
    ctx.save();
    ctx.translate(width / 2, height * 0.3);
    ctx.rotate(-0.05);
    ctx.scale(pop, pop);
    ctx.globalAlpha = Math.min(1, banner.life * 3);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = Math.min(84 * ratio, (width * 1.6) / Math.max(4, banner.text.length));
    ctx.font = `900 ${size}px "Arial Black", Impact, system-ui, sans-serif`;
    ctx.lineWidth = 10 * ratio;
    ctx.strokeStyle = "#000";
    ctx.strokeText(banner.text, 0, 0);
    ctx.fillStyle = banner.color;
    ctx.fillText(banner.text, 0, 0);
    if (banner.sub) {
      ctx.font = `800 ${22 * ratio}px system-ui, sans-serif`;
      ctx.lineWidth = 5 * ratio;
      ctx.strokeText(banner.sub, 0, size * 0.75);
      ctx.fillStyle = "#fff";
      ctx.fillText(banner.sub, 0, size * 0.75);
    }
    ctx.restore();
  }
}

const WHEELS: Array<[number, number]> = [
  [-10, -10],
  [10, -10],
  [-10, 10],
  [10, 10],
];

function blend(a: RaceView, b: RaceView, t: number): RaceView {
  const lerp = (from: number, to: number) => from + (to - from) * t;
  const carsBefore = new Map(a.cars.map((car) => [car.id, car]));
  const rocketsBefore = new Map(a.rockets.map((rocket) => [rocket.id, rocket]));
  return {
    ...b,
    view: { x: lerp(a.view.x, b.view.x), y: lerp(a.view.y, b.view.y), width: lerp(a.view.width, b.view.width), height: lerp(a.view.height, b.view.height) },
    cars: b.cars.map((car) => {
      const from = carsBefore.get(car.id);
      // A jump of more than a few car lengths is a respawn or a new grid: don't slide across the map.
      if (!from || from.state !== car.state || Math.hypot(from.x - car.x, from.y - car.y) > 120) return car;
      return { ...car, x: lerp(from.x, car.x), y: lerp(from.y, car.y), z: lerp(from.z, car.z), angle: from.angle + wrap(car.angle - from.angle) * t, roll: lerp(from.roll, car.roll) };
    }),
    rockets: b.rockets.map((rocket) => {
      const from = rocketsBefore.get(rocket.id);
      return from ? { ...rocket, x: lerp(from.x, rocket.x), y: lerp(from.y, rocket.y) } : rocket;
    }),
  };
}

function trackArt(track: Track): TrackArt {
  const cached = arts.get(track.def.id);
  if (cached) return cached;
  const samples = track.samples;
  const ring = (extra: number, side: number, path: Path2D) => {
    samples.forEach((sample, index) => {
      const offset = (sample.halfWidth + extra) * side;
      const x = sample.x - sample.ty * offset;
      const y = sample.y + sample.tx * offset;
      if (index === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.closePath();
  };
  const verge = new Path2D();
  ring(VERGE_WIDTH, 1, verge);
  ring(VERGE_WIDTH, -1, verge);
  const road = new Path2D();
  ring(0, 1, road);
  ring(0, -1, road);
  const dashes = new Path2D();
  samples.forEach((sample, index) => (index === 0 ? dashes.moveTo(sample.x, sample.y) : dashes.lineTo(sample.x, sample.y)));
  dashes.closePath();
  const walls = new Path2D();
  const rimDrop = new Path2D();
  for (const side of [-1, 1]) {
    let drawingWall = false;
    let drawingRim = false;
    samples.forEach((sample, index) => {
      const offset = (sample.halfWidth + VERGE_WIDTH) * side;
      const x = sample.x - sample.ty * offset;
      const y = sample.y + sample.tx * offset;
      const wall = sample.edge === "wall";
      if (wall) {
        if (drawingWall) walls.lineTo(x, y);
        else walls.moveTo(x, y);
      } else if (drawingRim) rimDrop.lineTo(x, y);
      else rimDrop.moveTo(x, y);
      drawingWall = wall;
      drawingRim = !wall;
      if (index === samples.length - 1) {
        const first = samples[0];
        const firstX = first.x - first.ty * (first.halfWidth + VERGE_WIDTH) * side;
        const firstY = first.y + first.tx * (first.halfWidth + VERGE_WIDTH) * side;
        if (wall && first.edge === "wall") walls.lineTo(firstX, firstY);
        if (!wall && first.edge !== "wall") rimDrop.lineTo(firstX, firstY);
      }
    });
  }
  const startSpot = pointAt(track, 0);
  const deco: TrackArt["deco"] = [];
  const icons = THEMES[track.def.theme].deco;
  const xs = samples.map((sample) => sample.x);
  const ys = samples.map((sample) => sample.y);
  const minX = Math.min(...xs) - 500;
  const maxX = Math.max(...xs) + 500;
  const minY = Math.min(...ys) - 500;
  const maxY = Math.max(...ys) + 500;
  for (let x = minX; x < maxX; x += 170) {
    for (let y = minY; y < maxY; y += 170) {
      const px = x + hash(x, y) * 120;
      const py = y + hash(y, x) * 120;
      if (hash(px, py) > 0.45) continue;
      const spot = locate(track, px, py);
      if (Math.abs(spot.offset) < spot.sample.halfWidth + VERGE_WIDTH + 40 || Math.hypot(spot.sample.x - px, spot.sample.y - py) < spot.sample.halfWidth + VERGE_WIDTH + 40) continue;
      deco.push({ x: px, y: py, icon: icons[Math.floor(hash(px + 1, py) * icons.length)], size: 26 + hash(py, px + 2) * 22 });
    }
  }
  const art: TrackArt = {
    verge,
    road,
    rimDrop,
    walls,
    dashes,
    start: { x: startSpot.x, y: startSpot.y, angle: Math.atan2(startSpot.ty, startSpot.tx), width: startSpot.halfWidth },
    deco,
  };
  arts.set(track.def.id, art);
  return art;
}

// A small picture of a track for the lobby.
export function drawTrackPreview(canvas: HTMLCanvasElement, trackId: string): void {
  const track = trackById(trackId);
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.clientWidth * ratio || 260;
  canvas.height = canvas.clientHeight * ratio || 140;
  const ctx = canvas.getContext("2d")!;
  const xs = track.samples.map((sample) => sample.x);
  const ys = track.samples.map((sample) => sample.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const scale = Math.min((canvas.width - 20) / spanX, (canvas.height - 20) / spanY);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate((canvas.width - spanX * scale) / 2, (canvas.height - spanY * scale) / 2);
  ctx.scale(scale, scale);
  ctx.translate(-minX, -minY);
  ctx.lineJoin = "round";
  ctx.strokeStyle = THEMES[track.def.theme].verge;
  ctx.lineWidth = 260;
  ctx.beginPath();
  track.samples.forEach((sample, index) => (index === 0 ? ctx.moveTo(sample.x, sample.y) : ctx.lineTo(sample.x, sample.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = THEMES[track.def.theme].road;
  ctx.lineWidth = 170;
  ctx.stroke();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

// A lumpy puddle that keeps its shape from frame to frame.
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, seed: number): void {
  ctx.beginPath();
  for (let index = 0; index <= 10; index += 1) {
    const angle = (index / 10) * Math.PI * 2;
    const r = radius * (0.75 + hash(seed, index) * 0.35);
    if (index === 0) ctx.moveTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
    else ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  ctx.fill();
}

function hash(a: number, b: number): number {
  const value = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function fit(ctx: CanvasRenderingContext2D, text: string, room: number): string {
  if (ctx.measureText(text).width <= room) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > room) cut = cut.slice(0, -1);
  return `${cut}…`;
}
