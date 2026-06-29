import type { ClientMessage } from "../../../shared/message-types/protocol.js";

const MAX_NAME_LENGTH = 24;

export function parseClientMessage(raw: unknown): ClientMessage {
  if (!raw || typeof raw !== "object") {
    throw new Error("Message must be a JSON object.");
  }

  const message = raw as Record<string, unknown>;

  switch (message.type) {
    case "CREATE_ROOM":
      return { type: "CREATE_ROOM", displayName: readDisplayName(message.displayName) };
    case "JOIN_ROOM":
      return {
        type: "JOIN_ROOM",
        roomCode: readRoomCode(message.roomCode),
        displayName: readDisplayName(message.displayName),
      };
    case "LEAVE_ROOM":
      return { type: "LEAVE_ROOM" };
    case "PLAYER_READY":
      if (typeof message.isReady !== "boolean") throw new Error("isReady must be a boolean.");
      return { type: "PLAYER_READY", isReady: message.isReady };
    case "START_GAME":
      if (message.minigameId !== undefined && typeof message.minigameId !== "string") {
        throw new Error("minigameId must be a string.");
      }
      return { type: "START_GAME", minigameId: message.minigameId };
    case "PLAYER_INPUT":
      if (message.input !== "PRESS") throw new Error("Unsupported player input.");
      return { type: "PLAYER_INPUT", input: "PRESS" };
    case "RETURN_TO_LOBBY":
      return { type: "RETURN_TO_LOBBY" };
    default:
      throw new Error("Unknown message type.");
  }
}

function readDisplayName(value: unknown): string {
  if (typeof value !== "string") throw new Error("displayName is required.");
  const trimmed = value.trim();
  if (!trimmed) throw new Error("displayName cannot be empty.");
  return trimmed.slice(0, MAX_NAME_LENGTH);
}

function readRoomCode(value: unknown): string {
  if (typeof value !== "string") throw new Error("roomCode is required.");
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(normalized)) throw new Error("roomCode must be a 5-character code.");
  return normalized;
}
