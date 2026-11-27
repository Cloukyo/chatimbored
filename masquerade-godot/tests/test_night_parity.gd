extends TestCase
## Replays whole nights recorded on the Node server (tests/parity/record_nights.ts) through NightSession,
## with the same seeds and scripted players, and checks the night agrees after every step:
## points, tips, claims, picks, twists, suspicion, the invite, the Mole, the Last Dance, standings and awards.

const ParityScript := preload("res://tests/test_parity.gd")


func test_whole_nights_replay_the_servers_nights_exactly() -> void:
	var nights: Array = JSON.parse_string(FileAccess.get_file_as_string("res://tests/parity/nights.json"))
	eq(nights.size(), 3, "recorded nights")
	for recorded in nights:
		_replay(recorded)


func _replay(recorded: Dictionary) -> void:
	var label: String = recorded.label
	var seed := int(recorded.seed)
	var players := []
	for i in int(recorded.playerCount):
		players.append({"id": "p%d" % (i + 1), "name": "Player %d" % (i + 1)})
	var ids := players.map(func(p: Dictionary) -> String: return p.id)
	var counter := [0]
	var make_random := func() -> CrowdRandom:
		counter[0] += 1
		return CrowdRandom.new(seed * 100 + counter[0] - 1)
	var session := NightSession.new(players, int(recorded.rounds), recorded.shared, CrowdRandom.new(seed), recorded.options, make_random)
	var night := session.night
	var seqs := {}
	var log: Array = recorded.log
	var rooms: Array = recorded.rooms
	var room_index := 0
	var step := 0
	if not _same(label, 0, _summary(night, session.phase), log[0]):
		return
	for guard in 200:
		if session.phase == "night_over":
			break
		match session.phase:
			"board":
				var error := session.pick_room(night.picker_id, night.offered[0])
				ok(error == "", "%s: pick failed: %s" % [label, error])
			"in_game":
				while session.phase == "in_game":
					var crowd := session.crowd
					for i in ids.size():
						seqs[ids[i]] = seqs.get(ids[i], 0) + 1
						session.handle_input(ids[i], ParityScript.scripted_input(crowd, i, seqs[ids[i]]))
					session.update()
				var room: Dictionary = rooms[room_index]
				room_index += 1
				var crowd := session.crowd
				eq(crowd.rules.mode, room.mode, "%s room %d mode" % [label, room_index])
				eq(crowd.tick, room.endTick, "%s room %d end tick" % [label, room_index])
				eq(crowd.result.winner, room.winner, "%s room %d winner" % [label, room_index])
				eq(crowd.result.get("winnerPlayerId", ""), room.winnerPlayerId, "%s room %d winning player" % [label, room_index])
				ok(_numbers_match(crowd.spectator_view("host").e, room.e), "%s room %d: figures differ at the end" % [label, room_index])
			"results":
				session.next(session.host_id())
			"shop":
				for i in ids.size():
					session.night_action(ids[i], {"kind": "buy", "perk": NightData.PERKS[(i + night.played.size()) % NightData.PERKS.size()].key})
					session.night_action(ids[i], {"kind": "done"})
			"mole_vote":
				for i in ids.size():
					session.night_action(ids[i], {"kind": "vote", "playerId": ids[(i + 1) % ids.size()]})
			"finale_pick":
				var finalists := night.finalists.duplicate()
				for i in ids.size():
					if session.phase == "finale_pick":
						session.night_action(ids[i], {"kind": "back", "playerId": finalists[i % 2]})
				if session.phase == "finale_pick":
					session.night_action(session.host_id(), {"kind": "skip"})
		step += 1
		if step >= log.size():
			ok(false, "%s: the night ran longer than the server's" % label)
			return
		if not _same(label, step, _summary(night, session.phase), log[step]):
			return
	eq(step, log.size() - 1, label + ": steps")
	eq(room_index, rooms.size(), label + ": rooms played")


func _same(label: String, step: int, mine: Dictionary, theirs: Dictionary) -> bool:
	var a := JSON.stringify(_normalise(mine), "", true)
	var b := JSON.stringify(_normalise(theirs), "", true)
	if a == b:
		return true
	for key in theirs:
		var x := JSON.stringify(_normalise(mine.get(key)), "", true)
		var y := JSON.stringify(_normalise(theirs[key]), "", true)
		if x != y:
			failures.append("%s step %d (%s): %s differs\n      godot:  %s\n      server: %s" % [label, step, theirs.phase, key, x, y])
	return false


## Same fields as summary() in record_nights.ts.
static func _summary(night: MasqueradeNight, phase: String) -> Dictionary:
	var snap := night.snapshot_for("p1", phase == "night_over")
	return {
		"phase": phase,
		"points": snap.points,
		"tips": snap.tips,
		"claims": snap.claims,
		"played": snap.played,
		"offered": snap.offered,
		"pickerId": snap.pickerId,
		"twists": snap.twists,
		"guests": snap.guests,
		"hostId": snap.hostId,
		"wantedId": snap.wantedId,
		"finalists": snap.finalists,
		"finaleWinner": snap.finaleWinner,
		"moleReveal": snap.moleReveal,
		"suspicion": night.suspicion,
		"inviteHolder": night.invite_holder,
		"standings": snap.get("standings", []),
		"awards": snap.get("awards", []),
	}


## Sorted keys and numbers as floats, so the two sides print the same.
static func _normalise(value):
	if value is Dictionary:
		var keys: Array = value.keys()
		keys.sort()
		var out := {}
		for key in keys:
			out[key] = _normalise(value[key])
		return out
	if value is Array:
		return value.map(func(v): return _normalise(v))
	if value is int:
		return float(value)
	return value


static func _numbers_match(a: Array, b: Array) -> bool:
	if a.size() != b.size():
		return false
	for i in a.size():
		if absf(float(a[i]) - float(b[i])) > 1e-9:
			return false
	return true
