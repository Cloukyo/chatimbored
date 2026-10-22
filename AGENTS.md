# AGENTS.md

## Project Purpose

`chatImbored` is a browser-based online multiplayer party game platform for quick room-link sessions with friends or stream audiences. The current milestone is an authoritative lobby plus one placeholder minigame, Button Race.

## Folder Structure

- `client-web/`: Browser client (TypeScript, Vite, Canvas 2D) for the crowd games: Act Natural, Silent Witness, Lantern Festival, Bell Ringers, Heist Hour, Marked, Freeze Frame, Hot Parcel and Closing Time. Mode rules live in `server/src/crowd/modes.ts`.
- `client-godot/`: Godot 4 client project for the other minigames. Godot should open this folder only.
- `server/`: Node.js and TypeScript WebSocket server.
- `shared/`: Shared message/type definitions and constants. `shared/crowd/` holds the crowd protocol and the movement rules that the server and client prediction both run.
- `docs/`: Architecture and setup documentation.

Codex and VS Code should open the repo root, not only the Godot folder.

## Server-Authoritative Rules

- The server owns room state, player membership, ready state, minigame phase, timers, scores, and winners.
- The client may request actions but must not decide winners or final scores.
- Validate all incoming client messages before mutating room state.
- Keep rooms in memory for this prototype. Do not add accounts, database persistence, matchmaking, payments, chat, analytics, or cosmetics yet.

## Crowd Games

- Crowd games run on `server/src/crowd/CrowdMatch.ts`; each mode is a `CrowdRules` object in `server/src/crowd/modes.ts`.
- Clients must never be able to tell players from NPCs. Send per-player views (`snapshotFor`), keep hidden state off `room.game`, give players and NPCs the same speeds, directions and look, and never send another player's id or role during a round.

## Party Night

- A Party Night wraps the crowd games: `server/src/party/PartyNight.ts` holds the night (points, claimed rooms, who picks next, and every layer's state) on `room.night`, and `server/src/party/scoring.ts` turns a finished `CrowdMatch` into points per player. The mansion layout, layer list, perks, twists and host tricks live in `shared/party/night.ts`.
- Layers are lobby switches (`NightOptions`). `server/src/party/round.ts` (`NightRound`) runs one round's layers as a `CrowdObserver` on the match: contracts (`contracts.ts`), suspicion, the cursed invite, Wanted, Nemesis, ghosts and the Party Host's tricks. `lastDance.ts` is the finale mode.
- Room phases during a night: `board` (last place picks a room) → `in_game` → `results` → `shop` → `board` again; after the last round `mole_vote`, `finale_pick` and the Last Dance, then `night_over`. Between-round choices arrive as `NIGHT_ACTION` messages.
- `room.nightFor(playerId)` is public apart from `secret`, which only its owner gets. Suspicion, the invite holder, contracts and the Mole stay server-side; never put them in the public snapshot.
- Design doc: https://claude.ai/artifact/J6seXvPd1DHaaSfvicovTj.

## Couch Play

- The web client supports several players on one screen with controllers. Each extra controller joins the room as its own player over its own WebSocket, so the server doesn't know or care.
- A shared screen must not mark anyone: no "you" tag, no own-figure prediction, no private HUD lines. Secrets reach couch players through controller rumble (`client-web/src/input/pads.ts`). Modes and layers that need private words (Marked, contracts, the Mole, the Glimpse perk) are left out on a shared screen.

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
