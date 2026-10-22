import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { MESSAGE_TYPES, type GameSnapshot, type ServerMessage } from "../../shared/message-types/protocol.js";
import { parseClientMessage } from "./messages/validation.js";
import { getMinigame } from "./minigames/registry.js";
import { RoomManager } from "./rooms/RoomManager.js";
import type { Room } from "./rooms/Room.js";

const port = Number(process.env.PORT ?? 8787);
const manager = new RoomManager();
const sockets = new Map<string, WebSocket>();

const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "chatimbored-server" }));
    return;
  }

  response.writeHead(200, { "content-type": "text/plain" });
  response.end("chatImbored WebSocket server is running.\n");
});
const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  let playerId: string | undefined;

  socket.on("message", (data) => {
    try {
      const message = parseClientMessage(JSON.parse(data.toString()));

      if (message.type === MESSAGE_TYPES.CREATE_ROOM) {
        const result = manager.createRoom(message.displayName);
        playerId = result.player.id;
        sockets.set(playerId, socket);
        broadcastRoom(result.room);
        return;
      }

      if (message.type === MESSAGE_TYPES.JOIN_ROOM) {
        const result = manager.joinRoom(message.roomCode, message.displayName);
        playerId = result.player.id;
        sockets.set(playerId, socket);
        broadcastRoom(result.room);
        return;
      }

      if (message.type === MESSAGE_TYPES.LEAVE_ROOM) {
        if (playerId) broadcastRoom(manager.leave(playerId));
        return;
      }

      if (!playerId) throw new Error("Create or join a room first.");
      const room = manager.handleRoomMessage(playerId, message, finishAndBroadcast, broadcastTick);
      // Tick-driven games already stream state every tick; skip the per-input full broadcast.
      if (message.type === MESSAGE_TYPES.PLAYER_INPUT && isTickBroadcastOnly(room)) return;
      broadcastRoom(room);
    } catch (error) {
      send(socket, { type: MESSAGE_TYPES.ERROR, message: error instanceof Error ? error.message : "Invalid message." });
    }
  });

  socket.on("close", () => {
    if (!playerId) return;
    const room = manager.leave(playerId);
    sockets.delete(playerId);
    broadcastRoom(room);
  });
});

server.listen(port, () => {
  console.log(`chatImbored server listening on port ${port}`);
});

function finishAndBroadcast(room: Room): void {
  manager.finishGame(room);
  if (!room.game) return;
  for (const player of room.players) {
    const socket = sockets.get(player.id);
    const game = gameFor(room, player.id);
    if (socket && game) send(socket, { type: MESSAGE_TYPES.GAME_OVER, game, winnerId: game.winnerId });
  }
  broadcastRoom(room);
}

function isTickBroadcastOnly(room: Room): boolean {
  return room.phase === "in_game" && getMinigame(room.selectedMinigameId)?.tickBroadcastOnly === true;
}

// The game as one player may see it. Games with hidden information build a view per player.
function gameFor(room: Room, playerId: string, shared = room.snapshot().game): GameSnapshot | undefined {
  const minigame = getMinigame(room.selectedMinigameId);
  return minigame?.snapshotFor ? minigame.snapshotFor(room, playerId) : shared;
}

function broadcastTick(room: Room): void {
  if (!isTickBroadcastOnly(room)) {
    broadcastRoom(room);
    return;
  }
  // Room membership and phase don't change on a tick, so only the game state is sent.
  const shared = room.snapshot().game;
  if (!shared) return;
  const perPlayer = Boolean(getMinigame(room.selectedMinigameId)?.snapshotFor);
  const sharedPayload = perPlayer ? "" : JSON.stringify({ type: MESSAGE_TYPES.GAME_STATE, game: shared } satisfies ServerMessage);
  for (const player of room.players) {
    const socket = sockets.get(player.id);
    if (!socket || socket.readyState !== socket.OPEN) continue;
    if (!perPlayer) {
      socket.send(sharedPayload);
      continue;
    }
    const game = gameFor(room, player.id, shared);
    if (game) send(socket, { type: MESSAGE_TYPES.GAME_STATE, game });
  }
}

function broadcastRoom(room?: Room): void {
  if (!room) return;
  const snapshot = room.snapshot();
  for (const player of room.players) {
    const socket = sockets.get(player.id);
    if (!socket) continue;
    const game = gameFor(room, player.id, snapshot.game);
    send(socket, { type: MESSAGE_TYPES.ROOM_STATE, room: { ...snapshot, game, night: room.nightFor(player.id) }, playerId: player.id });
    if (game) send(socket, { type: MESSAGE_TYPES.GAME_STATE, game });
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}
