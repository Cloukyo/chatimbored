import { randomUUID } from "node:crypto";
import { ROOM_CODE_LENGTH } from "../../../shared/constants/platform.js";
import type { ClientMessage } from "../../../shared/message-types/protocol.js";
import { getMinigame } from "../minigames/registry.js";
import type { Player } from "./Player.js";
import { Room } from "./Room.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly playerRooms = new Map<string, string>();

  createRoom(displayName: string): { room: Room; player: Player } {
    const room = new Room(this.createRoomCode());
    const player = this.createPlayer(displayName);
    room.addPlayer(player);
    this.rooms.set(room.code, room);
    this.playerRooms.set(player.id, room.code);
    return { room, player };
  }

  joinRoom(roomCode: string, displayName: string): { room: Room; player: Player } {
    const room = this.mustFindRoom(roomCode);
    const player = this.createPlayer(displayName);
    room.addPlayer(player);
    this.playerRooms.set(player.id, room.code);
    return { room, player };
  }

  leave(playerId: string): Room | undefined {
    const room = this.getRoomForPlayer(playerId);
    if (!room) return undefined;
    room.removePlayer(playerId);
    this.playerRooms.delete(playerId);
    if (room.players.length === 0) this.rooms.delete(room.code);
    return room;
  }

  getRoomForPlayer(playerId: string): Room | undefined {
    const code = this.playerRooms.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  handleRoomMessage(playerId: string, message: ClientMessage, onGameFinished: (room: Room) => void): Room {
    const room = this.getRoomForPlayer(playerId);
    if (!room) throw new Error("Create or join a room first.");

    if (message.type === "PLAYER_READY") {
      room.setReady(playerId, message.isReady);
      return room;
    }

    if (message.type === "START_GAME") {
      const minigameId = message.minigameId ?? room.selectedMinigameId;
      const minigame = getMinigame(minigameId);
      if (!minigame) throw new Error("Unknown minigame.");
      if (!room.canStart(playerId, minigame)) throw new Error("Only the host can start when all players are ready.");
      room.start(minigame, () => onGameFinished(room));
      return room;
    }

    if (message.type === "PLAYER_INPUT") {
      const minigame = getMinigame(room.selectedMinigameId);
      if (!minigame || room.phase !== "in_game") throw new Error("No minigame is running.");
      minigame.handleInput(room, playerId, message.input);
      return room;
    }

    if (message.type === "RETURN_TO_LOBBY") {
      if (room.phase === "results" && room.hostId === playerId) room.returnToLobby();
      return room;
    }

    return room;
  }

  finishGame(room: Room): void {
    const minigame = getMinigame(room.selectedMinigameId);
    if (!minigame || room.phase !== "in_game") return;
    room.finish(minigame);
  }

  private mustFindRoom(code: string): Room {
    const room = this.rooms.get(code);
    if (!room) throw new Error("Room not found.");
    return room;
  }

  private createPlayer(displayName: string): Player {
    return { id: randomUUID(), displayName, isHost: false, isReady: false, score: 0 };
  }

  private createRoomCode(): string {
    let code = "";
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
    } while (this.rooms.has(code));
    return code;
  }
}
