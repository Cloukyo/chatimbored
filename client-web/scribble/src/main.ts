import "./style.css";
import type { GameSnapshot, RoomSnapshot, ServerMessage } from "../../../shared/message-types/protocol.js";
import {
  GAME_NAMES,
  INK,
  BRUSHES,
  MODES,
  SCRIBBLE_ID,
  playerInk,
  type ArtRef,
  type Fighter,
  type ScribbleInput,
  type ScribbleMode,
  type ScribbleView,
  type Stroke,
} from "../../../shared/scribble/protocol.js";
import { Connection, resolveServerUrl, wakeServer } from "../../src/net.js";
import { DrawPad, artCanvas } from "./art.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const screens = { landing: $("landing"), lobby: $("lobby"), game: $("game"), results: $("results") };

const SESSION_KEY = "scribble:session";
const RESUME_ATTEMPTS = 20;
const RESUME_DELAY_MS = 1500;
const STREAM_EVERY_MS = 100;

let room: RoomSnapshot | undefined;
let view: ScribbleView | undefined;
let myId = "";
let myToken = "";
let resumeAttempts = 0;
let resuming = false;
let selectedMode: ScribbleMode = "night";
let deadline = 0;
let toastTimer: number | undefined;
let askedForArt = 0;
const art = new Map<ArtRef, Stroke[]>();

const serverUrl = resolveServerUrl();
wakeServer(serverUrl);
const connection = new Connection(
  serverUrl,
  onMessage,
  (reason) => {
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

function send(input: ScribbleInput): void {
  connection.send({ type: "PLAYER_INPUT", input });
}

const amScreen = () => Boolean(room?.players.find((player) => player.id === myId)?.screen);
const amHost = () => room?.hostId === myId;
const nameOf = (id?: string) => view?.players.find((player) => player.id === id)?.name ?? room?.players.find((player) => player.id === id)?.displayName ?? "Someone";
const inkOf = (id?: string) => INK[playerInk(view?.players.find((player) => player.id === id)?.color ?? 0)];

// Help --------------------------------------------------------------------------

const help = $<HTMLDialogElement>("help");
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-help]")) button.addEventListener("click", () => help.showModal());
$("help-close").addEventListener("click", () => help.close());
help.addEventListener("click", (event) => event.target === help && help.close());

// Landing -----------------------------------------------------------------------

const nameInput = $<HTMLInputElement>("name");
const codeInput = $<HTMLInputElement>("code");
const tvBox = $<HTMLInputElement>("as-tv");
nameInput.value = readStored("chatimbored:name") ?? "";
codeInput.value = new URLSearchParams(location.search).get("room")?.toUpperCase().slice(0, 5) ?? "";
tvBox.addEventListener("change", () => {
  nameInput.disabled = tvBox.checked;
  nameInput.placeholder = tvBox.checked ? "The TV doesn't need a name" : "Display name";
});

$("create").addEventListener("click", () => {
  const displayName = requireName();
  if (displayName) connection.send({ type: "CREATE_ROOM", displayName, screen: tvBox.checked || undefined });
});
$("join").addEventListener("click", joinFromForm);
codeInput.addEventListener("keydown", (event) => event.key === "Enter" && joinFromForm());

function joinFromForm(): void {
  const displayName = requireName();
  const roomCode = codeInput.value.trim().toUpperCase();
  if (!displayName) return;
  if (roomCode.length !== 5) {
    $("landing-status").textContent = "Room codes are 5 characters.";
    return;
  }
  connection.send({ type: "JOIN_ROOM", roomCode, displayName, screen: tvBox.checked || undefined });
}

function requireName(): string | undefined {
  if (tvBox.checked) return "📺 TV";
  const name = nameInput.value.trim();
  if (!name) {
    $("landing-status").textContent = "Pick a name first.";
    nameInput.focus();
    return undefined;
  }
  writeStored("chatimbored:name", name);
  return name;
}

// Lobby ---------------------------------------------------------------------------

const modesBox = $("modes");
for (const mode of MODES) {
  const button = el("button", { className: "mode", dataset: { mode: mode.key } }, el("strong", {}, mode.name), el("span", {}, mode.blurb), el("small", {}, mode.minutes));
  button.addEventListener("click", () => {
    selectedMode = mode.key;
    renderLobby();
  });
  modesBox.append(button);
}

$("ready").addEventListener("click", () => {
  const mine = room?.players.find((player) => player.id === myId);
  connection.send({ type: "PLAYER_READY", isReady: !mine?.isReady });
});
$("start").addEventListener("click", () => {
  connection.send({ type: "START_GAME", minigameId: SCRIBBLE_ID, scribbleMode: selectedMode, blind: $<HTMLInputElement>("blind").checked });
});
$("leave").addEventListener("click", () => {
  connection.send({ type: "LEAVE_ROOM" });
  leaveToLanding();
});
$("copy-link").addEventListener("click", async () => {
  if (!room) return;
  const link = inviteLink();
  try {
    await navigator.clipboard.writeText(link);
    showToast("Invite link copied.", "info");
  } catch {
    showToast(link, "info");
  }
});

function inviteLink(): string {
  return `${location.origin}${location.pathname}?room=${room?.code ?? ""}${serverQuery()}`;
}

function renderLobby(): void {
  if (!room) return;
  $("room-code").textContent = room.code;
  const players = room.players.filter((player) => !player.screen);
  $("join-hint").textContent = amScreen() ? `On your phone, go to ${location.host}${location.pathname} and join room ${room.code}.` : "";
  $("players").replaceChildren(
    ...room.players.map((player) =>
      el(
        "li",
        {},
        el("span", { className: "name" }, `${player.displayName}${player.id === myId ? " (you)" : ""}`),
        el(
          "span",
          { className: `tag${player.isReady || player.isHost || player.screen ? " ready" : ""}` },
          player.away ? "reconnecting…" : player.screen ? (player.isHost ? "TV, host" : "TV") : player.isHost ? "host" : player.isReady ? "ready" : "not ready",
        ),
      ),
    ),
  );
  const isHost = amHost();
  for (const button of modesBox.querySelectorAll<HTMLButtonElement>("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === selectedMode));
    button.disabled = !isHost;
  }
  $<HTMLInputElement>("blind").disabled = !isHost;
  const mine = room.players.find((player) => player.id === myId);
  $("ready").hidden = isHost || amScreen();
  $("ready").textContent = mine?.isReady ? "Not ready" : "Ready";
  $("start").hidden = !isHost;
  const everyoneReady = room.players.every((player) => player.isReady || player.isHost || player.screen);
  $<HTMLButtonElement>("start").disabled = !everyoneReady || players.length < 3;
  $("lobby-status").textContent =
    players.length < 3
      ? `Scribble Scrap needs at least 3 players. ${players.length === 0 ? "Nobody has" : players.length === 1 ? "1 has" : `${players.length} have`} joined so far.`
      : !isHost
        ? "The host picks what to play and starts the game."
        : everyoneReady
          ? ""
          : "Waiting for everyone to be ready.";
}

// Game: header, timer and player chips -------------------------------------------------

$("skip").addEventListener("click", () => send({ kind: "scribble", action: "skip" }));

const STEP_TITLES: Record<string, string> = {
  intro: "",
  draw: "Draw!",
  caption: "Caption it",
  vote: "Vote",
  scores: "Scores",
  secret: "Your secret",
  turns: "One stroke each",
  accuse: "Who's the forger?",
  guess: "Last chance",
  reveal: "The reveal",
  pick: "Pick your cards",
  fight: "Fight!",
  ko: "K.O.!",
  final: "That's the game",
};

function renderHeader(current: ScribbleView): void {
  const name = GAME_NAMES[current.game];
  $("part").textContent = current.parts > 1 ? `Part ${current.part} of ${current.parts} · ` : current.rounds > 1 ? `Round ${current.round} of ${current.rounds} · ` : "";
  $("title").textContent = `${name}${current.blind ? " (blind)" : ""}${STEP_TITLES[current.step] ? `: ${STEP_TITLES[current.step]}` : ""}`;
  $("skip").hidden = !amHost() || current.step === "final";
  const waiting = ["draw", "caption", "vote", "pick", "accuse", "fight"].includes(current.step);
  $("chips").replaceChildren(
    ...[...current.players]
      .sort((a, b) => b.points - a.points)
      .map((player) => {
        const gain = current.gains?.[player.id];
        return el(
          "li",
          { className: `chip${player.done && waiting ? " done" : ""}${player.away ? " away" : ""}${player.id === myId ? " me" : ""}` },
          el("span", { className: "dot", style: `background:${INK[playerInk(player.color)]}` }),
          el("span", { className: "name" }, player.name),
          el("span", { className: "points" }, String(player.points)),
          gain ? el("span", { className: "gain" }, `+${gain}`) : "",
          waiting && player.done ? el("span", { className: "tick", title: "Done" }, "✓") : "",
        );
      }),
  );
}

function secondsLeft(): number {
  return Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
}

// The stage: one panel per step ----------------------------------------------------------

type Panel = { update(current: ScribbleView): void; timeUp?(): void; frame?(): void };
let panel: Panel | undefined;
let panelKey = "";
let timeUpFired = false;

function renderStage(current: ScribbleView): void {
  const key = `${current.part}:${current.round}:${current.step}`;
  if (key !== panelKey) {
    panelKey = key;
    timeUpFired = false;
    const stage = $("stage");
    stage.replaceChildren();
    stage.className = `stage step-${current.step} game-${current.game}`;
    panel = mountPanel(stage, current);
  }
  panel?.update(current);
}

function mountPanel(stage: HTMLElement, current: ScribbleView): Panel {
  switch (current.step) {
    case "intro":
      return introPanel(stage, current);
    case "draw":
      return drawPanel(stage, current);
    case "caption":
      return captionPanel(stage);
    case "vote":
    case "scores":
      return current.game === "brawl" ? championPanel(stage) : galleryPanel(stage);
    case "secret":
    case "turns":
    case "accuse":
    case "guess":
    case "reveal":
      return forgerPanel(stage);
    case "pick":
      return pickPanel(stage);
    case "fight":
    case "ko":
      return fightPanel(stage);
    default:
      return { update: () => undefined };
  }
}

const INTROS: Record<string, string> = {
  roast: "You'll get a prompt about someone in this room. Draw it. Then caption someone else's masterpiece, and vote for the best drawing and the best caption.",
  forger: "Everyone gets the same secret word, except the forger. Add one stroke each to a shared picture, twice round, then vote out the forger.",
  brawl: "Pick a fighter from two hands of cards, draw it, and give it a name. Fighters go head to head. Winner stays on.",
};

function introPanel(stage: HTMLElement, current: ScribbleView): Panel {
  stage.append(
    el(
      "div",
      { className: "intro" },
      el("h1", {}, GAME_NAMES[current.game]),
      current.blind ? el("p", { className: "blind-banner" }, "🙈 Blind round! You won't see your own lines.") : "",
      el("p", {}, INTROS[current.game]),
    ),
  );
  return { update: () => undefined };
}

// Draw (Roast Portraits and Doodle Brawl) ------------------------------------------------------

function toolbar(pad: DrawPad, onChange?: () => void): HTMLElement {
  const inks = INK.map((color, index) => {
    const button = el("button", { className: "ink", style: `background:${color}`, ariaLabel: `Ink ${index + 1}` });
    button.addEventListener("click", () => {
      pad.ink = index;
      sync();
    });
    return button;
  });
  const brushes = BRUSHES.map((size, index) => {
    const button = el("button", { className: "brush", ariaLabel: `Brush ${size}` }, el("span", { style: `width:${Math.min(28, size)}px;height:${Math.min(28, size)}px` }));
    button.addEventListener("click", () => {
      pad.brush = index;
      sync();
    });
    return button;
  });
  const undo = el("button", { className: "ghost small" }, "↶ Undo");
  undo.addEventListener("click", () => {
    pad.undo();
    onChange?.();
  });
  const clear = el("button", { className: "ghost small" }, "Clear");
  clear.addEventListener("click", () => {
    pad.clear();
    onChange?.();
  });
  function sync(): void {
    inks.forEach((button, index) => button.setAttribute("aria-pressed", String(index === pad.ink)));
    brushes.forEach((button, index) => button.setAttribute("aria-pressed", String(index === pad.brush)));
  }
  sync();
  return el("div", { className: "toolbar" }, el("div", { className: "inks" }, ...inks), el("div", { className: "brushes" }, ...brushes, undo, clear));
}

function drawPanel(stage: HTMLElement, current: ScribbleView): Panel {
  if (amScreen()) {
    const note = el("p", { className: "big-note" }, "");
    stage.append(el("div", { className: "waiting" }, el("div", { className: "pencil" }, "✏️"), note));
    return {
      update: (latest) => {
        const left = latest.players.filter((player) => !player.done && !player.away).length;
        note.textContent = left === 0 ? "Everyone's done!" : `Everyone's drawing${latest.blind ? " blind" : ""}. ${left} still going.`;
      },
    };
  }
  const brawl = current.game === "brawl";
  const prompt = el("p", { className: "prompt" });
  const nameField = el("input", { className: "fighter-name", maxLength: 24, placeholder: "Name your fighter" }) as HTMLInputElement;
  const canvas = el("canvas", { className: "pad" }) as HTMLCanvasElement;
  const pad = new DrawPad(canvas);
  pad.blind = current.blind;
  let sentAt = -1;
  let changes = 0;
  canvas.addEventListener("pointerup", () => (changes += 1));
  const doneButton = el("button", { className: "primary" }, "Done");
  const sentNote = el("div", { className: "sent" }, el("p", {}, "Sent! Waiting for everyone else."));
  const again = el("button", { className: "ghost small" }, "Keep drawing");
  sentNote.append(again);
  sentNote.hidden = true;
  const submit = () => {
    send({ kind: "scribble", action: "drawing", strokes: pad.strokes, name: brawl ? nameField.value.trim() : undefined });
    sentAt = changes;
  };
  doneButton.addEventListener("click", () => {
    submit();
    pad.locked = true;
    sentNote.hidden = false;
  });
  again.addEventListener("click", () => {
    pad.locked = false;
    sentNote.hidden = true;
  });
  stage.append(
    prompt,
    brawl ? nameField : "",
    current.blind ? el("p", { className: "blind-banner small" }, "🙈 Blind round: your page stays blank. Trust your hand.") : "",
    el("div", { className: "pad-wrap" }, canvas, sentNote),
    toolbar(pad, () => (changes += 1)),
    el("div", { className: "row end" }, doneButton),
  );
  return {
    update: (latest) => {
      if (brawl) {
        const cards = latest.brawl?.cards;
        prompt.replaceChildren(el("span", {}, "Draw your fighter: "), el("b", {}, cards ? `${cards.who} ${cards.with}` : "…"));
      } else {
        prompt.replaceChildren(el("span", {}, "Draw: "), el("b", {}, latest.roast?.prompt ?? "…"));
      }
    },
    // Whatever's on the page goes in when the clock runs out.
    timeUp: () => {
      if (sentAt !== changes || sentAt < 0) submit();
      pad.locked = true;
      sentNote.hidden = false;
    },
  };
}

// Roast Portraits: caption and gallery -------------------------------------------------------------

function captionPanel(stage: HTMLElement): Panel {
  if (amScreen()) {
    stage.append(el("div", { className: "waiting" }, el("div", { className: "pencil" }, "💬"), el("p", { className: "big-note" }, "Everyone's writing a caption for someone else's drawing.")));
    return { update: () => undefined };
  }
  const holder = el("div", { className: "caption-art" });
  const prompt = el("p", { className: "prompt" });
  const input = el("input", { maxLength: 60, placeholder: "Write a caption, headline or quote" }) as HTMLInputElement;
  const sendButton = el("button", { className: "primary" }, "Send");
  const status = el("p", { className: "muted" });
  let sent = "";
  const submit = () => {
    const text = input.value.trim();
    if (!text || text === sent) return;
    send({ kind: "scribble", action: "text", text });
    sent = text;
    status.textContent = "Sent! You can still change it.";
  };
  sendButton.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => event.key === "Enter" && submit());
  stage.append(prompt, holder, el("div", { className: "row" }, input, sendButton), status);
  let shown = "";
  return {
    update: (latest) => {
      const target = latest.roast?.toCaption;
      if (!target) {
        prompt.textContent = "Nothing for you to caption this time.";
        return;
      }
      prompt.replaceChildren(el("span", {}, "The prompt was: "), el("b", {}, target.prompt));
      if (shown !== target.art && art.has(target.art)) {
        shown = target.art;
        holder.replaceChildren(artCanvas(art.get(target.art), `caption:${target.art}`));
      }
    },
    timeUp: submit,
  };
}

function galleryPanel(stage: HTMLElement): Panel {
  const grid = el("div", { className: "gallery" });
  const note = el("p", { className: "muted center" });
  stage.append(note, grid);
  return {
    update: (latest) => {
      const roast = latest.roast;
      if (!roast?.entries) return;
      const voting = latest.step === "vote";
      const canVote = voting && !amScreen();
      note.textContent = voting
        ? canVote
          ? "Pick the best drawing and the best caption. Not your own!"
          : "Everyone's voting for the best drawing and the best caption."
        : "";
      grid.replaceChildren(
        ...roast.entries.map((entry) => {
          const mineDrawing = entry.artistId === myId;
          const mineCaption = entry.captionBy === myId;
          const card = el("figure", { className: `entry${roast.myVotes?.drawing === entry.art ? " voted-drawing" : ""}${roast.myVotes?.caption === entry.art ? " voted-caption" : ""}` });
          card.append(el("figcaption", { className: "entry-prompt" }, entry.prompt), artCanvas(art.get(entry.art), `gallery:${entry.art}`));
          card.append(el("p", { className: "entry-caption" }, entry.caption ? `“${entry.caption}”` : "(no caption)"));
          if (canVote) {
            const drawingVote = el("button", { className: "vote" }, roast.myVotes?.drawing === entry.art ? "🎨 Your pick" : "🎨 Best drawing");
            drawingVote.disabled = mineDrawing;
            drawingVote.addEventListener("click", () => send({ kind: "scribble", action: "vote", slot: "drawing", target: entry.art }));
            const captionVote = el("button", { className: "vote" }, roast.myVotes?.caption === entry.art ? "💬 Your pick" : "💬 Best caption");
            captionVote.disabled = mineCaption || !entry.caption;
            captionVote.addEventListener("click", () => send({ kind: "scribble", action: "vote", slot: "caption", target: entry.art }));
            card.append(el("div", { className: "row" }, drawingVote, captionVote));
            if (mineDrawing) card.append(el("p", { className: "muted small" }, "Your drawing"));
          } else if (!voting) {
            card.append(
              el(
                "p",
                { className: "credits" },
                el("span", { style: `color:${inkOf(entry.artistId)}` }, `🎨 ${nameOf(entry.artistId)}: ${entry.drawingVotes ?? 0}`),
                entry.caption ? el("span", { style: `color:${inkOf(entry.captionBy)}` }, `💬 ${nameOf(entry.captionBy)}: ${entry.captionVotes ?? 0}`) : "",
              ),
            );
          }
          return card;
        }),
      );
    },
  };
}

// The Forger ---------------------------------------------------------------------------------------

function forgerPanel(stage: HTMLElement): Panel {
  const secret = el("div", { className: "secret" });
  const order = el("ol", { className: "order" });
  const status = el("p", { className: "status-line" });
  const canvas = el("canvas", { className: "pad" }) as HTMLCanvasElement;
  const pad = new DrawPad(canvas);
  pad.locked = true;
  const actions = el("div", { className: "actions" });
  // Which turn of mine the pad was last unlocked for, by how many strokes were on the page then.
  let unlockedAt = -1;
  let myTurn = false;
  pendingGuess = undefined;
  pad.onStroke = (stroke, done) => {
    if (myTurn) send({ kind: "scribble", action: "stroke", stroke, done });
  };
  stage.append(secret, order, status, el("div", { className: "pad-wrap" }, canvas), actions);
  let actionsKey = "";

  return {
    update: (latest) => {
      const forger = latest.forger;
      if (!forger) return;
      const step = latest.step;
      // The secret card.
      if (step === "reveal") {
        secret.replaceChildren(el("span", {}, "The word was "), el("b", {}, (forger.word ?? "").toUpperCase()), el("span", {}, ` (${forger.category})`));
      } else if (amScreen()) {
        secret.replaceChildren(el("span", {}, "Category: "), el("b", {}, forger.category), el("span", { className: "muted" }, "  · Check your phone for the word"));
      } else if (forger.youAreForger) {
        secret.replaceChildren(el("b", { className: "forger-tag" }, "You're the FORGER."), el("span", {}, ` The category is ${forger.category}. Blend in.`));
      } else {
        secret.replaceChildren(el("span", {}, "The word is "), el("b", {}, (forger.word ?? "").toUpperCase()), el("span", {}, ` (${forger.category}). Don't make it too obvious.`));
      }
      secret.className = `secret${step === "secret" ? " big" : ""}`;
      // Turn order.
      order.replaceChildren(
        ...forger.order.map((id) =>
          el("li", { className: `${id === forger.turnId ? "now" : ""}${id === forger.forgerId ? " caught" : ""}`, style: `border-color:${inkOf(id)}` }, el("span", { className: "dot", style: `background:${inkOf(id)}` }), nameOf(id)),
        ),
      );
      order.hidden = step === "secret";
      // The shared canvas.
      myTurn = step === "turns" && forger.turnId === myId && !amScreen();
      const live = forger.live && forger.live.by !== myId ? [forger.live] : [];
      pad.under = [...forger.strokes, ...live];
      if (!myTurn) {
        pad.strokes = [];
        pad.locked = true;
      } else if (unlockedAt !== forger.strokes.length) {
        // A fresh turn of mine.
        unlockedAt = forger.strokes.length;
        pad.strokes = [];
        pad.locked = false;
        pad.ink = playerInk(latest.players.find((player) => player.id === myId)?.color ?? 0);
        pad.brush = 1;
      }
      pad.render();
      canvas.classList.toggle("my-turn", myTurn);
      (canvas.parentElement as HTMLElement).hidden = step === "secret";
      // What's going on.
      if (step === "secret") status.textContent = amScreen() ? "Everyone, look at your phone." : "Remember it. Drawing starts in a moment.";
      else if (step === "turns") status.textContent = myTurn ? "Your turn! Draw ONE stroke: put your finger down, draw, lift." : `${nameOf(forger.turnId)} is drawing… (lap ${forger.lap} of ${forger.laps})`;
      else if (step === "accuse") status.textContent = amScreen() ? "Everyone's voting for the forger." : "Who's the forger? Vote on your phone.";
      else if (step === "guess") status.textContent = `${nameOf(forger.forgerId)} was caught! They get one guess at the word.`;
      else if (step === "reveal") status.textContent = outcomeText(forger);
      status.className = `status-line${step === "reveal" ? ` outcome ${forger.outcome}` : ""}`;
      // Votes and guesses.
      const key = `${step}:${forger.myVote ?? ""}:${forger.accusedId ?? ""}`;
      if (key === actionsKey) return;
      actionsKey = key;
      actions.replaceChildren();
      if (step === "accuse" && !amScreen()) {
        actions.append(
          ...forger.order
            .filter((id) => id !== myId)
            .map((id) => {
              const button = el("button", { className: `suspect${forger.myVote === id ? " picked" : ""}`, style: `border-color:${inkOf(id)}` }, nameOf(id));
              button.addEventListener("click", () => send({ kind: "scribble", action: "vote", slot: "suspect", target: id }));
              return button;
            }),
        );
      } else if (step === "guess" && forger.youAreForger) {
        const input = el("input", { maxLength: 40, placeholder: "What was the word?" }) as HTMLInputElement;
        const guess = el("button", { className: "primary" }, "Guess");
        const submit = () => input.value.trim() && send({ kind: "scribble", action: "text", text: input.value.trim() });
        guess.addEventListener("click", submit);
        input.addEventListener("keydown", (event) => event.key === "Enter" && submit());
        actions.append(el("div", { className: "row" }, input, guess));
        pendingGuess = submit;
        input.focus();
      } else if (step === "reveal" && forger.votes) {
        actions.append(
          el(
            "ul",
            { className: "tally" },
            ...Object.entries(forger.votes)
              .sort((a, b) => b[1] - a[1])
              .map(([id, votes]) => el("li", {}, `${nameOf(id)}: ${votes} vote${votes === 1 ? "" : "s"}`)),
          ),
        );
      }
    },
    timeUp: () => pendingGuess?.(),
    // Stream the stroke while it's being drawn so everyone watches it happen.
    frame: () => {
      const live = pad.live;
      if (!myTurn || !live) return;
      const now = performance.now();
      if (now - lastStream < STREAM_EVERY_MS) return;
      lastStream = now;
      send({ kind: "scribble", action: "stroke", stroke: live, done: false });
    },
  };
}
let pendingGuess: (() => void) | undefined;
let lastStream = 0;

function outcomeText(forger: NonNullable<ScribbleView["forger"]>): string {
  const name = nameOf(forger.forgerId);
  if (forger.outcome === "escaped") return `${name} was the forger and got away with it!`;
  if (forger.outcome === "guessed") return `${name} was caught, but guessed “${forger.guess}”. Sneaky!`;
  return forger.guess ? `${name} was caught and guessed “${forger.guess}”. Wrong! The artists win.` : `${name} was caught red-handed. The artists win.`;
}

// Doodle Brawl ----------------------------------------------------------------------------------

function pickPanel(stage: HTMLElement): Panel {
  if (amScreen()) {
    stage.append(el("div", { className: "waiting" }, el("div", { className: "pencil" }, "🃏"), el("p", { className: "big-note" }, "Everyone's picking a fighter.")));
    return { update: () => undefined };
  }
  const choice = { who: -1, with: -1 };
  const whoRow = el("div", { className: "cards" });
  const withRow = el("div", { className: "cards" });
  const fight = el("button", { className: "primary" }, "That's my fighter");
  fight.addEventListener("click", () => send({ kind: "scribble", action: "pick", who: choice.who, with: choice.with }));
  stage.append(el("h3", {}, "Pick a fighter…"), whoRow, el("h3", {}, "…and what makes them dangerous"), withRow, el("div", { className: "row end" }, fight));
  let dealt = false;
  const sync = (latest: ScribbleView) => {
    const hand = latest.brawl?.hand;
    if (!hand) return;
    const make = (row: HTMLElement, cards: string[], slot: "who" | "with") => {
      row.replaceChildren(
        ...cards.map((card, index) => {
          const button = el("button", { className: `card-pick${choice[slot] === index ? " picked" : ""}` }, card);
          button.addEventListener("click", () => {
            choice[slot] = index;
            sync(latest);
          });
          return button;
        }),
      );
    };
    if (!dealt && latest.brawl?.picked) Object.assign(choice, latest.brawl.picked);
    dealt = true;
    make(whoRow, hand.who, "who");
    make(withRow, hand.with, "with");
    fight.disabled = choice.who < 0 || choice.with < 0;
    fight.textContent = latest.brawl?.picked ? "Locked in (tap to change)" : "That's my fighter";
  };
  return { update: sync };
}

function fighterCard(fighter: Fighter | undefined, side: string): HTMLElement {
  if (!fighter) return el("div");
  return el(
    "figure",
    { className: `fighter ${side}` },
    el("figcaption", {}, el("b", {}, fighter.name), el("small", {}, `${fighter.who} ${fighter.with}`), el("small", { style: `color:${inkOf(fighter.id)}` }, `drawn by ${nameOf(fighter.id)}`)),
    artCanvas(art.get(fighter.art), `fighter:${fighter.art}`),
  );
}

function fightPanel(stage: HTMLElement): Panel {
  const arena = el("div", { className: "arena" });
  const actions = el("div", { className: "actions" });
  const next = el("p", { className: "muted center" });
  stage.append(arena, actions, next);
  let actionsKey = "";
  let arenaKey = "";
  return {
    update: (latest) => {
      const brawl = latest.brawl;
      if (!brawl?.fighters) return;
      const champ = brawl.fighters.find((fighter) => fighter.id === brawl.champId);
      const challenger = brawl.fighters.find((fighter) => fighter.id === brawl.challengerId);
      const ko = latest.step === "ko";
      const sideOf = (fighter?: Fighter) => (ko ? (fighter?.id === brawl.winnerId ? " winner" : " loser") : "");
      // Votes coming in shouldn't restart the fighters' animations.
      const fightKey = `${latest.step}:${brawl.champId}:${brawl.challengerId}:${brawl.winnerId ?? ""}`;
      if (fightKey !== arenaKey) {
        arenaKey = fightKey;
        arena.replaceChildren(
          fighterCard(champ, `left${sideOf(champ)}`),
          el("div", { className: "vs" }, ko ? "K.O.!" : "VS"),
          fighterCard(challenger, `right${sideOf(challenger)}`),
        );
        if (champ && (brawl.wins?.[champ.id] ?? 0) > 0) arena.firstElementChild?.prepend(el("span", { className: "streak" }, `🏆 ${brawl.wins![champ.id]} win${brawl.wins![champ.id] === 1 ? "" : "s"}`));
      }
      next.textContent = brawl.queue && brawl.queue.length > 0 ? `Next up: ${brawl.queue.map((id) => nameOf(id)).join(", ")}` : "Final fight!";
      const key = `${latest.step}:${brawl.myVote ?? ""}:${brawl.champId}:${brawl.challengerId}`;
      if (key === actionsKey) return;
      actionsKey = key;
      actions.replaceChildren();
      if (ko) {
        const winner = brawl.fighters.find((fighter) => fighter.id === brawl.winnerId);
        const votes = brawl.votes ?? {};
        actions.append(el("p", { className: "big-note" }, brawl.coinFlip ? `A tie! A coin flip says ${winner?.name} wins.` : `${winner?.name} wins, ${votes[brawl.winnerId!] ?? 0} vote${votes[brawl.winnerId!] === 1 ? "" : "s"} to ${Object.values(votes).reduce((a, b) => a + b, 0) - (votes[brawl.winnerId!] ?? 0)}.`));
        return;
      }
      const fighting = myId === brawl.champId || myId === brawl.challengerId;
      if (amScreen()) actions.append(el("p", { className: "big-note" }, "Who wins? Vote on your phone."));
      else if (fighting) actions.append(el("p", { className: "big-note" }, "You're in this fight. Look tough."));
      else {
        for (const fighter of [champ, challenger]) {
          if (!fighter) continue;
          const button = el("button", { className: `vote big${brawl.myVote === fighter.id ? " picked" : ""}` }, brawl.myVote === fighter.id ? `✊ ${fighter.name}` : fighter.name);
          button.addEventListener("click", () => send({ kind: "scribble", action: "vote", slot: "fighter", target: fighter.id }));
          actions.append(button);
        }
      }
    },
  };
}

function championPanel(stage: HTMLElement): Panel {
  const holder = el("div", { className: "champion" });
  stage.append(holder);
  return {
    update: (latest) => {
      const brawl = latest.brawl;
      const champ = brawl?.fighters?.find((fighter) => fighter.id === brawl.champId);
      if (!brawl || !champ) return;
      holder.replaceChildren(
        el("h2", {}, `🏆 ${champ.name} is the last one standing!`),
        fighterCard(champ, "solo"),
        el(
          "ul",
          { className: "tally" },
          ...Object.entries(brawl.wins ?? {})
            .sort((a, b) => b[1] - a[1])
            .map(([id, wins]) => el("li", {}, `${nameOf(id)}: ${wins} win${wins === 1 ? "" : "s"}`)),
        ),
      );
    },
  };
}

// Results ---------------------------------------------------------------------------------------

$("back-to-lobby").addEventListener("click", () => connection.send({ type: "RETURN_TO_LOBBY" }));

function showResults(): void {
  const players = [...(view?.players ?? [])].sort((a, b) => b.points - a.points);
  const winner = players[0];
  $("results-title").textContent = winner ? `${winner.name} wins Scribble Scrap!` : "Game over";
  $("standings").replaceChildren(
    ...players.map((player, index) =>
      el(
        "li",
        { className: index === 0 ? "first" : "" },
        el("span", { className: "dot", style: `background:${INK[playerInk(player.color)]}` }),
        el("span", { className: "name" }, `${index === 0 ? "👑 " : ""}${player.name}`),
        el("span", { className: "points" }, `${player.points} pts`),
      ),
    ),
  );
  $("back-to-lobby").hidden = !amHost();
  $("results-wait").hidden = amHost();
  show("results");
}

// Loop ---------------------------------------------------------------------------------------------

function loop(): void {
  if (room?.phase === "in_game" && view) {
    const left = secondsLeft();
    const timer = $("timer");
    const timed = view.step !== "final" && view.step !== "intro";
    timer.textContent = timed ? `${left}` : "";
    timer.classList.toggle("hurry", timed && left <= 5);
    if (left === 0 && !timeUpFired && panel?.timeUp) {
      timeUpFired = true;
      panel.timeUp();
    }
    panel?.frame?.();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Messages ----------------------------------------------------------------------------------------

function onMessage(message: ServerMessage): void {
  switch (message.type) {
    case "ROOM_STATE": {
      $("landing-status").textContent = "";
      if (resumeAttempts > 0 || resuming) showToast("Back in the room.", "info");
      resumeAttempts = 0;
      resuming = false;
      room = message.room;
      myId = message.playerId;
      if (message.resumeToken) myToken = message.resumeToken;
      saveSession();
      history.replaceState(null, "", `?room=${room.code}${serverQuery()}`);
      if (room.phase === "lobby") {
        view = undefined;
        panelKey = "";
        show("lobby");
        renderLobby();
      } else if (room.phase === "in_game") {
        show("game");
        if (room.game) applyGame(room.game);
      } else if (room.phase === "results") {
        if (room.game) applyGame(room.game);
        showResults();
      } else {
        show("lobby");
        renderLobby();
        $("lobby-status").textContent = "Another game is running in this room. Waiting for it to finish.";
      }
      return;
    }
    case "GAME_STATE":
      if (room?.phase === "in_game") applyGame(message.game);
      return;
    case "GAME_OVER":
      applyGame(message.game);
      showResults();
      return;
    case "ERROR":
      showToast(message.message);
      $("landing-status").textContent = message.message;
      if (resuming || resumeAttempts > 0) {
        resuming = false;
        resumeAttempts = 0;
        leaveToLanding();
      }
      return;
  }
}

function applyGame(game: GameSnapshot): void {
  const current = game.scribble;
  if (!current) return;
  for (const [ref, strokes] of Object.entries(current.art ?? {})) art.set(ref, strokes);
  // A refresh loses drawings the server already sent: ask again, once in a while.
  const needed = [
    ...(current.roast?.entries?.map((entry) => entry.art) ?? []),
    current.roast?.toCaption?.art,
    ...(current.brawl?.fighters?.map((fighter) => fighter.art) ?? []),
  ].filter((ref): ref is string => Boolean(ref));
  if (needed.some((ref) => !art.has(ref)) && performance.now() - askedForArt > 2000) {
    askedForArt = performance.now();
    send({ kind: "scribble", action: "resend" });
  }
  view = current;
  deadline = performance.now() + current.msLeft;
  if (room?.phase !== "in_game") return;
  show("game");
  renderHeader(current);
  renderStage(current);
}

function leaveToLanding(): void {
  forgetSession();
  room = undefined;
  view = undefined;
  myId = "";
  panelKey = "";
  show("landing");
}

// Reconnecting -------------------------------------------------------------------------------------

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

// Helpers ---------------------------------------------------------------------------------------------

type Props = { className?: string; style?: string; dataset?: Record<string, string>; ariaLabel?: string; maxLength?: number; placeholder?: string; title?: string };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.style) node.setAttribute("style", props.style);
  if (props.ariaLabel) node.setAttribute("aria-label", props.ariaLabel);
  if (props.title) node.title = props.title;
  if (props.maxLength !== undefined) node.setAttribute("maxlength", String(props.maxLength));
  if (props.placeholder) node.setAttribute("placeholder", props.placeholder);
  for (const [key, value] of Object.entries(props.dataset ?? {})) node.dataset[key] = value;
  node.append(...children.filter((child) => child !== ""));
  return node;
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
