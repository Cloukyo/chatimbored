# AGENTS.md

## Project Purpose

`chatImbored` is a browser-based online multiplayer party game platform for quick room-link sessions with friends or stream audiences. The current milestone is an authoritative lobby plus one placeholder minigame, Button Race.

## Folder Structure

- `client-godot/`: Godot 4 client project. Godot should open this folder only.
- `server/`: Node.js and TypeScript WebSocket server.
- `shared/`: Shared message/type definitions and constants.
- `docs/`: Architecture and setup documentation.

Codex and VS Code should open the repo root, not only the Godot folder.

## Server-Authoritative Rules

- The server owns room state, player membership, ready state, minigame phase, timers, scores, and winners.
- The client may request actions but must not decide winners or final scores.
- Validate all incoming client messages before mutating room state.
- Keep rooms in memory for this prototype. Do not add accounts, database persistence, matchmaking, payments, chat, analytics, cosmetics, or a board wrapper yet.

## Minigame Module Rules

- Each minigame must expose an id, name, min/max player counts, setup/start or update behavior, input handling, and finish behavior.
- Register minigames through the server registry so platform flow does not need minigame-specific branches.
- Future minigames should keep their state server-side and expose only safe snapshots to clients.

## Current Constraints

- Godot 4 client, exported to Web later.
- Node.js + TypeScript WebSocket backend.
- Target 2-8 players per room.
- Desktop browser first.
- Keep the prototype simple and readable.

## First Milestone Checklist

- [x] Create room.
- [x] Join room.
- [x] See lobby player list.
- [x] Ready up.
- [x] Host starts placeholder minigame.
- [x] Play Button Race for 10 seconds.
- [x] Server declares winner.
- [x] Return to lobby.
