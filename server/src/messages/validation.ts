import type { ClientMessage, PlayerInputPayload } from "../../../shared/message-types/protocol.js";
import { NIGHT_LAYERS, NIGHT_LENGTHS, PERKS, type NightLength, type NightOptions, type PerkKey } from "../../../shared/party/night.js";
import type { NightAction } from "../../../shared/message-types/protocol.js";
import {
  BRUSHES,
  CANVAS_H,
  CANVAS_W,
  INK,
  MAX_STROKE_POINTS,
  MAX_STROKES,
  MAX_TEXT,
  MODES,
  type ScribbleInput,
  type ScribbleMode,
  type Stroke,
} from "../../../shared/scribble/protocol.js";

const MAX_NAME_LENGTH = 24;

export function parseClientMessage(raw: unknown): ClientMessage {
  if (!raw || typeof raw !== "object") {
    throw new Error("Message must be a JSON object.");
  }

  const message = raw as Record<string, unknown>;

  switch (message.type) {
    case "CREATE_ROOM":
      return { type: "CREATE_ROOM", displayName: readDisplayName(message.displayName), screen: message.screen === true || undefined };
    case "JOIN_ROOM":
      return {
        type: "JOIN_ROOM",
        roomCode: readRoomCode(message.roomCode),
        displayName: readDisplayName(message.displayName),
        screen: message.screen === true || undefined,
      };
    case "LEAVE_ROOM":
      return { type: "LEAVE_ROOM" };
    case "RESUME":
      if (typeof message.token !== "string" || message.token.length > 64) throw new Error("token must be a string.");
      return { type: "RESUME", token: message.token };
    case "RENAME":
      return { type: "RENAME", displayName: readDisplayName(message.displayName) };
    case "PLAYER_READY":
      if (typeof message.isReady !== "boolean") throw new Error("isReady must be a boolean.");
      return { type: "PLAYER_READY", isReady: message.isReady };
    case "START_GAME":
      if (message.minigameId !== undefined && typeof message.minigameId !== "string") {
        throw new Error("minigameId must be a string.");
      }
      if (message.trackId !== undefined && (typeof message.trackId !== "string" || message.trackId.length > 32)) {
        throw new Error("trackId must be a short string.");
      }
      if (message.scribbleMode !== undefined && !MODES.some((mode) => mode.key === message.scribbleMode)) {
        throw new Error("Unknown Scribble Scrap mode.");
      }
      return {
        type: "START_GAME",
        minigameId: message.minigameId,
        trackId: message.trackId,
        scribbleMode: message.scribbleMode as ScribbleMode | undefined,
        blind: typeof message.blind === "boolean" ? message.blind : undefined,
      };
    case "PLAYER_INPUT":
      if (message.input === "PRESS") return { type: "PLAYER_INPUT", input: "PRESS" };
      return { type: "PLAYER_INPUT", input: readPlayerInput(message.input) };
    case "RETURN_TO_LOBBY":
      return { type: "RETURN_TO_LOBBY" };
    case "START_NIGHT":
      if (!NIGHT_LENGTHS.includes(message.rounds as NightLength)) throw new Error(`rounds must be one of ${NIGHT_LENGTHS.join(", ")}.`);
      if (typeof message.sharedScreen !== "boolean") throw new Error("sharedScreen must be a boolean.");
      return { type: "START_NIGHT", rounds: message.rounds as NightLength, sharedScreen: message.sharedScreen, options: readNightOptions(message.options) };
    case "PICK_ROOM":
      if (typeof message.roomKey !== "string") throw new Error("roomKey must be a string.");
      return { type: "PICK_ROOM", roomKey: message.roomKey };
    case "NEXT_ROUND":
      return { type: "NEXT_ROUND" };
    case "NIGHT_ACTION":
      return { type: "NIGHT_ACTION", action: readNightAction(message.action) };
    default:
      throw new Error("Unknown message type.");
  }
}

function readPlayerInput(value: unknown): PlayerInputPayload {
  if (!value || typeof value !== "object") throw new Error("Unsupported player input.");
  const input = value as Record<string, unknown>;
  if (input.kind === "race") {
    const fires = input.fires;
    if (typeof fires !== "number" || !Number.isSafeInteger(fires) || fires < 0) throw new Error("Race input needs a whole number of fires.");
    return {
      kind: "race",
      steer: clampUnit(typeof input.steer === "number" ? input.steer : 0),
      throttle: clampUnit(typeof input.throttle === "number" ? input.throttle : 0),
      fires,
    };
  }
  if (input.kind === "scribble") return readScribbleInput(input);
  if (input.kind === "crowd") {
    const seq = readSequence(input.seq);
    if (seq === undefined) throw new Error("Crowd input needs a positive integer seq.");
    return {
      kind: "crowd",
      seq,
      move: readVector(input.move),
      run: input.run === true,
      shoot: readOptionalPoint(input.shoot),
      shootAt: Number.isInteger(input.shootAt) ? (input.shootAt as number) : undefined,
      act: input.act === true,
    };
  }
  if (
    input.action === "request_hit"
    || input.action === "request_stay"
    || input.action === "dealer_deal"
    || input.action === "dealer_confirm_stay"
    || input.action === "continue"
  ) {
    return { action: input.action };
  }
  if (!("aim" in input) && !("shoot" in input) && !("run" in input) && !("kill" in input) && "movement" in input) {
    return {
      movement: readVector(input.movement),
      sequence: readSequence(input.sequence),
    };
  }
  return {
    movement: readVector(input.movement),
    aim: readVector(input.aim),
    targetPoint: readOptionalPoint(input.targetPoint),
    shoot: input.shoot === true,
    run: input.run === true,
    kill: input.kill === true,
  };
}

function readScribbleInput(input: Record<string, unknown>): ScribbleInput {
  const text = (value: unknown) => {
    if (typeof value !== "string") throw new Error("text must be a string.");
    return value.slice(0, MAX_TEXT * 2);
  };
  switch (input.action) {
    case "drawing": {
      if (!Array.isArray(input.strokes) || input.strokes.length > MAX_STROKES) throw new Error("A drawing is a list of strokes.");
      return { kind: "scribble", action: "drawing", strokes: input.strokes.map(readStroke), name: input.name === undefined ? undefined : text(input.name) };
    }
    case "text":
      return { kind: "scribble", action: "text", text: text(input.text) };
    case "vote":
      if (!["drawing", "caption", "suspect", "fighter"].includes(input.slot as string)) throw new Error("Unknown vote.");
      if (typeof input.target !== "string" || input.target.length > 64) throw new Error("target must be a string.");
      return { kind: "scribble", action: "vote", slot: input.slot as "drawing", target: input.target };
    case "pick":
      if (!Number.isSafeInteger(input.who) || !Number.isSafeInteger(input.with)) throw new Error("Pick two cards.");
      return { kind: "scribble", action: "pick", who: input.who as number, with: input.with as number };
    case "stroke":
      return { kind: "scribble", action: "stroke", stroke: readStroke(input.stroke), done: input.done === true };
    case "resend":
    case "skip":
      return { kind: "scribble", action: input.action };
    default:
      throw new Error("Unknown Scribble Scrap action.");
  }
}

function readStroke(value: unknown): Stroke {
  if (!value || typeof value !== "object") throw new Error("A stroke must be an object.");
  const stroke = value as Record<string, unknown>;
  const c = stroke.c;
  const b = stroke.b;
  if (!Number.isSafeInteger(c) || (c as number) < 0 || (c as number) >= INK.length) throw new Error("Unknown ink.");
  if (!Number.isSafeInteger(b) || (b as number) < 0 || (b as number) >= BRUSHES.length) throw new Error("Unknown brush.");
  if (!Array.isArray(stroke.p) || stroke.p.length % 2 !== 0 || stroke.p.length > MAX_STROKE_POINTS * 2) throw new Error("Bad stroke points.");
  const p = stroke.p.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Bad stroke points.");
    return Math.max(0, Math.min(index % 2 === 0 ? CANVAS_W : CANVAS_H, Math.round(value)));
  });
  return { c: c as number, b: b as number, p };
}

function readNightOptions(value: unknown): Partial<NightOptions> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("options must be an object.");
  const raw = value as Record<string, unknown>;
  const options: Partial<NightOptions> = {};
  for (const layer of NIGHT_LAYERS) if (typeof raw[layer.key] === "boolean") options[layer.key] = raw[layer.key] as boolean;
  return options;
}

function readNightAction(value: unknown): NightAction {
  if (!value || typeof value !== "object") throw new Error("action must be an object.");
  const action = value as Record<string, unknown>;
  switch (action.kind) {
    case "buy":
      if (!PERKS.some((perk) => perk.key === action.perk)) throw new Error("Unknown perk.");
      return { kind: "buy", perk: action.perk as PerkKey };
    case "vote":
    case "back":
      if (typeof action.playerId !== "string") throw new Error("playerId must be a string.");
      return { kind: action.kind, playerId: action.playerId };
    case "done":
    case "skip":
      return { kind: action.kind };
    default:
      throw new Error("Unknown night action.");
  }
}

function readSequence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return undefined;
  return value;
}

function readVector(value: unknown): { x: number; y: number } {
  if (!value || typeof value !== "object") return { x: 0, y: 0 };
  const vector = value as Record<string, unknown>;
  return {
    x: clampUnit(typeof vector.x === "number" ? vector.x : 0),
    y: clampUnit(typeof vector.y === "number" ? vector.y : 0),
  };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function readOptionalPoint(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const point = value as Record<string, unknown>;
  const x = typeof point.x === "number" ? point.x : Number.NaN;
  const y = typeof point.y === "number" ? point.y : Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
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
