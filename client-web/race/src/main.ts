import "./style.css";
import type { ClientMessage, GameSnapshot, RoomSnapshot, ServerMessage } from "../../../shared/message-types/protocol.js";
import { PILE_UP_ID, type RaceInput, type RaceView } from "../../../shared/race/protocol.js";
import { TRACKS } from "../../../shared/race/track.js";
import { PAD, PadEdges, connectedPads, padMove, pressed, readPad } from "../../src/input/pads.js";
import { Connection, resolveServerUrl, wakeServer } from "../../src/net.js";
import { CAR_COLORS, RaceRenderer, drawTrackPreview } from "./draw.js";
import { sound } from "./sound.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = { landing: $("landing"), lobby: $("lobby"), game: $("game") };

// Who drives from this screen, and with what. The first driver is this page's own player; the rest are couch seats.
type Keys = "all" | "left" | "right";
type Driver = {
  playerId: string;
  keys?: Keys;
  pad?: number;
  fires: number;
  lastSent: string;
  lastSentAt: number;
};
type Seat = Driver & { connection: Connection; token: string; readied: boolean; name: string };

const KEYS = {
  left: { left: ["KeyA"], right: ["KeyD"], gas: ["KeyW"], brake: ["KeyS"], fire: ["Space", "KeyF", "ShiftLeft"] },
  right: { left: ["ArrowLeft"], right: ["ArrowRight"], gas: ["ArrowUp"], brake: ["ArrowDown"], fire: ["Enter", "ShiftRight", "Slash", "Numpad0"] },
};
const SEND_EVERY_MS = 150;
const SESSION_KEY = "pile-up:session";
const RESUME_ATTEMPTS = 20;
const RESUME_DELAY_MS = 1500;
const GUEST_NAMES = ["Turbo", "Wheelie", "Captain Crash", "Sir Skids", "Bumpy", "Nitro Nan", "Zoom", "Fender"];

let room: RoomSnapshot | undefined;
let lastRace: RaceView | undefined;
let selectedTrack = "";
let claimingPad = false;
let toastTimer: number | undefined;
let myToken = "";
let resumeAttempts = 0;
let resuming = false;
const me: Driver = { playerId: "", keys: "all", fires: 0, lastSent: "", lastSentAt: 0 };
const seats: Seat[] = [];
const held = new Set<string>();
const touch = { left: false, right: false, brake: false };
const padEdges = new PadEdges();
const renderer = new RaceRenderer($<HTMLCanvasElement>("arena"));
const isTouch = matchMedia("(pointer: coarse)").matches;

const serverUrl = resolveServerUrl();
wakeServer(serverUrl);
const connection = new Connection(
  serverUrl,
  onMessage,
  (reason) => {
    // The server holds the seat for a while, so keep trying to take it back.
    if (myToken && resumeAttempts < RESUME_ATTEMPTS) {
      resumeAttempts += 1;
      showToast("Connection lost. Reconnecting…", "info");
      window.setTimeout(() => connection.send({ type: "RESUME", token: myToken }), RESUME_DELAY_MS);
      return;
    }
    showToast(`${reason} Refresh to try again.`);
    leaveToLanding();
  },
  () => ($("landing-status").textContent = "Waking up the game server. This can take up to a minute the first time."),
);

// Help and sound ------------------------------------------------------------

const help = $<HTMLDialogElement>("help");
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-help]")) button.addEventListener("click", () => help.showModal());
$("help-close").addEventListener("click", () => help.close());
help.addEventListener("click", (event) => event.target === help && help.close());
const muteButton = $("mute");
const showMute = () => (muteButton.textContent = sound.muted ? "🔇" : "🔊");
showMute();
muteButton.addEventListener("click", () => {
  sound.setMuted(!sound.muted);
  showMute();
});

// Landing ---------------------------------------------------------------------

const nameInput = $<HTMLInputElement>("name");
const codeInput = $<HTMLInputElement>("code");
nameInput.value = readStored("chatimbored:name") ?? "";
codeInput.value = new URLSearchParams(location.search).get("room")?.toUpperCase().slice(0, 5) ?? "";

$("create").addEventListener("click", () => {
  const displayName = requireName();
  if (displayName) connection.send({ type: "CREATE_ROOM", displayName });
});
$("join").addEventListener("click", joinFromForm);
codeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinFromForm();
});

function joinFromForm(): void {
  const displayName = requireName();
  const roomCode = codeInput.value.trim().toUpperCase();
  if (!displayName) return;
  if (roomCode.length !== 5) {
    $("landing-status").textContent = "Room codes are 5 characters.";
    return;
  }
  connection.send({ type: "JOIN_ROOM", roomCode, displayName });
}

function requireName(): string | undefined {
  const name = nameInput.value.trim();
  if (!name) {
    $("landing-status").textContent = "Pick a name first.";
    nameInput.focus();
    return undefined;
  }
  writeStored("chatimbored:name", name);
  return name;
}

// Lobby -----------------------------------------------------------------------

const tracksBox = $("tracks");
for (const track of [{ id: "", name: "Surprise me" }, ...TRACKS]) {
  const button = document.createElement("button");
  button.dataset.track = track.id;
  if (track.id) {
    const preview = document.createElement("canvas");
    button.append(preview);
    requestAnimationFrame(() => drawTrackPreview(preview, track.id));
  } else {
    const icon = document.createElement("span");
    icon.textContent = "🎲";
    icon.style.fontSize = "40px";
    icon.style.height = "70px";
    icon.style.lineHeight = "70px";
    button.append(icon);
  }
  button.append(track.name);
  button.addEventListener("click", () => {
    selectedTrack = track.id;
    renderLobby();
  });
  tracksBox.append(button);
}

$("ready").addEventListener("click", () => {
  const mine = room?.players.find((player) => player.id === me.playerId);
  connection.send({ type: "PLAYER_READY", isReady: !mine?.isReady });
});
$("start").addEventListener("click", () => connection.send({ type: "START_GAME", minigameId: PILE_UP_ID, trackId: selectedTrack || undefined }));
$("leave").addEventListener("click", () => {
  connection.send({ type: "LEAVE_ROOM" });
  leaveToLanding();
});
$("copy-link").addEventListener("click", async () => {
  if (!room) return;
  const link = `${location.origin}${location.pathname}?room=${room.code}${serverQuery()}`;
  try {
    await navigator.clipboard.writeText(link);
    showToast("Invite link copied.", "info");
  } catch {
    showToast(link, "info");
  }
});
$("claim-pad").addEventListener("click", () => {
  claimingPad = !claimingPad;
  renderLobby();
});

function renderLobby(): void {
  if (!room) return;
  $("room-code").textContent = room.code;
  const list = $("players");
  list.replaceChildren(
    ...room.players.map((player, index) => {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = CAR_COLORS[index % CAR_COLORS.length];
      const name = document.createElement("span");
      const seat = seats.find((candidate) => candidate.playerId === player.id);
      const how = player.id === me.playerId ? (me.pad !== undefined ? "you, controller" : "you") : seat ? (seat.pad !== undefined ? `this screen, controller ${seat.pad + 1}` : "this screen, arrow keys") : "";
      name.textContent = `${player.displayName}${how ? ` (${how})` : ""}`;
      const tag = document.createElement("span");
      tag.className = `tag${player.isReady || player.isHost ? " ready" : ""}`;
      tag.textContent = player.away ? "reconnecting…" : player.isHost ? "host" : player.isReady ? "ready" : "not ready";
      item.append(swatch, name, tag);
      if (seat) {
        const remove = document.createElement("button");
        remove.className = "ghost";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => removeSeat(seat));
        item.append(remove);
      }
      return item;
    }),
  );
  const isHost = room.hostId === me.playerId;
  for (const button of tracksBox.querySelectorAll<HTMLButtonElement>("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.track === selectedTrack));
    button.disabled = !isHost;
  }
  const mine = room.players.find((player) => player.id === me.playerId);
  $("ready").hidden = isHost;
  $("ready").textContent = mine?.isReady ? "Not ready" : "Ready";
  $("start").hidden = !isHost;
  const everyoneReady = room.players.every((player) => player.isReady || player.isHost);
  const enough = room.players.length >= 2;
  ($("start") as HTMLButtonElement).disabled = !everyoneReady || !enough;
  $("claim-pad").textContent = claimingPad ? "Press A on the controller you want…" : me.pad !== undefined ? `Driving with controller ${me.pad + 1}` : "Drive with a controller myself";
  $("lobby-status").textContent = !enough
    ? "Need at least 2 drivers: share the link, or add a controller or a second keyboard player. Bots fill the rest."
    : !isHost
      ? "The host picks the track and starts the race."
      : everyoneReady
        ? ""
        : "Waiting for everyone to be ready.";
}

// Couch seats -------------------------------------------------------------------

function addSeat(source: { pad?: number; keys?: Keys }): void {
  if (!room || room.phase !== "lobby" || room.players.length >= 8) return;
  const taken = new Set(room.players.map((player) => player.displayName));
  const name = GUEST_NAMES.find((candidate) => !taken.has(candidate)) ?? `Driver ${seats.length + 2}`;
  const seat: Seat = {
    playerId: "",
    ...source,
    fires: 0,
    lastSent: "",
    lastSentAt: 0,
    token: "",
    readied: false,
    name,
    connection: new Connection(
      serverUrl,
      (message) => onSeatMessage(seat, message),
      () => removeSeat(seat, false),
    ),
  };
  seats.push(seat);
  if (source.keys === "right") me.keys = "left";
  seat.connection.send({ type: "JOIN_ROOM", roomCode: room.code, displayName: name });
}

function removeSeat(seat: Seat, sayGoodbye = true): void {
  const index = seats.indexOf(seat);
  if (index === -1) return;
  seats.splice(index, 1);
  if (seat.keys === "right") me.keys = "all";
  if (sayGoodbye) seat.connection.send({ type: "LEAVE_ROOM" });
  window.setTimeout(() => seat.connection.close(), 200);
  renderLobby();
}

function onSeatMessage(seat: Seat, message: ServerMessage): void {
  if (message.type === "ROOM_STATE") {
    seat.playerId = message.playerId;
    if (message.resumeToken) seat.token = message.resumeToken;
    // Everyone on this couch is here already, so extra seats are always ready.
    if (message.room.phase !== "lobby") seat.readied = false;
    else if (!seat.readied) {
      seat.readied = true;
      seat.connection.send({ type: "PLAYER_READY", isReady: true });
    }
  } else if (message.type === "ERROR") {
    showToast(`${seat.name}: ${message.message}`);
    if (!seat.playerId) removeSeat(seat, false);
  }
}

// Input -------------------------------------------------------------------------

window.addEventListener("keydown", (event) => {
  const typing = event.target instanceof HTMLInputElement;
  if (typing) return;
  if (room?.phase === "in_game" && (event.code.startsWith("Arrow") || event.code === "Space")) event.preventDefault();
  held.add(event.code);
  if (event.repeat) return;
  if (room?.phase === "lobby" && event.code === "Enter" && !seats.some((seat) => seat.keys === "right")) {
    addSeat({ keys: "right" });
    return;
  }
  if (room?.phase !== "in_game") return;
  for (const driver of drivers()) {
    if (driver.keys && keysFor(driver.keys).fire.includes(event.code)) {
      driver.fires += 1;
      sendInput(driver, true);
    }
  }
});
window.addEventListener("keyup", (event) => held.delete(event.code));
window.addEventListener("blur", () => held.clear());

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-touch]")) {
  const key = button.dataset.touch as "left" | "right" | "brake" | "fire";
  const down = (event: PointerEvent) => {
    event.preventDefault();
    button.classList.add("held");
    if (key === "fire") {
      me.fires += 1;
      sendInput(me, true);
    } else {
      touch[key] = true;
    }
  };
  const up = () => {
    button.classList.remove("held");
    if (key !== "fire") touch[key] = false;
  };
  button.addEventListener("pointerdown", down);
  button.addEventListener("pointerup", up);
  button.addEventListener("pointercancel", up);
  button.addEventListener("pointerleave", up);
}

function drivers(): Driver[] {
  return [me, ...seats.filter((seat) => seat.playerId)];
}

function keysFor(keys: Keys): { left: string[]; right: string[]; gas: string[]; brake: string[]; fire: string[] } {
  if (keys === "all") {
    return {
      left: [...KEYS.left.left, ...KEYS.right.left],
      right: [...KEYS.left.right, ...KEYS.right.right],
      gas: [...KEYS.left.gas, ...KEYS.right.gas],
      brake: [...KEYS.left.brake, ...KEYS.right.brake],
      fire: [...KEYS.left.fire, ...KEYS.right.fire],
    };
  }
  return KEYS[keys];
}

function readDriver(driver: Driver): { steer: number; throttle: number } {
  let steer = 0;
  let gas = 0;
  let brake = 0;
  if (driver.keys) {
    const keys = keysFor(driver.keys);
    const any = (codes: string[]) => codes.some((code) => held.has(code));
    steer += (any(keys.right) ? 1 : 0) - (any(keys.left) ? 1 : 0);
    gas = Math.max(gas, any(keys.gas) ? 1 : 0);
    brake = Math.max(brake, any(keys.brake) ? 1 : 0);
  }
  if (driver === me && isTouch) {
    steer += (touch.right ? 1 : 0) - (touch.left ? 1 : 0);
    // On a phone the gas is always down, so two thumbs are enough. Not once you're out: then it would drag the air-strike sight.
    const out = lastRace?.cars.find((car) => car.id === me.playerId)?.state === "out";
    gas = Math.max(gas, touch.brake || out ? 0 : 1);
    brake = Math.max(brake, touch.brake ? 1 : 0);
  }
  const pad = driver.pad === undefined ? undefined : readPad(driver.pad);
  if (pad) {
    steer += padMove(pad).x;
    gas = Math.max(gas, pad.buttons[PAD.RT]?.value ?? 0, pressed(pad, PAD.A) ? 1 : 0);
    brake = Math.max(brake, pad.buttons[PAD.LT]?.value ?? 0, pressed(pad, PAD.B) ? 1 : 0);
  }
  return { steer: Math.max(-1, Math.min(1, steer)), throttle: brake > 0.1 ? -brake : gas };
}

function sendInput(driver: Driver, force = false): void {
  const { steer, throttle } = readDriver(driver);
  const input: RaceInput = { kind: "race", steer: Math.round(steer * 20) / 20, throttle: Math.round(throttle * 20) / 20, fires: driver.fires };
  const key = JSON.stringify(input);
  const now = performance.now();
  if (!force && key === driver.lastSent && now - driver.lastSentAt < SEND_EVERY_MS) return;
  driver.lastSent = key;
  driver.lastSentAt = now;
  const message: ClientMessage = { type: "PLAYER_INPUT", input };
  if (driver === me) connection.send(message);
  else (driver as Seat).connection.send(message);
}

// Controllers: join from the lobby, fire in the race.
function pollPads(): void {
  for (const pad of connectedPads()) {
    const edges = padEdges.poll(pad);
    const owner = drivers().find((driver) => driver.pad === pad.index) ?? seats.find((seat) => seat.pad === pad.index);
    if (room?.phase === "lobby") {
      if (edges.has(PAD.A) && !owner) {
        if (claimingPad) {
          me.pad = pad.index;
          claimingPad = false;
          renderLobby();
        } else {
          addSeat({ pad: pad.index });
        }
      }
      if (edges.has(PAD.B) && owner && owner !== me) removeSeat(owner as Seat);
      if (edges.has(PAD.START) && owner === me && room.hostId === me.playerId) ($("start") as HTMLButtonElement).click();
    } else if (room?.phase === "in_game" && owner && (edges.has(PAD.X) || edges.has(PAD.RB))) {
      owner.fires += 1;
      sendInput(owner, true);
    } else if (room?.phase === "results" && owner === me && edges.has(PAD.A)) {
      ($("back-to-lobby") as HTMLButtonElement).click();
    }
  }
}

function loop(now: number): void {
  pollPads();
  if (room?.phase === "in_game") for (const driver of drivers()) sendInput(driver);
  if (!screens.game.hidden) renderer.frame(now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Results -----------------------------------------------------------------------

$("back-to-lobby").addEventListener("click", () => connection.send({ type: "RETURN_TO_LOBBY" }));

function showResults(): void {
  const race = lastRace;
  if (!room || !race) return;
  const order = [...race.cars].sort((a, b) => b.points - a.points);
  const winner = race.cars.find((car) => car.id === race.matchWinner) ?? order[0];
  $("results-title").textContent = winner ? `${winner.name} wins the Pile-Up!` : "Race over";
  $("standings").replaceChildren(
    ...order.map((car) => {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = CAR_COLORS[car.color % CAR_COLORS.length];
      const name = document.createElement("span");
      name.textContent = `${car.name}${car.bot ? " 🤖" : ""}`;
      const points = document.createElement("span");
      points.className = "points";
      points.textContent = `${car.points} pts`;
      item.append(swatch, name, points);
      return item;
    }),
  );
  const isHost = room.hostId === me.playerId;
  $("back-to-lobby").hidden = !isHost;
  $("results-wait").hidden = isHost;
  $("results").hidden = false;
}

// Messages ----------------------------------------------------------------------

function onMessage(message: ServerMessage): void {
  switch (message.type) {
    case "ROOM_STATE": {
      $("landing-status").textContent = "";
      if (resumeAttempts > 0 || resuming) showToast("Back in the room.", "info");
      resumeAttempts = 0;
      resuming = false;
      const wasInGame = room?.phase === "in_game";
      room = message.room;
      me.playerId = message.playerId;
      if (message.resumeToken) myToken = message.resumeToken;
      saveSession();
      history.replaceState(null, "", `?room=${room.code}${serverQuery()}`);
      if (room.phase === "lobby") {
        show("lobby");
        $("results").hidden = true;
        renderLobby();
      } else if (room.phase === "in_game" || room.phase === "results") {
        if (!wasInGame && room.phase === "in_game") startRace();
        show("game");
        $("touch").hidden = !isTouch || room.phase !== "in_game";
        if (room.game) applyGame(room.game);
        if (room.phase === "results") showResults();
      } else {
        show("lobby");
        renderLobby();
        $("lobby-status").textContent = "Another game is running in this room. Waiting for it to finish.";
      }
      return;
    }
    case "GAME_STATE":
      applyGame(message.game);
      return;
    case "GAME_OVER":
      applyGame(message.game);
      showResults();
      return;
    case "ERROR":
      showToast(message.message);
      $("landing-status").textContent = message.message;
      // The seat couldn't be taken back: start over.
      if (resuming || resumeAttempts > 0) {
        resuming = false;
        resumeAttempts = 0;
        leaveToLanding();
      }
      return;
  }
}

function startRace(): void {
  renderer.reset();
  lastRace = undefined;
  $("results").hidden = true;
  for (const driver of drivers()) {
    driver.fires = 0;
    driver.lastSent = "";
  }
}

function applyGame(game: GameSnapshot): void {
  if (!game.race) return;
  lastRace = game.race;
  renderer.push(game.race);
}

function leaveToLanding(): void {
  forgetSession();
  [...seats].forEach((seat) => removeSeat(seat));
  room = undefined;
  me.playerId = "";
  me.pad = undefined;
  renderer.reset();
  show("landing");
}

// Reconnecting --------------------------------------------------------------------
// The server hands each player a secret token. After a refresh it takes the same seat back. Kept per tab.

type StoredSession = { server: string; room: string; token: string };

function saveSession(): void {
  if (!room || !myToken) return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ server: serverUrl, room: room.code, token: myToken } satisfies StoredSession));
  } catch {
    // Without storage a refresh just starts over.
  }
}

function forgetSession(): void {
  myToken = "";
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing stored.
  }
}

function resumeStoredSession(): void {
  let session: StoredSession | null = null;
  try {
    session = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as StoredSession | null;
  } catch {
    session = null;
  }
  if (!session?.token || session.server !== serverUrl) return;
  resuming = true;
  myToken = session.token;
  $("landing-status").textContent = `Rejoining room ${session.room}…`;
  connection.send({ type: "RESUME", token: session.token });
}

// Helpers -------------------------------------------------------------------------

function serverQuery(): string {
  const server = new URLSearchParams(location.search).get("server");
  return server ? `&server=${encodeURIComponent(server)}` : "";
}

function show(name: keyof typeof screens): void {
  for (const [key, element] of Object.entries(screens)) element.hidden = key !== name;
}

function showToast(text: string, kind: "error" | "info" = "error"): void {
  const toast = $("toast");
  toast.classList.toggle("info", kind === "info");
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 4000);
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembering the name is a convenience only.
  }
}

resumeStoredSession();
