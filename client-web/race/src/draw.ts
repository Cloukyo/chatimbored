import type { RaceCar, RaceEvent, RaceView, WeaponKind } from "../../../shared/race/protocol.js";
import { trackById, type TrackTheme } from "../../../shared/race/track.js";
import { sound } from "./sound.js";
import { CAR_COLORS, World3D, type Particle, type ScreenPoint } from "./world3d.js";

export { CAR_COLORS };

const CAR_LENGTH = 34;
// Snapshots arrive 20 times a second; drawing a little in the past lets every frame sit between two of them.
const INTERPOLATION_MS = 100;
const FALL_MS = 900;

export const WEAPON_ICONS: Record<WeaponKind, string> = {
  missile: "🚀",
  machinegun: "🔫",
  shotgun: "💥",
  mortar: "🎯",
  mines: "💣",
  drums: "🛢️",
  oil: "⚫",
  flamethrower: "🔥",
  flashbang: "✨",
};
const HOT = ["HOT HOT HOT!", "OW OW OW!", "TOASTY!", "FIRE!!"];
const BONKS = ["BONK!", "CLANG!", "WHAM!", "CRUNCH!", "BOINK!", "THUD!", "DOINK!"];
const BYES = ["SEE YA!", "BYE!", "WRECKED!", "YEET!", "OOPS!", "NOPE!", "LATER!", "TOAST!"];
const FALLS: Record<TrackTheme, string[]> = {
  quarry: ["AAAAH!", "WHEEE!", "OH NO"],
  harbour: ["SPLOOSH!", "GLUG GLUG", "SPLASH!"],
  summit: ["WHEEE!", "AAAAH!", "BYE BYE"],
};
// Road and verge colours for the lobby's little track pictures.
const PREVIEW: Record<TrackTheme, { verge: string; road: string }> = {
  quarry: { verge: "#b98a52", road: "#5d5a58" },
  harbour: { verge: "#d8c58e", road: "#4f5560" },
  summit: { verge: "#e9f1f7", road: "#596170" },
};

type Snapshot = { at: number; view: RaceView };
// Comic text that pops up in the world and floats upwards.
type Popup = { x: number; y: number; z: number; text: string; life: number; color: string; size: number; tilt: number };
type Eyes = { x: number; y: number; vx: number; vy: number; lastVx: number; lastVy: number };
type Banner = { text: string; sub?: string; life: number; max: number; color: string };

// Runs the race screen: keeps the snapshots, turns events into effects and sounds, has the 3D world draw the scene,
// and draws everything flat on top: names, comic text, edge warnings, the scores and the big banners.
export class RaceRenderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly world?: World3D;
  private snapshots: Snapshot[] = [];
  private seenEvents = new Set<number>();
  private popups: Popup[] = [];
  private skidEnds = new Map<string, Array<{ x: number; y: number }>>();
  private eyes = new Map<string, Eyes>();
  private fallingSince = new Map<string, number>();
  private banner?: Banner;
  private shake = 0;
  // Seconds of flash-bang whiteout left. On a shared screen it blinds everyone, the thrower too.
  private flash = 0;
  private lastFrame = 0;
  private lastCountdown = 0;
  private lastPhase = "";
  private width = 0;
  private height = 0;
  private ratio = 1;
  // Screen pixels per world unit around the middle of the shared screen, for sizing text in the world.
  private scale = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    worldCanvas: HTMLCanvasElement,
  ) {
    this.context = canvas.getContext("2d")!;
    this.world = World3D.create(worldCanvas);
  }

  reset(): void {
    this.snapshots = [];
    this.seenEvents.clear();
    this.popups = [];
    this.skidEnds.clear();
    this.eyes.clear();
    this.fallingSince.clear();
    this.banner = undefined;
    this.flash = 0;
    this.lastPhase = "";
    this.world?.reset();
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
    this.resize();
    const { width, height } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!this.world) {
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${16 * this.ratio}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("This browser can't draw 3D (WebGL is off or unsupported).", width / 2, height / 2);
      return;
    }
    if (!view) return;
    this.shake = Math.max(0, this.shake - dt * 40);
    for (const car of view.cars) {
      this.updateSkids(car);
      if (car.state === "driving") this.carEffects(car);
    }
    this.world.render(
      view,
      now,
      dt,
      { x: (Math.random() - 0.5) * this.shake, y: (Math.random() - 0.5) * this.shake },
      (car) => this.fallScale(car),
      (car) => this.wobble(car, dt),
    );
    const middle = this.toScreen(view.view.x, view.view.y, 0);
    const across = this.toScreen(view.view.x + 100, view.view.y, 0);
    this.scale = Math.max(0.2, Math.hypot(across.x - middle.x, across.y - middle.y) / 100);

    this.drawScreenEdge(view, now);
    for (const car of view.cars) if (car.state === "driving") this.drawTag(car, view, now);
    for (const car of view.cars) if (car.strike) this.drawStrikeLabel(car);
    this.drawPopups(dt);
    this.drawWarnings(view, now);
    this.drawCaptions();
    this.drawHud(view, width);
    this.drawBanner(dt, width, height);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt);
      ctx.fillStyle = `rgba(255,255,250,${Math.min(1, this.flash / 0.9)})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  // Where a world point lands on the overlay, in its pixels.
  private toScreen(x: number, y: number, z: number): ScreenPoint {
    const spot = this.world!.project(x, y, z);
    return { x: spot.x * this.width, y: spot.y * this.height, behind: spot.behind };
  }

  private spark(particle: Omit<Particle, "z" | "vz"> & { z?: number; vz?: number }): void {
    this.world?.addParticle({ z: 4, vz: 0, ...particle });
  }

  private onEvent(event: RaceEvent, view: RaceView): void {
    const theme = trackById(view.trackId).def.theme;
    const carOf = (id: string) => view.cars.find((car) => car.id === id);
    switch (event.type) {
      case "boom": {
        this.shake = Math.min(28, this.shake + event.radius / 8);
        for (let index = 0; index < 30; index += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 60 + Math.random() * event.radius * 2.2;
          const fire = index < 16;
          this.spark({
            x: event.x,
            y: event.y,
            z: 6,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            vz: fire ? 80 + Math.random() * 260 : 40 + Math.random() * 90,
            life: fire ? 0.5 : 1.2,
            max: fire ? 0.5 : 1.2,
            size: fire ? 10 + Math.random() * 12 : 9 + Math.random() * 9,
            color: fire ? pick(["#ffef7a", "#ffb23f", "#ff6b2e"]) : pick(["#5a5a5a", "#6e6e6e", "#474747"]),
            grow: fire ? -8 : 22,
          });
        }
        if (Math.random() < 0.5) this.popup(event.x, event.y, 50, pick(["KABOOM!", "BOOM!", "KA-BLAM!"]), "#ffcf3f", 34);
        sound.play("boom", Math.min(1, event.radius / 120));
        break;
      }
      case "crash": {
        this.shake = Math.min(20, this.shake + event.force / 60);
        for (let index = 0; index < 8; index += 1) {
          const angle = Math.random() * Math.PI * 2;
          this.spark({ x: event.x, y: event.y, z: 8, vx: Math.cos(angle) * 220, vy: Math.sin(angle) * 220, vz: 60 + Math.random() * 80, life: 0.3, max: 0.3, size: 2.5, color: "#fff6a8", grow: -6 });
        }
        if (event.force > 180) this.popup(event.x, event.y, 34, pick(BONKS), "#ffffff", 18 + Math.min(16, event.force / 30));
        sound.play("bonk", Math.min(1, event.force / 400));
        break;
      }
      case "pickup": {
        const car = carOf(event.car);
        if (car) this.popup(car.x, car.y, 50, WEAPON_ICONS[event.weapon], "#fff", 26);
        sound.play("pickup");
        break;
      }
      case "fire": {
        const car = carOf(event.car);
        if (car) this.muzzle(car, event.weapon);
        sound.play(event.weapon === "machinegun" ? "gun" : event.weapon === "shotgun" ? "shotgun" : event.weapon === "flashbang" ? "beep" : "fire");
        break;
      }
      case "hit":
        for (let index = 0; index < 6; index += 1) {
          const angle = Math.random() * Math.PI * 2;
          this.spark({ x: event.x, y: event.y, z: 8, vx: Math.cos(angle) * 160, vy: Math.sin(angle) * 160, vz: 50, life: 0.25, max: 0.25, size: 2.2, color: "#ffe36b", grow: -5 });
        }
        sound.play("bonk", 0.4);
        break;
      case "burn": {
        const car = carOf(event.car);
        if (car) this.popup(car.x, car.y, 44, pick(HOT), "#ff8c2e", 22);
        sound.play("fire");
        break;
      }
      case "flash":
        this.flash = 1.6;
        sound.play("flash");
        break;
      case "turbo": {
        const car = carOf(event.car);
        if (car) this.popup(car.x, car.y, 44, "TURBO!", "#7bd33f", 22);
        sound.play("honk");
        break;
      }
      case "stall": {
        const car = carOf(event.car);
        if (car) this.popup(car.x, car.y, 44, pick(["STALLED!", "PUTT PUTT…", "CLUNK"]), "#bbbbbb", 20);
        sound.play("stall");
        break;
      }
      case "splash": {
        this.popup(event.x, event.y, 30, pick(FALLS[theme]), theme === "harbour" ? "#bfe7ff" : "#ffffff", 26);
        if (theme === "harbour") {
          for (let index = 0; index < 16; index += 1) {
            const angle = Math.random() * Math.PI * 2;
            this.spark({ x: event.x, y: event.y, z: 0, vx: Math.cos(angle) * 90, vy: Math.sin(angle) * 90, vz: 150 + Math.random() * 120, life: 0.7, max: 0.7, size: 5, color: "#d6f1ff", grow: -3 });
          }
        }
        sound.play(theme === "harbour" ? "splash" : "whistle");
        break;
      }
      case "out": {
        const car = carOf(event.car);
        if (car) this.world?.yeet({ ...car, x: event.x, y: event.y }, `${pick(BYES)} ${car.name.toUpperCase()}`);
        this.shake = Math.min(24, this.shake + 10);
        sound.play("whistle");
        break;
      }
      case "round": {
        if (view.matchWinner) break;
        const winner = event.winner ? carOf(event.winner) : undefined;
        const second = event.second ? carOf(event.second) : undefined;
        const first = event.first ? carOf(event.first) : undefined;
        const tally = [winner && `+2 ${winner.name}`, second && `+1 ${second.name}`, first && `−1 ${first.name}`].filter(Boolean).join("   ");
        this.setBanner(winner ? `${winner.name.toUpperCase()} SURVIVES!` : "NOBODY SURVIVES!", winner ? CAR_COLORS[winner.color] : "#fff", 3, tally || undefined);
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

  private popup(x: number, y: number, z: number, text: string, color: string, size: number): void {
    this.popups.push({ x, y, z, text, color, size, life: 1, tilt: (Math.random() - 0.5) * 0.5 });
  }

  private sample(renderAt: number): RaceView | undefined {
    const list = this.snapshots;
    if (list.length === 0) return undefined;
    if (list.length === 1 || renderAt <= list[0].at) return list[0].view;
    const index = list.findIndex((snapshot) => snapshot.at > renderAt);
    if (index === -1) return list[list.length - 1].view;
    const before = list[index - 1];
    const after = list[index];
    const t = (renderAt - before.at) / (after.at - before.at || 1);
    return blend(before.view, after.view, t);
  }

  private resize(): void {
    this.ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(this.canvas.clientWidth * this.ratio);
    const height = Math.round(this.canvas.clientHeight * this.ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.width = width;
    this.height = height;
  }

  // Tyre marks from both rear wheels wherever a car slides sideways.
  private updateSkids(car: RaceCar): void {
    const speed = Math.hypot(car.vx, car.vy);
    const forward = speed > 0 ? (car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle)) / speed : 1;
    const sliding = car.state === "driving" && car.z <= 2 && speed > 120 && (forward < 0.93 || car.dizzy > 0);
    if (!sliding) {
      this.skidEnds.delete(car.id);
      return;
    }
    const back = CAR_LENGTH * 0.3;
    const wheels = [-1, 1].map((side) => ({
      x: car.x - Math.cos(car.angle) * back - Math.sin(car.angle) * 10 * side,
      y: car.y - Math.sin(car.angle) * back + Math.cos(car.angle) * 10 * side,
    }));
    const last = this.skidEnds.get(car.id);
    if (last) {
      wheels.forEach((wheel, index) => {
        if (Math.hypot(last[index].x - wheel.x, last[index].y - wheel.y) < 60) this.world?.addSkid(last[index].x, last[index].y, wheel.x, wheel.y);
      });
    }
    this.skidEnds.set(car.id, wheels);
  }

  private fallScale(car: RaceCar): number {
    const since = this.fallingSince.get(car.id);
    if (car.state !== "falling" || since === undefined) return 1;
    return Math.max(0, 1 - (performance.now() - since) / FALL_MS);
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

  // Fire on a burning car, the flamethrower's jet, smoke from a stalled engine.
  private carEffects(car: RaceCar): void {
    const backX = -Math.cos(car.angle);
    const backY = -Math.sin(car.angle);
    if (car.burning) {
      this.spark({ x: car.x + (Math.random() - 0.5) * 16, y: car.y + (Math.random() - 0.5) * 10, z: car.z + 14, vx: 0, vy: 0, vz: 70, life: 0.4, max: 0.4, size: 4.5, color: pick(["#ffb23f", "#ff6b2e", "#ffe36b"]), grow: -6 });
    }
    if (car.flaming) {
      for (let index = 0; index < 3; index += 1) {
        const spread = (Math.random() - 0.5) * 0.5;
        const speed = 350 + Math.random() * 150;
        this.spark({
          x: car.x + backX * 18,
          y: car.y + backY * 18,
          z: 8,
          vx: (backX * Math.cos(spread) - backY * Math.sin(spread)) * speed + car.vx,
          vy: (backY * Math.cos(spread) + backX * Math.sin(spread)) * speed + car.vy,
          vz: 10,
          life: 0.4,
          max: 0.4,
          size: 5,
          color: pick(["#ffb23f", "#ff6b2e", "#ffe36b"]),
          grow: 14,
        });
      }
    }
    if (car.stalled && Math.random() < 0.4) {
      this.spark({ x: car.x - backX * 12, y: car.y - backY * 12, z: 12, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, vz: 50, life: 0.8, max: 0.8, size: 4, color: "#4a4a4a", grow: 10 });
    }
  }

  private muzzle(car: RaceCar, weapon: WeaponKind): void {
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    const flashAt = (x: number, y: number, dx: number, dy: number) => {
      for (let index = 0; index < 5; index += 1) {
        this.spark({ x, y, z: 9, vx: dx * (200 + Math.random() * 200) + (Math.random() - 0.5) * 80, vy: dy * (200 + Math.random() * 200) + (Math.random() - 0.5) * 80, vz: 20, life: 0.18, max: 0.18, size: 4.5, color: "#fff2a0", grow: -8 });
      }
    };
    if (weapon === "shotgun") {
      flashAt(car.x - fy * 14, car.y + fx * 14, -fy, fx);
      flashAt(car.x + fy * 14, car.y - fx * 14, fy, -fx);
      this.shake = Math.min(20, this.shake + 6);
    } else if (weapon === "mortar") {
      this.spark({ x: car.x, y: car.y, z: 14, vx: 0, vy: 0, vz: 60, life: 0.6, max: 0.6, size: 6, color: "#c8c8c8", grow: 16 });
    }
  }

  private drawTag(car: RaceCar, view: RaceView, now: number): void {
    const ctx = this.context;
    const spot = this.toScreen(car.x, car.y, car.z + 34);
    if (spot.behind) return;
    const nearEdge = Math.abs(car.x - view.view.x) > view.view.width / 2 - 70 || Math.abs(car.y - view.view.y) > view.view.height / 2 - 70;
    const size = Math.max(11 * this.ratio, 15 * this.scale);
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const label = car.weapon ? `${WEAPON_ICONS[car.weapon]}${car.ammo > 1 ? `×${car.ammo}` : ""} ${car.name}` : car.name;
    ctx.lineWidth = size / 4;
    ctx.strokeStyle = "#000";
    ctx.strokeText(label, spot.x, spot.y);
    ctx.fillStyle = nearEdge && Math.floor(now / 150) % 2 === 0 ? "#ff4a3a" : CAR_COLORS[car.color % CAR_COLORS.length];
    ctx.fillText(label, spot.x, spot.y);
    if (car.dizzy > 0) {
      ctx.font = `${size}px system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      for (let index = 0; index < 3; index += 1) {
        const angle = now / 180 + (index * Math.PI * 2) / 3;
        ctx.fillText("⭐", spot.x + Math.cos(angle) * size * 1.4, spot.y + size * 0.9 + Math.sin(angle) * size * 0.4);
      }
    }
  }

  private drawStrikeLabel(car: RaceCar): void {
    const strike = car.strike!;
    const spot = this.toScreen(strike.x, strike.y, 0);
    if (spot.behind) return;
    const ctx = this.context;
    const size = Math.max(11 * this.ratio, 14 * this.scale);
    ctx.save();
    ctx.globalAlpha = strike.ready ? 1 : 0.5;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = size / 4;
    ctx.strokeStyle = "#000";
    const label = `☠ ${car.name}${strike.ready ? "" : "…"}`;
    const y = spot.y + 36 * this.scale;
    ctx.strokeText(label, spot.x, y);
    ctx.fillStyle = CAR_COLORS[car.color % CAR_COLORS.length];
    ctx.fillText(label, spot.x, y);
    ctx.restore();
  }

  // A car off the screen: a marker on the nearest edge with the seconds it has left to get back.
  private drawWarnings(view: RaceView, now: number): void {
    const ctx = this.context;
    const { ratio, width, height } = this;
    for (const car of view.cars) {
      if (car.state !== "driving" || car.warn <= 0) continue;
      const spot = this.toScreen(car.x, car.y, 0);
      const margin = 34 * ratio;
      const x = Math.max(margin, Math.min(width - margin, spot.x));
      const y = Math.max(margin + 50 * ratio, Math.min(height - margin, spot.y));
      const flash = Math.floor(now / 120) % 2 === 0;
      ctx.fillStyle = flash ? "#ff2828" : CAR_COLORS[car.color % CAR_COLORS.length];
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 3 * ratio;
      ctx.beginPath();
      ctx.arc(x, y, 22 * ratio, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Pointing at the car.
      const angle = Math.atan2(spot.y - y, spot.x - x);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * 30 * ratio, y + Math.sin(angle) * 30 * ratio);
      ctx.lineTo(x + Math.cos(angle + 0.5) * 20 * ratio, y + Math.sin(angle + 0.5) * 20 * ratio);
      ctx.lineTo(x + Math.cos(angle - 0.5) * 20 * ratio, y + Math.sin(angle - 0.5) * 20 * ratio);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `900 ${20 * ratio}px "Arial Black", Impact, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(Math.ceil(car.warn)), x, y + ratio);
      ctx.font = `bold ${11 * ratio}px system-ui, sans-serif`;
      ctx.strokeText(car.name, x, y + 34 * ratio);
      ctx.fillText(car.name, x, y + 34 * ratio);
    }
  }

  private drawPopups(dt: number): void {
    const ctx = this.context;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const popup of this.popups) {
      popup.life -= dt * 0.9;
      popup.z += 45 * dt;
      const spot = this.toScreen(popup.x, popup.y, popup.z);
      if (spot.behind) continue;
      const pop = popup.life > 0.85 ? 1 + (popup.life - 0.85) * 4 : 1;
      const size = Math.max(12 * this.ratio, popup.size * this.scale);
      ctx.save();
      ctx.translate(spot.x, spot.y);
      ctx.rotate(popup.tilt);
      ctx.scale(pop, pop);
      ctx.globalAlpha = Math.max(0, Math.min(1, popup.life * 2));
      ctx.font = `900 ${size}px "Arial Black", Impact, system-ui, sans-serif`;
      ctx.lineWidth = size / 6;
      ctx.strokeStyle = "#000";
      ctx.strokeText(popup.text, 0, 0);
      ctx.fillStyle = popup.color;
      ctx.fillText(popup.text, 0, 0);
      ctx.restore();
    }
    this.popups = this.popups.filter((popup) => popup.life > 0);
  }

  // Outside the shared screen is the danger zone: darkened, so everyone can see where the edge is.
  // The camera is tilted, so on screen the edge is a trapezoid, narrower at the far end.
  private drawScreenEdge(view: RaceView, now: number): void {
    const ctx = this.context;
    const rect = view.view;
    const corners = [
      this.toScreen(rect.x - rect.width / 2, rect.y - rect.height / 2, 0),
      this.toScreen(rect.x + rect.width / 2, rect.y - rect.height / 2, 0),
      this.toScreen(rect.x + rect.width / 2, rect.y + rect.height / 2, 0),
      this.toScreen(rect.x - rect.width / 2, rect.y + rect.height / 2, 0),
    ];
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
    corners.forEach((corner, index) => (index === 0 ? ctx.moveTo(corner.x, corner.y) : ctx.lineTo(corner.x, corner.y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fill("evenodd");
    ctx.beginPath();
    corners.forEach((corner, index) => (index === 0 ? ctx.moveTo(corner.x, corner.y) : ctx.lineTo(corner.x, corner.y)));
    ctx.closePath();
    ctx.lineWidth = (view.shrinking ? 6 : 2) * this.ratio;
    ctx.strokeStyle = view.shrinking ? (Math.floor(now / 300) % 2 === 0 ? "rgba(255,74,58,0.9)" : "rgba(255,207,63,0.9)") : "rgba(255,255,255,0.25)";
    ctx.stroke();
  }

  // The caption under a knocked-out car as it flies at the camera.
  private drawCaptions(): void {
    if (!this.world) return;
    const ctx = this.context;
    for (const caption of this.world.captions()) {
      const t = 1 - caption.life / 1.6;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, caption.life * 2));
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const size = Math.round((28 + t * 20) * this.ratio);
      ctx.font = `900 ${size}px "Arial Black", Impact, system-ui, sans-serif`;
      ctx.lineWidth = 6 * this.ratio;
      ctx.strokeStyle = "#000";
      const room = ctx.measureText(caption.text).width / 2 + 20 * this.ratio;
      const x = Math.max(room, Math.min(this.width - room, caption.x * this.width));
      const y = Math.max(80 * this.ratio, Math.min(this.height - 60 * this.ratio, caption.y * this.height - 90 * this.ratio));
      ctx.strokeText(caption.text, x, y);
      ctx.fillStyle = "#fff";
      ctx.fillText(caption.text, x, y);
      ctx.restore();
    }
  }

  private drawHud(view: RaceView, width: number): void {
    const ctx = this.context;
    const ratio = this.ratio;
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
        circle(ctx, x + 14 * ratio + point * Math.min(13, (chip / ratio - 30) / view.target) * ratio, top + 30 * ratio, 4 * ratio);
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
    const ratio = this.ratio;
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

function blend(a: RaceView, b: RaceView, t: number): RaceView {
  const lerp = (from: number, to: number) => from + (to - from) * t;
  const carsBefore = new Map(a.cars.map((car) => [car.id, car]));
  const shotsBefore = new Map(a.shots.map((shot) => [shot.id, shot]));
  return {
    ...b,
    view: { x: lerp(a.view.x, b.view.x), y: lerp(a.view.y, b.view.y), width: lerp(a.view.width, b.view.width), height: lerp(a.view.height, b.view.height) },
    cars: b.cars.map((car) => {
      const from = carsBefore.get(car.id);
      // A jump of more than a few car lengths is a respawn or a new grid: don't slide across the map.
      if (!from || from.state !== car.state || Math.hypot(from.x - car.x, from.y - car.y) > 120) return car;
      if (car.state === "out") {
        const strike = from.strike && car.strike ? { ...car.strike, x: lerp(from.strike.x, car.strike.x), y: lerp(from.strike.y, car.strike.y) } : car.strike;
        return { ...car, strike };
      }
      const strike = from.strike && car.strike ? { ...car.strike, x: lerp(from.strike.x, car.strike.x), y: lerp(from.strike.y, car.strike.y) } : car.strike;
      return { ...car, x: lerp(from.x, car.x), y: lerp(from.y, car.y), z: lerp(from.z, car.z), angle: from.angle + wrap(car.angle - from.angle) * t, roll: lerp(from.roll, car.roll), strike };
    }),
    shots: b.shots.map((shot) => {
      const from = shotsBefore.get(shot.id);
      return from ? { ...shot, x: lerp(from.x, shot.x), y: lerp(from.y, shot.y), z: lerp(from.z, shot.z) } : shot;
    }),
  };
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
  ctx.strokeStyle = PREVIEW[track.def.theme].verge;
  ctx.lineWidth = 260;
  ctx.beginPath();
  track.samples.forEach((sample, index) => (index === 0 ? ctx.moveTo(sample.x, sample.y) : ctx.lineTo(sample.x, sample.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = PREVIEW[track.def.theme].road;
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
