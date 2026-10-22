import "./style.css";
import type { CrowdInput } from "../../shared/crowd/protocol.js";
import type { ClientMessage, GameSnapshot, RoomSnapshot, ServerMessage } from "../../shared/message-types/protocol.js";
import {
  HOST_MIN_PLAYERS,
  MANSION_ROOMS,
  NIGHT_LAYERS,
  NIGHT_POINTS,
  PERKS,
  TWISTS,
  defaultNightOptions,
  type MansionRoomKey,
  type NightOptions,
  type NightSnapshot,
} from "../../shared/party/night.js";
import { CrowdGame, type GameSeat, type InputSource } from "./crowd/CrowdGame.js";
import { PAD, PadEdges, connectedPads } from "./input/pads.js";
import { roomIcon } from "./party/icons.js";
import { sound } from "./audio/sound.js";
import { Connection, resolveServerUrl, wakeServer } from "./net.js";

const MODES = [
  {
    id: "crowd_act_natural",
    name: "Act Natural",
    blurb: "Shuffle with the crowd toward the exit. First one out wins. One shot each, for whoever looks a bit too human.",
  },
  {
    id: "crowd_silent_witness",
    name: "Silent Witness",
    blurb: "One of you is the Killer, quietly picking off the crowd. Everyone else gets one shot. Five bodies and the Killer wins.",
  },
  {
    id: "crowd_lantern_festival",
    name: "Lantern Festival",
    blurb: "Light all five lanterns to win. Every lantern flares when it's lit, so others will be watching. Anyone in reach can be struck down.",
  },
  {
    id: "crowd_bell_ringers",
    name: "Bell Ringers",
    blurb: "A few Ringers hide in the crowd and must ring all four bells. Everyone else watches from above with two arrows each.",
  },
  {
    id: "crowd_heist_hour",
    name: "Heist Hour",
    blurb: "Crack three different vaults to win. Each one sounds an alarm when cracked. One shot each for whoever looks guilty.",
  },
  {
    id: "crowd_marked",
    name: "Marked",
    blurb: "You're hunting one player and someone's hunting you. Strike your mark to take over theirs. Strike the wrong person and you're left dazed.",
  },
  {
    id: "crowd_freeze_frame",
    name: "Freeze Frame",
    blurb: "Race the crowd to the exit. Every so often everyone freezes without warning. Keep walking and you'll stand out. One shot each.",
  },
  {
    id: "crowd_hot_parcel",
    name: "Hot Parcel",
    blurb: "Someone's holding a ticking parcel and only they know it. Bump into another player to pass it on before it goes off. Last one standing wins.",
  },
  {
    id: "crowd_closing_time",
    name: "Closing Time",
    blurb: "The lights go out from the edges in. Stay in the light with the crowd, strike anyone close, and be the last one standing.",
  },
] as const;

const ROLE_NAMES = { runner: "", killer: "Killer", hunter: "Hunter", ringer: "Ringer", lookout: "Lookout", backer: "Backer", host: "Host" } as const;

// Board colours, by join order.
const PLAYER_COLORS = ["#e9806b", "#6ba3e9", "#7fb069", "#e8d26a", "#b48ce0", "#e0a64a", "#5fc7b9", "#e58bb5"];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = { landing: $("landing"), lobby: $("lobby"), board: $("board"), step: $("night-step"), nightOver: $("night-over"), game: $("game") };

// An extra player on this screen, with their own controller and their own connection to the room.
type CouchSeat = { key: string; pad: number; connection: Connection; playerId: string; readied: boolean; token: string; retries: number };

let room: RoomSnapshot | undefined;
let playerId = "";
let selectedMode: string = MODES[0].id;
let game: CrowdGame | undefined;
let toastTimer: number | undefined;
let mySource: InputSource = { kind: "keyboard" };
let claimingPad = false;
let boardFocus = 0;
// The host's house rules for the next night. Layers that need private text switch off on a shared screen.
const chosenLayers: NightOptions = defaultNightOptions(false);
// Which button each of this screen's players has highlighted with a controller, between rounds.
const stepFocus = new Map<string, number>();
let stepPhase = "";
let nightOverPlayed = false;
const couchSeats: CouchSeat[] = [];
const menuEdges = new PadEdges();

const serverUrl = resolveServerUrl();
wakeServer(serverUrl);
const connection = new Connection(
  serverUrl,
  onMessage,
  (reason) => {
    // Hold on to the seat: the server keeps it for a while, so keep trying to take it back.
    if (myToken && resumeAttempts < RESUME_ATTEMPTS) {
      resumeAttempts += 1;
      showToast("Connection lost. Reconnecting…", "info");
      window.setTimeout(() => connection.send({ type: "RESUME", token: myToken }), RESUME_DELAY_MS);
      return;
    }
    showToast(`${reason} Refresh to try again.`);
    forgetSession();
    $("landing-status").textContent = "";
    room = undefined;
    removeAllCouchSeats();
    stopGame();
    show("landing");
  },
  () => ($("landing-status").textContent = "Waking up the game server. This can take up to a minute the first time."),
);

// How to play ---------------------------------------------------------------

const help = $<HTMLDialogElement>("help");
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-help]")) button.addEventListener("click", () => help.showModal());
$("help-close").addEventListener("click", () => help.close());
help.addEventListener("click", (event) => event.target === help && help.close());

// Sound -------------------------------------------------------------------

const musicVolume = $<HTMLInputElement>("music-volume");
const effectsVolume = $<HTMLInputElement>("effects-volume");
musicVolume.value = String(sound.settings.music);
effectsVolume.value = String(sound.settings.effects);
for (const slider of [musicVolume, effectsVolume]) {
  slider.addEventListener("input", () => sound.setVolumes({ music: Number(musicVolume.value), effects: Number(effectsVolume.value) }));
}
$("sound-toggle").addEventListener("click", () => {
  const panel = $("sound-panel");
  panel.hidden = !panel.hidden;
  $("sound-toggle").setAttribute("aria-expanded", String(!panel.hidden));
});
// A soft click for every button press.
document.addEventListener("click", (event) => {
  if (event.target instanceof HTMLElement && event.target.closest("button")) sound.play("click");
});

// Reconnecting ----------------------------------------------------------
// Each seat on this screen has a secret token from the server. A refresh or a dropped connection sends it back
// to take the same seat again. Kept per tab, so two tabs stay two players.

const SESSION_KEY = "morbid-masquerade:session";
const RESUME_ATTEMPTS = 20;
const RESUME_DELAY_MS = 1500;
type StoredSession = { server: string; room: string; token: string; pad?: number; seats: Array<{ pad: number; token: string }> };
let myToken = "";
let resumeAttempts = 0;
let resuming = false;

function saveSession(): void {
  if (!room || !myToken) return;
  const session: StoredSession = {
    server: serverUrl,
    room: room.code,
    token: myToken,
    pad: mySource.kind === "pad" ? mySource.index : undefined,
    seats: couchSeats.filter((seat) => seat.token).map((seat) => ({ pad: seat.pad, token: seat.token })),
  };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
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

function storedSession(): StoredSession | undefined {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as StoredSession | null;
    return session?.server === serverUrl && session.token ? session : undefined;
  } catch {
    return undefined;
  }
}

// After a refresh: take back this screen's seats, controllers included.
function resumeStoredSession(): void {
  const session = storedSession();
  if (!session) return;
  resuming = true;
  myToken = session.token;
  if (session.pad !== undefined) mySource = { kind: "pad", index: session.pad };
  $("landing-status").textContent = `Rejoining room ${session.room}…`;
  connection.send({ type: "RESUME", token: session.token });
  for (const stored of session.seats) openCouchSeat(stored.pad, { type: "RESUME", token: stored.token }, stored.token);
}

// A shared screen: more than one person is playing on this page.
const sharedScreen = () => couchSeats.length > 0;

// Landing ---------------------------------------------------------------

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

// Lobby -----------------------------------------------------------------

const modesBox = $("modes");
for (const mode of MODES) {
  const button = document.createElement("button");
  button.className = "mode";
  button.dataset.mode = mode.id;
  button.innerHTML = `<strong>${mode.name}</strong><span>${mode.blurb}</span>`;
  button.addEventListener("click", () => {
    selectedMode = mode.id;
    renderLobby();
  });
  modesBox.append(button);
}

$("ready").addEventListener("click", () => {
  const me = room?.players.find((player) => player.id === playerId);
  connection.send({ type: "PLAYER_READY", isReady: !me?.isReady });
});

$("start").addEventListener("click", () => connection.send({ type: "START_GAME", minigameId: selectedMode }));
$("start-night").addEventListener("click", startNight);

$("leave").addEventListener("click", () => {
  removeAllCouchSeats();
  forgetSession();
  connection.send({ type: "LEAVE_ROOM" });
  room = undefined;
  show("landing");
});

$("claim-pad").addEventListener("click", () => {
  if (mySource.kind === "pad") {
    mySource = { kind: "keyboard" };
    claimingPad = false;
  } else {
    claimingPad = !claimingPad;
  }
  renderLobby();
});

$("copy-link").addEventListener("click", async () => {
  if (!room) return;
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  try {
    await navigator.clipboard.writeText(link);
    $("lobby-status").textContent = "Invite link copied.";
  } catch {
    $("lobby-status").textContent = link;
  }
});

function startNight(): void {
  const rounds = Number($<HTMLSelectElement>("night-length").value);
  connection.send({ type: "START_NIGHT", rounds, sharedScreen: sharedScreen(), options: nightOptions() });
}

function nightOptions(): NightOptions {
  const shared = sharedScreen();
  return Object.fromEntries(
    NIGHT_LAYERS.map((layer) => [layer.key, chosenLayers[layer.key] && !(shared && layer.needsPrivateText)]),
  ) as NightOptions;
}

function renderLayers(isHost: boolean): void {
  const options = nightOptions();
  const players = room?.players.length ?? 0;
  $("night-layers").replaceChildren(
    ...NIGHT_LAYERS.map((layer) => {
      const label = document.createElement("label");
      const blocked = sharedScreen() && layer.needsPrivateText;
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = options[layer.key];
      box.disabled = !isHost || Boolean(blocked);
      box.addEventListener("change", () => {
        chosenLayers[layer.key] = box.checked;
        renderLobby();
      });
      const text = document.createElement("div");
      const note = blocked
        ? " Off on a shared screen, since it needs secret words."
        : layer.key === "host" && players < HOST_MIN_PLAYERS
          ? ` Needs ${HOST_MIN_PLAYERS} or more players.`
          : "";
      text.append(layer.name);
      const blurb = document.createElement("span");
      blurb.textContent = `${layer.blurb}${note}`;
      text.append(blurb);
      label.className = options[layer.key] ? "" : "off";
      label.append(box, text);
      return label;
    }),
  );
}

function renderLobby(): void {
  if (!room) return;
  const isHost = room.hostId === playerId;
  $("room-code").textContent = room.code;

  const list = $("players");
  list.replaceChildren(
    ...room.players.map((player) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.className = "who";
      name.append(swatch(player.id), `${player.displayName}${localLabel(player.id)}`);
      const seat = couchSeatFor(player.id);
      if (seat) {
        const rename = document.createElement("button");
        rename.className = "ghost small";
        rename.textContent = "Rename";
        rename.title = "Or press Y on the controller for another name";
        rename.addEventListener("click", () => editName(item, player.id, player.displayName));
        name.append(rename);
      }
      const tag = document.createElement("span");
      tag.className = player.away ? "tag away" : player.isHost || player.isReady ? "tag ok" : "tag";
      const state = player.away ? "Reconnecting…" : player.isHost ? "Host" : player.isReady ? "Ready" : "Not ready";
      tag.textContent = `${state} · ${player.score} pts`;
      item.append(name, tag);
      return item;
    }),
  );

  // Marked tells each player a secret name, which one shared screen can't do.
  if (sharedScreen() && selectedMode === "crowd_marked") selectedMode = MODES[0].id;
  for (const button of modesBox.querySelectorAll<HTMLButtonElement>(".mode")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === selectedMode));
    button.disabled = !isHost || (sharedScreen() && button.dataset.mode === "crowd_marked");
  }

  const pads = connectedPads().length;
  $("couch-hint").innerHTML = claimingPad
    ? "Press <b>A</b> on the controller you want to use."
    : pads === 0
      ? "Playing on one screen? Plug in controllers, then press <b>A</b> on each one to add a player."
      : `Playing on one screen? Press <b>A</b> on each extra controller to add a player, <b>Y</b> for another name, <b>B</b> to remove them.${
          mySource.kind === "pad" ? ` You're on controller ${mySource.index + 1}.` : ""
        }`;
  const claim = $<HTMLButtonElement>("claim-pad");
  claim.textContent = mySource.kind === "pad" ? "Switch back to keyboard and mouse" : claimingPad ? "Cancel" : "Play with a controller myself";

  const me = room.players.find((player) => player.id === playerId);
  const readyButton = $<HTMLButtonElement>("ready");
  readyButton.hidden = isHost;
  readyButton.textContent = me?.isReady ? "Not ready" : "Ready";

  const everyoneReady = room.players.every((player) => player.isHost || player.isReady);
  const canStart = room.players.length >= 2 && everyoneReady;
  const startButton = $<HTMLButtonElement>("start");
  startButton.hidden = !isHost;
  startButton.disabled = !canStart;
  const nightButton = $<HTMLButtonElement>("start-night");
  nightButton.hidden = !isHost;
  nightButton.disabled = !canStart;
  $<HTMLSelectElement>("night-length").disabled = !isHost;
  renderLayers(isHost);
  $("lobby-status").textContent = !isHost
    ? "The host picks the game and starts when everyone's ready."
    : room.players.length < 2
      ? "Share the invite link or add a controller. You need at least 2 players."
      : everyoneReady
        ? sharedScreen()
          ? `Sharing one screen: roles and secrets come through controller rumble.${
              mySource.kind === "keyboard" ? " You're on the keyboard, so you won't feel them." : ""
            }`
          : ""
        : "Waiting for everyone to ready up.";
}

// Swaps a lobby row's name for a text box. Enter saves, Escape cancels.
function editName(item: HTMLElement, id: string, current: string): void {
  const input = document.createElement("input");
  input.value = current;
  input.maxLength = 24;
  input.className = "rename";
  const save = () => {
    const displayName = input.value.trim();
    if (displayName && displayName !== current) sendAs(id, { type: "RENAME", displayName });
    renderLobby();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") save();
    if (event.key === "Escape") renderLobby();
  });
  input.addEventListener("blur", save);
  item.firstElementChild?.replaceWith(input);
  input.focus();
  input.select();
}

// Couch seats -----------------------------------------------------------

function addCouchSeat(pad: number): void {
  if (!room || room.phase !== "lobby" || couchSeats.length + 1 >= 8) return;
  openCouchSeat(pad, { type: "JOIN_ROOM", roomCode: room.code, displayName: guestName(pad) });
  renderLobby();
}

function openCouchSeat(pad: number, hello: ClientMessage, token = ""): void {
  const seatConnection = new Connection(
    serverUrl,
    (message) => onSeatMessage(seat, message),
    () => {
      // Same as this screen's own seat: keep trying to take the seat back before giving it up.
      if (seat.token && seat.retries < RESUME_ATTEMPTS && couchSeats.includes(seat)) {
        seat.retries += 1;
        window.setTimeout(() => seat.connection.send({ type: "RESUME", token: seat.token }), RESUME_DELAY_MS);
      } else {
        removeCouchSeat(seat, false);
      }
    },
  );
  const seat: CouchSeat = { key: `pad-${pad}`, pad, connection: seatConnection, playerId: "", readied: Boolean(token), token, retries: 0 };
  couchSeats.push(seat);
  seat.connection.send(hello);
}

// Masquerade names for controller players, who can't easily type. Y in the lobby picks another.
const GUEST_NAMES = [
  "Count Velvet",
  "Lady Nightshade",
  "Baron Ash",
  "The Marquise",
  "Duke Hollow",
  "Miss Raven",
  "Sir Lark",
  "Madame Moth",
  "Lord Cinder",
  "Dame Thistle",
  "The Viscount",
  "Lady Gloam",
];

function guestName(pad: number, current?: string): string {
  const taken = new Set(room?.players.map((player) => player.displayName));
  const start = current ? GUEST_NAMES.indexOf(current) + 1 : pad * 3;
  for (let step = 0; step < GUEST_NAMES.length; step += 1) {
    const name = GUEST_NAMES[(start + step) % GUEST_NAMES.length];
    if (!taken.has(name)) return name;
  }
  return `Guest ${pad + 1}`;
}

function removeCouchSeat(seat: CouchSeat, sayGoodbye = true): void {
  const index = couchSeats.indexOf(seat);
  if (index === -1) return;
  couchSeats.splice(index, 1);
  saveSession();
  if (sayGoodbye) seat.connection.send({ type: "LEAVE_ROOM" });
  // Give the goodbye a moment to go out before the socket closes.
  window.setTimeout(() => seat.connection.close(), 200);
  if (room?.phase === "lobby") renderLobby();
}

function removeAllCouchSeats(): void {
  [...couchSeats].forEach((seat) => removeCouchSeat(seat));
}

function onSeatMessage(seat: CouchSeat, message: ServerMessage): void {
  switch (message.type) {
    case "ROOM_STATE":
      seat.playerId = message.playerId;
      seat.retries = 0;
      if (message.resumeToken && seat.token !== message.resumeToken) {
        seat.token = message.resumeToken;
        saveSession();
      }
      // Everyone on this couch is here already, so extra seats come in ready.
      if (!seat.readied && message.room.phase === "lobby") {
        seat.readied = true;
        seat.connection.send({ type: "PLAYER_READY", isReady: true });
      }
      return;
    case "GAME_STATE":
    case "GAME_OVER":
      if (game && message.game.crowd) game.applyView(seat.key, message.game.crowd, message.game.endsAt);
      return;
    case "ERROR":
      showToast(`Pad ${seat.pad + 1}: ${message.message}`);
      if (!seat.playerId) {
        removeCouchSeat(seat, false);
        saveSession();
      }
      return;
  }
}

function couchSeatFor(id: string): CouchSeat | undefined {
  return couchSeats.find((seat) => seat.playerId === id);
}

function isLocal(id: string): boolean {
  return id === playerId || Boolean(couchSeatFor(id));
}

function localLabel(id: string): string {
  if (id === playerId) return sharedScreen() ? " (this screen)" : " (you)";
  return couchSeatFor(id) ? " (this screen)" : "";
}

// Send as one of this screen's players: the server checks who's asking.
function sendAs(id: string, message: ClientMessage): void {
  if (id === playerId) connection.send(message);
  else couchSeatFor(id)?.connection.send(message);
}

// Controllers in the menus --------------------------------------------------

window.setInterval(() => {
  for (const pad of connectedPads()) {
    const edges = menuEdges.poll(pad);
    if (edges.size > 0) onPadMenu(pad.index, edges);
  }
}, 50);
window.addEventListener("gamepadconnected", () => room?.phase === "lobby" && renderLobby());
window.addEventListener("gamepaddisconnected", () => room?.phase === "lobby" && renderLobby());

function onPadMenu(pad: number, edges: Set<number>): void {
  if (!$("round-intro").hidden) hideRoundIntro();
  if (!room) return;
  const mine = mySource.kind === "pad" && mySource.index === pad;
  const seat = couchSeats.find((candidate) => candidate.pad === pad);
  const isHost = room.hostId === playerId;
  const hostPad = mine && isHost;

  if (room.phase === "lobby") {
    if (claimingPad && edges.has(PAD.A) && !seat) {
      mySource = { kind: "pad", index: pad };
      claimingPad = false;
      renderLobby();
    } else if (edges.has(PAD.A) && !seat && !mine) {
      addCouchSeat(pad);
    } else if (edges.has(PAD.B) && seat) {
      removeCouchSeat(seat);
    } else if (edges.has(PAD.Y) && seat?.playerId) {
      const current = room.players.find((player) => player.id === seat.playerId)?.displayName;
      sendAs(seat.playerId, { type: "RENAME", displayName: guestName(pad, current) });
    } else if (edges.has(PAD.START) && hostPad && !$<HTMLButtonElement>("start-night").disabled) {
      startNight();
    }
    return;
  }

  if (room.phase === "board") {
    const picker = boardPickerSeat();
    const padPicker = picker && (picker === playerId ? mine : couchSeatFor(picker)?.pad === pad);
    if (!padPicker && !hostPad) return;
    const options = room.night?.offered ?? [];
    if (edges.has(PAD.LEFT) || edges.has(PAD.UP)) boardFocus = (boardFocus + options.length - 1) % Math.max(1, options.length);
    if (edges.has(PAD.RIGHT) || edges.has(PAD.DOWN)) boardFocus = (boardFocus + 1) % Math.max(1, options.length);
    if (edges.has(PAD.A) && options[boardFocus]) pickRoom(options[boardFocus]);
    renderBoard();
    return;
  }

  if (room.phase === "shop" || room.phase === "mole_vote" || room.phase === "finale_pick") {
    const owner = mine ? playerId : seat?.playerId;
    if (owner) moveStepFocus(owner, edges);
    if (hostPad && edges.has(PAD.START)) connection.send({ type: "NIGHT_ACTION", action: { kind: "skip" } });
    return;
  }

  if (!hostPad || !(edges.has(PAD.A) || edges.has(PAD.START))) return;
  if (room.phase === "results" && !$("results").hidden) {
    if (room.night) connection.send({ type: "NEXT_ROUND" });
    else connection.send({ type: "RETURN_TO_LOBBY" });
  } else if (room.phase === "night_over") {
    connection.send({ type: "RETURN_TO_LOBBY" });
  }
}

// Party Night board -------------------------------------------------------

$("end-night").addEventListener("click", () => connection.send({ type: "RETURN_TO_LOBBY" }));
$("night-to-lobby").addEventListener("click", () => connection.send({ type: "RETURN_TO_LOBBY" }));
$("next-round").addEventListener("click", () => connection.send({ type: "NEXT_ROUND" }));

// Which of this screen's players may pick: the picker if they're here, otherwise the host if that's us.
function boardPickerSeat(): string | undefined {
  const night = room?.night;
  if (!room || !night) return undefined;
  if (night.pickerId && isLocal(night.pickerId)) return night.pickerId;
  return room.hostId === playerId ? playerId : undefined;
}

function pickRoom(key: MansionRoomKey): void {
  const picker = boardPickerSeat();
  if (picker) sendAs(picker, { type: "PICK_ROOM", roomKey: key });
}

function renderBoard(): void {
  const night = room?.night;
  if (!room || !night) return;
  const isHost = room.hostId === playerId;
  const picker = boardPickerSeat();
  boardFocus = Math.min(boardFocus, Math.max(0, night.offered.length - 1));
  $("board-title").textContent = `Party Night · Round ${night.roundsPlayed + 1} of ${night.totalRounds}`;
  $("end-night").hidden = !isHost;

  $("mansion").replaceChildren(
    ...[...MANSION_ROOMS]
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((mansionRoom) => {
        const tile = document.createElement("button");
        const offered = night.offered.indexOf(mansionRoom.key);
        const played = night.played.includes(mansionRoom.key);
        const owner = night.claims[mansionRoom.key];
        const skipped = night.sharedScreen && mansionRoom.needsPrivateText;
        tile.className = `room${played ? " played" : ""}${owner ? " claimed" : ""}${offered >= 0 ? " offered" : ""}${offered === boardFocus && offered >= 0 ? " focused" : ""}`;
        if (owner) {
          tile.style.setProperty("--owner", colorOf(owner));
          // A wall shared with another of the same owner's rooms opens into a doorway.
          const neighbour = (col: number, row: number) => MANSION_ROOMS.find((other) => other.col === col && other.row === row);
          const right = neighbour(mansionRoom.col + 1, mansionRoom.row);
          const below = neighbour(mansionRoom.col, mansionRoom.row + 1);
          if (right && night.claims[right.key] === owner) tile.classList.add("join-right");
          if (below && night.claims[below.key] === owner) tile.classList.add("join-down");
        }
        tile.disabled = offered < 0 || !picker;
        const name = document.createElement("strong");
        name.textContent = mansionRoom.name;
        const mode = document.createElement("span");
        mode.className = "muted";
        mode.textContent = MODES.find((candidate) => candidate.id === mansionRoom.minigameId)?.name ?? "";
        const state = document.createElement("span");
        state.className = "owner";
        if (owner) state.append(swatch(owner), `Claimed by ${nameOf(owner)}`);
        else state.textContent = played ? "Nobody claimed it" : skipped ? "Closed tonight (needs secret words)" : offered >= 0 ? "On offer" : "";
        const icon = document.createElement("span");
        icon.className = "room-icon";
        icon.innerHTML = roomIcon(mansionRoom.key);
        tile.append(icon, name, mode, state);
        tile.addEventListener("click", () => pickRoom(mansionRoom.key));
        return tile;
      }),
  );

  const pickerName = night.pickerId ? nameOf(night.pickerId) : "Someone";
  const last = night.lastRound;
  const lastLine = last
    ? `${MANSION_ROOMS.find((candidate) => candidate.key === last.room)?.name}: ${last.claimedBy ? `${nameOf(last.claimedBy)} claimed it.` : "nobody claimed it."} `
    : "";
  const howTo = picker && picker === night.pickerId ? " Click a lit room, or use the d-pad and A." : picker ? " As host you can pick for them." : "";
  $("board-status").textContent = `${lastLine}${pickerName} is in last place and picks the next room.${howTo}`;

  renderBoardExtras(night);

  const ranked = [...room.players].sort((a, b) => (night.points[b.id] ?? 0) - (night.points[a.id] ?? 0));
  $("scoreboard").replaceChildren(
    ...ranked.map((player) => {
      const item = document.createElement("li");
      const who = document.createElement("span");
      who.append(swatch(player.id), `${player.displayName}${localLabel(player.id)}`);
      const rooms = Object.values(night.claims).filter((owner) => owner === player.id).length;
      const score = document.createElement("span");
      const tips = night.options.shop ? ` · ${night.tips[player.id] ?? 0} tips` : "";
      const wanted = night.wantedId === player.id ? " · Wanted" : "";
      score.innerHTML = `<b>${night.points[player.id] ?? 0}</b> pts · ${rooms} room${rooms === 1 ? "" : "s"}${tips}${wanted}`;
      item.append(who, score);
      return item;
    }),
  );
}

// The night's running layers, in a line each.
function renderBoardExtras(night: NightSnapshot): void {
  const lines: string[] = [];
  if (night.options.emptyingParty) lines.push(`${night.guests} guests are still at the party.`);
  for (const key of night.twists) {
    const twist = TWISTS.find((candidate) => candidate.key === key);
    if (twist) lines.push(`Twist: ${twist.name}. ${twist.blurb}`);
  }
  if (night.wantedId) lines.push(`${nameOf(night.wantedId)} is Wanted: ${NIGHT_POINTS.wantedBounty} points to whoever takes them out.`);
  if (night.options.invite) {
    lines.push(
      night.sharedScreen
        ? "Someone holds the cursed invitation. Three soft taps on your controller now and then means it's you."
        : "Someone holds the cursed invitation. If it's you, you'll see it during the round.",
    );
  }
  if (night.options.host && (room?.players.length ?? 0) >= HOST_MIN_PLAYERS) lines.push("Each round, one player sits out as the Party Host and plays tricks on the crowd.");
  $("board-extras").replaceChildren(
    ...lines.map((line) => {
      const item = document.createElement("li");
      item.textContent = line;
      return item;
    }),
  );
  const target = night.secret?.moleTargetId;
  const secret = $("board-secret");
  secret.hidden = !target;
  if (target) secret.textContent = `Only you can see this: you are the Mole. Make sure ${nameOf(target)} finishes the night in last place, without anyone working out it's you. Pull it off and it's worth ${NIGHT_POINTS.moleUnnoticed} points.`;
}

// Between rounds: the shop, the Mole vote and backing a finalist. Each of this screen's players gets a row.
type StepChoice = { label: string; action: ClientMessage; chosen?: boolean; disabled?: boolean; detail?: string; cost?: number; who?: string };

function localPlayers(): string[] {
  const ids = [playerId, ...couchSeats.map((seat) => seat.playerId)];
  return ids.filter((id) => room?.players.some((player) => player.id === id));
}

function stepChoices(night: NightSnapshot, id: string): { note: string; choices: StepChoice[] } {
  const phase = room?.phase;
  const others = (room?.players ?? []).filter((player) => player.id !== id);
  if (phase === "shop") {
    const tips = night.tips[id] ?? 0;
    const bought = night.perks[id];
    const done = night.shopDone.includes(id);
    const perks = PERKS.filter((perk) => !(night.sharedScreen && perk.needsPrivateText) && (!perk.needs || night.options[perk.needs]));
    return {
      note: done ? "Done shopping." : `${tips} tips to spend.`,
      choices: [
        ...perks.map((perk) => ({
          label: perk.name,
          detail: perk.blurb,
          cost: perk.cost,
          action: { type: "NIGHT_ACTION", action: { kind: "buy", perk: perk.key } } as ClientMessage,
          chosen: bought === perk.key,
          disabled: done || Boolean(bought) || tips < perk.cost,
        })),
        { label: "Done", action: { type: "NIGHT_ACTION", action: { kind: "done" } }, disabled: done },
      ],
    };
  }
  if (phase === "mole_vote") {
    const voted = night.moleVoted.includes(id);
    return {
      note: voted ? "Vote in. Waiting for everyone else." : "Who's the Mole?",
      choices: others.map((player) => ({
        label: player.displayName,
        who: player.id,
        action: { type: "NIGHT_ACTION", action: { kind: "vote", playerId: player.id } } as ClientMessage,
        disabled: voted,
      })),
    };
  }
  if (phase === "finale_pick") {
    if (night.finalists?.includes(id)) return { note: "You're dancing in the Last Dance.", choices: [] };
    const backed = night.backers[id];
    return {
      note: backed ? `Backing ${nameOf(backed)}.` : "Who are you backing?",
      choices: (night.finalists ?? []).map((finalist) => ({
        label: nameOf(finalist),
        who: finalist,
        action: { type: "NIGHT_ACTION", action: { kind: "back", playerId: finalist } } as ClientMessage,
        chosen: backed === finalist,
        disabled: Boolean(backed),
      })),
    };
  }
  return { note: "", choices: [] };
}

const STEP_TEXT = {
  shop: {
    title: "The shop",
    blurb: "Tips come from surviving, takedowns and contracts. Buy one perk for the next round, or save up.",
  },
  mole_vote: {
    title: "Who's the Mole?",
    blurb: `One of you has been quietly working to make someone finish last. Catch them and you get ${NIGHT_POINTS.moleCaughtVoter} points.`,
  },
  finale_pick: {
    title: "The Last Dance",
    blurb: `The top two dance in the Ballroom to decide the night. Back one of them: you'll steer a guest as a ghost to help, and get ${NIGHT_POINTS.backedFinalist} points if they win.`,
  },
} as const;

function renderStep(): void {
  const night = room?.night;
  const phase = room?.phase;
  if (!room || !night || (phase !== "shop" && phase !== "mole_vote" && phase !== "finale_pick")) return;
  const text = STEP_TEXT[phase];
  $("step-title").textContent = phase === "finale_pick" && night.finalists ? `The Last Dance: ${night.finalists.map(nameOf).join(" vs ")}` : text.title;
  $("step-blurb").textContent = text.blurb;
  const anyPad = mySource.kind === "pad" || couchSeats.length > 0;
  $("step-seats").replaceChildren(
    ...localPlayers().map((id) => {
      const { note, choices } = stepChoices(night, id);
      const focus = Math.min(stepFocus.get(id) ?? 0, Math.max(0, choices.length - 1));
      const box = document.createElement("div");
      box.className = "step-seat";
      const heading = document.createElement("h4");
      heading.append(swatch(id), `${nameOf(id)}${localLabel(id)}`);
      const status = document.createElement("p");
      status.className = "muted";
      status.textContent = note;
      const row = document.createElement("div");
      row.className = "choices";
      choices.forEach((choice, index) => {
        const button = document.createElement("button");
        if (choice.detail) {
          button.className = "perk";
          const title = document.createElement("strong");
          title.textContent = choice.label;
          const cost = document.createElement("span");
          cost.className = "cost";
          cost.textContent = `${choice.cost} tips`;
          const detail = document.createElement("span");
          detail.className = "detail";
          detail.textContent = choice.detail;
          button.append(title, cost, detail);
        } else {
          if (choice.who) button.append(swatch(choice.who));
          button.append(choice.label);
        }
        button.disabled = Boolean(choice.disabled);
        button.setAttribute("aria-pressed", String(Boolean(choice.chosen)));
        if (anyPad && index === focus && !choice.disabled) button.classList.add("focused");
        button.addEventListener("click", () => sendAs(id, choice.action));
        row.append(button);
      });
      box.append(heading, status, row);
      return box;
    }),
  );
  const isHost = room.hostId === playerId;
  $("step-skip").hidden = !isHost;
  const waiting =
    phase === "shop"
      ? room.players.filter((player) => !night.shopDone.includes(player.id))
      : phase === "mole_vote"
        ? room.players.filter((player) => !night.moleVoted.includes(player.id))
        : room.players.filter((player) => !night.finalists?.includes(player.id) && !night.backers[player.id]);
  const padHelp = anyPad ? " Controllers: d-pad to choose, A to confirm." : "";
  $("step-status").textContent = `${waiting.length > 0 ? `Waiting for ${waiting.map((player) => player.displayName).join(", ")}.` : ""}${padHelp}`;
}

function moveStepFocus(id: string, edges: Set<number>): void {
  const night = room?.night;
  if (!night) return;
  const { choices } = stepChoices(night, id);
  if (choices.length === 0) return;
  let focus = Math.min(stepFocus.get(id) ?? 0, choices.length - 1);
  if (edges.has(PAD.LEFT) || edges.has(PAD.UP)) focus = (focus + choices.length - 1) % choices.length;
  if (edges.has(PAD.RIGHT) || edges.has(PAD.DOWN)) focus = (focus + 1) % choices.length;
  stepFocus.set(id, focus);
  const choice = choices[focus];
  if (edges.has(PAD.A) && !choice.disabled) sendAs(id, choice.action);
  renderStep();
}

$("step-skip").addEventListener("click", () => connection.send({ type: "NIGHT_ACTION", action: { kind: "skip" } }));

function renderNightOver(): void {
  const night = room?.night;
  if (!room || !night?.standings) return;
  const winner = night.standings[0];
  $("night-over-title").textContent = !winner
    ? "The night is over."
    : night.finaleWinner === winner.playerId
      ? `${nameOf(winner.playerId)} wins the Last Dance and the night!`
      : `${nameOf(winner.playerId)} wins the night!`;
  // Top three on a podium: second, first, third from left to right.
  const podium = [night.standings[1], night.standings[0], night.standings[2]];
  $("podium").replaceChildren(
    ...podium.map((standing, index) => {
      const step = document.createElement("div");
      if (!standing) {
        step.className = "step empty";
        return step;
      }
      const place = [2, 1, 3][index];
      step.className = `step place-${place}`;
      step.style.setProperty("--owner", colorOf(standing.playerId));
      const who = document.createElement("strong");
      who.textContent = nameOf(standing.playerId);
      const total = document.createElement("span");
      total.textContent = `${standing.total} pts`;
      const block = document.createElement("div");
      block.className = "block";
      block.textContent = String(place);
      step.append(who, total, block);
      return step;
    }),
  );
  if (!nightOverPlayed) {
    nightOverPlayed = true;
    sound.play("win");
  }
  const reveal = night.moleReveal;
  const moleLine = $("mole-reveal");
  moleLine.hidden = !reveal;
  if (reveal) {
    const plot = `${nameOf(reveal.moleId)} was the Mole, trying to put ${nameOf(reveal.targetId)} in last place.`;
    moleLine.textContent = reveal.caught
      ? `${plot} They got caught.`
      : reveal.objectiveMet
        ? `${plot} Nobody caught them, and it worked: +${NIGHT_POINTS.moleUnnoticed} points.`
        : `${plot} Nobody caught them, but it didn't work.`;
  }
  const awards = night.awards ?? [];
  $("awards-title").hidden = awards.length === 0;
  $("awards").replaceChildren(
    ...awards.map((award) => {
      const item = document.createElement("li");
      const title = document.createElement("span");
      title.append(swatch(award.playerId));
      const strong = document.createElement("b");
      strong.textContent = award.title;
      title.append(strong, ` ${nameOf(award.playerId)}`);
      const detail = document.createElement("span");
      detail.textContent = award.detail;
      item.append(title, detail);
      return item;
    }),
  );
  $("standings").replaceChildren(
    ...night.standings.map((standing) => {
      const row = document.createElement("tr");
      const who = document.createElement("td");
      who.append(swatch(standing.playerId), nameOf(standing.playerId));
      row.append(who, ...[standing.points, standing.rooms, standing.connectedPairs, standing.total].map(cell));
      return row;
    }),
  );
  const isHost = room.hostId === playerId;
  $("night-to-lobby").hidden = !isHost;
  $("night-over-wait").hidden = isHost;
}

function signed(value: number): string {
  return value < 0 ? `${value}` : `+${value}`;
}

function cell(value: number): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = String(value);
  return td;
}

function swatch(id: string): HTMLElement {
  const dot = document.createElement("span");
  dot.className = "swatch";
  dot.style.background = colorOf(id);
  return dot;
}

function colorOf(id: string): string {
  const index = room?.players.findIndex((player) => player.id === id) ?? -1;
  return index >= 0 ? PLAYER_COLORS[index % PLAYER_COLORS.length] : "transparent";
}

function nameOf(id?: string): string {
  return room?.players.find((player) => player.id === id)?.displayName ?? "Someone who left";
}

// Game ------------------------------------------------------------------

$("back-to-lobby").addEventListener("click", () => connection.send({ type: "RETURN_TO_LOBBY" }));

function startGame(): void {
  if (game) return;
  $("results").hidden = true;
  show("game");
  const seats: GameSeat[] = [
    { id: "me", source: mySource, send: (input) => connection.send({ type: "PLAYER_INPUT", input }) },
    ...couchSeats.map((seat) => ({
      id: seat.key,
      source: { kind: "pad", index: seat.pad } as const,
      send: (input: CrowdInput) => seat.connection.send({ type: "PLAYER_INPUT", input }),
    })),
  ];
  game = new CrowdGame($<HTMLCanvasElement>("arena"), $("hud"), seats, nameOf, sharedScreen());
  showRoundIntro();
}

// A title card for each room of the night, shown over the first few seconds of the round.
let introTimer: number | undefined;
function showRoundIntro(): void {
  const night = room?.night;
  const intro = $("round-intro");
  window.clearTimeout(introTimer);
  intro.hidden = true;
  if (!room) return;
  const finale = Boolean(night && !night.current && night.finalists);
  const mansionRoom = MANSION_ROOMS.find((candidate) => candidate.key === night?.current)
    ?? (night ? undefined : MANSION_ROOMS.find((candidate) => candidate.minigameId === room!.selectedMinigameId));
  if (!finale && !mansionRoom) return;
  const mode = MODES.find((candidate) => candidate.id === mansionRoom?.minigameId);
  $("intro-icon").innerHTML = roomIcon(finale ? "ballroom" : mansionRoom!.key);
  $("intro-round").textContent = finale ? "The final dance" : night ? `Round ${night.roundsPlayed + 1} of ${night.totalRounds}` : "Quick play";
  $("intro-room").textContent = finale ? "The Ballroom" : mansionRoom!.name;
  $("intro-mode").textContent = finale ? `${night!.finalists!.map(nameOf).join(" vs ")}` : (mode?.name ?? "");
  $("intro-blurb").textContent = finale
    ? "Hit the other finalist to win the night. Everyone else steers a guest."
    : (mode?.blurb ?? "");
  $("intro-controls").textContent = controlsLine();
  // The first time someone meets a room the card stays up longer; any key, click or button dismisses it.
  const key = finale ? "ballroom" : mansionRoom!.key;
  const firstTime = !seenRooms().includes(key);
  if (firstTime) markRoomSeen(key);
  intro.classList.toggle("first", firstTime);
  intro.hidden = false;
  intro.classList.remove("leaving");
  introTimer = window.setTimeout(hideRoundIntro, firstTime ? 8000 : 3200);
}

function hideRoundIntro(): void {
  const intro = $("round-intro");
  if (intro.hidden || intro.classList.contains("leaving")) return;
  window.clearTimeout(introTimer);
  intro.classList.add("leaving");
  introTimer = window.setTimeout(() => (intro.hidden = true), 400);
}

for (const type of ["keydown", "pointerdown"]) window.addEventListener(type, () => !$("round-intro").hidden && hideRoundIntro());

function controlsLine(): string {
  if (window.matchMedia("(pointer: coarse)").matches && !sharedScreen()) return "Stick to move · Act button to act · Tap the crowd to shoot · Hold Run to run";
  if (mySource.kind === "pad" || sharedScreen()) return "Stick to move · A acts · X shoots · RB runs";
  return "WASD or arrows to move · E acts · Click shoots · Shift runs";
}

const SEEN_KEY = "morbid-masquerade:seen-rooms";
function seenRooms(): string[] {
  return (readStored(SEEN_KEY) ?? "").split(",").filter(Boolean);
}

function markRoomSeen(key: string): void {
  writeStored(SEEN_KEY, [...seenRooms(), key].join(","));
}

function stopGame(): void {
  game?.destroy();
  game = undefined;
}

function applyGame(snapshot: GameSnapshot | undefined): void {
  if (!snapshot?.crowd) return;
  startGame();
  game!.applyView("me", snapshot.crowd, snapshot.endsAt);
  if (snapshot.crowd.result) showResults(snapshot);
}

function showResults(snapshot: GameSnapshot): void {
  const result = snapshot.crowd!.result!;
  const name = (id?: string) => room?.players.find((player) => player.id === id)?.displayName ?? "Someone";
  const title =
    result.winner === "player"
      ? `${name(result.winnerPlayerId)} wins!`
      : result.winner === "killer"
        ? `The Killer, ${name(result.winnerPlayerId)}, wins!`
        : result.winner === "hunters"
          ? "The Hunters win!"
          : result.winner === "ringers"
            ? "The Ringers win!"
            : result.winner === "lookouts"
              ? "The Lookouts win!"
              : "Nobody won this one.";
  $("results-title").textContent = title;
  // Round points arrive with the room update that follows the result.
  const night = room?.phase === "results" ? room.night : undefined;
  const last = night?.lastRound;
  const round = last && (last.room === "ballroom" ? Boolean(night?.finaleWinner) : night?.played.at(-1) === last.room) ? last : undefined;
  $("reveal").replaceChildren(
    ...result.reveal.map((entry) => {
      const item = document.createElement("li");
      const won = entry.playerId === result.winnerPlayerId || (result.winnerRole !== undefined && entry.role === result.winnerRole);
      item.className = won ? "won" : "";
      const who = document.createElement("span");
      who.className = "who";
      who.append(swatch(entry.playerId), name(entry.playerId));
      if (entry.role !== "runner") {
        const role = document.createElement("span");
        role.className = `chip role-${entry.role}`;
        role.textContent = ROLE_NAMES[entry.role];
        who.append(role);
      }
      const what = document.createElement("span");
      what.className = "tag";
      const status = document.createElement("span");
      status.textContent = entry.alive ? "survived" : "down";
      status.className = entry.alive ? "" : "down";
      what.append(status);
      if (round?.claimedBy === entry.playerId) {
        const claim = document.createElement("span");
        claim.className = "chip claim";
        claim.textContent = "claims the room";
        what.append(claim);
      }
      if (round) {
        const value = round.points[entry.playerId] ?? 0;
        const points = document.createElement("b");
        points.className = `points${value < 0 ? " negative" : ""}`;
        points.textContent = signed(value);
        what.append(points);
      }
      item.append(who, what);
      return item;
    }),
  );
  const isHost = room?.hostId === playerId;
  $("next-round").hidden = !isHost || !room?.night;
  $("next-round").textContent = night && night.roundsPlayed >= night.totalRounds ? "Continue" : "Back to the mansion";
  $("back-to-lobby").hidden = !isHost || Boolean(room?.night);
  $("results-wait").hidden = isHost;
  $("results").hidden = false;
}

// Messages --------------------------------------------------------------

function onMessage(message: ServerMessage): void {
  switch (message.type) {
    case "ROOM_STATE": {
      $("landing-status").textContent = "";
      if (resumeAttempts > 0 || resuming) showToast("Back in the room.", "info");
      resumeAttempts = 0;
      resuming = false;
      room = message.room;
      playerId = message.playerId;
      if (message.resumeToken) myToken = message.resumeToken;
      saveSession();
      if (room.selectedMinigameId.startsWith("crowd_")) selectedMode = room.selectedMinigameId;
      if (room.phase !== "night_over") nightOverPlayed = false;
      history.replaceState(null, "", `?room=${room.code}${serverQuery()}`);
      if (room.phase === "lobby") {
        stopGame();
        show("lobby");
        renderLobby();
      } else if (room.phase === "board") {
        stopGame();
        show("board");
        renderBoard();
      } else if (room.phase === "shop" || room.phase === "mole_vote" || room.phase === "finale_pick") {
        // Each step starts with every controller on its first choice.
        if (screens.step.hidden || stepPhase !== room.phase) stepFocus.clear();
        stepPhase = room.phase;
        stopGame();
        show("step");
        renderStep();
      } else if (room.phase === "night_over") {
        stopGame();
        show("nightOver");
        renderNightOver();
      } else if (room.game?.crowd) {
        applyGame(room.game);
      } else {
        stopGame();
        show("lobby");
        renderLobby();
        $("lobby-status").textContent = `${room.game?.name ?? "This game"} is only in the desktop client. Waiting for it to finish.`;
      }
      return;
    }
    case "GAME_STATE":
    case "GAME_OVER":
      applyGame(message.game);
      return;
    case "ERROR":
      showToast(message.message);
      $("landing-status").textContent = message.message;
      // The seat couldn't be taken back: start over from the landing screen.
      if (resuming || resumeAttempts > 0) {
        resuming = false;
        resumeAttempts = 0;
        forgetSession();
        removeAllCouchSeats();
        room = undefined;
        stopGame();
        show("landing");
      }
      return;
  }
}

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
