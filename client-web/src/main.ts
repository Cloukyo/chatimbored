import "./style.css";
import type { CrowdInput } from "../../shared/crowd/protocol.js";
import type { ClientMessage, GameSnapshot, RoomSnapshot, ServerMessage } from "../../shared/message-types/protocol.js";
import { MANSION_ROOMS, type MansionRoomKey } from "../../shared/party/night.js";
import { CrowdGame, type GameSeat, type InputSource } from "./crowd/CrowdGame.js";
import { PAD, PadEdges, connectedPads } from "./input/pads.js";
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

const ROLE_NAMES = { runner: "", killer: "Killer", hunter: "Hunter", ringer: "Ringer", lookout: "Lookout" } as const;

// Board colours, by join order.
const PLAYER_COLORS = ["#e9806b", "#6ba3e9", "#7fb069", "#e8d26a", "#b48ce0", "#e0a64a", "#5fc7b9", "#e58bb5"];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = { landing: $("landing"), lobby: $("lobby"), board: $("board"), nightOver: $("night-over"), game: $("game") };

// An extra player on this screen, with their own controller and their own connection to the room.
type CouchSeat = { key: string; pad: number; connection: Connection; playerId: string; readied: boolean };

let room: RoomSnapshot | undefined;
let playerId = "";
let selectedMode: string = MODES[0].id;
let game: CrowdGame | undefined;
let toastTimer: number | undefined;
let mySource: InputSource = { kind: "keyboard" };
let claimingPad = false;
let boardFocus = 0;
const couchSeats: CouchSeat[] = [];
const menuEdges = new PadEdges();

const serverUrl = resolveServerUrl();
wakeServer(serverUrl);
const connection = new Connection(
  serverUrl,
  onMessage,
  (reason) => {
    showToast(`${reason} Refresh to reconnect.`);
    $("landing-status").textContent = "";
    room = undefined;
    removeAllCouchSeats();
    stopGame();
    show("landing");
  },
  () => ($("landing-status").textContent = "Waking up the game server. This can take up to a minute the first time."),
);

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
  connection.send({ type: "START_NIGHT", rounds, sharedScreen: sharedScreen() });
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
      name.append(swatch(player.id), `${player.displayName}${localLabel(player.id)}`);
      const tag = document.createElement("span");
      tag.className = player.isHost || player.isReady ? "tag ok" : "tag";
      tag.textContent = `${player.isHost ? "Host" : player.isReady ? "Ready" : "Not ready"} · ${player.score} pts`;
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
      : `Playing on one screen? Press <b>A</b> on each extra controller to add a player, <b>B</b> to remove them.${
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

// Couch seats -----------------------------------------------------------

function addCouchSeat(pad: number): void {
  if (!room || room.phase !== "lobby" || couchSeats.length + 1 >= 8) return;
  const seatConnection = new Connection(
    serverUrl,
    (message) => onSeatMessage(seat, message),
    () => removeCouchSeat(seat, false),
  );
  const seat: CouchSeat = { key: `pad-${pad}`, pad, connection: seatConnection, playerId: "", readied: false };
  couchSeats.push(seat);
  seat.connection.send({ type: "JOIN_ROOM", roomCode: room.code, displayName: `Pad ${pad + 1}` });
  renderLobby();
}

function removeCouchSeat(seat: CouchSeat, sayGoodbye = true): void {
  const index = couchSeats.indexOf(seat);
  if (index === -1) return;
  couchSeats.splice(index, 1);
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
      if (!seat.playerId) removeCouchSeat(seat, false);
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
    } else if (edges.has(PAD.START) && hostPad && !$<HTMLButtonElement>("start-night").disabled) {
      startNight();
    }
    return;
  }

  if (room.phase === "board") {
    const picker = boardPickerSeat();
    const padPicker = picker && (picker === playerId ? mine : couchSeatFor(picker)?.pad === pad);
    if (!padPicker && !hostPad) return;
    const options = room.night?.options ?? [];
    if (edges.has(PAD.LEFT) || edges.has(PAD.UP)) boardFocus = (boardFocus + options.length - 1) % Math.max(1, options.length);
    if (edges.has(PAD.RIGHT) || edges.has(PAD.DOWN)) boardFocus = (boardFocus + 1) % Math.max(1, options.length);
    if (edges.has(PAD.A) && options[boardFocus]) pickRoom(options[boardFocus]);
    renderBoard();
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
  boardFocus = Math.min(boardFocus, Math.max(0, night.options.length - 1));
  $("board-title").textContent = `Party Night · Round ${night.roundsPlayed + 1} of ${night.totalRounds}`;
  $("end-night").hidden = !isHost;

  $("mansion").replaceChildren(
    ...[...MANSION_ROOMS]
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((mansionRoom) => {
        const tile = document.createElement("button");
        const offered = night.options.indexOf(mansionRoom.key);
        const played = night.played.includes(mansionRoom.key);
        const owner = night.claims[mansionRoom.key];
        const skipped = night.sharedScreen && mansionRoom.needsPrivateText;
        tile.className = `room${played ? " played" : ""}${offered >= 0 ? " offered" : ""}${offered === boardFocus && offered >= 0 ? " focused" : ""}`;
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
        tile.append(name, mode, state);
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

  const ranked = [...room.players].sort((a, b) => (night.points[b.id] ?? 0) - (night.points[a.id] ?? 0));
  $("scoreboard").replaceChildren(
    ...ranked.map((player) => {
      const item = document.createElement("li");
      const who = document.createElement("span");
      who.append(swatch(player.id), `${player.displayName}${localLabel(player.id)}`);
      const rooms = Object.values(night.claims).filter((owner) => owner === player.id).length;
      const score = document.createElement("span");
      score.innerHTML = `<b>${night.points[player.id] ?? 0}</b> pts · ${rooms} room${rooms === 1 ? "" : "s"}`;
      item.append(who, score);
      return item;
    }),
  );
}

function renderNightOver(): void {
  const night = room?.night;
  if (!room || !night?.standings) return;
  const winner = night.standings[0];
  $("night-over-title").textContent = winner ? `${nameOf(winner.playerId)} wins the night!` : "The night is over.";
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

function cell(value: number): HTMLTableCellElement {
  const td = document.createElement("td");
  td.textContent = String(value);
  return td;
}

function swatch(id: string): HTMLElement {
  const dot = document.createElement("span");
  dot.className = "swatch";
  const index = room?.players.findIndex((player) => player.id === id) ?? -1;
  dot.style.background = index >= 0 ? PLAYER_COLORS[index % PLAYER_COLORS.length] : "transparent";
  return dot;
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
  const round = night?.lastRound && night.played.at(-1) === night.lastRound.room ? night.lastRound : undefined;
  $("reveal").replaceChildren(
    ...result.reveal.map((entry) => {
      const item = document.createElement("li");
      const who = document.createElement("span");
      who.textContent = name(entry.playerId);
      const what = document.createElement("span");
      what.className = "tag";
      const role = entry.role === "runner" ? "" : `${ROLE_NAMES[entry.role]} · `;
      const points = round ? ` · +${round.points[entry.playerId] ?? 0} pts${round.claimedBy === entry.playerId ? ", claims the room" : ""}` : "";
      what.textContent = `${role}${entry.alive ? "survived" : "down"}${points}`;
      item.append(who, what);
      return item;
    }),
  );
  const isHost = room?.hostId === playerId;
  $("next-round").hidden = !isHost || !room?.night;
  $("next-round").textContent = night && night.roundsPlayed >= night.totalRounds ? "Final standings" : "Back to the mansion";
  $("back-to-lobby").hidden = !isHost || Boolean(room?.night);
  $("results-wait").hidden = isHost;
  $("results").hidden = false;
}

// Messages --------------------------------------------------------------

function onMessage(message: ServerMessage): void {
  switch (message.type) {
    case "ROOM_STATE": {
      $("landing-status").textContent = "";
      room = message.room;
      playerId = message.playerId;
      if (room.selectedMinigameId.startsWith("crowd_")) selectedMode = room.selectedMinigameId;
      history.replaceState(null, "", `?room=${room.code}${serverQuery()}`);
      if (room.phase === "lobby") {
        stopGame();
        show("lobby");
        renderLobby();
      } else if (room.phase === "board") {
        stopGame();
        show("board");
        renderBoard();
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

function showToast(text: string): void {
  const toast = $("toast");
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
