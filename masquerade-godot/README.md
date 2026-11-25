# Morbid Masquerade (Godot)

The Steam version of Morbid Masquerade. The plan is in [docs/godot-remake-plan.md](../docs/godot-remake-plan.md).

- `rules/`: the game rules, ported from `server/src/crowd/`. `CrowdMatch` runs a round; each room is a
  `CrowdRules` subclass in `rules/modes/`; `QuickPlayRound` adds the round timer and scores.
- `tests/`: headless tests, including the parity test against rounds recorded on the Node server.
- `debug/`: a flat test bench to play the rooms (keyboard plus any controllers). Not the game's look.

Open this folder in Godot 4.7 and press Play for the test bench.

## Tests

```
GODOT=/path/to/godot masquerade-godot/tests/run.sh          # everything
GODOT=/path/to/godot masquerade-godot/tests/run.sh marked   # names containing "marked"
```

If you change the rules on the server, re-record the parity rounds from the repo root and make the Godot port
match again:

```
server/node_modules/.bin/tsx masquerade-godot/tests/parity/record.ts
```
