# Morbid Masquerade (Godot)

The Steam version of Morbid Masquerade. The plan is in [docs/godot-remake-plan.md](../docs/godot-remake-plan.md).

- `rules/`: the game rules, ported from `server/src/crowd/`. `CrowdMatch` runs a round; each room is a
  `CrowdRules` subclass in `rules/modes/`; `QuickPlayRound` adds the round timer and scores.
- `night/`: the full night (the main mode; its name is still to be decided), ported from `server/src/party/`.
  `MasqueradeNight` holds the night, `NightRound` runs the layers during a room, `NightSession` drives a whole night
  (board, rooms, results, shop, Mole vote, Last Dance, standings).
- `tests/`: headless tests, including the parity test against rounds recorded on the Node server.
- `view/`: the 3D picture. `CrowdView3D` draws a round from the view dictionaries the rules hand out, so it
  works the same for a local round or one sent over the network. Rooms, figures, masks and props are placeholders;
  see [view/README.md](view/README.md) for swapping in modelled art.
- `game/`: the game scene. `PlayDriver` runs quick play or a night on one screen (keyboard is player 1, each
  controller the next); `GameHud` is the HUD.
- `debug/`: a flat test bench with the same driver, for checking rules without the 3D view.

Open this folder in Godot 4.7 and press Play. Keys: WASD move, Shift run, E act, click to shoot. Tab next room,
R restart, N a full night, 1-3 pick a room on the night's board, Enter to go on. Controllers: left stick, B run,
A act, X shoots the nearest person ahead.

Screenshots without a screen (Linux, with Xvfb):

```
xvfb-run -a godot --path masquerade-godot --rendering-driver opengl3 --write-movie /tmp/shot.png \
  --fixed-fps 20 --quit-after 120 -- --demo --room=marked      # or --night
```

## Tests

```
GODOT=/path/to/godot masquerade-godot/tests/run.sh          # everything
GODOT=/path/to/godot masquerade-godot/tests/run.sh marked   # names containing "marked"
```

If you change the rules on the server, re-record the parity rounds from the repo root and make the Godot port
match again:

```
server/node_modules/.bin/tsx masquerade-godot/tests/parity/record.ts
server/node_modules/.bin/tsx masquerade-godot/tests/parity/record_nights.ts
```
