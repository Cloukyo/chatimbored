import { randomUUID } from "node:crypto";
import { ROOM_CODE_LENGTH } from "../../../shared/constants/platform.js";
import type { ClientMessage } from "../../../shared/message-types/protocol.js";
import { LAST_DANCE_ID, crowdMatchFor } from "../minigames/CrowdGames.js";
import type { Minigame } from "../minigames/Minigame.js";
import { getMinigame } from "../minigames/registry.js";
import { PartyNight } from "../party/PartyNight.js";
import { scoreCrowdRound } from "../party/scoring.js";
import type { Player } from "./Player.js";
import { Room } from "./Room.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomManager {
  // Tests can pass a seeded generator so room offers and pickers are repeatable.
  constructor(private readonly random: () => number = Math.random) {}

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
    const minigame = room.phase === "in_game" ? getMinigame(room.selectedMinigameId) : undefined;
    room.removePlayer(playerId);
    room.night?.removePlayer(playerId);
    minigame?.onPlayerLeft?.(room, playerId);
    if (room.game?.winnerId && room.phase === "in_game" && minigame) this.finish(room, minigame);
    this.playerRooms.delete(playerId);
    if (room.players.length === 0) this.rooms.delete(room.code);
    return room;
  }

  getRoomForPlayer(playerId: string): Room | undefined {
    const code = this.playerRooms.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  handleRoomMessage(
    playerId: string,
    message: ClientMessage,
    onGameFinished: (room: Room) => void,
    onGameTick?: (room: Room) => void,
  ): Room {
    const room = this.getRoomForPlayer(playerId);
    if (!room) throw new Error("Create or join a room first.");

    if (message.type === "PLAYER_READY") {
      room.setReady(playerId, message.isReady);
      return room;
    }

    if (message.type === "START_GAME") {
      const minigameId = message.minigameId ?? room.selectedMinigameId;
      const minigame = minigameId === LAST_DANCE_ID ? undefined : getMinigame(minigameId);
      if (!minigame) throw new Error("Unknown minigame.");
      if (!room.canStart(playerId, minigame)) throw new Error("Only the host can start when all players are ready.");
      room.start(minigame, () => onGameFinished(room), () => onGameTick?.(room));
      return room;
    }

    if (message.type === "PLAYER_INPUT") {
      const minigame = getMinigame(room.selectedMinigameId);
      // Inputs already in flight when a round ends are dropped quietly rather than shown as an error.
      if (room.phase !== "in_game") return room;
      if (!minigame) throw new Error("No minigame is running.");
      minigame.handleInput(room, playerId, message.input);
      if (room.game?.winnerId) onGameFinished(room);
      return room;
    }

    if (message.type === "RETURN_TO_LOBBY") {
      // During a night this ends it early.
      if (room.phase !== "lobby" && room.phase !== "in_game" && room.hostId === playerId) room.returnToLobby();
      return room;
    }

    if (message.type === "START_NIGHT") {
      if (!room.everyoneReadyForHost(playerId)) throw new Error("Only the host can start when all players are ready.");
      room.night = new PartyNight(
        room.players.map((player) => player.id),
        message.rounds,
        message.sharedScreen,
        this.random,
        message.options,
      );
      room.phase = "board";
      room.game = undefined;
      return room;
    }

    if (message.type === "PICK_ROOM") {
      const night = room.night;
      if (!night || room.phase !== "board") throw new Error("Nothing to pick right now.");
      if (!night.canPick(playerId, room.hostId === playerId)) throw new Error("It's someone else's pick.");
      if (room.players.length < 2) throw new Error("A round needs at least 2 players.");
      const minigame = getMinigame(night.pick(message.roomKey).minigameId);
      if (!minigame) throw new Error("Unknown minigame.");
      room.start(minigame, () => onGameFinished(room), () => onGameTick?.(room));
      return room;
    }

    if (message.type === "NEXT_ROUND") {
      if (room.phase === "results" && room.hostId === playerId) room.continueNight();
      return room;
    }

    if (message.type === "NIGHT_ACTION") {
      const night = room.night;
      if (!night) throw new Error("There's no Party Night running.");
      const action = message.action;
      const isHost = room.hostId === playerId;
      if (room.phase === "shop") {
        if (action.kind === "buy") night.buy(playerId, action.perk);
        if ((action.kind === "done" && night.finishShopping(playerId)) || (action.kind === "skip" && isHost)) room.phase = "board";
      } else if (room.phase === "mole_vote") {
        if ((action.kind === "vote" && night.voteMole(playerId, action.playerId)) || (action.kind === "skip" && isHost)) room.phase = night.revealMole();
      } else if (room.phase === "finale_pick") {
        if ((action.kind === "back" && night.back(playerId, action.playerId)) || (action.kind === "skip" && isHost)) {
          this.startFinale(room, onGameFinished, onGameTick);
        }
      } else {
        throw new Error("Nothing to do right now.");
      }
      return room;
    }

    return room;
  }

  finishGame(room: Room): void {
    const minigame = getMinigame(room.selectedMinigameId);
    if (!minigame || room.phase !== "in_game") return;
    this.finish(room, minigame);
  }

  private finish(room: Room, minigame: Minigame): void {
    room.finish(minigame);
    const night = room.night;
    if (!night || (!night.current && !night.inFinale)) return;
    const match = crowdMatchFor(room);
    if (match) night.recordRound(scoreCrowdRound(match), match);
    else night.skipRound();
  }

  private startFinale(room: Room, onGameFinished: (room: Room) => void, onGameTick?: (room: Room) => void): void {
    room.night!.startFinale();
    room.start(getMinigame(LAST_DANCE_ID)!, () => onGameFinished(room), () => onGameTick?.(room));
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
