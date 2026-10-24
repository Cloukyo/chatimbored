import { ACT_NATURAL_TICK_MS, DEFAULT_MINIGAME_ID, MAX_PLAYERS, MIN_PLAYERS } from "../../../shared/constants/platform.js";
import type { GameSnapshot, RoomSnapshot } from "../../../shared/message-types/protocol.js";
import type { Minigame } from "../minigames/Minigame.js";
import type { PartyNight } from "../party/PartyNight.js";
import type { ScribbleMode } from "../../../shared/scribble/protocol.js";
import type { Player } from "./Player.js";

export class Room {
  readonly code: string;
  readonly players: Player[] = [];
  selectedMinigameId = DEFAULT_MINIGAME_ID;
  phase: RoomSnapshot["phase"] = "lobby";
  game?: GameSnapshot;
  night?: PartyNight;
  // Choices from START_GAME that a minigame reads in setup, such as Pile-Up's track.
  gameOptions?: { trackId?: string; scribbleMode?: ScribbleMode; blind?: boolean };
  private endTimer?: NodeJS.Timeout;
  private tickTimer?: NodeJS.Timeout;
  private lastTickAt = 0;

  constructor(code: string) {
    this.code = code;
  }

  get hostId(): string {
    return this.players.find((player) => player.isHost)?.id ?? this.players[0]?.id ?? "";
  }

  addPlayer(player: Player): void {
    // A TV seat doesn't take a player's place.
    if (!player.screen && this.players.filter((other) => !other.screen).length >= MAX_PLAYERS) throw new Error("Room is full.");
    if (this.phase !== "lobby") throw new Error("Game already in progress.");
    player.isHost = this.players.length === 0;
    this.players.push(player);
  }

  removePlayer(playerId: string): void {
    const index = this.players.findIndex((player) => player.id === playerId);
    if (index === -1) return;

    const wasHost = this.players[index].isHost;
    this.players.splice(index, 1);
    if (wasHost && this.players[0]) this.players[0].isHost = true;
    if (this.players.length === 0) this.clearTimer();
  }

  setReady(playerId: string, isReady: boolean): void {
    const player = this.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error("Player is not in the room.");
    player.isReady = isReady;
  }

  canStart(playerId: string, minigame: Minigame): boolean {
    return (
      this.everyoneReadyForHost(playerId, minigame.minPlayers) &&
      this.players.length <= minigame.maxPlayers
    );
  }

  // Lobby, asked by the host, enough players, and everyone else ready. A game that works solo passes a lower minimum.
  everyoneReadyForHost(playerId: string, minPlayers = MIN_PLAYERS): boolean {
    const readyCount = this.players.filter((player) => player.isReady || player.isHost || player.screen).length;
    // A TV seat doesn't count as a player.
    const playing = this.players.filter((player) => !player.screen).length;
    return (
      this.hostId === playerId &&
      this.phase === "lobby" &&
      playing >= minPlayers &&
      readyCount === this.players.length
    );
  }

  start(minigame: Minigame, onFinished: () => void, onTick?: () => void): GameSnapshot {
    this.clearTimer();
    this.phase = "in_game";
    this.selectedMinigameId = minigame.id;
    this.game = minigame.setup(this);
    this.lastTickAt = Date.now();
    if (minigame.update) {
      this.tickTimer = setInterval(() => {
        const now = Date.now();
        minigame.update?.(this, now - this.lastTickAt);
        this.lastTickAt = now;
        onTick?.();
        if (this.game?.winnerId) onFinished();
      }, minigame.tickMs ?? ACT_NATURAL_TICK_MS);
    }
    this.endTimer = setTimeout(onFinished, Math.max(0, this.game.endsAt - Date.now()));
    return this.game;
  }

  finish(minigame: Minigame): GameSnapshot {
    this.clearTimer();
    this.phase = "results";
    return minigame.finish(this);
  }

  returnToLobby(): void {
    this.clearTimer();
    this.phase = "lobby";
    this.game = undefined;
    this.night = undefined;
  }

  // After a Party Night round: the shop, the board, the Mole vote, the finale or the final standings.
  continueNight(): void {
    if (!this.night || this.phase !== "results") return;
    this.clearTimer();
    this.game = undefined;
    this.phase = this.night.afterResults();
  }

  // The night as one player may see it: public, plus their own secrets.
  nightFor(playerId: string): RoomSnapshot["night"] {
    return this.night?.snapshotFor(playerId, this.phase === "night_over");
  }

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      selectedMinigameId: this.selectedMinigameId,
      players: this.players.map((player) => ({ ...player })),
      game: this.game ? { ...this.game, scores: { ...this.game.scores } } : undefined,
      night: this.nightFor(""),
    };
  }

  private clearTimer(): void {
    if (this.endTimer) clearTimeout(this.endTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.endTimer = undefined;
    this.tickTimer = undefined;
  }
}
