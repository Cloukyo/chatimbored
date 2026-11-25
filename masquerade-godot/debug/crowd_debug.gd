extends Node2D
## A bare test bench for the ported rules: flat circles, no art. Not the game's look, just a way to
## play the rooms on one screen before the 3D ballroom exists.
## Keyboard: WASD move, Shift run, E act, click someone to shoot them.
## Each controller joins as another player: left stick move, B run, A act, X shoots whoever is nearest ahead.
## Tab: next room. R: restart. F1: show who the players are (a cheat, for testing only).
## N: start a full night instead (1-3 picks a room on the board, Enter moves on / skips a step).

const PLAYER_COUNT := 4
const KEYBOARD := "p1"

var round_index := 0
var game: QuickPlayRound
var accumulator := 0.0
var seqs := {}
var reveal := false
## device id -> player id
var pads := {}
## Set while a full night is running instead of quick play.
var session: NightSession = null


func _ready() -> void:
	_start()


func _players() -> Array:
	var players := []
	for i in PLAYER_COUNT:
		players.append({"id": "p%d" % (i + 1), "name": "Player %d" % (i + 1), "score": 0})
	return players


func _seat_pads() -> int:
	pads.clear()
	var next := 2
	for device in Input.get_connected_joypads():
		if next > PLAYER_COUNT:
			break
		pads[device] = "p%d" % next
		next += 1
	return next


## Seats nobody is sitting in walk with the crowd, so a room always has enough players.
func _fill_empty_seats(crowd: CrowdMatch, first_empty: int) -> void:
	for i in range(first_empty, PLAYER_COUNT + 1):
		var slot: CrowdSlot = crowd.slots.get("p%d" % i)
		if slot != null and not slot.entity.hidden:
			slot.entity.give_brain()


func _start_night() -> void:
	session = NightSession.new(_players(), 4, false)
	_seat_pads()


func _start() -> void:
	session = null
	var mode: String = CrowdModes.ids()[round_index % CrowdModes.ids().size()]
	game = QuickPlayRound.new(mode, _players())
	_fill_empty_seats(game.crowd, _seat_pads())


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_TAB:
				round_index += 1
				_start()
			KEY_R:
				_start()
			KEY_F1:
				reveal = not reveal
			KEY_N:
				_start_night()
			KEY_1, KEY_2, KEY_3:
				if session != null and session.phase == "board":
					var choice: int = event.keycode - KEY_1
					if choice < session.night.offered.size():
						session.pick_room(session.night.picker_id, session.night.offered[choice])
						_fill_empty_seats(session.crowd, pads.size() + 2)
			KEY_ENTER:
				if session != null:
					_night_continue()


## Enter moves the night on: past results, and skips the shop, the vote and backing as the group's host.
func _night_continue() -> void:
	match session.phase:
		"results":
			session.next(session.host_id())
		"shop", "mole_vote":
			session.night_action(session.host_id(), {"kind": "skip"})
		"finale_pick":
			session.night_action(session.host_id(), {"kind": "skip"})
			if session.crowd != null:
				_fill_empty_seats(session.crowd, pads.size() + 2)


func _process(delta: float) -> void:
	accumulator += delta
	while accumulator >= CrowdMovement.TICK_SECONDS:
		accumulator -= CrowdMovement.TICK_SECONDS
		_send(KEYBOARD, _keyboard_input())
		for device in pads:
			_send(pads[device], _pad_input(device, pads[device]))
		if session != null:
			session.update()
		else:
			game.update()
			if game.should_finish() and not game.finished:
				game.finish()
	queue_redraw()


func _send(player_id: String, input: Dictionary) -> void:
	seqs[player_id] = seqs.get(player_id, 0) + 1
	input.seq = seqs[player_id]
	if session != null:
		session.handle_input(player_id, input)
	else:
		game.handle_input(player_id, input)


func _keyboard_input() -> Dictionary:
	var move := Vector2(
		float(Input.is_physical_key_pressed(KEY_D)) - float(Input.is_physical_key_pressed(KEY_A)),
		float(Input.is_physical_key_pressed(KEY_S)) - float(Input.is_physical_key_pressed(KEY_W)),
	)
	var input := {"move": {"x": move.x, "y": move.y}, "run": Input.is_physical_key_pressed(KEY_SHIFT), "act": Input.is_physical_key_pressed(KEY_E)}
	if Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) and not _mouse_was_down:
		var point := get_local_mouse_position()
		input.shoot = {"x": point.x, "y": point.y}
		var picked := _entity_near(point, 30)
		if picked != null:
			input.shootAt = picked.id
	_mouse_was_down = Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
	return input


var _mouse_was_down := false
var _pad_shot_down := {}


func _pad_input(device: int, player_id: String) -> Dictionary:
	var stick := Vector2(Input.get_joy_axis(device, JOY_AXIS_LEFT_X), Input.get_joy_axis(device, JOY_AXIS_LEFT_Y))
	var input := {"move": {"x": stick.x, "y": stick.y}, "run": Input.is_joy_button_pressed(device, JOY_BUTTON_B), "act": Input.is_joy_button_pressed(device, JOY_BUTTON_A)}
	var shooting := Input.is_joy_button_pressed(device, JOY_BUTTON_X)
	if shooting and not _pad_shot_down.get(device, false):
		var target := _nearest_ahead(player_id, stick)
		if target != null:
			input.shoot = {"x": target.x, "y": target.y}
			input.shootAt = target.id
	_pad_shot_down[device] = shooting
	return input


## Controller shots pick the nearest person roughly along the stick, so aiming isn't a skill.
func _crowd() -> CrowdMatch:
	if session != null:
		return session.crowd
	return game.crowd


func _nearest_ahead(player_id: String, stick: Vector2) -> CrowdEntity:
	if _crowd() == null or not _crowd().slots.has(player_id):
		return null
	var me: CrowdEntity = _crowd().slots[player_id].entity
	var facing := stick.normalized() if stick.length() > 0.3 else Vector2.RIGHT.rotated(me.facing * PI / 4)
	var best: CrowdEntity = null
	var best_score := INF
	for e: CrowdEntity in _crowd().visible_entities():
		if e == me or e.dead:
			continue
		var offset := Vector2(e.x - me.x, e.y - me.y)
		if offset.length() > 400 or offset.normalized().dot(facing) < 0.8:
			continue
		if offset.length() < best_score:
			best = e
			best_score = offset.length()
	return best


func _entity_near(point: Vector2, reach: float) -> CrowdEntity:
	var best: CrowdEntity = null
	if _crowd() == null:
		return null
	for e: CrowdEntity in _crowd().visible_entities():
		if not e.dead and Vector2(e.x, e.y).distance_to(point) <= reach:
			if best == null or Vector2(e.x, e.y).distance_to(point) < Vector2(best.x, best.y).distance_to(point):
				best = e
	return best


func _draw() -> void:
	if session != null and session.crowd == null:
		_draw_night_screen()
		return
	var crowd := _crowd()
	var arena := crowd.arena
	draw_rect(Rect2(0, 0, arena.width, arena.height), Color("2a0f14"))
	if arena.has("exitX"):
		draw_rect(Rect2(arena.exitX, 0, arena.width - arena.exitX, arena.height), Color("3d2a10"))
	var view: Dictionary = session.crowd_view_for(KEYBOARD) if session != null else game.view_for(KEYBOARD)
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
		lines.append("Controllers: %d   Scores: %s" % [pads.size(), game.scores()])
		if game.winner_id != "":
			lines.append("Winner: %s" % game.winner_id)
	for i in lines.size():
		draw_string(font, Vector2(12, 22 + i * 18), lines[i], HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color("f5e6c8"))


## Between rooms: the board, shop, vote, backing and final standings, as plain text.
func _draw_night_screen() -> void:
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
