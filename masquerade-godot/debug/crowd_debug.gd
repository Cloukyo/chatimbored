extends Node2D
## A bare test bench for the ported rules: flat circles, no art. Not the game's look, just a way to
## play the rooms on one screen before the 3D ballroom exists.
## Keyboard: WASD move, Shift run, E act, click someone to shoot them.
## Each controller joins as another player: left stick move, B run, A act, X shoots whoever is nearest ahead.
## Tab: next room. R: restart. F1: show who the players are (a cheat, for testing only).
## N: start a full night instead (1-3 picks a room on the board, Enter moves on / skips a step).

var driver := PlayDriver.new()
var reveal := false
var _mouse_was_down := false


func _ready() -> void:
	driver.start_quick()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_TAB:
				driver.next_room()
			KEY_R:
				driver.start_quick()
			KEY_F1:
				reveal = not reveal
			KEY_N:
				driver.start_night()
			KEY_1, KEY_2, KEY_3:
				driver.pick(event.keycode - KEY_1)
			KEY_ENTER:
				driver.night_continue()


func _process(delta: float) -> void:
	driver.advance(delta, _keyboard_input)
	queue_redraw()


func _keyboard_input() -> Dictionary:
	var move := Vector2(
		float(Input.is_physical_key_pressed(KEY_D)) - float(Input.is_physical_key_pressed(KEY_A)),
		float(Input.is_physical_key_pressed(KEY_S)) - float(Input.is_physical_key_pressed(KEY_W)),
	)
	var input := {"move": {"x": move.x, "y": move.y}, "run": Input.is_physical_key_pressed(KEY_SHIFT), "act": Input.is_physical_key_pressed(KEY_E)}
	if Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) and not _mouse_was_down:
		var point := get_local_mouse_position()
		input.shoot = {"x": point.x, "y": point.y}
		var picked := driver.entity_near(point, 30)
		if picked != null:
			input.shootAt = picked.id
	_mouse_was_down = Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
	return input


func _draw() -> void:
	var session := driver.session
	var game := driver.game
	if session != null and session.crowd == null:
		_draw_night_screen()
		return
	var crowd := driver.crowd()
	var arena := crowd.arena
	draw_rect(Rect2(0, 0, arena.width, arena.height), Color("2a0f14"))
	if arena.has("exitX"):
		draw_rect(Rect2(arena.exitX, 0, arena.width - arena.exitX, arena.height), Color("3d2a10"))
	var view: Dictionary = driver.view()
	if view.has("zone"):
		draw_arc(Vector2(view.zone.x, view.zone.y), view.zone.r, 0, TAU, 96, Color("f2d27a"), 2)
	for prop in crowd.props:
		draw_rect(Rect2(prop.x - 10, prop.y - 10, 20, 20), Color("f2c14e") if prop.on else Color("6b5a2e"))
	var packed: Array = view.e
	for i in range(0, packed.size(), 5):
		var state: int = packed[i + 4]
		var color := Color("d9c7a3")
		match state:
			CrowdEntity.State.DEAD:
				color = Color("5a3a3a")
			CrowdEntity.State.SICK:
				color = Color("7fae5a")
			CrowdEntity.State.STUNNED:
				color = Color("9a8fd0")
		draw_circle(Vector2(packed[i + 1], packed[i + 2]), 9, color)
	if reveal:
		for slot: CrowdSlot in crowd.slots.values():
			if not slot.entity.hidden:
				draw_arc(Vector2(slot.entity.x, slot.entity.y), 14, 0, TAU, 24, Color("ff4060"), 2)
	for event in view.events:
		if event.type == "shot":
			draw_line(Vector2(event.from.x, event.from.y), Vector2(event.to.x, event.to.y), Color(1, 1, 1, 0.4), 1)
	var font := ThemeDB.fallback_font
	var ms_left: int = session.ms_left if session != null else game.ms_left
	var lines := [
		"%s   %ds left   (Tab: next room, R: restart, N: full night, F1: reveal)" % [CrowdModes.NAMES.get(crowd.rules.mode, "Last Dance"), ms_left / 1000],
		"You (keyboard): %s, shots %d, %s" % [view.role, view.shots, "can act" if view.canAct else ""],
		"HUD: %s" % [view.hud],
	]
	if session != null:
		lines.append("Night: %s" % [view.get("party", {})])
		if session.phase == "results":
			lines.append("Round over: %s   (Enter to go on)" % [session.night.last_round.get("points", {})])
	else:
		lines.append("Controllers: %d   Scores: %s" % [driver.pads.size(), game.scores()])
		if game.winner_id != "":
			lines.append("Winner: %s" % game.winner_id)
	for i in lines.size():
		draw_string(font, Vector2(12, 22 + i * 18), lines[i], HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color("f5e6c8"))


## Between rooms: the board, shop, vote, backing and final standings, as plain text.
func _draw_night_screen() -> void:
	var session := driver.session
	draw_rect(Rect2(0, 0, 1280, 720), Color("1d0b0f"))
	var night := session.night
	var lines := ["The night: room %d of %d   (phase: %s)" % [night.played.size() + 1, night.total_rounds, session.phase], ""]
	match session.phase:
		"board":
			lines.append("%s picks the next room. Press 1-3:" % session.name_of(night.picker_id))
			for i in night.offered.size():
				var room := NightData.room(night.offered[i])
				lines.append("  %d. %s (%s)%s" % [i + 1, room.name, CrowdModes.NAMES[room.mode], "   claimed by " + session.name_of(night.claims[room.key]) if night.claims.has(room.key) else ""])
		"shop", "mole_vote", "finale_pick":
			lines.append("Press Enter to skip this step.")
		"night_over":
			lines.append("Final standings (N for another night, R for quick play):")
			for standing in night.standings():
				lines.append("  %s: %d (%d points, %d rooms)" % [session.name_of(standing.playerId), standing.total, standing.points, standing.rooms])
			for award in night.awards():
				lines.append("  %s: %s, %s" % [award.title, session.name_of(award.playerId), award.detail])
	lines.append("")
	lines.append("Points: %s" % [night.points])
	lines.append("Rooms claimed: %s" % [night.claims])
	var font := ThemeDB.fallback_font
	for i in lines.size():
		draw_string(font, Vector2(40, 60 + i * 24), lines[i], HORIZONTAL_ALIGNMENT_LEFT, -1, 18, Color("f5e6c8"))
