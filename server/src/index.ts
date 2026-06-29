import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { MESSAGE_TYPES, type ServerMessage } from "../../shared/message-types/protocol.js";
import { parseClientMessage } from "./messages/validation.js";
import { RoomManager } from "./rooms/RoomManager.js";
import type { Room } from "./rooms/Room.js";

const port = Number(process.env.PORT ?? 8787);
const manager = new RoomManager();
const sockets = new Map<string, WebSocket>();

const server = createServer();
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
      const room = manager.handleRoomMessage(playerId, message, finishAndBroadcast);
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
  console.log(`chatImbored server listening on ws://localhost:${port}`);
});

function finishAndBroadcast(room: Room): void {
  manager.finishGame(room);
  const game = room.game;
  if (!game) return;
  for (const player of room.players) {
    const socket = sockets.get(player.id);
    if (socket) send(socket, { type: MESSAGE_TYPES.GAME_OVER, game, winnerId: game.winnerId });
  }
  broadcastRoom(room);
}

function broadcastRoom(room?: Room): void {
  if (!room) return;
  const snapshot = room.snapshot();
  for (const player of room.players) {
    const socket = sockets.get(player.id);
    if (!socket) continue;
    send(socket, { type: MESSAGE_TYPES.ROOM_STATE, room: snapshot, playerId: player.id });
    if (snapshot.game) send(socket, { type: MESSAGE_TYPES.GAME_STATE, game: snapshot.game });
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}
