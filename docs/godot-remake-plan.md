# Morbid Masquerade on Steam: the Godot remake plan

Decided 2026-11-25: Morbid Masquerade becomes a Godot game for Steam, with its rules running inside the game.
One player's copy hosts the round (host-authoritative), online play goes through Steam lobbies, and a hosted
server is only needed for the phone companion. The web version keeps running while this is built.

## Choices made up front

- **Godot 4.7, GDScript.** Same engine version as `client-godot/`. GDScript keeps the web export open and works
  with GodotSteam without extra glue. C# would cost the web export in Godot 4.
- **A new project, `masquerade-godot/`.** `client-godot/` stays as the hub's classic games.
- **The rules are a straight port of the server**, call for call, so the same seed plays the same round. A parity
  test replays rounds recorded on the Node server and checks every figure lands in the same place.
- **Players and NPCs stay indistinguishable**: peers only ever receive `view_for()` dictionaries, the same shape as
  the web protocol. One catch remains with a player hosting: the host's machine holds everyone's secrets, so a
  determined host could cheat. That's accepted for a game among friends.

## Milestones

Rough sizes assume steady work. Each one ends with something you can try.

1. **Rules inside the game** (this first PR). Crowd movement, `CrowdMatch`, the nine rooms, quick-play scoring,
   the server's tests ported, the parity test, and a flat test bench scene to play with keyboard and controllers.
2. **Party Night** (about 1 week). Port `server/src/party/` (points, room picks, shop, contracts, suspicion, ghosts,
   Host, Last Dance, awards) with its tests and a parity check.
3. **The 3D ballroom** (3 to 5 weeks, the biggest step). Rebuild `scene3d.ts` in Godot: the ballroom, figures with
   oversized animal masks facing the camera, light pools, floor markings, the invitation HUD, the mansion board from
   PR #15, sound and the waltz. Rigged, animated figures become possible here.
4. **Couch play** (about 1 week). Many controllers on one screen, rumble for secrets, the shared-screen rules
   (nobody marked, private-word modes off without phones).
5. **Online through Steam** (2 to 3 weeks). GodotSteam lobbies and Steam networking: the host steps the match at
   20 Hz and sends each peer its view; peers send inputs and predict their own figure with `CrowdMovement`. Away and
   reconnect as on the web. Before the Steam app exists this can be tested over plain ENet, with a headless Godot
   host on Sal's server.
6. **Phone companion** (1 to 2 weeks). The game registers a room with a small relay on a hosted server; phones open
   a web page with the room code and get their private orders, codenames and secret picks. Reuses parts of
   `client-web/`.
7. **Steam release work** (about 2 weeks). Steamworks app ($100 fee), achievements, rich presence and invites,
   Remote Play Together and Steam Deck testing, SteamPipe builds, store page, Valve review.
8. **Rival Agents.** The new acts, gadgets and orders from the Rival Agents design, built on the Godot version.

Total: about 3 to 4 months before Rival Agents.
