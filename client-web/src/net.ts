import type { ClientMessage, ServerMessage } from "../../shared/message-types/protocol.js";

const PRODUCTION_SERVER_URL = "wss://chatimbored.onrender.com";
const STORAGE_KEY = "CHATIMBORED_SERVER_URL";
// The old Railway server is gone; ignore it if a browser still has it stored.
const RETIRED_HOSTS = ["chatimbored-production.up.railway.app"];
// Render's free tier sleeps when idle and takes up to a minute to wake, so keep retrying the first connect.
const CONNECT_RETRY_MS = 3000;
const CONNECT_ATTEMPTS = 30;

// Same lookup order as the Godot client: ?server=, then the last one used, then a build-time default.
export function resolveServerUrl(): string {
  const fromQuery = new URLSearchParams(location.search).get("server");
  if (fromQuery) {
    tryStore(fromQuery);
    return fromQuery;
  }
  const stored = tryRead();
  if (stored) return stored;
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  return local ? `ws://${location.hostname}:8787` : PRODUCTION_SERVER_URL;
}

// Starts waking a sleeping server as soon as the page loads, before anyone clicks.
export function wakeServer(url: string): void {
  const health = url.replace(/^ws/, "http").replace(/\/$/, "") + "/health";
  fetch(health, { mode: "no-cors" }).catch(() => undefined);
}

type Handler = (message: ServerMessage) => void;

export class Connection {
  private socket?: WebSocket;
  private outbox: ClientMessage[] = [];
  private failedAttempts = 0;
  private retryTimer?: number;

  constructor(
    private readonly url: string,
    private readonly onMessage: Handler,
    private readonly onClosed: (reason: string) => void,
    private readonly onWaking: () => void = () => undefined,
  ) {}

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    // Queue until the socket opens instead of guessing with a timer.
    this.outbox.push(message);
    this.open();
  }

  close(): void {
    this.outbox = [];
    window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.socket?.close();
    this.socket = undefined;
  }

  private open(): void {
    if (this.retryTimer !== undefined) return;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    let opened = false;
    socket.addEventListener("open", () => {
      opened = true;
      this.failedAttempts = 0;
      const pending = this.outbox;
      this.outbox = [];
      pending.forEach((message) => socket.send(JSON.stringify(message)));
    });
    socket.addEventListener("message", (event) => {
      try {
        this.onMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch (error) {
        console.error("Bad server message", error);
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      // Never connected and still has something to send: the server is probably waking up.
      if (!opened && this.outbox.length > 0 && this.failedAttempts < CONNECT_ATTEMPTS) {
        if (this.failedAttempts === 0) this.onWaking();
        this.failedAttempts += 1;
        this.retryTimer = window.setTimeout(() => {
          this.retryTimer = undefined;
          this.open();
        }, CONNECT_RETRY_MS);
        return;
      }
      this.failedAttempts = 0;
      this.onClosed(opened ? `Lost connection to ${this.url}.` : `Couldn't reach the game server at ${this.url}.`);
    });
  }
}

function tryStore(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage can be blocked; the query parameter still works for this visit.
  }
}

function tryRead(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && RETIRED_HOSTS.some((host) => stored.includes(host)) ? null : stored;
  } catch {
    return null;
  }
}
