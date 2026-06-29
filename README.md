# chatImbored

`chatImbored` is a browser-first online multiplayer party game platform prototype. One player creates a room, shares the room code or link, friends join in their browsers, and the group plays short minigames.

This first milestone only proves the loop:

1. Create room.
2. Join room.
3. See lobby player list.
4. Ready up.
5. Host starts Button Race.
6. Press for 10 seconds.
7. Server declares the winner.
8. Return to lobby.

## Structure

```text
client-godot/   Godot 4 client project, scenes, scripts, and assets
server/         Node.js + TypeScript WebSocket server
shared/         Message types and constants shared by server/client-facing docs
docs/           Architecture and local setup notes
```

Open the repo root in Codex or VS Code. Open only `client-godot/` in Godot.

## Quick Start

```bash
cd server
npm install
npm run dev
```

Then open `client-godot/` in Godot 4 and run the project.

See [docs/local-setup.md](docs/local-setup.md) for two-client testing and future Web export notes.
