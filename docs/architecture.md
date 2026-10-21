# Architecture

`chatImbored` is split into a Godot client, an authoritative WebSocket server, and shared protocol definitions.

## Browser client (crowd games)

`client-web/` is a TypeScript + Vite client with its own landing page and lobby. It plays the crowd games (`crowd_act_natural`, `crowd_silent_witness`) and draws with Canvas 2D.

- `src/net.ts`: WebSocket connection and server URL lookup (`?server=`, then local storage, then `VITE_SERVER_URL`, then localhost or the Render URL).
- `src/main.ts`: landing, lobby and results screens.
- `src/crowd/CrowdGame.ts`: input at 20 Hz, local prediction with server reconciliation (`seq`/`ack`), and 100 ms interpolation for everyone else.
- `src/crowd/draw.ts`: plaza, figures and effects. Every figure is drawn the same way.

The server runs crowd games in `server/src/crowd/`. `CrowdMatch` owns the entities, input queues and events; `modes.ts` holds each mode's rules. Each player gets their own view: an anonymous, id-sorted entity list (shuffled ids each round), their own entity id, role and shots. Roles and player ids are only revealed in the round result.

## Godot client

The Godot project lives in `client-godot/`. The current client is intentionally plain and code-built:

- `scenes/Landing.tscn`: display name, create room, join room.
- `scenes/Lobby.tscn`: room code, share placeholder, player list, ready state, host start.
- `scenes/GameScreen.tscn`: active minigame UI and results.
- `scripts/NetworkManager.gd`: WebSocket singleton/autoload.
- `scripts/RoomState.gd`: client-side room state model.

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
