# AGENTS.md

## Project Purpose

`chatImbored` is a browser-based online multiplayer party game platform for quick room-link sessions with friends or stream audiences. The current milestone is an authoritative lobby plus one placeholder minigame, Button Race.

## Folder Structure

- `client-web/`: Browser client (TypeScript, Vite, Three.js) for the crowd games: Act Natural, Silent Witness, Lantern Festival, Bell Ringers, Heist Hour, Marked, Freeze Frame, Hot Parcel and Closing Time. Mode rules live in `server/src/crowd/modes.ts`. The rooms are drawn in 3D by `client-web/src/crowd/scene3d.ts` (a burgundy, black and gold ballroom seen at a slight 3/4 angle; figures wear animal masks that always face the camera; looks come from the shuffled entity id, so the picture never marks a player). Floor markings (hints, darkness, smoke, crosshairs) are painted with the 2D helpers in `draw.ts` onto a layer lying on the floor, and name tags, shots and "!"s go on a 2D overlay canvas. Without WebGL, `CrowdGame` falls back to the old flat 2D drawing in `draw.ts`.
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

- The crowd games are one game in the chatImbored hub, called **Morbid Masquerade**. Party Night is its main mode, and the nine crowd modes are its quick-play rooms.
- A Party Night wraps the crowd games: `server/src/party/PartyNight.ts` holds the night (points, claimed rooms, who picks next, and every layer's state) on `room.night`, and `server/src/party/scoring.ts` turns a finished `CrowdMatch` into points per player. The mansion layout, layer list, perks, twists and host tricks live in `shared/party/night.ts`.
- Layers are lobby switches (`NightOptions`). `server/src/party/round.ts` (`NightRound`) runs one round's layers as a `CrowdObserver` on the match: contracts (`contracts.ts`), suspicion, the cursed invite, Wanted, Nemesis, ghosts and the Party Host's tricks. `lastDance.ts` is the finale mode.
- Room phases during a night: `board` (last place picks a room) → `in_game` → `results` → `shop` → `board` again; after the last round `mole_vote`, `finale_pick` and the Last Dance, then `night_over`. Between-round choices arrive as `NIGHT_ACTION` messages.
- `room.nightFor(playerId)` is public apart from `secret`, which only its owner gets. Suspicion, the invite holder, contracts and the Mole stay server-side; never put them in the public snapshot.
- Design doc: https://claude.ai/artifact/J6seXvPd1DHaaSfvicovTj.

## Site, Reconnect, Sound and Touch

- The deployed site is assembled in `dist/` by `npm run vercel-build`: the hub (`hub/index.html`) at `/`, Morbid Masquerade at `/play/`, and the Godot games at `/classic/index.html`.
- Act Natural and Silent Witness live only in Morbid Masquerade now; their Godot scenes are gone. The old `act_natural` and `silent_witness` server minigames stay until the committed Godot export is re-exported without them.
- Every player gets a resume token in ROOM_STATE. A dropped socket marks the player away (an NPC brain walks their figure) and holds the seat for 90s; RESUME with the token takes it back. The web client keeps tokens in sessionStorage.
- Sound is synthesised in `client-web/src/audio/sound.ts` (no audio files). Touch controls appear on coarse pointers.

## Scribble Scrap

- The drawing party game, served at `/scribble/` from `client-web/scribble/`. One minigame, `scribble_scrap` (`server/src/minigames/ScribbleScrap.ts`), runs three games: Roast Portraits, The Forger and Doodle Brawl, or all of them as a full night. The rules live in `server/src/scribble/ScribbleMatch.ts`, the prompts and cards in `server/src/scribble/cards.ts`, the protocol in `shared/scribble/protocol.ts`.
- Couch play is Jackbox-style: one device joins as the TV (`screen: true` on CREATE_ROOM/JOIN_ROOM). A screen seat is always ready, doesn't count towards player limits, and never draws or votes. You can't draw with a gamepad, so players use their phones.
- Snapshots go out only when `ScribbleMatch.version` changes (`Minigame.shouldBroadcast`). Drawings are sent to each device once (`art` in the view) and then referred to by id; a device that lost them sends `resend`.
- The Forger's word must never reach the forger or a screen seat before the reveal.

## Couch Play

- The web client supports several players on one screen with controllers. Each extra controller joins the room as its own player over its own WebSocket, so the server doesn't know or care.
- A shared screen must not mark anyone: no "you" tag, no own-figure prediction, no private HUD lines. Secrets reach couch players through controller rumble (`client-web/src/input/pads.ts`). Modes and layers that need private words (Marked, contracts, the Mole, the Glimpse perk) are left out on a shared screen.

## Pile-Up

- A top-down party racer that follows Mashed (Supersonic Software, 2004) as closely as we can without its names or art: one shared screen that follows the leader and zooms within limits, two seconds to get back on screen before your car explodes, the next round starting where the last one ended, +2 for the last car left, +1 for the last one out, −1 for the first one out, first to 10. Mashed's nine weapons (homing missile, machine gun and mortar with lock-on, shotgun out of both sides, proximity mines, drum bombs, oil, flamethrower, flash bang), air strikes for knocked-out players, and turbo starts.
- The server runs it: `server/src/race/RaceMatch.ts` (cars, weapons, camera, rounds), `server/src/race/bot.ts` (bots fill the grid up to 4 cars and drive for anyone whose connection drops), `server/src/minigames/PileUp.ts` (the minigame, id `pile_up`). Tracks and the wire types are in `shared/race/`, so the client draws the same road the server drives on.
- The client is its own page, `client-web/race/` (`npm run web:race`), served at `/race/`. It reuses `client-web/src/net.ts` and `client-web/src/input/pads.ts`. The world is 3D with Three.js (`race/src/world3d.ts`: track on a ledge, cars, shots, particles, and a tilted camera that always keeps the server's whole screen rectangle in shot); `race/src/draw.ts` runs the snapshots, events and sounds and draws the flat overlay (names, comic text, edge warnings, scores, banners) on a 2D canvas above it. Couch play works the same way as Morbid Masquerade: each extra controller, or a second keyboard player on the arrow keys, joins as its own player over its own socket.
- Keep it slapstick: bouncy collisions, blasts that throw cars into the air, comic popups and the cartoon exit for knocked-out cars are the point of the game, not polish to trim.

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
