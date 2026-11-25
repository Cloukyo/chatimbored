extends TestCase
## The full night's rules, ported from server/src/party/PartyNight.test.ts and layers.test.ts.

var _seq := 0


static func only(keys: Array) -> Dictionary:
	var options := {}
	for layer in NightData.LAYERS:
		options[layer.key] = keys.has(layer.key)
	return options


func input(extra: Dictionary = {}) -> Dictionary:
	_seq += 1
	var made := {"seq": _seq, "move": {"x": 0.0, "y": 0.0}, "run": false, "act": false}
	made.merge(extra, true)
	return made


func shoot(crowd: CrowdMatch, shooter: String, target: String) -> void:
	var entity: CrowdEntity = crowd.slots[target].entity
	crowd.queue_input(shooter, input({"shoot": {"x": entity.x, "y": entity.y}}))
	crowd.step()


func start_round(night: MasqueradeNight, rules: CrowdRules, seed: int) -> CrowdMatch:
	night.pick(night.offered[0])
	var prep := night.prepare_round(rules)
	var crowd := CrowdMatch.new(prep.rules, prep.player_ids, CrowdRandom.new(seed), {"ghosts": prep.ghosts, "observer": night.round})
	night.round.begin(crowd)
	return crowd


func test_a_takedown_in_a_free_for_all_round_scores_and_the_winner_claims_the_room() -> void:
	var rules := ActNaturalRules.new()
	rules.npc_count = 0
	var crowd := CrowdMatch.new(rules, ["a", "b", "c"], CrowdRandom.new(1))
	shoot(crowd, "a", "b")
	eq(crowd.slots["a"].takedowns, ["b"] as Array[String], "takedowns")
	crowd.slots["a"].entity.x = 1000
	crowd.slots["c"].entity.x = 100
	crowd.timeout()
	var score := NightScoring.score_round(crowd)
	eq(score.points["a"], NightData.POINTS.soloWin + NightData.POINTS.takedown + NightData.POINTS.survive, "a")
	eq(score.points["b"], 0, "b")
	eq(score.points["c"], NightData.POINTS.survive, "c")
	eq(score.claimant, "a", "claimant")


func test_shooting_your_own_side_does_not_score_and_a_tied_team_win_goes_to_one_of_the_tied() -> void:
	var ids := ["a", "b", "c", "d"]
	var rules := SilentWitnessRules.new()
	rules.npc_count = 0
	var crowd := CrowdMatch.new(rules, ids, CrowdRandom.new(2))
	var hunters := ids.filter(func(id: String) -> bool: return crowd.slots[id].role == "hunter")
	shoot(crowd, hunters[0], hunters[1])
	ok(not crowd.is_over(), "not over")
	crowd.timeout()
	var score := NightScoring.score_round(crowd)
	eq(score.points[hunters[0]], NightData.POINTS.teamWin + NightData.POINTS.survive)
	eq(score.points[hunters[1]], NightData.POINTS.teamWin)
	eq(score.points[hunters[2]], NightData.POINTS.teamWin + NightData.POINTS.survive)
	ok(score.claimant == hunters[0] or score.claimant == hunters[2], "claimant is a top hunter")


func test_last_place_picks_from_three_unplayed_rooms() -> void:
	var night := MasqueradeNight.new(["a", "b", "c"], 6, false, CrowdRandom.new(3))
	eq(night.offered.size(), 3)
	night.pick(night.offered[0])
	night.record_round({"points": {"a": 5, "b": 0, "c": 2}, "claimant": "a"})
	eq(night.picker_id, "b", "picker")
	eq(night.offered.size(), 3)
	ok(night.offered.all(func(key: String) -> bool: return not night.played.has(key)), "unplayed")
	ok(night.pick(night.played[0]).is_empty(), "can't pick a played room")


func test_a_shared_screen_leaves_out_rooms_that_need_secret_words() -> void:
	var night := MasqueradeNight.new(["a", "b"], 8, true, CrowdRandom.new(4))
	var keys := {}
	while not night.is_over():
		for key in night.offered:
			keys[key] = true
		night.pick(night.offered[0])
		night.skip_round()
	eq(night.total_rounds, 8)
	for room in NightData.ROOMS:
		eq(keys.has(room.key), not room.get("needsPrivateText", false), room.key)


func test_final_standings_add_claimed_rooms_and_connected_pairs() -> void:
	var night := MasqueradeNight.new(["a", "b"], 4, false, CrowdRandom.new(5))
	night.points["a"] = 10
	night.points["b"] = 12
	night.claims["grand_hall"] = "a"
	night.claims["garden"] = "a"
	night.claims["vault"] = "a"
	night.claims["library"] = "b"
	var ranked := night.standings()
	eq(ranked[0], {"playerId": "a", "points": 10, "rooms": 3, "connectedPairs": 2, "total": 10 + 3 * 2 + 2})
	eq(ranked[1].total, 12 + 2)


func test_a_plain_night_runs_through_every_room_to_the_final_standings() -> void:
	var players := [{"id": "host", "name": "Host"}, {"id": "guest", "name": "Guest"}]
	var session := NightSession.new(players, 4, false, CrowdRandom.new(6), only([]), func() -> CrowdRandom: return CrowdRandom.new(60))
	eq(session.phase, "board")
	for round in range(1, 5):
		var night := session.night
		var picker := night.picker_id
		if picker == "host":
			ok(session.pick_room("guest", night.offered[0]) != "", "guest can't pick for the host")
		eq(session.pick_room(picker, night.offered[0]), "", "pick")
		eq(session.phase, "in_game")
		session.finish_round()
		eq(session.phase, "results")
		eq(session.night_view_for("host").roundsPlayed, round)
		session.next("host")
	eq(session.phase, "night_over")
	eq(session.night_view_for("host").standings.size(), 2)


func test_a_picker_who_leaves_hands_the_pick_to_whoever_is_now_last() -> void:
	var night := MasqueradeNight.new(["a", "b", "c"], 4, false, CrowdRandom.new(7))
	var leaving := night.picker_id
	night.remove_player(leaving)
	ok(night.picker_id != "" and night.picker_id != leaving)


func test_the_shop_sells_one_perk_refunds_a_swap_and_closes_when_everyone_is_done() -> void:
	var night := MasqueradeNight.new(["a", "b"], 4, false, CrowdRandom.new(3), only(["shop", "suspicion"]))
	night.tips["a"] = 4
	eq(night.buy("b", "extra_shot"), "Not enough tips.")
	eq(night.buy("a", "extra_shot"), "")
	eq(night.tips["a"], 1)
	night.suspicion["a"] = 40
	eq(night.buy("a", "clean_slate"), "", "swap")
	eq(night.tips["a"], 1, "refund")
	eq(night.suspicion["a"], 0)
	eq(night.finish_shopping("a"), false)
	eq(night.finish_shopping("b"), true)
	ok(night.buy("a", "extra_shot") != "", "shop closed")
	var shared := MasqueradeNight.new(["a", "b"], 4, true, CrowdRandom.new(3), only(["shop"]))
	shared.tips["a"] = 9
	eq(shared.buy("a", "glimpse"), "That perk isn't for sale tonight.")


func test_an_extra_shot_perk_adds_a_shot_next_round_only_in_modes_with_shots() -> void:
	var night := MasqueradeNight.new(["a", "b"], 4, false, CrowdRandom.new(4), only(["shop"]))
	night.tips["a"] = 5
	night.buy("a", "extra_shot")
	var crowd := start_round(night, ActNaturalRules.new(), 40)
	eq(crowd.slots["a"].shots, 2)
	eq(crowd.slots["b"].shots, 1)


func test_guests_who_die_stay_gone_down_to_a_floor() -> void:
	var night := MasqueradeNight.new(["a", "b"], 8, false, CrowdRandom.new(8), only(["emptyingParty"]))
	var crowd := start_round(night, ActNaturalRules.new(), 80)
	eq(crowd.entities.size(), 44 + 2, "act natural's own crowd")
	var npcs := crowd.entities.filter(func(e: CrowdEntity) -> bool: return e.has_brain)
	for i in 10:
		crowd.kill(npcs[i])
	crowd.timeout()
	night.record_round(NightScoring.score_round(crowd), crowd)
	eq(night.guests, MasqueradeNight.GUESTS - 10)
	night.guests = 3
	var thin := start_round(night, ActNaturalRules.new(), 81)
	eq(thin.entities.size(), MasqueradeNight.MIN_GUESTS + 2, "floor")


func test_last_dance_backers_ghost_from_the_start_and_hitting_the_other_finalist_wins() -> void:
	var night := MasqueradeNight.new(["a", "b", "c"], 1, false, CrowdRandom.new(13), only(["finale"]))
	night.finalists = ["a", "b"]
	night.backers["c"] = "a"
	night.start_finale()
	var prep := night.prepare_round(null)
	var crowd := CrowdMatch.new(prep.rules, prep.player_ids, CrowdRandom.new(14), {"ghosts": prep.ghosts, "observer": night.round})
	night.round.begin(crowd)
	eq(crowd.rules.mode, "last_dance")
	ok(crowd.slots["c"].ghost != null, "backer ghosts")
	ok(crowd.slots["c"].entity.hidden, "backer not in the crowd")
	for e in crowd.entities:
		if e.has_brain:
			e.y = 700
	crowd.slots["a"].entity.x = 300; crowd.slots["a"].entity.y = 300
	crowd.slots["b"].entity.x = 500; crowd.slots["b"].entity.y = 300
	shoot(crowd, "a", "b")
	eq(crowd.result.get("winnerPlayerId", ""), "a")
	night.record_round(NightScoring.score_round(crowd), crowd)
	eq(night.finale_winner, "a")
	ok(night.points["c"] >= NightData.POINTS.backedFinalist, "backer paid")
	eq(night.standings()[0].playerId, "a")


func test_the_host_watches_from_above_and_their_tricks_move_only_guests() -> void:
	var players := []
	for i in 5:
		players.append({"id": "p%d" % (i + 1), "name": "P%d" % (i + 1)})
	var session := NightSession.new(players, 4, false, CrowdRandom.new(21), only(["host"]), func() -> CrowdRandom: return CrowdRandom.new(22))
	session.pick_room(session.night.picker_id, session.night.offered[0])
	var host := session.night.host_id
	ok(host != "", "someone hosts")
	ok(not session.crowd.slots.has(host), "the host isn't in the crowd")
	var view := session.crowd_view_for(host)
	eq(view.you, 0, "host has no figure")
	eq(view.party.trick, "toast")
	eq(view.party.players.size(), 4, "host sees where the players are")
	session.handle_input(host, input({"act": true}))
	eq(session.crowd_view_for(host).party.trick, "conga", "act cycles the trick")
	for slot: CrowdSlot in session.crowd.slots.values():
		slot.entity.stop()
	session.handle_input(host, input({"act": true, "shoot": {"x": 640, "y": 360}}))
	for slot: CrowdSlot in session.crowd.slots.values():
		ok(CrowdMovement.is_still(slot.entity.direction), "players don't play along")
	eq(session.crowd_view_for(host).party.tricksLeft, NightData.HOST_TRICKS_PER_ROUND - 1)
