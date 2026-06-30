# chatImbored

`chatImbored` is a browser-first online multiplayer party game platform prototype. One player creates a room, shares the room code or link, friends join in their browsers, and the group plays short minigames.

The current scaffold proves the core platform loop:

1. Create room.
2. Join room.
3. See lobby player list.
4. Ready up.
5. Host starts a minigame.
6. Play Button Race, Act Natural, or Loot & Leave.
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

From the repo root:

```bash
npm install
npm run dev
```

Or from the server folder:

```bash
cd server
npm install
npm run dev
```

Then open `client-godot/` in Godot 4 and run the project.

Production server check:

```bash
npm run build
npm start
```

See [docs/local-setup.md](docs/local-setup.md) for two-client testing and [docs/deployment.md](docs/deployment.md) for Railway server and Vercel Godot Web deployment setup.

## Playtest Branch

`main` is the live playtest branch. Build new features on branches, test locally, open a pull request, and merge to `main` only when the build and local playtest pass.
