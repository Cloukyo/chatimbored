// Pile-Up's 3D world, drawn with Three.js: the track up on its ledge, the cars, everything thrown about, and the camera
// that frames the shared screen from high up and behind, the way Mashed did. The 2D overlay in draw.ts sits on top of it.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LOCKING_WEAPONS, type RaceCar, type RaceShot, type RaceView } from "../../../shared/race/protocol.js";
import { screenCorners, type ScreenView } from "../../../shared/race/camera.js";
import { VERGE_WIDTH, locate, pointAt, trackById, type Track, type TrackTheme } from "../../../shared/race/track.js";

export const CAR_COLORS = ["#ff5a4e", "#3fa7ff", "#7bd33f", "#ffcf3f", "#c77dff", "#ff8c2e", "#2fe0c8", "#ff7ac3"];

// The road sits on a ledge this far above the ground, so going over a drop edge is a real fall.
const DROP = 90;
// The camera looks down at this angle from behind the pack.
const PITCH = (50 * Math.PI) / 180;
const FOV = 40;
const MAX_PARTICLES = 900;
const MAX_SKIDS = 1400;
const YEET_S = 1.6;

// Every car in a match gets its own body, by its colour slot.
const BODIES = ["muscle", "buggy", "van", "mini"] as const;

type Theme = { ground: string; sky: string; verge: string; road: string; rim: string; cliff: string; dash: string };
const THEMES: Record<TrackTheme, Theme> = {
  quarry: { ground: "#3b2a1c", sky: "#21170f", verge: "#b98a52", road: "#5d5a58", rim: "#e0b276", cliff: "#7a5532", dash: "#b9b7b4" },
  harbour: { ground: "#1d5f8c", sky: "#123d5c", verge: "#d8c58e", road: "#4f5560", rim: "#f2f2f2", cliff: "#6f737b", dash: "#b5b8bd" },
  summit: { ground: "#3a4c6e", sky: "#1c2638", verge: "#e9f1f7", road: "#596170", rim: "#ffffff", cliff: "#5b6474", dash: "#c2c6cd" },
};

export type Particle = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; color: string; grow: number };
export type Caption = { text: string; x: number; y: number; life: number };
export type ScreenPoint = { x: number; y: number; behind: boolean };

type CarModel = {
  root: THREE.Group;
  materials: THREE.Material[];
  pupils: Array<{ mesh: THREE.Mesh; center: THREE.Vector3 }>;
  flame: THREE.Mesh;
  shadow: THREE.Mesh;
};

type Yeet = { model: CarModel; from: THREE.Vector3; life: number; spin: THREE.Vector3; text: string };

// Shared shapes, scaled per use. Never disposed.
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  wheel: new THREE.CylinderGeometry(1, 1, 1, 14).rotateX(Math.PI / 2),
  drum: new THREE.CylinderGeometry(1, 1, 1, 14),
  sphere: new THREE.SphereGeometry(1, 16, 12),
  // Points along +x.
  cone: new THREE.ConeGeometry(1, 1, 12).rotateZ(-Math.PI / 2),
  // Lying flat on the ground.
  flat: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  ring: new THREE.RingGeometry(0.84, 1, 40).rotateX(-Math.PI / 2),
  bit: new THREE.IcosahedronGeometry(1, 0),
};
for (const geometry of Object.values(GEO)) geometry.userData.shared = true;

const colors = new Map<string, THREE.Color>();
function colorOf(style: string): THREE.Color {
  let color = colors.get(style);
  if (!color) {
    // Particles use rgba() for see-through smoke; the 3D version draws them solid.
    const rgba = /^rgba?\(([^)]+)\)$/.exec(style);
    color = rgba ? new THREE.Color().setRGB(...(rgba[1].split(",").slice(0, 3).map((part) => Number(part) / 255) as [number, number, number]), THREE.SRGBColorSpace) : new THREE.Color(style);
    colors.set(style, color);
  }
  return color;
}

export class World3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 40, 30000);
  private readonly point = new THREE.Vector3();
  private trackId = "";
  private trackGroup?: THREE.Group;
  private readonly cars = new Map<string, CarModel>();
  private readonly shots = new Map<number, THREE.Object3D>();
  private readonly targets = new Map<number, THREE.Mesh>();
  private readonly mines = new Map<number, THREE.Group>();
  private readonly slicks = new Map<number, THREE.Group>();
  private readonly crates = new Map<number, THREE.Mesh>();
  private readonly sights = new Map<string, THREE.Group>();
  private readonly crosshairs = new Map<string, THREE.Group>();
  private particles: Particle[] = [];
  private readonly particleMesh: THREE.InstancedMesh;
  private readonly skidMesh: THREE.Mesh;
  private readonly skidPositions = new Float32Array(MAX_SKIDS * 18);
  private skidNext = 0;
  private yeets: Yeet[] = [];
  private fitDistance = 1400;
  private fitOffset = 0;
  private width = 0;
  private height = 0;
  private readonly crateMaterial: THREE.Material;
  private readonly shadowTexture: THREE.Texture;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#8a7a6a", 2.1));
    const sun = new THREE.DirectionalLight("#fff6e6", 2.0);
    sun.position.set(-0.45, 1, 0.35);
    this.scene.add(sun);

    this.particleMesh = new THREE.InstancedMesh(GEO.bit, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, depthWrite: false }), MAX_PARTICLES);
    this.particleMesh.frustumCulled = false;
    this.particleMesh.count = 0;
    this.particleMesh.renderOrder = 3;
    this.scene.add(this.particleMesh);

    const skids = new THREE.BufferGeometry();
    skids.setAttribute("position", new THREE.BufferAttribute(this.skidPositions, 3));
    this.skidMesh = new THREE.Mesh(skids, new THREE.MeshBasicMaterial({ color: "#141414", transparent: true, opacity: 0.32, depthWrite: false }));
    this.skidMesh.frustumCulled = false;
    this.skidMesh.renderOrder = 1;
    this.scene.add(this.skidMesh);

    this.shadowTexture = radialTexture();
    const question = labelTexture("?", "#c8873e", "#fff4c2", "#5a3510");
    this.crateMaterial = new THREE.MeshLambertMaterial({ map: question });
  }

  // Throws when the browser has no WebGL; the caller shows a message instead.
  static create(canvas: HTMLCanvasElement): World3D | undefined {
    try {
      return new World3D(canvas);
    } catch {
      return undefined;
    }
  }

  reset(): void {
    for (const pool of [this.shots, this.targets, this.mines, this.slicks, this.crates, this.sights, this.crosshairs] as Array<Map<unknown, THREE.Object3D>>) {
      for (const object of pool.values()) this.drop(object);
      pool.clear();
    }
    for (const model of this.cars.values()) this.dropCar(model);
    this.cars.clear();
    for (const yeet of this.yeets) this.dropCar(yeet.model);
    this.yeets = [];
    this.particles = [];
    this.skidPositions.fill(0);
    this.skidNext = 0;
    this.skidMesh.geometry.getAttribute("position").needsUpdate = true;
  }

  addParticle(particle: Particle): void {
    this.particles.push(particle);
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  // A tyre mark from one rear wheel's last spot to where it is now.
  addSkid(x1: number, y1: number, x2: number, y2: number): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * 2.6;
    const ny = (dx / length) * 2.6;
    const y = 0.9;
    const corners = [
      [x1 - nx, y1 - ny],
      [x1 + nx, y1 + ny],
      [x2 + nx, y2 + ny],
      [x2 - nx, y2 - ny],
    ];
    const order = [0, 1, 2, 0, 2, 3];
    const base = this.skidNext * 18;
    order.forEach((corner, index) => {
      this.skidPositions[base + index * 3] = corners[corner][0];
      this.skidPositions[base + index * 3 + 1] = y;
      this.skidPositions[base + index * 3 + 2] = corners[corner][1];
    });
    this.skidNext = (this.skidNext + 1) % MAX_SKIDS;
    this.skidMesh.geometry.getAttribute("position").needsUpdate = true;
  }

  // A knocked-out car flies out of the world and straight at the camera.
  yeet(car: RaceCar, text: string): void {
    const model = buildCar(car.color, this.shadowTexture);
    model.shadow.visible = false;
    this.scene.add(model.root);
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(10 + Math.random() * 8);
    this.yeets.push({ model, from: new THREE.Vector3(car.x, Math.max(10, car.z + 10), car.y), life: YEET_S, spin, text });
  }

  // Where a world point lands on the screen, from 0 to 1 across and down.
  project(x: number, y: number, z: number): ScreenPoint {
    const point = this.point.set(x, z, y).project(this.camera);
    return { x: (point.x + 1) / 2, y: (1 - point.y) / 2, behind: point.z > 1 };
  }

  captions(): Caption[] {
    return this.yeets.map((yeet) => {
      const spot = this.point.copy(yeet.model.root.position).project(this.camera);
      return { text: yeet.text, x: (spot.x + 1) / 2, y: (1 - spot.y) / 2, life: yeet.life };
    });
  }

  render(view: RaceView, now: number, dt: number, shake: { x: number; y: number }, fall: (car: RaceCar) => number, eyes: (car: RaceCar) => { x: number; y: number }): void {
    this.resize();
    this.useTrack(view.trackId);
    this.fit(view.view);
    if (shake.x || shake.y) {
      this.camera.position.x += shake.x;
      this.camera.position.z += shake.y;
      this.camera.updateMatrixWorld();
    }
    this.syncCars(view, now, fall, eyes);
    this.syncShots(view, now);
    this.syncProps(view, now);
    this.updateParticles(dt);
    this.updateYeets(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // Frame the server's screen: the whole of it must be in shot, since leaving it is what knocks a car out. The camera sits
  // behind it, facing the way the server's camera faces, so the screen's trapezoid shows as (nearly) the whole window.
  // A few rounds of adjusting distance and aim settle it.
  private fit(view: ScreenView): void {
    let distance = this.fitDistance;
    let offset = this.fitOffset;
    const corners = screenCorners(view);
    for (let round = 0; round < 4; round += 1) {
      this.place(view, offset, distance);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const corner of corners) {
        const point = this.point.set(corner.x, 0, corner.y).project(this.camera);
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
      const spanY = Math.max(0.01, maxY - minY);
      offset += ((maxY + minY) / 2) * (view.height / spanY);
      distance *= Math.max((maxX - minX) / 1.98, spanY / 1.96);
    }
    this.fitDistance = Math.min(20000, Math.max(200, distance));
    this.fitOffset = offset;
    this.place(view, offset, this.fitDistance);
  }

  // Looks at a point `offset` up the screen from its middle, from `distance` away, behind and above.
  private place(view: ScreenView, offset: number, distance: number): void {
    const forwardX = Math.cos(view.angle);
    const forwardY = Math.sin(view.angle);
    const x = view.x + forwardX * offset;
    const y = view.y + forwardY * offset;
    const back = Math.cos(PITCH) * distance;
    this.camera.position.set(x - forwardX * back, Math.sin(PITCH) * distance, y - forwardY * back);
    this.camera.lookAt(x, 0, y);
    this.camera.updateMatrixWorld();
  }

  private useTrack(trackId: string): void {
    if (trackId === this.trackId) return;
    this.trackId = trackId;
    if (this.trackGroup) this.drop(this.trackGroup);
    const track = trackById(trackId);
    const theme = THEMES[track.def.theme];
    this.scene.background = colorOf(theme.sky);
    this.trackGroup = buildTrack(track, theme);
    this.scene.add(this.trackGroup);
    this.skidPositions.fill(0);
    this.skidMesh.geometry.getAttribute("position").needsUpdate = true;
  }

  private syncCars(view: RaceView, now: number, fall: (car: RaceCar) => number, eyes: (car: RaceCar) => { x: number; y: number }): void {
    const seen = new Set<string>();
    for (const car of view.cars) {
      seen.add(car.id);
      let model = this.cars.get(car.id);
      if (!model) {
        model = buildCar(car.color, this.shadowTexture);
        this.scene.add(model.root, model.shadow);
        this.cars.set(car.id, model);
      }
      const shown = car.state !== "out";
      model.root.visible = shown;
      model.shadow.visible = shown && car.state === "driving";
      if (!shown) continue;
      const falling = 1 - fall(car);
      model.root.position.set(car.x, car.z + 8 - falling * falling * DROP * 1.4, car.y);
      model.root.rotation.set(car.roll + falling * 7, -car.angle + falling * 3, 0, "YXZ");
      const ghost = car.ghost ? (Math.floor(now / 90) % 2 === 0 ? 0.3 : 0.8) : 1;
      for (const material of model.materials) {
        material.transparent = ghost < 1;
        material.opacity = ghost;
      }
      model.flame.visible = car.boosting;
      if (car.boosting) {
        const length = 10 + Math.random() * 14;
        model.flame.scale.set(length, 4, 4);
        model.flame.position.set(-17 - length / 2, 8, 0);
      }
      // Pupils sit on the front of each eyeball, looking up at the camera, and roll about with every bump.
      const look = eyes(car);
      for (const pupil of model.pupils) {
        const direction = this.point.set(0.55 + look.x * 0.3, 1, look.y * 0.3).normalize().multiplyScalar(3.4);
        pupil.mesh.position.copy(pupil.center).add(direction);
      }
      const lift = 1 / (1 + car.z / 160);
      model.shadow.position.set(car.x + 3, 0.7, car.y + 4);
      model.shadow.rotation.y = -car.angle;
      model.shadow.scale.set(44 * lift, 1, 30 * lift);
    }
    for (const [id, model] of this.cars) {
      if (seen.has(id)) continue;
      this.dropCar(model);
      this.cars.delete(id);
    }
  }

  private syncShots(view: RaceView, now: number): void {
    sync(this.scene, this.shots, view.shots, (shot) => shot.id, makeShot, (object, shot) => {
      const flying = shot.kind === "mortar" || shot.kind === "strike";
      object.position.set(shot.x, flying ? shot.z + 8 : shot.kind === "drum" ? 10 : 9, shot.y);
      object.rotation.y = -shot.angle;
      if (shot.kind === "strike" || shot.kind === "mortar") object.rotation.z = Math.sin(now / 90) * 0.2;
      if (shot.kind === "drum") object.rotation.z = Math.PI / 2;
      if (shot.kind === "drum") {
        const material = (object as THREE.Mesh).material as THREE.MeshLambertMaterial;
        material.color.set(Math.floor(now / 120) % 2 === 0 ? "#d8322a" : "#8c1b16");
      }
      if (shot.kind === "missile") {
        this.addParticle({ x: shot.x - Math.cos(shot.angle) * 14, y: shot.y - Math.sin(shot.angle) * 14, z: 9, vx: 0, vy: 0, vz: 10, life: 0.5, max: 0.5, size: 4, color: "#d9d9d9", grow: 10 });
      }
    });
    // Where a lobbed mortar or an air strike is about to land.
    const landing = view.shots.filter((shot) => (shot.kind === "mortar" || shot.kind === "strike") && shot.tx !== undefined);
    sync(this.scene, this.targets, landing, (shot) => shot.id, (shot) => {
      const ring = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: shot.kind === "strike" ? "#ff2828" : "#ffc828", transparent: true, opacity: 0.9, depthWrite: false }));
      ring.renderOrder = 2;
      return ring;
    }, (ring, shot) => {
      const pulse = 30 * (1 + Math.sin(now / 60) * 0.12);
      ring.position.set(shot.tx!, 1.4, shot.ty!);
      ring.scale.set(pulse, 1, pulse);
    });
  }

  private syncProps(view: RaceView, now: number): void {
    sync(this.scene, this.crates, view.crates, (crate) => crate.id, () => new THREE.Mesh(GEO.box, this.crateMaterial), (mesh, crate) => {
      mesh.scale.setScalar(24);
      mesh.position.set(crate.x, 16 + Math.sin(now / 250 + crate.x) * 4, crate.y);
      mesh.rotation.set(0.25, now / 700 + crate.id, 0.15);
    }, false);
    sync(this.scene, this.mines, view.mines, (mine) => mine.id, makeMine, (group, mine) => {
      group.position.set(mine.x, 0, mine.y);
      const light = group.children[1] as THREE.Mesh;
      (light.material as THREE.MeshBasicMaterial).color.set(mine.armed && Math.floor(now / 250) % 2 === 0 ? "#ff3b2f" : "#661410");
    });
    sync(this.scene, this.slicks, view.slicks, (slick) => slick.id, (slick) => makeSlick(slick.id), (group, slick) => {
      group.position.set(slick.x, 0, slick.y);
      group.scale.set(slick.radius, 1, slick.radius);
    });
    // Laser sights on the lock-on weapons: green while searching, red on a target.
    const aiming = view.cars.filter((car) => car.state === "driving" && car.weapon && LOCKING_WEAPONS.includes(car.weapon));
    sync(this.scene, this.sights, aiming, (car) => car.id, makeSight, (group, car) => {
      const target = car.lock ? view.cars.find((other) => other.id === car.lock) : undefined;
      const beam = group.children[0] as THREE.Mesh;
      const ring = group.children[1] as THREE.Mesh;
      const toX = target ? target.x : car.x + Math.cos(car.angle) * 260;
      const toY = target ? target.y : car.y + Math.sin(car.angle) * 260;
      stretch(beam, car.x, car.y, toX, toY, 2.4, 6);
      (beam.material as THREE.MeshBasicMaterial).color.set(target ? "#ff2828" : "#5aff5a");
      (beam.material as THREE.MeshBasicMaterial).opacity = target ? 0.85 : 0.5;
      ring.visible = Boolean(target);
      if (target) ring.position.set(target.x, 2, target.y);
    });
    // A knocked-out player's air-strike sight, in their colour.
    const striking = view.cars.filter((car) => car.strike);
    sync(this.scene, this.crosshairs, striking, (car) => car.id, (car) => makeCrosshair(CAR_COLORS[car.color % CAR_COLORS.length]), (group, car) => {
      const strike = car.strike!;
      const size = strike.ready ? 26 + Math.sin(now / 120) * 4 : 20;
      group.position.set(strike.x, 2.2, strike.y);
      group.scale.set(size, 1, size);
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) (child.material as THREE.MeshBasicMaterial).opacity = strike.ready ? 1 : 0.45;
      });
    });
  }

  private updateParticles(dt: number): void {
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const damping = Math.exp(-3 * dt);
    let count = 0;
    for (const particle of this.particles) {
      particle.life -= dt;
      if (particle.life <= 0) continue;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z = Math.max(0, particle.z + particle.vz * dt);
      particle.vx *= damping;
      particle.vy *= damping;
      particle.vz *= damping;
      particle.size = Math.max(0.5, particle.size + particle.grow * dt);
      const size = particle.size * (0.35 + 0.65 * (particle.life / particle.max));
      rotation.setFromEuler(new THREE.Euler(particle.x * 0.1, particle.y * 0.1, 0));
      matrix.compose(this.point.set(particle.x, particle.z + 2, particle.y), rotation, scale.setScalar(size));
      this.particleMesh.setMatrixAt(count, matrix);
      this.particleMesh.setColorAt(count, colorOf(particle.color));
      count += 1;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
    this.particleMesh.count = count;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true;
  }

  private updateYeets(dt: number): void {
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    for (const yeet of this.yeets) {
      yeet.life -= dt;
      const t = Math.min(1, 1 - yeet.life / YEET_S);
      // Up in a hop, then straight into the lens.
      const target = this.camera.position.clone().addScaledVector(forward, 90);
      const position = yeet.from.clone().lerp(target, t * t * 0.97);
      position.y += Math.sin(Math.PI * Math.min(1, t * 1.4)) * 140 * (1 - t);
      yeet.model.root.position.copy(position);
      yeet.model.root.rotation.set(yeet.spin.x * t, yeet.spin.y * t, yeet.spin.z * t);
    }
    for (const yeet of this.yeets.filter((each) => each.life <= 0)) this.dropCar(yeet.model);
    this.yeets = this.yeets.filter((yeet) => yeet.life > 0);
  }

  private dropCar(model: CarModel): void {
    this.drop(model.root);
    this.drop(model.shadow);
  }

  private drop(object: THREE.Object3D): void {
    this.scene.remove(object);
    disposeTree(object);
  }
}

// Keeps one 3D object per item, adding new ones and removing those that are gone.
function sync<T, K, O extends THREE.Object3D>(scene: THREE.Scene, pool: Map<K, O>, items: T[], key: (item: T) => K, make: (item: T) => O, update: (object: O, item: T) => void, dispose = true): void {
  const seen = new Set<K>();
  for (const item of items) {
    const id = key(item);
    seen.add(id);
    let object = pool.get(id);
    if (!object) {
      object = make(item);
      scene.add(object);
      pool.set(id, object);
    }
    update(object, item);
  }
  for (const [id, object] of pool) {
    if (seen.has(id)) continue;
    scene.remove(object);
    if (dispose) disposeTree(object);
    pool.delete(id);
  }
}

function disposeTree(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (!child.geometry.userData.shared) child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (!material.userData.shared) material.dispose();
    }
  });
}

// A flat strip along the ground from one point to another.
function stretch(mesh: THREE.Mesh, x1: number, y1: number, x2: number, y2: number, width: number, height: number): void {
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  mesh.position.set((x1 + x2) / 2, height, (y1 + y2) / 2);
  mesh.rotation.y = -Math.atan2(y2 - y1, x2 - x1);
  mesh.scale.set(length, 1, width);
}

function box(parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, width: number, height: number, depth: number): THREE.Mesh {
  const mesh = new THREE.Mesh(GEO.box, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(width, height, depth);
  parent.add(mesh);
  return mesh;
}

// The cars: chunky toy shapes with big googly eyes.
function buildCar(colorIndex: number, shadowTexture: THREE.Texture): CarModel {
  const paint = new THREE.MeshLambertMaterial({ color: CAR_COLORS[colorIndex % CAR_COLORS.length] });
  const dark = new THREE.MeshLambertMaterial({ color: "#1d1d1d" });
  const light = new THREE.MeshLambertMaterial({ color: "#f2f2f2" });
  const glass = new THREE.MeshLambertMaterial({ color: "#8fc9f2" });
  const white = new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#666666" });
  const black = new THREE.MeshBasicMaterial({ color: "#000000" });
  const fire = new THREE.MeshBasicMaterial({ color: "#ffb23f" });
  const root = new THREE.Group();
  const body = new THREE.Group();
  // A touch bigger than the car's footprint in the game: chunky toys read better from up high.
  root.scale.setScalar(1.3);
  // The car tumbles about a point a little above the road.
  body.position.y = -8;
  root.add(body);
  const kind = BODIES[colorIndex % BODIES.length];
  let wheel = 5;
  let eyeX = 6;
  let eyeY = 16;
  if (kind === "muscle") {
    box(body, paint, 0, 7, 0, 34, 8, 19);
    box(body, paint, -4, 13.5, 0, 15, 6, 15);
    box(body, glass, 3.6, 13.3, 0, 1, 5, 14);
    box(body, light, 0, 11.2, -3, 34.4, 0.6, 2.4);
    box(body, light, 0, 11.2, 3, 34.4, 0.6, 2.4);
    box(body, dark, -16.5, 12.5, 0, 3, 1.5, 18);
    eyeX = 4;
    eyeY = 17;
  } else if (kind === "buggy") {
    wheel = 6.5;
    box(body, paint, 0, 7, 0, 28, 5, 15);
    box(body, paint, 10, 9.5, 0, 8, 3, 13);
    for (const [x, z] of [[-8, -6], [-8, 6], [4, -6], [4, 6]]) box(body, dark, x, 13.5, z, 1.6, 9, 1.6);
    box(body, dark, -2, 18, -6, 13.6, 1.6, 1.6);
    box(body, dark, -2, 18, 6, 13.6, 1.6, 1.6);
    box(body, dark, -2, 18, 0, 1.6, 1.6, 13.6);
    eyeX = 9;
    eyeY = 13;
  } else if (kind === "van") {
    box(body, paint, 0, 12, 0, 34, 17, 19);
    box(body, glass, 16.6, 15, 0, 1, 6, 16);
    box(body, light, -2, 20.8, 0, 26, 0.8, 15);
    eyeX = 13;
    eyeY = 23;
  } else {
    box(body, paint, 0, 7.5, 0, 28, 9, 18);
    box(body, light, -2, 14.5, 0, 14, 5, 15);
    box(body, glass, 5.2, 14, 0, 1, 4, 14);
    eyeX = 6;
    eyeY = 19;
  }
  for (const [x, z] of [[-10, -10.5], [10, -10.5], [-10, 10.5], [10, 10.5]]) {
    const tyre = new THREE.Mesh(GEO.wheel, dark);
    tyre.position.set(x, wheel, z);
    tyre.scale.set(wheel, wheel, 4.5);
    body.add(tyre);
  }
  const pupils: CarModel["pupils"] = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(GEO.sphere, white);
    eye.position.set(eyeX, eyeY, side * 4.9);
    eye.scale.setScalar(4.8);
    body.add(eye);
    const pupil = new THREE.Mesh(GEO.sphere, black);
    pupil.scale.setScalar(2.3);
    body.add(pupil);
    pupils.push({ mesh: pupil, center: eye.position.clone() });
  }
  // Points backwards out of the exhaust; its length is set every frame while boosting.
  const flame = new THREE.Mesh(GEO.cone, fire);
  flame.rotation.y = Math.PI;
  flame.visible = false;
  body.add(flame);
  const shadow = new THREE.Mesh(GEO.flat, new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
  shadow.renderOrder = 1;
  return { root, materials: [paint, dark, light, glass, white, black], pupils, flame, shadow };
}

function makeShot(shot: RaceShot): THREE.Object3D {
  const group = new THREE.Group();
  switch (shot.kind) {
    case "bullet": {
      box(group, new THREE.MeshBasicMaterial({ color: "#ffe36b" }), -6, 0, 0, 16, 2.2, 2.2);
      break;
    }
    case "missile": {
      box(group, new THREE.MeshLambertMaterial({ color: "#dddddd" }), 0, 0, 0, 20, 6, 6);
      const nose = new THREE.Mesh(GEO.cone, new THREE.MeshLambertMaterial({ color: "#e0312b" }));
      nose.position.set(13, 0, 0);
      nose.scale.set(6, 3.4, 3.4);
      group.add(nose);
      box(group, new THREE.MeshLambertMaterial({ color: "#e0312b" }), -9, 0, 0, 4, 1, 12);
      const flame = new THREE.Mesh(GEO.cone, new THREE.MeshBasicMaterial({ color: "#ffb23f" }));
      flame.rotation.y = Math.PI;
      flame.position.set(-14, 0, 0);
      flame.scale.set(9, 2.6, 2.6);
      group.add(flame);
      break;
    }
    case "mortar": {
      const ball = new THREE.Mesh(GEO.sphere, new THREE.MeshLambertMaterial({ color: "#333333" }));
      ball.scale.setScalar(8);
      group.add(ball);
      break;
    }
    case "strike": {
      const bomb = new THREE.Mesh(GEO.sphere, new THREE.MeshLambertMaterial({ color: "#444444" }));
      bomb.scale.set(9, 12, 9);
      group.add(bomb);
      box(group, new THREE.MeshLambertMaterial({ color: "#e0312b" }), 0, 13, 0, 12, 4, 1.2);
      box(group, new THREE.MeshLambertMaterial({ color: "#e0312b" }), 0, 13, 0, 1.2, 4, 12);
      break;
    }
    case "drum": {
      const drum = new THREE.Mesh(GEO.drum, new THREE.MeshLambertMaterial({ color: "#d8322a" }));
      drum.scale.set(9, 22, 9);
      return drum;
    }
  }
  return group;
}

function makeMine(): THREE.Group {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(GEO.drum, new THREE.MeshLambertMaterial({ color: "#2a2a2a" }));
  shell.position.y = 2.5;
  shell.scale.set(10, 5, 10);
  const light = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: "#661410" }));
  light.position.y = 6;
  light.scale.setScalar(3.6);
  group.add(shell, light);
  return group;
}

// A lumpy puddle that keeps its shape, with an oily sheen.
function makeSlick(seed: number): THREE.Group {
  const group = new THREE.Group();
  const lumpy = (scale: number, offset: number) => {
    const shape = new THREE.Shape();
    for (let index = 0; index <= 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      const radius = scale * (0.75 + hash(seed + offset, index) * 0.35);
      if (index === 0) shape.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      else shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    return new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
  };
  const pool = new THREE.Mesh(lumpy(1, 0), new THREE.MeshBasicMaterial({ color: "#0a0a0e", transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide }));
  pool.position.y = 1.1;
  const sheen = new THREE.Mesh(lumpy(0.45, 3), new THREE.MeshBasicMaterial({ color: "#5a46a0", transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
  sheen.position.set(-0.2, 1.3, -0.15);
  pool.renderOrder = 1;
  sheen.renderOrder = 2;
  group.add(pool, sheen);
  return group;
}

function makeSight(): THREE.Group {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(GEO.flat, new THREE.MeshBasicMaterial({ color: "#5aff5a", transparent: true, opacity: 0.5, depthWrite: false }));
  const ring = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: "#ff2828", transparent: true, opacity: 0.95, depthWrite: false }));
  ring.scale.set(24, 1, 24);
  beam.renderOrder = 2;
  ring.renderOrder = 2;
  group.add(beam, ring);
  return group;
}

function makeCrosshair(color: string): THREE.Group {
  const group = new THREE.Group();
  const material = () => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
  const ring = new THREE.Mesh(GEO.ring, material());
  group.add(ring);
  for (const angle of [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2]) {
    const tick = new THREE.Mesh(GEO.flat, material());
    tick.position.set(Math.cos(angle) * 0.95, 0, Math.sin(angle) * 0.95);
    tick.rotation.y = -angle;
    tick.scale.set(0.9, 1, 0.12);
    group.add(tick);
  }
  group.traverse((child) => (child.renderOrder = 4));
  return group;
}

// The track: road and verges on a ledge, cliffs down to the ground, tyre walls and the drop edges' white rim, plus scenery.
function buildTrack(track: Track, theme: Theme): THREE.Group {
  const group = new THREE.Group();
  const samples = track.samples;
  const count = samples.length;
  const at = (index: number, offset: number): [number, number] => {
    const sample = samples[index];
    return [sample.x - sample.ty * offset, sample.y + sample.tx * offset];
  };
  const outer = (index: number) => samples[index].halfWidth + VERGE_WIDTH;

  const flat: number[] = [];
  const flatColors: number[] = [];
  const ribbon = (from: (index: number) => number, to: (index: number) => number, height: number, color: string, include: (index: number) => boolean = () => true) => {
    const paint = colorOf(color);
    for (let index = 0; index < count; index += 1) {
      if (!include(index)) continue;
      const next = (index + 1) % count;
      const a1 = at(index, from(index));
      const a2 = at(index, to(index));
      const b1 = at(next, from(next));
      const b2 = at(next, to(next));
      for (const triangle of [[a1, b1, b2], [a1, b2, a2]]) {
        // Wind every triangle to face up, so the lighting treats it as the top side.
        const [p, q, r] = triangle;
        const up = (q[1] - p[1]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[1] - p[1]);
        for (const [x, y] of up >= 0 ? [p, q, r] : [p, r, q]) {
          flat.push(x, height, y);
          flatColors.push(paint.r, paint.g, paint.b);
        }
      }
    }
  };
  ribbon((index) => -outer(index), (index) => outer(index), 0, theme.verge);
  ribbon((index) => -samples[index].halfWidth, (index) => samples[index].halfWidth, 0.6, theme.road);
  ribbon(() => -2, () => 2, 1.1, theme.dash, (index) => Math.floor(samples[index].s / 28) % 2 === 0);
  for (const side of [-1, 1]) {
    ribbon((index) => side * (outer(index) - 5), (index) => side * outer(index), 1, theme.rim, (index) => samples[index].edge === "drop");
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3));
  top.setAttribute("normal", new THREE.Float32BufferAttribute(flat.map((_, index) => (index % 3 === 1 ? 1 : 0)), 3));
  top.setAttribute("color", new THREE.Float32BufferAttribute(flatColors, 3));

  // Cliff faces from the edge of the verge down to the ground.
  const cliff: number[] = [];
  for (const side of [-1, 1]) {
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      const [ax, ay] = at(index, side * outer(index));
      const [bx, by] = at(next, side * outer(next));
      cliff.push(ax, 0, ay, bx, 0, by, bx, -DROP, by, ax, 0, ay, bx, -DROP, by, ax, -DROP, ay);
    }
  }
  const cliffs = new THREE.BufferGeometry();
  cliffs.setAttribute("position", new THREE.Float32BufferAttribute(cliff, 3));
  cliffs.computeVertexNormals();
  paintAll(cliffs, theme.cliff);

  // Tyre walls, red and white, wherever the edge is a wall.
  const walls: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      if (samples[index].edge !== "wall" || samples[next].edge !== "wall") continue;
      const [ax, ay] = at(index, side * (outer(index) + 6));
      const [bx, by] = at(next, side * (outer(next) + 6));
      const length = Math.hypot(bx - ax, by - ay);
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3((ax + bx) / 2, 7, (ay + by) / 2),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.atan2(by - ay, bx - ax), 0)),
        new THREE.Vector3(length + 1, 14, 12),
      );
      walls.push(piece(GEO.box, index % 2 === 0 ? "#e0312b" : "#ececec", matrix));
    }
  }

  // The chequered start line.
  const start = pointAt(track, 0);
  const line = new THREE.Mesh(GEO.flat, new THREE.MeshLambertMaterial({ map: checkerTexture() }));
  line.position.set(start.x, 1.3, start.y);
  line.rotation.y = -Math.atan2(start.ty, start.tx);
  line.scale.set(24, 1, start.halfWidth * 2);
  group.add(line);

  const parts = [top, cliffs, ...walls, ...scenery(track, theme)];
  const merged = mergeGeometries(parts.map((part) => stripTo(part)));
  for (const part of parts) part.dispose();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(merged, material));

  // The ground (or the sea) far below the road.
  const xs = samples.map((sample) => sample.x);
  const ys = samples.map((sample) => sample.y);
  const middleX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const middleY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 12000;
  const ground = new THREE.Mesh(GEO.flat, new THREE.MeshLambertMaterial({ color: theme.ground }));
  ground.position.set(middleX, -DROP, middleY);
  ground.scale.set(span, 1, span);
  group.add(ground);
  return group;
}

// Every geometry merged into the track needs the same attributes: position, normal and colour, no index.
function stripTo(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "color") geometry.deleteAttribute(name);
  }
  return geometry;
}

function piece(source: THREE.BufferGeometry, color: string, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.applyMatrix4(matrix);
  paintAll(geometry, color);
  return stripTo(geometry);
}

function paintAll(geometry: THREE.BufferGeometry, color: string): void {
  const paint = colorOf(color);
  const total = geometry.getAttribute("position").count;
  const values = new Float32Array(total * 3);
  for (let index = 0; index < total; index += 1) values.set([paint.r, paint.g, paint.b], index * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
}

const ICOSA = new THREE.IcosahedronGeometry(1, 0);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 10);
const CONE = new THREE.ConeGeometry(1, 1, 8);
const BALL = new THREE.SphereGeometry(1, 10, 8);

// Scenery down on the ground, placed the same way every time so every player sees the same world.
function scenery(track: Track, theme: Theme): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const samples = track.samples;
  const xs = samples.map((sample) => sample.x);
  const ys = samples.map((sample) => sample.y);
  const minX = Math.min(...xs) - 700;
  const maxX = Math.max(...xs) + 700;
  const minY = Math.min(...ys) - 700;
  const maxY = Math.max(...ys) + 700;
  const place = (x: number, y: number, size: number, turn: number) => (geometry: THREE.BufferGeometry, color: string, dx: number, dy: number, dz: number, sx: number, sy: number, sz: number, tilt = 0) => {
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x + (dx * cos - dz * sin) * size, -DROP + dy * size, y + (dx * sin + dz * cos) * size),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, -turn, 0)),
      new THREE.Vector3(sx * size, sy * size, sz * size),
    );
    parts.push(piece(geometry, color, matrix));
  };
  for (let x = minX; x < maxX; x += 170) {
    for (let y = minY; y < maxY; y += 170) {
      const px = x + hash(x, y) * 120;
      const py = y + hash(y, x) * 120;
      if (hash(px, py) > 0.45) continue;
      const spot = locate(track, px, py);
      const clear = spot.sample.halfWidth + VERGE_WIDTH + 50;
      if (Math.abs(spot.offset) < clear || Math.hypot(spot.sample.x - px, spot.sample.y - py) < clear) continue;
      const roll = hash(px + 1, py);
      const size = 1 + hash(py, px + 2) * 0.8;
      const add = place(px, py, size, hash(px, py + 5) * Math.PI * 2);
      if (track.def.theme === "quarry") {
        if (roll < 0.55) add(ICOSA, roll < 0.3 ? "#8a7a66" : "#6e5a45", 0, 10, 0, 22, 16, 18);
        else if (roll < 0.8) {
          add(GEO.box, "#ffcf3f", 0, 16, 0, 44, 10, 5);
          add(GEO.box, "#1d1d1d", -16, 6, 0, 3, 12, 3);
          add(GEO.box, "#1d1d1d", 16, 6, 0, 3, 12, 3);
        } else add(CYLINDER, roll < 0.9 ? "#2d5fa8" : "#c0392b", 0, 11, 0, 9, 22, 9);
      } else if (track.def.theme === "harbour") {
        if (roll < 0.45) {
          add(GEO.box, roll < 0.25 ? "#f2f2f2" : "#c0392b", 0, 4, 0, 56, 10, 22);
          add(GEO.box, "#8a5a2b", -4, 10, 0, 36, 3, 16);
          add(GEO.box, "#5a3a1a", 4, 34, 0, 2, 50, 2);
          add(CONE, "#f6f1e4", 12, 34, 0, 0.6, 44, 16);
        } else if (roll < 0.75) {
          add(CYLINDER, "#e0312b", 0, 8, 0, 8, 16, 8);
          add(CYLINDER, "#ffffff", 0, 18, 0, 6, 6, 6);
        } else {
          add(BALL, "#8a6a3a", 0, 5, 0, 12, 7, 8);
          add(BALL, "#2f8a3a", 9, 12, 0, 5, 5, 5);
          add(CONE, "#ff9f1c", 15, 12, 0, 2, 5, 2, Math.PI / 2);
        }
      } else if (roll < 0.6) {
        add(CYLINDER, "#5a3a1a", 0, 8, 0, 4, 16, 4);
        add(CONE, "#1f6e3a", 0, 30, 0, 22, 30, 22);
        add(CONE, "#24804a", 0, 48, 0, 17, 26, 17);
        add(CONE, "#ffffff", 0, 63, 0, 9, 12, 9);
      } else if (roll < 0.8) {
        add(BALL, "#ffffff", 0, 13, 0, 14, 13, 14);
        add(BALL, "#ffffff", 0, 33, 0, 10, 10, 10);
        add(BALL, "#ffffff", 0, 48, 0, 7, 7, 7);
        add(CONE, "#ff8c2e", 8, 48, 0, 2, 7, 2, Math.PI / 2);
      } else add(ICOSA, "#7a8496", 0, 10, 0, 24, 16, 20);
    }
  }
  void theme;
  return parts;
}

function radialTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0,0,0,0.55)");
  gradient.addColorStop(0.7, "rgba(0,0,0,0.35)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function labelTexture(text: string, background: string, ink: string, edge: string): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 56, 56);
  ctx.fillStyle = ink;
  ctx.font = "bold 44px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 32, 35);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function checkerTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      ctx.fillStyle = (row + column) % 2 === 0 ? "#ffffff" : "#111111";
      ctx.fillRect(column * 16, row * 16, 16, 16);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

export function hash(a: number, b: number): number {
  const value = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
