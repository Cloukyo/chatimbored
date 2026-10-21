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
client-web/     Browser client (TypeScript + Vite) for the crowd games
client-godot/   Godot 4 client project for the other minigames
server/         Node.js + TypeScript WebSocket server
shared/         Message types, constants and crowd movement rules shared by server and clients
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

Then, in a second terminal, start the browser client and open http://localhost:5173 in two tabs:

```bash
npm run web
```

The Godot client (`client-godot/`) still runs Loot & Leave and Lucky Seven.

Production server check:

```bash
npm run build
npm start
```

See [docs/local-setup.md](docs/local-setup.md) for two-client testing and [docs/deployment.md](docs/deployment.md) for Render server and Vercel web deployment setup.

## Playtest Branch

`main` is the live playtest branch. Build new features on branches, test locally, open a pull request, and merge to `main` only when the build and local playtest pass.
