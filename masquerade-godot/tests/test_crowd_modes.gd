extends CrowdTestHelpers
## One test per rule of each quick-play room, ported from the server's CrowdGames tests.


func test_act_natural_first_player_through_the_exit_wins_and_scores() -> void:
	start("act_natural")
	var entity := entity_of("p2")
	entity.x = ActNaturalRules.EXIT_X - 2
	send("p2", {"move": {"x": 1, "y": 0}})
	eq(game.winner_id, "p2")
	game.finish()
	eq(score_of("p2"), 1, "score")
	var reveal: Array = view("p1").result.reveal
	eq(reveal.size(), 3, "reveal size")
	for entry in reveal:
		if entry.playerId == "p2":
			eq(entry.entity, entity.id, "reveal entity")


func test_act_natural_one_shot_each_and_a_shot_player_is_out() -> void:
	start("act_natural")
	clear_crowd(30, 30)
	var target := entity_of("p2")
	entity_of("p1").x = 400; entity_of("p1").y = 400
	target.x = 600; target.y = 400
	send("p1", {"shoot": {"x": 600, "y": 400}})
	ok(target.dead, "target down")
	eq(view("p1").shots, 0, "shots left")
	ok(has_event(view("p3").events, "shot"), "everyone sees the shot")
	var third := entity_of("p3")
	third.x = 650; third.y = 400
	send("p1", {"shoot": {"x": 700, "y": 400}})
	ok(not third.dead, "no second shot")


func test_silent_witness_the_killer_changes_between_rounds() -> void:
	var killers := {}
	for i in 20:
		start("silent_witness", 4)
		killers[slot_with_role("killer").player_id] = true
	ok(killers.size() > 1)


func test_silent_witness_victims_sicken_then_die_and_five_deaths_win_it() -> void:
	start("silent_witness", 3)
	var killer := slot_with_role("killer")
	# Keep everyone else out of reach, so each strike can only land on the guest we put there.
	clear_crowd(30, 30)
	killer.entity.x = 640; killer.entity.y = 360
	for slot: CrowdSlot in crowd.slots.values():
		if slot != killer:
			slot.entity.x = 1200; slot.entity.y = 690
	var crowd_npcs := npcs()
	for kill in SilentWitnessRules.KILL_TARGET:
		var victim: CrowdEntity = crowd_npcs[kill]
		victim.x = killer.entity.x + 10
		victim.y = killer.entity.y
		victim.brain_timer_ms = 1e9
		victim.stop()
		killer.act_cooldown_ms = 0
		send(killer.player_id, {"act": true})
		ok(victim.sick_ms > 0, "victim %d sickens" % kill)
		for t in 60:
			if victim.dead:
				break
			game.update()
		ok(victim.dead, "victim %d dies" % kill)
	eq(game.winner_id, killer.player_id)


func test_silent_witness_a_hunter_who_shoots_the_killer_wins_it_for_the_hunters() -> void:
	start("silent_witness", 3)
	var killer := slot_with_role("killer")
	var hunter := slot_with_role("hunter")
	clear_crowd(30, 690)
	hunter.entity.x = 300; hunter.entity.y = 300
	killer.entity.x = 500; killer.entity.y = 300
	send(hunter.player_id, {"shoot": {"x": 500, "y": 300}})
	eq(game.winner_id, "hunters")
	game.finish()
	eq(score_of(killer.player_id), 0, "killer score")
	eq(score_of(hunter.player_id), 1, "hunter score")


func test_silent_witness_when_no_hunter_has_a_shot_left_the_killer_wins() -> void:
	start("silent_witness", 2)
	var hunter := slot_with_role("hunter")
	hunter.entity.x = 300; hunter.entity.y = 300
	send(hunter.player_id, {"shoot": {"x": 300, "y": 30}})
	eq(game.winner_id, slot_with_role("killer").player_id)


func test_lantern_festival_lighting_every_lantern_wins_and_each_flares() -> void:
	start("lantern_festival", 3)
	clear_crowd()
	eq(crowd.props.size(), LanternFestivalRules.GOAL, "lanterns")
	for lantern in crowd.props:
		stand_at("p1", lantern)
		send("p1", {"act": true})
		ok(has_event(view("p2").events, "flare", "prop", lantern.id), "flare %d" % lantern.id)
	eq(view("p1").hud.progress, LanternFestivalRules.GOAL, "progress")
	eq(view("p2").mine.size(), 0, "p2 lit none")
	eq(game.winner_id, "p1")


func test_lantern_festival_a_strike_takes_down_whoever_is_in_reach() -> void:
	start("lantern_festival", 2)
	clear_crowd()
	stand_at("p1", {"x": 640, "y": 300})
	stand_at("p2", {"x": 660, "y": 300})
	send("p1", {"act": true})
	ok(entity_of("p2").dead)
	eq(game.winner_id, "p1")


func test_bell_ringers_lookouts_are_not_in_the_crowd_and_shoot_where_they_aim() -> void:
	start("bell_ringers", 3)
	var ringer := slot_with_role("ringer")
	var lookout := slot_with_role("lookout")
	var seen := view(lookout.player_id)
	eq(seen.you, 0, "lookout has no figure")
	eq(seen.shots, BellRingersRules.LOOKOUT_ARROWS, "arrows")
	eq(seen.e.size(), (crowd.entities.size() - 2) * 5, "lookouts hidden")
	clear_crowd()
	ringer.entity.x = 600; ringer.entity.y = 400
	send(lookout.player_id, {"shoot": {"x": 603, "y": 409}})
	ok(ringer.entity.dead, "ringer down")
	eq(game.winner_id, "lookouts")
	game.finish()
	eq(score_of(lookout.player_id), 1)
	eq(score_of(ringer.player_id), 0)


func test_bell_ringers_ringing_every_bell_wins_it_for_the_ringers() -> void:
	start("bell_ringers", 4)
	clear_crowd()
	var ringers := crowd.slots.values().filter(func(slot: CrowdSlot) -> bool: return slot.role == "ringer")
	eq(ringers.size(), 2, "ringers")
	for i in crowd.props.size():
		var bell: Dictionary = crowd.props[i]
		var ringer: CrowdSlot = ringers[i % 2]
		stand_at(ringer.player_id, bell)
		send(ringer.player_id, {"act": true})
		ok(bell.on, "bell %d rung" % i)
	eq(game.winner_id, "ringers")


func test_bell_ringers_lookouts_out_of_arrows_hand_the_round_to_the_ringers() -> void:
	start("bell_ringers", 2)
	clear_crowd()
	var lookout := slot_with_role("lookout")
	for arrow in BellRingersRules.LOOKOUT_ARROWS:
		send(lookout.player_id, {"shoot": {"x": 900, "y": 100}})
	eq(game.winner_id, "ringers")


func test_heist_hour_three_different_vaults_win_and_cracked_vaults_stay_alarmed() -> void:
	start("heist_hour", 3)
	clear_crowd()
	var first: Dictionary = crowd.props[0]
	stand_at("p1", first)
	send("p1", {"act": true})
	ok(first.on, "alarm on")
	stand_at("p2", first)
	send("p2", {"act": true})
	eq(view("p2").hud.progress, 0, "alarmed vault can't be cracked")
	for vault in [crowd.props[1], crowd.props[2]]:
		stand_at("p1", vault)
		send("p1", {"act": true})
	eq(view("p1").hud.progress, HeistHourRules.GOAL, "progress")
	eq(game.winner_id, "p1")


func test_heist_hour_alarms_reset_after_a_few_seconds() -> void:
	start("heist_hour", 2)
	clear_crowd()
	var vault: Dictionary = crowd.props[0]
	stand_at("p1", vault)
	send("p1", {"act": true})
	steps(120)
	ok(not vault.on)


func test_marked_striking_your_mark_scores_and_hands_you_their_mark() -> void:
	start("marked", 4)
	clear_crowd()
	var rules: MarkedRules = crowd.rules
	var hunt := rules.state(crowd)
	var mark: String = hunt.targets["p1"]
	var next: String = hunt.targets[mark]
	stand_at("p1", {"x": 640, "y": 300})
	stand_at(mark, {"x": 660, "y": 300})
	send("p1", {"act": true})
	ok(entity_of(mark).dead, "mark down")
	var mine := view("p1")
	eq(mine.hud.progress, 1, "progress")
	eq(mine.hud.markName, next, "inherits mark")
	eq(entity_of("p1").stun_ms, 0, "not stunned")


func test_marked_striking_the_wrong_person_leaves_you_stunned_in_plain_view() -> void:
	start("marked", 3)
	clear_crowd()
	var npc: CrowdEntity = npcs()[0]
	stand_at("p1", {"x": 640, "y": 300})
	npc.x = 660; npc.y = 310
	send("p1", {"act": true})
	ok(npc.dead, "npc down")
	ok(entity_of("p1").stun_ms > 0, "stunned")
	var packed: Array = view("p2").e
	var at := -1
	for i in range(0, packed.size(), 5):
		if packed[i] == entity_of("p1").id:
			at = i
	eq(packed[at + 4], CrowdEntity.State.STUNNED, "shows as stunned")


func test_marked_everyone_gets_a_rough_hint_of_where_their_mark_is() -> void:
	start("marked", 3)
	game.update()
	for player_id in ["p1", "p2", "p3"]:
		var mine := view(player_id)
		var target := entity_of(mine.hud.markName)
		ok(mine.hud.has("hint"), "hint for " + player_id)
		ok(absf(mine.hud.hint.x - target.x) <= 75, "hint near")


func test_freeze_frame_the_whole_crowd_stops_together_then_starts_again() -> void:
	start("freeze_frame", 2)
	var rules: FreezeFrameRules = crowd.rules
	var crowd_npcs := npcs()
	var ticks := 0
	while rules.state(crowd).frozen_ms == 0 and ticks < FreezeFrameRules.GAP_MS[1] / 50 + 5:
		game.update()
		ticks += 1
	ok(rules.state(crowd).frozen_ms > 0, "froze")
	game.update()
	ok(crowd_npcs.all(func(npc: CrowdEntity) -> bool: return CrowdMovement.is_still(npc.direction)), "all still")
	var before := crowd_npcs.map(func(npc: CrowdEntity) -> Array: return [npc.x, npc.y])
	game.update()
	eq(crowd_npcs.map(func(npc: CrowdEntity) -> Array: return [npc.x, npc.y]), before, "nobody moved")
	steps(120)
	ok(crowd_npcs.any(func(npc: CrowdEntity) -> bool: return not CrowdMovement.is_still(npc.direction)), "thawed")


func test_freeze_frame_players_are_not_frozen_and_the_exit_still_wins() -> void:
	start("freeze_frame", 2)
	var rules: FreezeFrameRules = crowd.rules
	rules.state(crowd).until_freeze_ms = 0
	entity_of("p1").x = ActNaturalRules.EXIT_X - 2
	send("p1", {"move": {"x": 1, "y": 0}})
	ok(rules.state(crowd).frozen_ms > 0, "froze")
	eq(game.winner_id, "p1")


func test_hot_parcel_only_the_holder_knows_and_bumping_a_player_passes_it_on() -> void:
	start("hot_parcel", 3)
	clear_crowd()
	game.update()
	var rules: HotParcelRules = crowd.rules
	var parcel := rules.state(crowd)
	var holder: String = parcel.holder
	var other: String = ["p1", "p2", "p3"].filter(func(id: String) -> bool: return id != holder)[0]
	eq(view(holder).hud.holding, true, "holder knows")
	eq(view(other).hud.holding, false, "others don't")
	ok(not view(other).hud.has("fuseSeconds"), "no fuse for others")
	stand_at(holder, {"x": 640, "y": 300})
	stand_at(other, {"x": 660, "y": 300})
	send(holder, {"act": true})
	eq(parcel.holder, other, "passed")
	ok(has_event(view("p1").events, "bump"), "bump seen")
	# No handing it straight back.
	crowd.slots[other].act_cooldown_ms = 0
	send(other, {"act": true})
	eq(parcel.holder, other, "no return")


func test_hot_parcel_bumping_an_npc_wastes_the_move() -> void:
	start("hot_parcel", 2)
	clear_crowd()
	game.update()
	var rules: HotParcelRules = crowd.rules
	var parcel := rules.state(crowd)
	var holder: String = parcel.holder
	var npc: CrowdEntity = npcs()[0]
	stand_at(holder, {"x": 640, "y": 300})
	npc.x = 660; npc.y = 300
	send(holder, {"act": true})
	eq(parcel.holder, holder)
	ok(not npc.dead)


func test_hot_parcel_when_the_fuse_runs_out_the_holder_is_out() -> void:
	start("hot_parcel", 2)
	game.update()
	var rules: HotParcelRules = crowd.rules
	var holder: String = rules.state(crowd).holder
	for t in HotParcelRules.FUSE_MS[1] / 50 + 2:
		if game.winner_id != "":
			break
		game.update()
	ok(entity_of(holder).dead, "holder down")
	eq(game.winner_id, "p2" if holder == "p1" else "p1")


func test_closing_time_the_light_shrinks_and_lingering_in_the_dark_gets_you_caught() -> void:
	start("closing_time", 3)
	ok(crowd.rules.zone(crowd).r > 700, "starts wide")
	crowd.tick = 1700
	eq(crowd.rules.zone(crowd).r, ClosingTimeRules.END_RADIUS, "ends small")
	crowd.tick = 600
	var now := crowd.rules.zone(crowd)
	var outsider := entity_of("p1")
	outsider.x = 30.0 if now.x > 640 else 1250.0
	outsider.y = 690
	stand_at("p2", now)
	stand_at("p3", {"x": now.x + 10, "y": now.y})
	steps(ClosingTimeRules.DARK_LIMIT_MS / 50 - 1)
	ok(not outsider.dead, "not yet")
	ok(view("p1").hud.darkMs > 0, "dark timer")
	game.update()
	ok(outsider.dead, "caught")
	ok(view("p2").has("zone"), "zone in view")
