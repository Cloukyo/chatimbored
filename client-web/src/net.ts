import type { ClientMessage, ServerMessage } from "../../shared/message-types/protocol.js";

const PRODUCTION_SERVER_URL = "wss://chatimbored-production.up.railway.app";
const STORAGE_KEY = "CHATIMBORED_SERVER_URL";

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

type Handler = (message: ServerMessage) => void;

export class Connection {
  private socket?: WebSocket;
  private outbox: ClientMessage[] = [];

  constructor(
    private readonly url: string,
    private readonly onMessage: Handler,
    private readonly onClosed: (reason: string) => void,
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
    this.socket?.close();
    this.socket = undefined;
  }

  private open(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.addEventListener("open", () => {
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
      this.onClosed(`Lost connection to ${this.url}.`);
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
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
