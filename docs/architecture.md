# Architecture

`chatImbored` is split into a Godot client, an authoritative WebSocket server, and shared protocol definitions.

## Client

The Godot project lives in `client-godot/`. The current client is intentionally plain and code-built:

- `scenes/Landing.tscn`: display name, create room, join room.
- `scenes/Lobby.tscn`: room code, share placeholder, player list, ready state, host start.
- `scenes/GameScreen.tscn`: active minigame UI and results.
- `scenes/ButtonRace.tscn`: placeholder minigame scene entry.
- `scripts/NetworkManager.gd`: WebSocket singleton/autoload.
- `scripts/RoomState.gd` and `scripts/PlayerState.gd`: client-side state models.

The client sends requests and renders server snapshots. It does not decide scores, winners, readiness validity, or room phase.

## Server

The server lives in `server/` and uses Node.js, TypeScript, and `ws`.

- `src/index.ts`: WebSocket entrypoint and broadcast loop.
- `src/messages/validation.ts`: client message parsing and validation.
- `src/rooms/RoomManager.ts`: room lookup, create/join/leave, player-to-room mapping.
- `src/rooms/Room.ts`: authoritative room state and phase transitions.
- `src/rooms/Player.ts`: player model.
- `src/minigames/Minigame.ts`: minigame interface.
- `src/minigames/registry.ts`: registration point for future minigames.
- `src/minigames/ButtonRace.ts`: first placeholder minigame implementation.

Rooms are in memory for the prototype. If the server restarts, rooms disappear.

## Message Protocol

Shared protocol definitions live in `shared/message-types/protocol.ts`. The core messages are:

- `CREATE_ROOM`
- `JOIN_ROOM`
- `LEAVE_ROOM`
- `ROOM_STATE`
- `PLAYER_READY`
- `START_GAME`
- `PLAYER_INPUT`
- `GAME_STATE`
- `GAME_OVER`
- `RETURN_TO_LOBBY`
- `ERROR`

Server snapshots are intentionally simple JSON objects so the Godot client can consume them without generated bindings.

## Minigame Flow

1. Host starts a registered minigame from the lobby.
2. Server validates host, player count, and ready state.
3. Server creates minigame state and schedules the authoritative end timer.
4. Clients send input messages.
5. Server updates minigame state and broadcasts snapshots.
6. Server finishes the minigame, declares the winner, and moves the room to results.
7. Host returns the room to lobby.

Future minigames should implement the `Minigame` interface and register in `src/minigames/registry.ts`.
