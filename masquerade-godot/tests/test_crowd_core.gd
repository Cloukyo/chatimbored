extends CrowdTestHelpers
## The rules every room shares: anonymous views, movement, acks, shots, leaving.


func test_views_never_say_which_entities_are_players_or_who_holds_which_role() -> void:
	start("silent_witness", 4)
	steps(5)
	for player_id in ["p1", "p2", "p3", "p4"]:
		var mine := view(player_id)
		var json := JSON.stringify(mine)
		eq(mine.you, entity_of(player_id).id, "you")
		ok(not mine.has("result"), "no result yet")
		for other in ["p1", "p2", "p3", "p4"]:
			ok(not json.contains(other), "view names " + other)
		# The only role a player learns is their own.
		var other_role := "hunter" if mine.role == "killer" else "killer"
		ok(not json.contains(other_role), "view mentions " + other_role)
		eq(mine.e.size(), crowd.entities.size() * 5, "packed size")
		var ids := []
		for i in range(0, mine.e.size(), 5):
			ids.append(mine.e[i])
		var sorted := ids.duplicate()
		sorted.sort()
		eq(ids, sorted, "sorted by id")


func test_the_only_player_ids_in_a_view_are_nowhere() -> void:
	start("act_natural", 3)
	game.update()
	var json := JSON.stringify(view("p1"))
	ok(not json.contains("p2"))
	ok(not json.contains("p3"))


func test_inputs_move_at_full_walk_speed_in_8_directions_even_from_a_light_push() -> void:
	start("act_natural")
	var entity := entity_of("p1")
	entity.x = 600
	entity.y = 360
	send("p1", {"move": {"x": 0.3, "y": 0.02}})
	eq(entity.x, 600 + CrowdMovement.WALK_SPEED * CrowdMovement.TICK_SECONDS, "walk x")
	eq(entity.y, 360, "walk y")
	send("p1", {"move": {"x": 1, "y": 0}, "run": true})
	eq(entity.x, 600 + (CrowdMovement.WALK_SPEED + CrowdMovement.RUN_SPEED) * CrowdMovement.TICK_SECONDS, "run x")


func test_inputs_are_acked_so_a_client_can_replay_its_prediction_exactly() -> void:
	start("act_natural")
	var entity := entity_of("p1")
	var predicted := CrowdMovement.vec(entity.x, entity.y)
	for move in [{"x": 1, "y": 0}, {"x": 1, "y": 1}, {"x": 0, "y": -1}, {"x": -1, "y": 1}]:
		send("p1", {"move": move})
		predicted = CrowdMovement.step_position(predicted.x, predicted.y, CrowdMovement.snap_direction(move), false, crowd.arena)
	eq(view("p1").ack, _seqs["p1"], "ack")
	eq(entity.x, predicted.x, "x")
	eq(entity.y, predicted.y, "y")


func test_a_shot_hits_whoever_was_pointed_at_even_past_someone_in_the_way() -> void:
	start("act_natural")
	clear_crowd(30, 30)
	var shooter := entity_of("p1")
	var between := entity_of("p2")
	var target := entity_of("p3")
	shooter.x = 400; shooter.y = 400
	between.x = 500; between.y = 400
	target.x = 600; target.y = 400
	crowd.slots["p1"].shots = 2
	send("p1", {"shoot": {"x": 800, "y": 400}})
	ok(not between.dead and not target.dead, "empty floor misses")
	# The player names who was picked, from where they last saw them a moment ago.
	send("p1", {"shoot": {"x": 590, "y": 380}, "shootAt": target.id})
	ok(not between.dead, "nobody in between is hit")
	ok(target.dead, "the named target is hit")


func test_a_player_who_leaves_keeps_wandering_with_the_crowd() -> void:
	start("act_natural", 3)
	game.player_left("p3")
	ok(entity_of("p3").has_brain)
	eq(game.winner_id, "")


func test_the_random_generator_matches_the_servers_mulberry32() -> void:
	# First values of seededRandom(1) and seededRandom(12345) on the Node server.
	var one := CrowdRandom.new(1)
	eq(one.next(), 0.6270739405881613)
	eq(one.next(), 0.002735721180215478)
	var other := CrowdRandom.new(12345)
	eq(other.next(), 0.9797282677609473)
