// The Party Night board as a dollhouse: the mansion's nine rooms seen from above at a slight angle, with the roof off.
// Rooms on offer glow, claimed rooms fly their owner's pennant, and two rooms with the same owner open into each other.

import * as THREE from "three";
import type { MansionRoomKey } from "../../../shared/party/night.js";
import { type FloorStyle, paintFloor } from "../crowd/draw.js";

export type BoardRoom = {
  key: MansionRoomKey;
  col: number;
  row: number;
  name: string;
  detail: string;
  status: string;
  // The owner's colour, if someone has claimed it.
  owner?: string;
  offered: boolean;
  focused: boolean;
  played: boolean;
  closed: boolean;
  pickable: boolean;
};

const ROOM_W = 8;
const ROOM_D = 6;
const WALL = 0.3;
const BACK_WALL_HEIGHT = 2.2;
const INNER_WALL_HEIGHT = 1.1;
const FRONT_WALL_HEIGHT = 0.35;
const PITCH = (56 * Math.PI) / 180;
const FOV = 30;

const FLOORS: Record<MansionRoomKey, FloorStyle> = {
  bell_tower: "tower",
  gallery: "gallery",
  library: "library",
  garden: "garden",
  grand_hall: "hall",
  music_room: "music",
  terrace: "terrace",
  vault: "vault",
  post_room: "post",
};

const GOLD = new THREE.MeshStandardMaterial({ color: "#c9a14a", metalness: 1, roughness: 0.35 });
const WALL_MATERIAL = new THREE.MeshStandardMaterial({ color: "#3a0c16", roughness: 0.85 });
const WALL_TOP = new THREE.MeshStandardMaterial({ color: "#e9dcc0", roughness: 0.6 });
const WOOD = new THREE.MeshStandardMaterial({ color: "#4a2c18", roughness: 0.8 });

type RoomModel = {
  room: BoardRoom;
  group: THREE.Group;
  rim: THREE.Mesh[];
  rimMaterial: THREE.MeshStandardMaterial;
  cover: THREE.Mesh;
  coverMaterial: THREE.MeshBasicMaterial;
  pennant: THREE.Group;
  flag: THREE.Mesh;
  flagMaterial: THREE.MeshStandardMaterial;
  marker: THREE.Mesh;
  light: THREE.PointLight;
  label: HTMLElement;
};

export class MansionBoard {
  readonly element: HTMLElement;
  private readonly canvas = document.createElement("canvas");
  private readonly labels = document.createElement("div");
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 1, 300);
  private readonly models = new Map<MansionRoomKey, RoomModel>();
  private walls = new THREE.Group();
  private wallsKey = "";
  private frame?: number;
  private hovered?: MansionRoomKey;
  private width = 0;
  private height = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private constructor(private readonly onPick: (key: MansionRoomKey) => void) {
    this.element = document.createElement("div");
    this.element.className = "mansion-3d";
    this.labels.className = "mansion-labels";
    this.element.append(this.canvas, this.labels);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color("#0b0608");
    this.scene.add(new THREE.HemisphereLight("#7a5a68", "#1a0c08", 0.9));
    const key = new THREE.DirectionalLight("#ffe2b8", 2.2);
    key.position.set(-8, 30, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 80 });
    this.scene.add(key, this.walls);
    // The grounds around the house.
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#0d140e", roughness: 1 }));
    lawn.position.y = -0.05;
    lawn.receiveShadow = true;
    this.scene.add(lawn);

    this.canvas.addEventListener("pointermove", (event) => {
      this.hovered = this.roomAt(event)?.room.key;
      this.canvas.style.cursor = this.hovered && this.models.get(this.hovered)?.room.pickable ? "pointer" : "default";
    });
    this.canvas.addEventListener("pointerleave", () => (this.hovered = undefined));
    this.canvas.addEventListener("click", (event) => {
      const model = this.roomAt(event);
      if (model?.room.pickable) this.onPick(model.room.key);
    });
  }

  // Undefined when the browser has no WebGL; the board then stays a grid of buttons.
  static create(onPick: (key: MansionRoomKey) => void): MansionBoard | undefined {
    try {
      return new MansionBoard(onPick);
    } catch {
      return undefined;
    }
  }

  update(rooms: BoardRoom[]): void {
    for (const room of rooms) {
      let model = this.models.get(room.key);
      if (!model) {
        model = this.buildRoom(room);
        this.models.set(room.key, model);
      }
      model.room = room;
      model.label.querySelector("strong")!.textContent = room.name;
      model.label.querySelector(".board-detail")!.textContent = room.detail;
      model.label.querySelector(".board-status")!.textContent = room.status;
      model.label.classList.toggle("offered", room.offered);
      model.label.classList.toggle("focused", room.focused);
      model.label.classList.toggle("dim", (room.played && !room.owner) || room.closed);
      model.label.style.setProperty("--owner", room.owner ?? "transparent");
      model.label.classList.toggle("claimed", Boolean(room.owner));
    }
    const owners = rooms.map((room) => `${room.key}:${room.owner ?? ""}`).join(",");
    if (owners !== this.wallsKey) {
      this.wallsKey = owners;
      this.buildWalls(rooms);
    }
    this.start();
  }

  // Renders while the board is on screen, and stops by itself once it isn't.
  private start(): void {
    if (this.frame !== undefined) return;
    const loop = (now: number) => {
      if (!this.element.isConnected || this.element.offsetParent === null) {
        this.frame = undefined;
        return;
      }
      this.render(now);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  private render(now: number): void {
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.renderer.setSize(width, height, false);
      this.fit();
    }
    const t = now / 1000;
    for (const model of this.models.values()) {
      const { room } = model;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
      const lit = room.offered ? (room.focused || this.hovered === room.key ? 1 : 0.55 + pulse * 0.35) : 0;
      model.rimMaterial.emissiveIntensity = lit * 2.2;
      for (const rim of model.rim) rim.visible = room.offered;
      model.light.intensity = room.offered ? 6 + lit * 10 : room.owner ? 3 : 0;
      model.light.color.set(room.owner && !room.offered ? room.owner : "#ffc874");
      model.marker.visible = room.offered && (room.focused || this.hovered === room.key);
      model.marker.position.y = 2.2 + Math.sin(t * 4) * 0.15;
      model.marker.rotation.y = t * 2;
      // A wash of the owner's colour over a claimed room; dust sheets over rooms played and left unclaimed, or closed tonight.
      const cover = room.owner && !room.offered ? 0.28 : room.closed ? 0.72 : room.played && !room.owner ? 0.55 : room.offered ? 0 : 0.22;
      model.coverMaterial.color.set(room.owner && !room.offered ? room.owner : "#050304");
      model.coverMaterial.opacity = cover;
      model.cover.visible = cover > 0;
      model.pennant.visible = Boolean(room.owner);
      if (room.owner) {
        model.flagMaterial.color.set(room.owner);
        model.flag.rotation.y = Math.sin(t * 2.4 + room.col) * 0.25;
      }
      const at = this.project(model.group.position.x, 0, model.group.position.z + ROOM_D / 2 - 0.9);
      model.label.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%)`;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private project(x: number, y: number, z: number): { x: number; y: number } {
    const point = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((point.x + 1) / 2) * this.width, y: ((1 - point.y) / 2) * this.height };
  }

  private roomAt(event: PointerEvent): RoomModel | undefined {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
    if (!hit) return undefined;
    for (const model of this.models.values()) {
      const { x, z } = model.group.position;
      if (Math.abs(hit.x - x) <= ROOM_W / 2 && Math.abs(hit.z - z) <= ROOM_D / 2) return model;
    }
    return undefined;
  }

  // Pull the camera back until the whole house fits.
  private fit(): void {
    this.camera.aspect = this.width / Math.max(1, this.height);
    this.camera.updateProjectionMatrix();
    const halfW = (ROOM_W * 3) / 2 + WALL;
    const halfD = (ROOM_D * 3) / 2 + WALL;
    const corners = [
      new THREE.Vector3(-halfW, BACK_WALL_HEIGHT, -halfD),
      new THREE.Vector3(halfW, BACK_WALL_HEIGHT, -halfD),
      new THREE.Vector3(-halfW, 0, halfD + 0.4),
      new THREE.Vector3(halfW, 0, halfD + 0.4),
    ];
    const place = (distance: number) => {
      this.camera.position.set(0, Math.sin(PITCH) * distance, Math.cos(PITCH) * distance);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateMatrixWorld();
    };
    let low = 5;
    let high = 200;
    for (let step = 0; step < 30; step += 1) {
      const mid = (low + high) / 2;
      place(mid);
      const fits = corners.every((corner) => {
        const p = corner.clone().project(this.camera);
        return Math.abs(p.x) <= 0.96 && Math.abs(p.y) <= 0.94;
      });
      if (fits) high = mid;
      else low = mid;
    }
    place(high);
  }

  private buildRoom(room: BoardRoom): RoomModel {
    const group = new THREE.Group();
    group.position.set((room.col - 1) * ROOM_W, 0, (room.row - 1) * ROOM_D);
    this.scene.add(group);

    const texture = new THREE.CanvasTexture(paintFloor({ width: 640, height: 480 }, FLOORS[room.key]));
    texture.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 }));
    floor.receiveShadow = true;
    group.add(floor);

    const coverMaterial = new THREE.MeshBasicMaterial({ color: "#050304", transparent: true, opacity: 0, depthWrite: false });
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D).rotateX(-Math.PI / 2), coverMaterial);
    cover.position.y = 0.02;
    group.add(cover);

    // A gold rim that glows while the room is on offer.
    const rimMaterial = new THREE.MeshStandardMaterial({ color: "#c9a14a", emissive: "#ffb84a", emissiveIntensity: 0, metalness: 0.6, roughness: 0.4 });
    const inset = 0.35;
    const rim = [
      [0, -ROOM_D / 2 + inset, ROOM_W - inset * 2, 0.12],
      [0, ROOM_D / 2 - inset, ROOM_W - inset * 2, 0.12],
      [-ROOM_W / 2 + inset, 0, 0.12, ROOM_D - inset * 2],
      [ROOM_W / 2 - inset, 0, 0.12, ROOM_D - inset * 2],
    ].map(([x, z, w, d]) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), rimMaterial);
      mesh.position.set(x, 0.04, z);
      group.add(mesh);
      return mesh;
    });

    const light = new THREE.PointLight("#ffc874", 0, 9, 1.6);
    light.position.set(0, 2.6, 0);
    group.add(light);

    // A floating gold diamond over the room the picker is pointing at.
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshStandardMaterial({ color: "#ffd27a", emissive: "#ffb84a", emissiveIntensity: 1.5 }));
    marker.scale.y = 1.6;
    group.add(marker);

    // The owner's pennant, in the back corner.
    const pennant = new THREE.Group();
    pennant.position.set(ROOM_W / 2 - 0.8, 0, -ROOM_D / 2 + 0.8);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8), GOLD);
    pole.position.y = 1.6;
    pole.castShadow = true;
    const flagMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", side: THREE.DoubleSide, roughness: 0.7 });
    const flagShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.8, -0.5), new THREE.Vector2(0, -1)]);
    const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), flagMaterial);
    flag.position.set(0.05, 3.15, 0);
    flag.castShadow = true;
    pennant.add(pole, flag);
    group.add(pennant);

    group.add(furniture(room.key));

    const label = document.createElement("div");
    label.className = "board-label";
    label.innerHTML = `<strong></strong><span class="board-detail"></span><span class="board-status"></span>`;
    this.labels.append(label);

    return { room, group, rim, rimMaterial, cover, coverMaterial, pennant, flag, flagMaterial, marker, light, label };
  }

  // Outer walls (tall at the back, low at the front so you can see in) and inner walls with doorways.
  // A wall between two rooms with the same owner is knocked through.
  private buildWalls(rooms: BoardRoom[]): void {
    this.scene.remove(this.walls);
    this.walls.traverse((child) => child instanceof THREE.Mesh && child.geometry.dispose());
    this.walls = new THREE.Group();
    this.scene.add(this.walls);
    const ownerAt = (col: number, row: number) => rooms.find((room) => room.col === col && room.row === row)?.owner;
    const width = ROOM_W * 3;
    const depth = ROOM_D * 3;
    const wall = (x: number, z: number, w: number, d: number, h: number, material = WALL_MATERIAL) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.walls.add(mesh);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.06, d + 0.02), WALL_TOP);
      cap.position.set(x, h + 0.03, z);
      this.walls.add(cap);
    };
    wall(0, -depth / 2 - WALL / 2, width + WALL * 2, WALL, BACK_WALL_HEIGHT);
    wall(-width / 2 - WALL / 2, 0, WALL, depth, BACK_WALL_HEIGHT * 0.75);
    wall(width / 2 + WALL / 2, 0, WALL, depth, BACK_WALL_HEIGHT * 0.75);
    wall(0, depth / 2 + WALL / 2, width + WALL * 2, WALL, FRONT_WALL_HEIGHT);

    // An inner wall along one room edge: a doorway in the middle, or knocked through for a shared owner.
    const inner = (x: number, z: number, length: number, alongX: boolean, owner?: string) => {
      const gap = owner ? length * 0.7 : 1.2;
      const piece = (length - gap) / 2;
      for (const side of [-1, 1]) {
        const offset = side * (gap / 2 + piece / 2);
        if (alongX) wall(x + offset, z, piece, WALL, INNER_WALL_HEIGHT);
        else wall(x, z + offset, WALL, piece, INNER_WALL_HEIGHT);
      }
      if (owner) {
        // A coloured carpet runner through the opening.
        const runner = new THREE.Mesh(
          new THREE.BoxGeometry(alongX ? gap : 1.6, 0.03, alongX ? 1.6 : gap),
          new THREE.MeshStandardMaterial({ color: owner, roughness: 0.8 }),
        );
        runner.position.set(x, 0.03, z);
        this.walls.add(runner);
      }
    };
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const owner = ownerAt(col, row);
        const x = (col - 1) * ROOM_W;
        const z = (row - 1) * ROOM_D;
        if (col < 2) inner(x + ROOM_W / 2, z, ROOM_D, false, owner && ownerAt(col + 1, row) === owner ? owner : undefined);
        if (row < 2) inner(x, z + ROOM_D / 2, ROOM_W, true, owner && ownerAt(col, row + 1) === owner ? owner : undefined);
      }
    }
  }
}

// One piece of furniture that says which room it is.
function furniture(key: MansionRoomKey): THREE.Group {
  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  const back = -ROOM_D / 2 + 0.9;
  switch (key) {
    case "bell_tower":
      add(new THREE.BoxGeometry(0.12, 1.8, 0.12), WOOD, -0.8, 0.9, back);
      add(new THREE.BoxGeometry(0.12, 1.8, 0.12), WOOD, 0.8, 0.9, back);
      add(new THREE.BoxGeometry(1.8, 0.14, 0.16), WOOD, 0, 1.8, back);
      add(new THREE.CylinderGeometry(0.2, 0.5, 0.7, 16, 1, true), new THREE.MeshStandardMaterial({ color: "#c9a14a", metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }), 0, 1.35, back);
      break;
    case "gallery":
      for (const x of [-2.2, 0, 2.2]) {
        add(new THREE.BoxGeometry(1.4, 1, 0.08), GOLD, x, 1.2, -ROOM_D / 2 + 0.06);
        add(new THREE.BoxGeometry(1.2, 0.8, 0.1), new THREE.MeshStandardMaterial({ color: ["#3a2a1a", "#1c2a3a", "#4a2a2a"][Math.round(x / 2.2) + 1] }), x, 1.2, -ROOM_D / 2 + 0.08);
      }
      break;
    case "library":
      for (const x of [-2.4, 0, 2.4]) {
        add(new THREE.BoxGeometry(2, 1.6, 0.5), WOOD, x, 0.8, back - 0.3);
        for (let shelf = 0; shelf < 3; shelf += 1) add(new THREE.BoxGeometry(1.8, 0.35, 0.1), new THREE.MeshStandardMaterial({ color: ["#6a1426", "#1f3e5a", "#2c4a2a"][shelf] }), x, 0.35 + shelf * 0.5, back - 0.02);
      }
      break;
    case "garden":
      for (const [x, z] of [[-2.6, -1.4], [2.6, -1.4], [-2.6, 1.4], [2.6, 1.4]]) add(new THREE.SphereGeometry(0.55, 12, 10), new THREE.MeshStandardMaterial({ color: "#1f4a26", roughness: 1 }), x, 0.5, z);
      add(new THREE.CylinderGeometry(0.7, 0.8, 0.4, 20), new THREE.MeshStandardMaterial({ color: "#9a9284" }), 0, 0.2, 0);
      add(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 20), new THREE.MeshStandardMaterial({ color: "#2a4a6a", metalness: 0.3, roughness: 0.1 }), 0, 0.42, 0);
      break;
    case "grand_hall":
      add(new THREE.TorusGeometry(0.9, 0.06, 8, 24).rotateX(Math.PI / 2), GOLD, 0, 2.4, 0);
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        add(new THREE.SphereGeometry(0.07, 6, 6), new THREE.MeshBasicMaterial({ color: "#ffd890" }), Math.cos(angle) * 0.9, 2.5, Math.sin(angle) * 0.9);
      }
      break;
    case "music_room": {
      add(new THREE.BoxGeometry(1.8, 0.45, 1.1), new THREE.MeshStandardMaterial({ color: "#0c0a0c", roughness: 0.3 }), -1.6, 0.9, back + 0.2);
      for (const [x, z] of [[-2.35, back - 0.2], [-0.85, back - 0.2], [-1.6, back + 0.65]]) add(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), new THREE.MeshStandardMaterial({ color: "#0c0a0c" }), x, 0.35, z);
      add(new THREE.BoxGeometry(1.6, 0.04, 0.2), new THREE.MeshStandardMaterial({ color: "#f0e8d8" }), -1.6, 1.14, back + 0.72);
      break;
    }
    case "terrace":
      for (let index = -3; index <= 3; index += 1) add(new THREE.CylinderGeometry(0.08, 0.1, 0.6, 8), new THREE.MeshStandardMaterial({ color: "#c8c0b0" }), index * 1.1, 0.3, back - 0.4);
      add(new THREE.BoxGeometry(7.6, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: "#c8c0b0" }), 0, 0.66, back - 0.4);
      add(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffd890" }), 3, 1.4, 1.6);
      add(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 6), WOOD, 3, 0.65, 1.6);
      break;
    case "vault":
      add(new THREE.CylinderGeometry(1, 1, 0.25, 28).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#5a606a", metalness: 0.8, roughness: 0.35 }), 0, 1.1, -ROOM_D / 2 + 0.15);
      add(new THREE.TorusGeometry(1, 0.07, 8, 28), GOLD, 0, 1.1, -ROOM_D / 2 + 0.28);
      break;
    case "post_room":
      for (let index = 0; index < 5; index += 1) {
        const crate = add(new THREE.BoxGeometry(0.6, 0.45, 0.45), new THREE.MeshStandardMaterial({ color: index % 2 ? "#8a6a3a" : "#c8b088" }), -2.4 + index * 0.65, 0.23, back);
        crate.rotation.y = (index - 2) * 0.12;
      }
      break;
  }
  return group;
}
