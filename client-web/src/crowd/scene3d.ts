// The masquerade in 3D, drawn with Three.js: the room for each mode, every guest in a gown or tailcoat with an animal
// mask, the props, and candlelight. Names, shots and crosshairs are drawn flat on an overlay by CrowdGame, using project().
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { CROWD_STATE, type CrowdProp, type CrowdVector, type CrowdZone } from "../../../shared/crowd/protocol.js";
import { type Arena, type Figure, type FloorStyle, paintFloor } from "./draw.js";

// Arena pixels per world unit. A guest stands about 1.8 units tall.
const UNIT = 32;
const FOV = 30;
const PITCH = (52 * Math.PI) / 180;
const WALL_HEIGHT = 7;
// The floor layer is painted at half the arena's resolution.
const GROUND_SCALE = 0.5;
const TURN_RATE = 12;

export type ScreenPoint = { x: number; y: number };

// Masks are the codenames of the night: 8 animals in 5 colours. Each figure's mask and clothes come from its entity id,
// which the server shuffles every round, so a look says nothing about who is inside it.
export const ANIMALS = ["fox", "owl", "hare", "raven", "cat", "wolf", "stag", "bear"] as const;
export const MASK_COLOURS = { crimson: "#c0303c", blue: "#3a68c8", gold: "#e0b040", jade: "#2f9a72", violet: "#8250c0" } as const;
export type Animal = (typeof ANIMALS)[number];
export type MaskColour = keyof typeof MASK_COLOURS;

const COATS = ["#141012", "#1c1216", "#161a26", "#22141c", "#121212", "#1e1a14"];
const GOWNS = ["#7a1a34", "#1f3e78", "#8a6418", "#1f5c42", "#55307c", "#9a2c3e", "#2c2c48", "#b8a070"];
const HAIRS = ["#2a1a12", "#5a3a1e", "#c8a060", "#151515", "#7a3a1a", "#d8d0c0"];
const SKIN = "#e2c4a6";
const GOLD = "#c9a14a";

type Look = { gown: boolean; cloth: string; hair: string; animal: Animal; mask: MaskColour };

export function lookFor(id: number): Look {
  const pick = <T,>(items: readonly T[], salt: number) => items[Math.floor(hash(id * 31 + salt) * items.length)];
  const gown = hash(id * 31 + 2) < 0.5;
  return {
    gown,
    cloth: gown ? pick(GOWNS, 1) : pick(COATS, 1),
    hair: pick(HAIRS, 3),
    animal: pick(ANIMALS, 4),
    mask: pick(Object.keys(MASK_COLOURS) as MaskColour[], 5),
  };
}

// What hangs on the back wall between the gold trims.
type Dressing = "windows" | "shelves" | "paintings" | "vaults" | "pigeonholes";
type Room = { walls: boolean; floor: FloorStyle; wall: string; outdoor?: "garden" | "terrace"; dressing?: Dressing };
const ROOMS: Record<string, Room> = {
  hall: { walls: true, floor: "hall", wall: "#3a0c16" },
  library: { walls: true, floor: "library", wall: "#2a1a10", dressing: "shelves" },
  garden: { walls: false, floor: "garden", wall: "#1c2a1a", outdoor: "garden" },
  tower: { walls: true, floor: "tower", wall: "#2a2622" },
  vault: { walls: true, floor: "vault", wall: "#1e2226", dressing: "vaults" },
  gallery: { walls: true, floor: "gallery", wall: "#2a1430", dressing: "paintings" },
  music: { walls: true, floor: "music", wall: "#3a0c16" },
  post: { walls: true, floor: "post", wall: "#2c2216", dressing: "pigeonholes" },
  terrace: { walls: false, floor: "terrace", wall: "#1a1c2a", outdoor: "terrace" },
  ballroom: { walls: true, floor: "ballroom", wall: "#3a0c16" },
  plaza: { walls: true, floor: "plaza", wall: "#2a1a16" },
};

type Model = {
  root: THREE.Group;
  body: THREE.Group;
  legs: THREE.Mesh[];
  mask: THREE.Mesh;
  ring: THREE.Mesh;
  stars?: THREE.Group;
  yaw: number;
  seen: number;
};

type PropModel = { root: THREE.Group; light?: THREE.Mesh; swing?: THREE.Object3D; glow: THREE.Sprite; kind: CrowdProp["kind"] };

// Shared shapes and materials, never disposed.
const SHARED = { shared: true };
const BODY_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 });
const LEG_MATERIAL = new THREE.MeshStandardMaterial({ color: "#0c0a0c", roughness: 0.6 });
const GOLD_MATERIAL = new THREE.MeshStandardMaterial({ color: GOLD, metalness: 1, roughness: 0.35 });
const FLAME_MATERIAL = new THREE.MeshBasicMaterial({ color: "#ffd890" });
for (const material of [BODY_MATERIAL, LEG_MATERIAL, GOLD_MATERIAL, FLAME_MATERIAL]) material.userData = SHARED;
const LEG_GEOMETRY = new THREE.CylinderGeometry(0.08, 0.07, 0.75, 8).translate(0, -0.375, 0);
const MASK_GEOMETRY = new THREE.PlaneGeometry(1.6, 1.6);
const RING_GEOMETRY = new THREE.RingGeometry(0.55, 0.64, 40).rotateX(-Math.PI / 2);
const BLOB_GEOMETRY = new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2);
for (const geometry of [LEG_GEOMETRY, MASK_GEOMETRY, RING_GEOMETRY, BLOB_GEOMETRY]) geometry.userData = SHARED;

const bodyGeometries = new Map<string, THREE.BufferGeometry>();
const maskMaterials = new Map<string, THREE.Material>();
let blobMaterial: THREE.Material | undefined;
let glowTexture: THREE.Texture | undefined;

export class CrowdScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 1, 400);
  private composer?: EffectComposer;
  private readonly key: THREE.SpotLight;
  private readonly fill = new THREE.HemisphereLight("#6a4a58", "#1a0c08", 0.55);
  private zoneKey = "";
  private room?: THREE.Group;
  private roomKey = "";
  private arena: Arena = { width: 1280, height: 720 };
  private readonly models = new Map<number, Model>();
  private readonly props = new Map<number, PropModel>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly point = new THREE.Vector3();
  private width = 0;
  private height = 0;
  private top = 0;
  private fitted = "";
  private last = 0;
  // Rings, smoke and crosshairs are painted in 2D onto a layer lying on the floor.
  private readonly groundCanvas = document.createElement("canvas");
  private readonly groundTexture = new THREE.CanvasTexture(this.groundCanvas);
  private groundLayer?: THREE.Mesh;
  private groundPainted = false;

  constructor(private readonly canvas: HTMLCanvasElement, bloom: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color("#070405");

    this.scene.add(this.fill);
    this.key = new THREE.SpotLight("#ffd7a0", 320, 90, 0.75, 0.7, 1.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.radius = 4;
    this.scene.add(this.key, this.key.target);

    if (bloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.5, 0.9));
      this.composer.addPass(new OutputPass());
    }
  }

  // Undefined when the browser has no WebGL; the game then draws in 2D.
  static create(canvas: HTMLCanvasElement, bloom: boolean): CrowdScene | undefined {
    try {
      return new CrowdScene(canvas, bloom);
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    for (const model of this.models.values()) disposeTree(model.root);
    for (const prop of this.props.values()) disposeTree(prop.root);
    if (this.room) disposeTree(this.room);
    this.groundTexture.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
  }

  // `top` is the CSS pixels the HUD covers at the top of the screen.
  resize(width: number, height: number, top: number): void {
    if (width === this.width && height === this.height && top === this.top) return;
    this.width = width;
    this.height = height;
    this.top = top;
    this.renderer.setSize(width, height, false);
    this.composer?.setSize(width, height);
    this.fitted = "";
  }

  setRoom(style: FloorStyle, arena: Arena): void {
    const key = `${style}:${arena.width}x${arena.height}:${arena.exitX ?? ""}`;
    if (key === this.roomKey) return;
    this.roomKey = key;
    this.arena = arena;
    if (this.room) {
      this.scene.remove(this.room);
      disposeTree(this.room);
    }
    this.room = buildRoom(ROOMS[style] ?? ROOMS.plaza, arena);
    this.scene.add(this.room);
    const w = arena.width / UNIT;
    const d = arena.height / UNIT;
    this.groundCanvas.width = Math.round(arena.width * GROUND_SCALE);
    this.groundCanvas.height = Math.round(arena.height * GROUND_SCALE);
    this.groundTexture.colorSpace = THREE.SRGBColorSpace;
    this.groundTexture.dispose();
    this.groundPainted = true;
    const layer = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.groundTexture, transparent: true, depthWrite: false, toneMapped: false }),
    );
    layer.position.y = 0.03;
    layer.renderOrder = 1;
    this.groundTexture.userData.shared = true;
    this.room.add(layer);
    this.groundLayer = layer;
    this.zoneKey = "";
    this.setZone();
    this.key.shadow.camera.far = 120;
    this.fitted = "";
    for (const prop of this.props.values()) disposeTree(prop.root);
    this.props.clear();
  }

  // Figures in arena coordinates. `self` gets a ring at its feet.
  syncFigures(figures: Iterable<Figure>, now: number, self?: number): void {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    for (const figure of figures) {
      let model = this.models.get(figure.id);
      if (!model) {
        model = makeFigure(lookFor(figure.id));
        this.models.set(figure.id, model);
        this.scene.add(model.root);
        model.yaw = yawOf(figure.facing);
      }
      model.seen = now;
      animate(model, figure, now, dt);
      model.root.position.set(this.x(figure.x), 0, this.z(figure.y));
      model.ring.visible = figure.id === self;
    }
    for (const [id, model] of this.models) {
      if (model.seen === now) continue;
      this.scene.remove(model.root);
      disposeTree(model.root);
      this.models.delete(id);
    }
  }

  // `mine`: props this screen's player has used. `flare` runs 1 → 0 just after anyone used one.
  syncProps(props: CrowdProp[], mine: number[], flareOf: (id: number) => number, now: number): void {
    const ids = new Set(props.map((prop) => prop.id));
    for (const [id, model] of this.props) {
      if (ids.has(id)) continue;
      this.scene.remove(model.root);
      disposeTree(model.root);
      this.props.delete(id);
    }
    for (const prop of props) {
      let model = this.props.get(prop.id);
      if (!model) {
        model = makeProp(prop.kind);
        this.props.set(prop.id, model);
        this.scene.add(model.root);
      }
      model.root.position.set(this.x(prop.x), 0, this.z(prop.y));
      updateProp(model, prop, mine.includes(prop.id), flareOf(prop.id), now);
    }
  }

  // Closing Time: the key light narrows to the circle still lit and the rest of the room goes dark.
  setZone(zone?: CrowdZone): void {
    const key = zone ? `${zone.x},${zone.y},${zone.r}` : "none";
    if (key === this.zoneKey) return;
    this.zoneKey = key;
    const w = this.arena.width / UNIT;
    const d = this.arena.height / UNIT;
    const lamps: THREE.PointLight[] = [];
    this.room?.traverse((child) => child instanceof THREE.PointLight && lamps.push(child));
    for (const lamp of lamps) {
      lamp.userData.intensity ??= lamp.intensity;
      lamp.intensity = lamp.userData.intensity * (zone ? 0.15 : 1);
    }
    this.fill.intensity = zone ? 0.18 : 0.55;
    if (!zone) {
      this.key.position.set(0, Math.max(w, d) * 0.9, d * 0.25);
      this.key.target.position.set(0, 0, 0);
      this.key.angle = 0.75;
      this.key.penumbra = 0.7;
      return;
    }
    const height = 30;
    this.key.position.set(this.x(zone.x), height, this.z(zone.y));
    this.key.target.position.set(this.x(zone.x), 0, this.z(zone.y));
    this.key.angle = Math.min(1.2, Math.atan(zone.r / UNIT / height) * 1.08);
    this.key.penumbra = 0.15;
  }

  // Paint the floor layer in arena coordinates. Pass nothing when there is nothing to show.
  paintGround(draw?: (ctx: CanvasRenderingContext2D) => void): void {
    if (!this.groundLayer || (!draw && !this.groundPainted)) return;
    const ctx = this.groundCanvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.groundCanvas.width, this.groundCanvas.height);
    ctx.setTransform(GROUND_SCALE, 0, 0, GROUND_SCALE, 0, 0);
    draw?.(ctx);
    this.groundPainted = draw !== undefined;
    this.groundTexture.needsUpdate = true;
  }

  // Drop every figure and prop, ready for the next round on the same canvas.
  clear(): void {
    for (const model of this.models.values()) {
      this.scene.remove(model.root);
      disposeTree(model.root);
    }
    this.models.clear();
    for (const prop of this.props.values()) {
      this.scene.remove(prop.root);
      disposeTree(prop.root);
    }
    this.props.clear();
    this.last = 0;
    this.paintGround();
  }

  render(): void {
    this.fit();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // Arena point (and a height in world units) to CSS pixels on the canvas.
  project(at: CrowdVector, height = 0): ScreenPoint {
    const point = this.point.set(this.x(at.x), height, this.z(at.y)).project(this.camera);
    return { x: ((point.x + 1) / 2) * this.width, y: ((1 - point.y) / 2) * this.height };
  }

  // A CSS pixel on the canvas to the arena point under it on the floor.
  toArena(screen: ScreenPoint): CrowdVector | undefined {
    const ndc = new THREE.Vector2((screen.x / this.width) * 2 - 1, 1 - (screen.y / this.height) * 2);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.ground, this.point);
    if (!hit) return undefined;
    return { x: hit.x * UNIT + this.arena.width / 2, y: hit.z * UNIT + this.arena.height / 2 };
  }

  // Arena units to world units on the floor, centred on the middle of the room.
  private x(arenaX: number): number {
    return (arenaX - this.arena.width / 2) / UNIT;
  }

  private z(arenaY: number): number {
    return (arenaY - this.arena.height / 2) / UNIT;
  }

  // Pull the camera back until the whole floor and the walls' feet fit below the HUD.
  private fit(): void {
    const key = `${this.roomKey}:${this.width}x${this.height}:${this.top}`;
    if (key === this.fitted || this.width === 0) return;
    this.fitted = key;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    const w = this.arena.width / UNIT;
    const d = this.arena.height / UNIT;
    const corners = [
      new THREE.Vector3(-w / 2 - 0.6, 0, -d / 2 - 0.6),
      new THREE.Vector3(w / 2 + 0.6, 0, -d / 2 - 0.6),
      new THREE.Vector3(-w / 2 - 0.6, 0, d / 2 + 0.6),
      new THREE.Vector3(w / 2 + 0.6, 0, d / 2 + 0.6),
      // Heads at the back still need to show.
      new THREE.Vector3(0, 2.4, -d / 2),
    ];
    const topLimit = 1 - (this.top / this.height) * 2;
    const place = (distance: number, shift: number) => {
      this.camera.position.set(0, Math.sin(PITCH) * distance, Math.cos(PITCH) * distance + shift);
      this.camera.lookAt(0, 0, shift);
      this.camera.updateMatrixWorld();
    };
    const fits = (distance: number, shift: number) => {
      place(distance, shift);
      return corners.every((corner) => {
        const p = corner.clone().project(this.camera);
        return p.x >= -0.98 && p.x <= 0.98 && p.y >= -0.98 && p.y <= topLimit - 0.02;
      });
    };
    // Shift the view a little toward the viewer so the HUD covers wall, not floor.
    const shift = -(this.top / this.height) * d * 0.9;
    let low = 5;
    let high = 300;
    for (let step = 0; step < 30; step += 1) {
      const mid = (low + high) / 2;
      if (fits(mid, shift)) high = mid;
      else low = mid;
    }
    place(high, shift);
  }
}

function animate(model: Model, figure: Figure, now: number, dt: number): void {
  const t = now / 1000;
  const phase = t + figure.id * 0.37;
  const body = model.body;
  body.rotation.set(0, 0, 0);
  body.position.set(0, 0, 0);
  if (model.stars) model.stars.visible = false;

  if (figure.state === CROWD_STATE.DEAD) {
    // Fallen over sideways, mask still on.
    body.rotation.z = Math.PI / 2;
    body.position.set(0.25, 0.28, 0);
    for (const leg of model.legs) leg.rotation.x = 0;
    model.root.rotation.y = model.yaw;
    turnMask(model);
    return;
  }

  const target = yawOf(figure.facing);
  let delta = target - model.yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  model.yaw += delta * Math.min(1, dt * TURN_RATE);
  model.root.rotation.y = model.yaw;
  turnMask(model);

  const moving = figure.state === CROWD_STATE.WALK || figure.state === CROWD_STATE.RUN;
  const running = figure.state === CROWD_STATE.RUN;
  const stride = running ? 15 : 9;
  const swing = moving ? Math.sin(phase * stride) : 0;
  for (const [index, leg] of model.legs.entries()) leg.rotation.x = swing * (running ? 0.7 : 0.45) * (index === 0 ? 1 : -1);
  body.position.y = moving ? Math.abs(swing) * 0.06 : Math.sin(phase * 2) * 0.012;
  body.rotation.z = moving ? swing * 0.04 : 0;
  if (running) body.rotation.x = 0.18;

  if (figure.state === CROWD_STATE.STUNNED || figure.state === CROWD_STATE.SICK) {
    const fast = figure.state === CROWD_STATE.STUNNED;
    body.rotation.z = Math.sin(phase * (fast ? 9 : 5)) * 0.14;
    body.rotation.x = Math.cos(phase * (fast ? 7 : 4)) * 0.08;
    if (fast) {
      if (!model.stars) model.stars = makeStars(model.root);
      model.stars.visible = true;
      model.stars.rotation.y = phase * 5;
    }
  }
}

// Masks face the room's audience whichever way their wearer turns, so every codename can be read.
function turnMask(model: Model): void {
  const turn = -model.yaw;
  model.mask.rotation.y = turn;
  model.mask.position.set(Math.sin(turn) * 0.25, 1.62, Math.cos(turn) * 0.25);
}

// facing 0-7 counts eighths of a turn clockwise from +x, with y pointing down the screen (toward the camera).
function yawOf(facing: number): number {
  const angle = (facing * Math.PI) / 4;
  return Math.atan2(Math.cos(angle), Math.sin(angle));
}

function makeFigure(look: Look): Model {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mesh = new THREE.Mesh(bodyGeometry(look), BODY_MATERIAL);
  mesh.castShadow = true;
  body.add(mesh);
  const legs: THREE.Mesh[] = [];
  if (!look.gown) {
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(LEG_GEOMETRY, LEG_MATERIAL);
      leg.position.set(side * 0.1, 0.75, 0);
      leg.castShadow = true;
      root.add(leg);
      legs.push(leg);
    }
  }
  const mask = new THREE.Mesh(MASK_GEOMETRY, maskMaterial(look.animal, look.mask));
  // Tipped back toward the camera above, so faces read from across the room.
  mask.rotation.order = "YXZ";
  mask.rotation.x = -0.55;
  body.add(mask);
  const blob = new THREE.Mesh(BLOB_GEOMETRY, shadowBlob());
  blob.position.y = 0.02;
  root.add(blob);
  const ring = new THREE.Mesh(RING_GEOMETRY, new THREE.MeshBasicMaterial({ color: "#f4e6c4", transparent: true, opacity: 0.9 }));
  ring.position.y = 0.04;
  ring.visible = false;
  root.add(ring);
  return { root, body, legs, mask, ring, yaw: 0, seen: 0 };
}

// Everything that doesn't move on its own, merged into one mesh per look with the colours baked in.
function bodyGeometry(look: Look): THREE.BufferGeometry {
  const key = `${look.gown}:${look.cloth}:${look.hair}:${look.mask}`;
  const cached = bodyGeometries.get(key);
  if (cached) return cached;
  const parts: THREE.BufferGeometry[] = [];
  const add = (geometry: THREE.BufferGeometry, colour: string, at: [number, number, number], rotate?: [number, number, number]) => {
    if (rotate) geometry.rotateX(rotate[0]).rotateY(rotate[1]).rotateZ(rotate[2]);
    geometry.translate(...at);
    paint(geometry, colour);
    parts.push(geometry.index ? geometry.toNonIndexed() : geometry);
  };
  if (look.gown) {
    const skirt = new THREE.LatheGeometry(
      [new THREE.Vector2(0, 0), new THREE.Vector2(0.62, 0), new THREE.Vector2(0.58, 0.12), new THREE.Vector2(0.4, 0.5), new THREE.Vector2(0.22, 0.88), new THREE.Vector2(0.16, 0.96)],
      20,
    );
    add(skirt, look.cloth, [0, 0, 0]);
    add(new THREE.CylinderGeometry(0.15, 0.18, 0.42, 12), shade(look.cloth, 1.12), [0, 1.13, 0]);
    for (const side of [-1, 1]) add(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 6), SKIN, [side * 0.22, 1.08, 0.04], [0, 0, side * 0.25]);
    add(new THREE.SphereGeometry(0.09, 8, 6), look.hair, [0, 1.68, -0.13]);
  } else {
    add(new THREE.BoxGeometry(0.44, 0.58, 0.26), look.cloth, [0, 1.0, 0]);
    add(new THREE.BoxGeometry(0.38, 0.38, 0.05), look.cloth, [0, 0.6, -0.12], [0.15, 0, 0]);
    add(new THREE.BoxGeometry(0.14, 0.42, 0.02), "#f2ece0", [0, 1.07, 0.135]);
    add(new THREE.BoxGeometry(0.12, 0.04, 0.03), "#0c0a0c", [0, 1.26, 0.15]);
    for (const side of [-1, 1]) add(new THREE.CylinderGeometry(0.065, 0.06, 0.52, 8), look.cloth, [side * 0.28, 0.98, 0], [0, 0, side * 0.12]);
  }
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.13, 8), SKIN, [0, 1.36, 0]);
  add(new THREE.SphereGeometry(0.19, 14, 10), SKIN, [0, 1.56, 0]);
  add(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), look.hair, [0, 1.58, -0.01], [-0.35, 0, 0]);
  // The mask's ribbon tied behind the head, the one part of the mask you see from behind.
  add(new THREE.BoxGeometry(0.05, 0.26, 0.02), MASK_COLOURS[look.mask], [0, 1.47, -0.2]);
  const merged = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  merged.userData = SHARED;
  bodyGeometries.set(key, merged);
  return merged;
}

function paint(geometry: THREE.BufferGeometry, colour: string): void {
  const c = new THREE.Color(colour);
  const count = geometry.getAttribute("position").count;
  const colours = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) colours.set([c.r, c.g, c.b], index * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
}

function maskMaterial(animal: Animal, colour: MaskColour): THREE.Material {
  const key = `${animal}:${colour}`;
  let material = maskMaterials.get(key);
  if (!material) {
    const texture = canvasTexture(128, 128, (ctx) => {
      ctx.translate(64, 76);
      drawMask(ctx, animal, colour, 4.4);
    });
    material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.4, roughness: 0.3, metalness: 0.15, side: THREE.DoubleSide });
    material.userData = SHARED;
    maskMaterials.set(key, material);
  }
  return material;
}

// A mask seen from the front, ears up, drawn around (0, 0). Also used for the codename card.
export function drawMask(ctx: CanvasRenderingContext2D, animal: Animal, colour: MaskColour, scale: number): void {
  const fill = MASK_COLOURS[colour];
  const trim = "#e8c66a";
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = fill;
  ctx.strokeStyle = trim;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  if (animal === "fox" || animal === "cat" || animal === "wolf") {
    ctx.moveTo(-7, -1);
    ctx.lineTo(-6, animal === "cat" ? -9 : -11);
    ctx.lineTo(-2, -4);
    ctx.lineTo(2, -4);
    ctx.lineTo(6, animal === "cat" ? -9 : -11);
    ctx.lineTo(7, -1);
  }
  if (animal === "hare") {
    ctx.ellipse(-3, -10, 2, 7, -0.15, 0, Math.PI * 2);
    ctx.ellipse(3, -10, 2, 7, 0.15, 0, Math.PI * 2);
  }
  if (animal === "owl") {
    ctx.moveTo(-7, -2);
    ctx.lineTo(-7.5, -9);
    ctx.lineTo(-3, -4);
    ctx.lineTo(3, -4);
    ctx.lineTo(7.5, -9);
    ctx.lineTo(7, -2);
  }
  if (animal === "bear") {
    ctx.arc(-6, -5, 3, 0, Math.PI * 2);
    ctx.arc(6, -5, 3, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  if (animal === "stag") {
    ctx.strokeStyle = fill;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-3, -4);
    ctx.lineTo(-8, -13);
    ctx.moveTo(-6, -9);
    ctx.lineTo(-11, -10);
    ctx.moveTo(3, -4);
    ctx.lineTo(8, -13);
    ctx.moveTo(6, -9);
    ctx.lineTo(11, -10);
    ctx.stroke();
    ctx.strokeStyle = trim;
    ctx.lineWidth = 0.9;
  }
  ctx.beginPath();
  ctx.ellipse(0, 0, 7.8, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const sheen = ctx.createLinearGradient(0, -5, 0, 5);
  sheen.addColorStop(0, "rgb(255 255 255 / 35%)");
  sheen.addColorStop(1, "rgb(0 0 0 / 25%)");
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.ellipse(0, 0, 7.8, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0e0608";
  ctx.beginPath();
  ctx.ellipse(-3.1, -0.6, 2, 1.3, 0.15, 0, Math.PI * 2);
  ctx.ellipse(3.1, -0.6, 2, 1.3, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 0.6;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 3.1, -0.6, 2.4, 1.7, -side * 0.15, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (animal === "fox" || animal === "wolf" || animal === "bear") {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(-2.5, 3);
    ctx.lineTo(0, 8);
    ctx.lineTo(2.5, 3);
    ctx.fill();
    ctx.stroke();
  }
  if (animal === "raven" || animal === "owl") {
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.moveTo(-1.7, 2);
    ctx.lineTo(0, 9);
    ctx.lineTo(1.7, 2);
    ctx.fill();
  }
  ctx.restore();
}

function makeStars(root: THREE.Group): THREE.Group {
  const stars = new THREE.Group();
  for (let index = 0; index < 3; index += 1) {
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshBasicMaterial({ color: "#f3d36b" }));
    const angle = (index * Math.PI * 2) / 3;
    star.position.set(Math.cos(angle) * 0.35, 2.05, Math.sin(angle) * 0.35);
    stars.add(star);
  }
  root.add(stars);
  return stars;
}

function makeProp(kind: CrowdProp["kind"]): PropModel {
  const root = new THREE.Group();
  const solid = (geometry: THREE.BufferGeometry, material: THREE.Material, at: [number, number, number]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...at);
    mesh.castShadow = true;
    root.add(mesh);
    return mesh;
  };
  const iron = new THREE.MeshStandardMaterial({ color: "#2a2420", roughness: 0.5, metalness: 0.4 });
  let light: THREE.Mesh | undefined;
  let swing: THREE.Object3D | undefined;
  if (kind === "lantern") {
    solid(new THREE.CylinderGeometry(0.05, 0.07, 1.6, 8), iron, [0, 0.8, 0]);
    light = solid(new THREE.CylinderGeometry(0.2, 0.16, 0.42, 8), new THREE.MeshStandardMaterial({ color: "#8a4d3a", emissive: "#000000", roughness: 0.5 }), [0, 1.82, 0]);
    solid(new THREE.ConeGeometry(0.26, 0.18, 8), iron, [0, 2.12, 0]);
  } else if (kind === "bell") {
    const wood = new THREE.MeshStandardMaterial({ color: "#4b3a2a", roughness: 0.8 });
    solid(new THREE.BoxGeometry(0.12, 2.1, 0.12), wood, [-0.55, 1.05, 0]);
    solid(new THREE.BoxGeometry(0.12, 2.1, 0.12), wood, [0.55, 1.05, 0]);
    solid(new THREE.BoxGeometry(1.35, 0.14, 0.16), wood, [0, 2.12, 0]);
    swing = new THREE.Group();
    swing.position.set(0, 2.04, 0);
    root.add(swing);
    const bell = new THREE.Mesh(
      new THREE.LatheGeometry([new THREE.Vector2(0.06, 0), new THREE.Vector2(0.18, -0.08), new THREE.Vector2(0.22, -0.4), new THREE.Vector2(0.34, -0.62), new THREE.Vector2(0.3, -0.64)], 16),
      new THREE.MeshStandardMaterial({ color: "#9b7b3a", metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide }),
    );
    bell.castShadow = true;
    swing.add(bell);
    light = bell;
  } else {
    solid(new THREE.BoxGeometry(0.9, 0.95, 0.7), new THREE.MeshStandardMaterial({ color: "#3b4048", metalness: 0.6, roughness: 0.4 }), [0, 0.48, 0]);
    solid(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 16).rotateX(Math.PI / 2), GOLD_MATERIAL, [0, 0.55, 0.37]);
    light = solid(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: "#5a1414", emissive: "#000000" }), [0, 1.02, 0.2]);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap(), color: "#ffc070", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.set(0, kind === "vault" ? 1.0 : 1.8, 0);
  glow.scale.set(2.4, 2.4, 1);
  root.add(glow);
  return { root, light, swing, glow, kind };
}

function updateProp(model: PropModel, prop: CrowdProp, mine: boolean, flare: number, now: number): void {
  const light = model.light?.material as THREE.MeshStandardMaterial | undefined;
  if (model.kind === "lantern" && light) {
    const lit = mine ? 0.85 + Math.sin(now * 0.005) * 0.12 : 0;
    light.color.set(mine ? "#f4a046" : "#8a4d3a");
    light.emissive.set("#ff9a40");
    light.emissiveIntensity = lit * 1.6;
  }
  if (model.kind === "bell" && light && model.swing) {
    light.color.set(prop.on ? "#f0c25a" : "#9b7b3a");
    model.swing.rotation.z = prop.on ? Math.sin(now * 0.01) * 0.3 : 0;
  }
  if (model.kind === "vault" && light) {
    const blink = prop.on && Math.floor(now / 250) % 2 === 0;
    light.emissive.set(blink ? "#ff4030" : "#000000");
    light.emissiveIntensity = blink ? 3 : 0;
  }
  const glowMaterial = model.glow.material as THREE.SpriteMaterial;
  glowMaterial.opacity = Math.max(flare * 0.9, model.kind === "lantern" && mine ? 0.45 : 0);
  const size = 2.4 + (1 - flare) * (flare > 0 ? 2 : 0);
  model.glow.scale.set(size, size, 1);
}

function buildRoom(room: Room, arena: Arena): THREE.Group {
  const group = new THREE.Group();
  const w = arena.width / UNIT;
  const d = arena.height / UNIT;
  const floorTexture = new THREE.CanvasTexture(paintFloor(arena, room.floor));
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  floorTexture.anisotropy = 8;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.5 }));
  floor.receiveShadow = true;
  group.add(floor);
  // A dark apron around the floor, and a gold rim.
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(w + 30, d + 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: room.outdoor ? "#0c120c" : "#120708", roughness: 1 }));
  apron.position.y = -0.02;
  apron.receiveShadow = true;
  group.add(apron);
  for (const [sx, sz, lx, lz] of [[0, -d / 2, w + 0.2, 0.1], [0, d / 2, w + 0.2, 0.1], [-w / 2, 0, 0.1, d], [w / 2, 0, 0.1, d]] as const) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(lx, 0.04, lz), GOLD_MATERIAL);
    rim.position.set(sx, 0.02, sz);
    group.add(rim);
  }

  const lights: Array<[number, number]> = [[-w / 4, -d / 6], [w / 4, -d / 6], [0, d / 6]];
  if (room.walls) {
    const wall = new THREE.MeshStandardMaterial({ color: room.wall, roughness: 0.85 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, WALL_HEIGHT, 0.4), wall);
    back.position.set(0, WALL_HEIGHT / 2, -d / 2 - 0.5);
    back.receiveShadow = true;
    group.add(back);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.4, WALL_HEIGHT, d + 1), wall);
      wing.position.set(side * (w / 2 + 0.5), WALL_HEIGHT / 2, 0);
      wing.receiveShadow = true;
      group.add(wing);
    }
    for (const y of [1.1, WALL_HEIGHT - 1]) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 0.18, 0.08), GOLD_MATERIAL);
      trim.position.set(0, y, -d / 2 - 0.28);
      group.add(trim);
    }
    dressWall(group, room.dressing ?? "windows", w, -d / 2 - 0.3);
    // Columns in the back corners, clear of where anyone walks.
    const marble = new THREE.MeshStandardMaterial({ color: "#e9e1d0", roughness: 0.35 });
    for (const side of [-1, 1]) {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, WALL_HEIGHT, 18), marble);
      column.position.set(side * (w / 2 - 0.2), WALL_HEIGHT / 2, -d / 2 - 0.1);
      column.castShadow = true;
      group.add(column);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 1.3), GOLD_MATERIAL);
      cap.position.set(side * (w / 2 - 0.2), WALL_HEIGHT, -d / 2 - 0.1);
      group.add(cap);
    }
    // Only the back chandeliers are hung: one over the middle of the floor would hide the crowd under it.
    for (const [x, z] of lights) if (z < 0) group.add(chandelier(x, 8.5, z));
  } else {
    // Out in the grounds: hedges or a stone balustrade, and lamps on posts.
    const garden = room.outdoor === "garden";
    const edge = new THREE.MeshStandardMaterial({ color: garden ? "#1f3a22" : "#9a9284", roughness: 0.9 });
    const height = garden ? 1.1 : 0.8;
    for (const [x, z, lx, lz] of [[0, -d / 2 - 0.6, w + 2.2, 0.9], [-w / 2 - 0.6, 0, 0.9, d + 2.2], [w / 2 + 0.6, 0, 0.9, d + 2.2]] as const) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(lx, height, lz), edge);
      block.position.set(x, height / 2, z);
      block.castShadow = true;
      block.receiveShadow = true;
      group.add(block);
    }
    for (const [x, z] of [[-w / 2 - 0.6, -d / 2 - 0.6], [w / 2 + 0.6, -d / 2 - 0.6], [-w / 2 - 0.6, d / 2], [w / 2 + 0.6, d / 2]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3, 8), new THREE.MeshStandardMaterial({ color: "#1a1612", metalness: 0.5, roughness: 0.5 }));
      post.position.set(x, 1.5, z);
      group.add(post);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), FLAME_MATERIAL);
      lamp.position.set(x, 3.1, z);
      group.add(lamp, glowSprite(x, 3.1, z, 2.2, 0.8));
    }
  }
  for (const [x, z] of lights) {
    const lamp = new THREE.PointLight("#ffb860", room.walls ? 55 : 35, 30, 1.6);
    lamp.position.set(x, 6, z);
    group.add(lamp);
  }
  return group;
}

// Tall night windows between curtains, or the room's own furniture along the back wall at depth `back`.
function dressWall(group: THREE.Group, dressing: Dressing, w: number, back: number): void {
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z = back) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  // Small repeated pieces (books, letters) are merged into one mesh coloured per vertex.
  const parts: THREE.BufferGeometry[] = [];
  const part = (geometry: THREE.BufferGeometry, colour: string, x: number, y: number, z: number) => {
    paint(geometry, colour);
    parts.push(geometry.translate(x, y, z));
  };
  const mergeParts = () => group.add(new THREE.Mesh(mergeGeometries(parts), BODY_MATERIAL));
  if (dressing === "shelves") {
    // Bookcases, each shelf a row of spines in leather colours.
    const spines = ["#6a1426", "#1f3e5a", "#2c4a2a", "#7a5a20", "#3a2440"];
    const cases = Math.max(3, Math.round(w / 5));
    const width = w / cases - 0.5;
    for (let index = 0; index < cases; index += 1) {
      const x = -w / 2 + (w / cases) * (index + 0.5);
      part(new THREE.BoxGeometry(width + 0.3, 5, 0.3), "#3a2414", x, 3.6, back + 0.1);
      for (let shelf = 0; shelf < 4; shelf += 1) {
        const y = 1.6 + shelf * 1.2;
        part(new THREE.BoxGeometry(width, 0.08, 0.5), "#3a2414", x, y, back + 0.25);
        let left = x - width / 2 + 0.05;
        let book = index * 7 + shelf * 3;
        while (left < x + width / 2 - 0.2) {
          const thick = 0.14 + hash(book) * 0.12;
          const tall = 0.75 + hash(book + 0.5) * 0.25;
          part(new THREE.BoxGeometry(thick - 0.02, tall, 0.4), spines[Math.floor(hash(book + 0.3) * spines.length)], left + thick / 2, y + 0.04 + tall / 2, back + 0.27);
          left += thick;
          book += 1;
        }
      }
    }
    mergeParts();
    return;
  }
  if (dressing === "paintings") {
    // Gilt-framed portraits under picture lights.
    const canvases = ["#3a2a1a", "#1c2a3a", "#4a2a2a", "#2a3a2a"].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    const count = Math.max(3, Math.round(w / 7));
    for (let index = 0; index < count; index += 1) {
      const x = -w / 2 + (w / count) * (index + 0.5);
      const tall = index % 2 === 0;
      const [pw, ph] = tall ? [2.2, 3] : [3, 2.2];
      add(new THREE.BoxGeometry(pw + 0.4, ph + 0.4, 0.12), GOLD_MATERIAL, x, 3.8, back + 0.05);
      add(new THREE.BoxGeometry(pw, ph, 0.14), canvases[index % canvases.length], x, 3.8, back + 0.07);
      // A face-shaped smudge, so it reads as a portrait.
      add(new THREE.CircleGeometry(0.35 * (ph / 3), 16), new THREE.MeshStandardMaterial({ color: "#b89a7a", roughness: 0.9 }), x, 3.8 + ph * 0.12, back + 0.15);
      add(new THREE.BoxGeometry(0.9, 0.08, 0.2), FLAME_MATERIAL, x, 3.8 + ph / 2 + 0.4, back + 0.2);
    }
    return;
  }
  if (dressing === "vaults") {
    // Round steel vault doors set into the wall.
    const steel = new THREE.MeshStandardMaterial({ color: "#5a606a", metalness: 0.8, roughness: 0.35 });
    const count = Math.max(2, Math.round(w / 9));
    for (let index = 0; index < count; index += 1) {
      const x = -w / 2 + (w / count) * (index + 0.5);
      add(new THREE.CylinderGeometry(1.7, 1.7, 0.3, 32).rotateX(Math.PI / 2), steel, x, 3.4, back + 0.1);
      add(new THREE.TorusGeometry(1.7, 0.12, 8, 32), GOLD_MATERIAL, x, 3.4, back + 0.26);
      for (let spoke = 0; spoke < 3; spoke += 1) {
        const bar = add(new THREE.BoxGeometry(1.4, 0.1, 0.1), GOLD_MATERIAL, x, 3.4, back + 0.35);
        bar.rotation.z = (spoke * Math.PI) / 3;
      }
    }
    return;
  }
  if (dressing === "pigeonholes") {
    // A sorting wall of pigeonholes, some with letters in them.
    add(new THREE.BoxGeometry(w * 0.8, 4.2, 0.2), new THREE.MeshStandardMaterial({ color: "#1a1008", roughness: 1 }), 0, 3.6, back);
    const columns = Math.round(w * 0.8 / 0.9);
    for (let column = 0; column <= columns; column += 1) part(new THREE.BoxGeometry(0.08, 4.2, 0.5), "#4a3218", -w * 0.4 + (w * 0.8 * column) / columns, 3.6, back + 0.2);
    for (let row = 0; row <= 5; row += 1) part(new THREE.BoxGeometry(w * 0.8, 0.08, 0.5), "#4a3218", 0, 1.5 + row * 0.84, back + 0.2);
    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < 5; row += 1) {
        if (hash(column * 5 + row) < 0.55) continue;
        part(new THREE.BoxGeometry(0.6, 0.4, 0.05), "#e8dcc0", -w * 0.4 + (w * 0.8 * (column + 0.5)) / columns, 1.75 + row * 0.84, back + 0.32);
      }
    }
    mergeParts();
    return;
  }
  const glass = new THREE.MeshStandardMaterial({ color: "#0c1830", emissive: "#20365e", emissiveIntensity: 0.6, roughness: 0.2 });
  const curtain = new THREE.MeshStandardMaterial({ color: "#6a1426", roughness: 0.9 });
  const count = Math.max(2, Math.round(w / 9));
  for (let index = 0; index < count; index += 1) {
    const x = -w / 2 + (w / count) * (index + 0.5);
    add(new THREE.BoxGeometry(2.2, 4.2, 0.08), glass, x, 3.6, back + 0.03);
    add(new THREE.BoxGeometry(2.45, 4.45, 0.04), GOLD_MATERIAL, x, 3.6);
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.6, 5.4, 0.25), curtain, x + side * 1.45, 3.7, back + 0.15).castShadow = true;
  }
}

function chandelier(x: number, y: number, z: number): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  for (const [height, radius] of [[0, 1.2], [0.45, 0.72]] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.05, 6, 40).rotateX(Math.PI / 2), GOLD_MATERIAL);
    ring.position.y = height;
    group.add(ring);
    for (let index = 0; index < 10; index += 1) {
      const angle = (index / 10) * Math.PI * 2;
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), FLAME_MATERIAL);
      flame.position.set(Math.cos(angle) * radius, height + 0.22, Math.sin(angle) * radius);
      group.add(flame);
    }
  }
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 6, 4), GOLD_MATERIAL);
  chain.position.y = 3.3;
  group.add(chain);
  group.add(glowSprite(0, 0.3, 0, 4.6, 0.55));
  return group;
}

function glowSprite(x: number, y: number, z: number, size: number, opacity: number): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap(), color: "#ffc070", transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  sprite.position.set(x, y, z);
  sprite.scale.set(size, size, 1);
  return sprite;
}

function glowMap(): THREE.Texture {
  if (!glowTexture) {
    glowTexture = canvasTexture(128, 128, (ctx) => {
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, "rgb(255 220 150 / 100%)");
      gradient.addColorStop(0.25, "rgb(255 180 90 / 50%)");
      gradient.addColorStop(1, "rgb(255 160 60 / 0%)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    });
    glowTexture.userData = SHARED;
  }
  return glowTexture;
}

function shadowBlob(): THREE.Material {
  if (!blobMaterial) {
    const texture = canvasTexture(64, 64, (ctx) => {
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, "rgb(0 0 0 / 70%)");
      gradient.addColorStop(1, "rgb(0 0 0 / 0%)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
    });
    blobMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    blobMaterial.userData = SHARED;
  }
  return blobMaterial;
}

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function shade(hex: string, factor: number): string {
  const c = new THREE.Color(hex).multiplyScalar(factor);
  return `#${c.getHexString()}`;
}

function disposeTree(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.Sprite)) return;
    if (!child.geometry.userData.shared) child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material.userData.shared) continue;
      const map = (material as THREE.MeshStandardMaterial).map;
      if (map && !map.userData.shared) map.dispose();
      material.dispose();
    }
  });
}

function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
