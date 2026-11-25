extends TestCase
## Replays rounds recorded on the Node server (tests/parity/record.ts) through the Godot port with the
## same seeds and scripted players, and checks every figure ends up in exactly the same place.
## If this passes, the port plays the same game the web version does, call for call.

const PLAYERS := ["p1", "p2", "p3", "p4"]
const TICKS := 1800
const SNAPSHOT_EVERY := 100
const MOVES := [
	{"x": 1, "y": 0}, {"x": 0.7, "y": -0.7}, {"x": 0, "y": -1}, {"x": -0.5, "y": -0.5},
	{"x": -1, "y": 0}, {"x": -0.3, "y": 0.9}, {"x": 0, "y": 1}, {"x": 0.6, "y": 0.6}, {"x": 0, "y": 0},
]


## The same scripted players as scriptedInput() in record.ts. Keep the two in step.
static func scripted_input(crowd: CrowdMatch, player_index: int, seq: int) -> Dictionary:
	var tick := crowd.tick
	var input := {
		"seq": seq,
		"move": MOVES[(tick / (20 + player_index * 7)) % MOVES.size()],
		"run": (tick + player_index * 13) % 90 < 30,
		"act": (tick + player_index * 11) % 23 == 0,
	}
	if (tick + player_index * 97) % 211 == 0:
		var ids := []
		for e: CrowdEntity in crowd.visible_entities():
			if not e.dead:
				ids.append(e.id)
		ids.sort()
		if not ids.is_empty():
			var id: int = ids[(tick * 7 + player_index) % ids.size()]
			for e in crowd.entities:
				if e.id == id:
					input.shoot = {"x": e.x + 3, "y": e.y - 2}
					if player_index % 2 == 0:
						input.shootAt = id
	return input


func test_every_room_replays_the_servers_rounds_exactly() -> void:
	var rounds: Array = JSON.parse_string(FileAccess.get_file_as_string("res://tests/parity/rounds.json"))
	ok(rounds.size() == 18, "recorded rounds")
	for recorded in rounds:
		var label := "%s/%d" % [recorded.mode, recorded.seed]
		var crowd := CrowdMatch.new(CrowdModes.make(recorded.mode), PLAYERS, CrowdRandom.new(int(recorded.seed)))
		for slot: CrowdSlot in crowd.slots.values():
			eq(slot.role, recorded.roles[slot.player_id], label + " role of " + slot.player_id)
		var seqs := [0, 0, 0, 0]
		var mismatch := ""
		for step in TICKS:
			if crowd.is_over():
				break
			for i in PLAYERS.size():
				seqs[i] += 1
				crowd.queue_input(PLAYERS[i], scripted_input(crowd, i, seqs[i]))
			crowd.step()
			if crowd.tick % SNAPSHOT_EVERY == 0 or crowd.is_over():
				var expected = recorded.snapshots.get(str(crowd.tick))
				if expected == null:
					mismatch = "no server snapshot at tick %d (the round ended at a different time)" % crowd.tick
					break
				var got: Array = crowd.view_for("p1").e
				if not _same_numbers(got, expected.e):
					mismatch = "figures differ at tick %d" % crowd.tick
					break
				for i in PLAYERS.size():
					var hud: Dictionary = crowd.view_for(PLAYERS[i]).hud
					if JSON.stringify(_numbers_as_floats(hud)) != JSON.stringify(_numbers_as_floats(expected.hud[i])):
						mismatch = "hud of %s differs at tick %d: %s vs %s" % [PLAYERS[i], crowd.tick, hud, expected.hud[i]]
						break
				if mismatch != "":
					break
		ok(mismatch == "", label + ": " + mismatch)
		if mismatch != "":
			continue
		eq(crowd.tick, recorded.endTick, label + " end tick")
		var outcome := crowd.timeout()
		eq(outcome.winner, recorded.result.winner, label + " winner")
		eq(outcome.get("winnerPlayerId", ""), recorded.result.get("winnerPlayerId", ""), label + " winning player")
		eq(outcome.get("winnerRole", ""), recorded.result.get("winnerRole", ""), label + " winning role")


static func _same_numbers(a: Array, b: Array) -> bool:
	if a.size() != b.size():
		return false
	for i in a.size():
		if absf(float(a[i]) - float(b[i])) > 1e-9:
			return false
	return true


## JSON numbers come back as floats; make ints match so dictionaries compare as text.
static func _numbers_as_floats(value):
	if value is Dictionary:
		var keys: Array = value.keys()
		keys.sort()
		var out := {}
		for key in keys:
			out[key] = _numbers_as_floats(value[key])
		return out
	if value is Array:
		return value.map(func(v): return _numbers_as_floats(v))
	if value is int:
		return float(value)
	return value
