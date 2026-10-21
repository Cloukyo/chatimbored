import "./style.css";
import type { GameSnapshot, RoomSnapshot, ServerMessage } from "../../shared/message-types/protocol.js";
import { CrowdGame } from "./crowd/CrowdGame.js";
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
] as const;

const ROLE_NAMES = { runner: "", killer: "Killer", hunter: "Hunter", ringer: "Ringer", lookout: "Lookout" } as const;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = { landing: $("landing"), lobby: $("lobby"), game: $("game") };

let room: RoomSnapshot | undefined;
let playerId = "";
let selectedMode: string = MODES[0].id;
let game: CrowdGame | undefined;
let toastTimer: number | undefined;

const serverUrl = resolveServerUrl();
wakeServer(serverUrl);
const connection = new Connection(
  serverUrl,
  onMessage,
  (reason) => {
    showToast(`${reason} Refresh to reconnect.`);
    $("landing-status").textContent = "";
    room = undefined;
    stopGame();
    show("landing");
  },
  () => ($("landing-status").textContent = "Waking up the game server. This can take up to a minute the first time."),
);

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

$("leave").addEventListener("click", () => {
  connection.send({ type: "LEAVE_ROOM" });
  room = undefined;
  show("landing");
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

function renderLobby(): void {
  if (!room) return;
  const isHost = room.hostId === playerId;
  $("room-code").textContent = room.code;

  const list = $("players");
  list.replaceChildren(
    ...room.players.map((player) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = `${player.displayName}${player.id === playerId ? " (you)" : ""}`;
      const tag = document.createElement("span");
      tag.className = player.isHost || player.isReady ? "tag ok" : "tag";
      tag.textContent = `${player.isHost ? "Host" : player.isReady ? "Ready" : "Not ready"} · ${player.score} pts`;
      item.append(name, tag);
      return item;
    }),
  );

  for (const button of modesBox.querySelectorAll<HTMLButtonElement>(".mode")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === selectedMode));
    button.disabled = !isHost;
  }

  const me = room.players.find((player) => player.id === playerId);
  const readyButton = $<HTMLButtonElement>("ready");
  readyButton.hidden = isHost;
  readyButton.textContent = me?.isReady ? "Not ready" : "Ready";

  const everyoneReady = room.players.every((player) => player.isHost || player.isReady);
  const startButton = $<HTMLButtonElement>("start");
  startButton.hidden = !isHost;
  startButton.disabled = room.players.length < 2 || !everyoneReady;
  $("lobby-status").textContent = !isHost
    ? "The host picks the game and starts when everyone's ready."
    : room.players.length < 2
      ? "Share the invite link. You need at least 2 players."
      : everyoneReady
        ? ""
        : "Waiting for everyone to ready up.";
}

// Game ------------------------------------------------------------------

$("back-to-lobby").addEventListener("click", () => connection.send({ type: "RETURN_TO_LOBBY" }));

function startGame(): void {
  if (game) return;
  $("results").hidden = true;
  show("game");
  game = new CrowdGame(
    $<HTMLCanvasElement>("arena"),
    $("hud"),
    (input) => connection.send({ type: "PLAYER_INPUT", input }),
    (id) => room?.players.find((player) => player.id === id)?.displayName ?? "Someone who left",
  );
}

function stopGame(): void {
  game?.destroy();
  game = undefined;
}

function applyGame(snapshot: GameSnapshot | undefined): void {
  if (!snapshot?.crowd) return;
  startGame();
  game!.applyView(snapshot.crowd, snapshot.endsAt);
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
  $("reveal").replaceChildren(
    ...result.reveal.map((entry) => {
      const item = document.createElement("li");
      const who = document.createElement("span");
      who.textContent = name(entry.playerId);
      const what = document.createElement("span");
      what.className = "tag";
      const role = entry.role === "runner" ? "" : `${ROLE_NAMES[entry.role]} · `;
      what.textContent = `${role}${entry.alive ? "survived" : "down"}`;
      item.append(who, what);
      return item;
    }),
  );
  const isHost = room?.hostId === playerId;
  $("back-to-lobby").hidden = !isHost;
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
