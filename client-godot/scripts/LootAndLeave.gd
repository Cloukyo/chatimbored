extends Control

const INPUT_REPEAT_INTERVAL := 0.135
const TILE_SIZE := 34.0
const HUD_HEIGHT := 86.0
const EFFECT_SECONDS := 0.32
const VISION_FULL_TILES := 2.5
const VISION_RADIUS_TILES := 6.5

const EMPTY := 0
const WALL := 1
const DIRT := 2
const ROCK := 3
const GEM := 4
const EXIT := 5
const RUBY := 6

var game: Dictionary = {}
var held_direction := Vector2.ZERO
var repeat_timer := 0.0
var input_sequence := 0
var pending_predictions: Array[Dictionary] = []
var prediction_base_tile := Vector2.ZERO
var predicted_tile := Vector2.ZERO
var has_prediction := false
var last_event_key := ""
var animated_effects: Array[Dictionary] = []
var display_positions: Dictionary = {}
var shake_timer := 0.0
var winner_panel: PanelContainer
var winner_label: Label
var winner_detail_label: Label
var return_button: Button
var hud_label: Label
var controls_label: Label
var sfx_players: Dictionary = {}

func _ready() -> void:
	NetworkManager.room_state_changed.connect(_on_room_state_changed)
	NetworkManager.game_state_changed.connect(_on_game_state_changed)
	NetworkManager.game_over.connect(_on_game_over)
	_build_ui()
	_build_sfx()
	game = NetworkManager.room.game
	queue_redraw()

func _process(delta: float) -> void:
	_update_effects(delta)
	shake_timer = max(0.0, shake_timer - delta)
	_update_movement_input(delta)
	queue_redraw()

func _build_ui() -> void:
	hud_label = Label.new()
	hud_label.offset_left = 18
	hud_label.offset_top = 12
	hud_label.add_theme_font_size_override("font_size", 22)
	add_child(hud_label)

	controls_label = Label.new()
	controls_label.text = "WASD / Arrow keys move and dig | collect gems | escape when the exit opens | avoid rocks and slimes"
	controls_label.offset_left = 18
	controls_label.offset_top = 48
	add_child(controls_label)

	winner_panel = PanelContainer.new()
	winner_panel.visible = false
	winner_panel.anchor_left = 0.5
	winner_panel.anchor_top = 0.5
	winner_panel.anchor_right = 0.5
	winner_panel.anchor_bottom = 0.5
	winner_panel.offset_left = -190
	winner_panel.offset_top = -100
	winner_panel.offset_right = 190
	winner_panel.offset_bottom = 100
	add_child(winner_panel)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	winner_panel.add_child(box)

	winner_label = Label.new()
	winner_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	winner_label.add_theme_font_size_override("font_size", 30)
	box.add_child(winner_label)

	winner_detail_label = Label.new()
	winner_detail_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	winner_detail_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(winner_detail_label)

	return_button = Button.new()
	return_button.text = "Return to Lobby"
	return_button.visible = false
	return_button.pressed.connect(NetworkManager.return_to_lobby)
	box.add_child(return_button)

func _draw() -> void:
	var state: Dictionary = game.get("lootAndLeave", {})
	if state.is_empty():
		return
	var cave: Dictionary = state.get("cave", {})
	var width := int(cave.get("width", 1))
	var height := int(cave.get("height", 1))
	var scale: float = min(size.x / max(1.0, float(width) * TILE_SIZE), max(1.0, size.y - HUD_HEIGHT) / max(1.0, float(height) * TILE_SIZE))
	var origin: Vector2 = Vector2((size.x - float(width) * TILE_SIZE * scale) * 0.5, HUD_HEIGHT)
	if shake_timer > 0.0:
		var strength := 8.0 * (shake_timer / EFFECT_SECONDS)
		origin += Vector2(sin(Time.get_ticks_msec() * 0.07), cos(Time.get_ticks_msec() * 0.083)) * strength

	_draw_tiles(origin, scale, state)
	_draw_bags(origin, scale, state)
	_draw_slimes(origin, scale, state)
	_draw_players(origin, scale, state)
	_draw_effects(origin, scale)
	_draw_darkness(origin, scale, state)
	_draw_hud(state)

func _build_sfx() -> void:
	var sounds := {
		"dig": "res://assets/sfx/dig_thonk.wav",
		"gem": "res://assets/sfx/gem_clink.wav",
		"loot_recover": "res://assets/sfx/gem_clink.wav",
		"exit_unlocked": "res://assets/sfx/gem_clink.wav",
		"rock_impact": "res://assets/sfx/rock_boom.wav",
		"player_hit": "res://assets/sfx/rock_boom.wav",
		"slime_hit": "res://assets/sfx/rock_boom.wav",
		"earthquake": "res://assets/sfx/earthquake_warning.wav"
	}
	for key in sounds.keys():
		var player := AudioStreamPlayer.new()
		player.stream = load(str(sounds[key]))
		player.volume_db = -8.0
		add_child(player)
		sfx_players[key] = player

func _draw_tiles(origin: Vector2, scale: float, state: Dictionary) -> void:
	var cave: Dictionary = state.get("cave", {})
	var width := int(cave.get("width", 0))
	var height := int(cave.get("height", 0))
	var tiles: Array = cave.get("tiles", [])
	for y in range(height):
		for x in range(width):
			var tile := int(tiles[y * width + x])
			var rect := Rect2(origin + Vector2(x, y) * TILE_SIZE * scale, Vector2(TILE_SIZE, TILE_SIZE) * scale)
			match tile:
				EMPTY:
					_draw_empty(rect, x, y)
				WALL:
					_draw_wall(rect, x, y)
				DIRT:
					_draw_dirt(rect, x, y)
				ROCK:
					_draw_rock(rect, state)
				GEM:
					_draw_gem(rect, Color(0.76, 0.90, 1.0), Color(0.30, 0.43, 0.80))
				RUBY:
					_draw_gem(rect, Color(1.0, 0.38, 0.32), Color(0.74, 0.18, 0.16))
				EXIT:
					if bool(state.get("exitUnlocked", false)) or _vision_strength(state, x, y) > 0.05:
						_draw_exit(rect, bool(state.get("exitUnlocked", false)))
					else:
						_draw_empty(rect, x, y)

func _draw_empty(rect: Rect2, x: int, y: int) -> void:
	draw_rect(rect, Color(0.030, 0.046, 0.058))
	if _variant(x, y, 1) % 3 == 0:
		draw_rect(Rect2(rect.position + rect.size * 0.22, rect.size * 0.22), Color(0.050, 0.068, 0.078, 0.65))

func _draw_wall(rect: Rect2, x: int, y: int) -> void:
	var v := _variant(x, y, 2)
	draw_rect(rect, Color(0.25, 0.22, 0.16))
	draw_rect(rect.grow(-2), Color(0.50 + float(v % 4) * 0.025, 0.47, 0.35))
	draw_rect(rect.grow(-2), Color(0.18, 0.16, 0.12), false, 2.0)

func _draw_dirt(rect: Rect2, x: int, y: int) -> void:
	var v := _variant(x, y, 3)
	draw_rect(rect, Color(0.25, 0.16, 0.075))
	draw_rect(rect.grow(-1), Color(0.42, 0.28, 0.13))
	draw_rect(Rect2(rect.position + Vector2(rect.size.x * 0.12, rect.size.y * 0.14), rect.size * 0.35), Color(0.31, 0.20, 0.09, 0.72))
	if v % 4 == 0:
		draw_circle(rect.get_center(), rect.size.x * 0.08, Color(0.55, 0.39, 0.18, 0.7))

func _draw_rock(rect: Rect2, state: Dictionary) -> void:
	var center := rect.get_center()
	if int(state.get("tick", 0)) % 8 < 3:
		draw_circle(center, rect.size.x * 0.46, Color(1.0, 0.72, 0.20, 0.08))
	var points := PackedVector2Array([
		center + Vector2(-0.36, -0.23) * rect.size,
		center + Vector2(-0.12, -0.40) * rect.size,
		center + Vector2(0.28, -0.34) * rect.size,
		center + Vector2(0.40, 0.00) * rect.size,
		center + Vector2(0.20, 0.36) * rect.size,
		center + Vector2(-0.24, 0.34) * rect.size,
		center + Vector2(-0.42, 0.04) * rect.size
	])
	draw_colored_polygon(points, Color(0.48, 0.48, 0.47))
	var outline := PackedVector2Array(points)
	outline.append(points[0])
	draw_polyline(outline, Color(0.20, 0.20, 0.20), 2.0)

func _draw_gem(rect: Rect2, fill: Color, edge: Color) -> void:
	var c := rect.get_center()
	var s := rect.size.x * 0.32
	var points := PackedVector2Array([c + Vector2(0, -s), c + Vector2(s, 0), c + Vector2(0, s), c + Vector2(-s, 0)])
	draw_colored_polygon(points, fill)
	var outline := PackedVector2Array(points)
	outline.append(points[0])
	draw_polyline(outline, edge, 2.0)

func _draw_exit(rect: Rect2, unlocked: bool) -> void:
	var color := Color(0.18, 0.72, 0.32) if unlocked else Color(0.35, 0.18, 0.12)
	draw_rect(rect.grow(-4), Color(0.06, 0.07, 0.07))
	draw_rect(rect.grow(-8), color)
	draw_rect(rect.grow(-4), Color(0.70, 0.70, 0.65), false, 2.0)
	draw_string(get_theme_default_font(), rect.position + Vector2(5, -3), "EXIT", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color.WHITE)

func _draw_bags(origin: Vector2, scale: float, state: Dictionary) -> void:
	for bag in state.get("lootBags", []):
		var pos := _tile_center(origin, scale, int(bag.get("x", 0)), int(bag.get("y", 0)))
		var local := str(bag.get("ownerId", "")) == NetworkManager.player_id
		draw_circle(pos, 17.0 * scale, Color(1.0, 0.78, 0.22, 0.25 if local else 0.12))
		draw_rect(Rect2(pos + Vector2(-10, -6) * scale, Vector2(20, 16) * scale), Color(0.54, 0.31, 0.12))
		draw_rect(Rect2(pos + Vector2(-10, -6) * scale, Vector2(20, 16) * scale), Color(0.08, 0.05, 0.03), false, 2.0)
		if local:
			draw_string(get_theme_default_font(), pos + Vector2(-18, -22) * scale, "YOURS", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(1.0, 0.9, 0.35))

func _draw_slimes(origin: Vector2, scale: float, state: Dictionary) -> void:
	for slime in state.get("slimes", []):
		var pos: Vector2 = _smoothed_tile_center(origin, scale, "slime_%s" % str(slime.get("id", "")), int(slime.get("x", 0)), int(slime.get("y", 0)))
		var wobble := sin(float(state.get("tick", 0)) * 0.55) * 2.0 * scale
		draw_circle(pos + Vector2(-5, 3 + wobble) * scale, 11.0 * scale, Color(0.18, 0.72, 0.22))
		draw_circle(pos + Vector2(5, 3 + wobble) * scale, 11.0 * scale, Color(0.18, 0.72, 0.22))
		draw_circle(pos + Vector2(0, -3 + wobble) * scale, 10.0 * scale, Color(0.40, 0.95, 0.38, 0.82))
		draw_circle(pos + Vector2(-4, -4 + wobble) * scale, 2.5 * scale, Color(0.03, 0.08, 0.03))
		draw_circle(pos + Vector2(5, -4 + wobble) * scale, 2.5 * scale, Color(0.03, 0.08, 0.03))

func _draw_players(origin: Vector2, scale: float, state: Dictionary) -> void:
	for player in state.get("players", []):
		if bool(player.get("out", false)) or bool(player.get("escaped", false)):
			continue
		var is_local := str(player.get("id", "")) == NetworkManager.player_id
		var tile := _visual_tile_for_player(player, is_local)
		var pos: Vector2 = _smoothed_tile_center(origin, scale, "player_%s" % str(player.get("id", "")), tile.x, tile.y)
		var color := Color(0.90, 0.86, 0.48) if is_local else Color(0.58, 0.66, 0.82)
		draw_rect(Rect2(pos + Vector2(-7, 2) * scale, Vector2(14, 16) * scale), Color(0.12, 0.12, 0.11))
		draw_rect(Rect2(pos + Vector2(-9, -8) * scale, Vector2(18, 11) * scale), Color(0.95, 0.72, 0.52))
		draw_rect(Rect2(pos + Vector2(-11, -15) * scale, Vector2(22, 7) * scale), color)
		if is_local:
			draw_arc(pos, 20.0 * scale, 0.0, TAU, 28, Color(0.35, 0.75, 1.0, 0.55), 2.0)
			draw_string(get_theme_default_font(), pos + Vector2(-10, -24) * scale, "You", HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color.WHITE)

func _draw_effects(origin: Vector2, scale: float) -> void:
	for effect in animated_effects:
		var t := 1.0 - float(effect.get("life", 0.0)) / EFFECT_SECONDS
		var alpha := 1.0 - t
		var pos := _tile_center(origin, scale, int(effect.get("x", 0)), int(effect.get("y", 0)))
		match str(effect.get("type", "")):
			"gem", "loot_recover", "exit_unlocked":
				draw_circle(pos, (12.0 + t * 24.0) * scale, Color(0.95, 1.0, 0.65, 0.35 * alpha))
			"dig":
				draw_circle(pos, (8.0 + t * 12.0) * scale, Color(0.42, 0.28, 0.13, 0.30 * alpha))
			"blocked":
				draw_rect(Rect2(pos - Vector2(12, 12) * scale, Vector2(24, 24) * scale), Color(1.0, 0.18, 0.08, 0.36 * alpha), false, 2.0)
			"player_hit", "slime_hit":
				draw_circle(pos, (18.0 + t * 15.0) * scale, Color(1.0, 0.08, 0.04, 0.32 * alpha))
			"rock_impact", "loot_drop":
				draw_circle(pos, (12.0 + t * 20.0) * scale, Color(0.64, 0.57, 0.45, 0.35 * alpha))

func _draw_darkness(origin: Vector2, scale: float, state: Dictionary) -> void:
	var cave: Dictionary = state.get("cave", {})
	var width := int(cave.get("width", 0))
	var height := int(cave.get("height", 0))
	for y in range(height):
		for x in range(width):
			var strength := _vision_strength(state, x, y)
			if strength < 0.995:
				var rect := Rect2(origin + Vector2(x, y) * TILE_SIZE * scale, Vector2(TILE_SIZE, TILE_SIZE) * scale)
				draw_rect(rect, Color(0.0, 0.0, 0.0, lerpf(0.96, 0.0, strength)))

func _draw_hud(state: Dictionary) -> void:
	var local: Dictionary = _local_player(state)
	var seconds_left: float = max(0.0, (float(game.get("endsAt", 0)) - Time.get_unix_time_from_system() * 1000.0) / 1000.0)
	var status := "Alive"
	if bool(local.get("out", false)):
		status = "Out"
	elif bool(local.get("escaped", false)):
		status = "Escaped"
	var exit_text := "Exit open" if bool(state.get("exitUnlocked", false)) else "Exit locked"
	hud_label.text = "Loot & Leave  L%s  %.0fs  Lives %s  Carry $%s  Bank $%s  %s  %s" % [
		state.get("level", 1),
		seconds_left,
		local.get("lives", 0),
		local.get("carriedCash", 0),
		local.get("bankedCash", 0),
		exit_text,
		status
	]

func _update_movement_input(delta: float) -> void:
	if winner_panel.visible:
		held_direction = Vector2.ZERO
		repeat_timer = 0.0
		return
	var movement := _pressed_direction()
	if movement == Vector2.ZERO:
		held_direction = Vector2.ZERO
		repeat_timer = 0.0
		return
	if movement != held_direction:
		_send_movement_step(movement)
		held_direction = movement
		repeat_timer = INPUT_REPEAT_INTERVAL
		return
	repeat_timer -= delta
	if repeat_timer <= 0.0:
		_send_movement_step(movement)
		repeat_timer += INPUT_REPEAT_INTERVAL

func _pressed_direction() -> Vector2:
	var movement := Vector2.ZERO
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT):
		movement.x -= 1
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT):
		movement.x += 1
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP):
		movement.y -= 1
	if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN):
		movement.y += 1
	if abs(movement.x) > 0.0:
		movement.y = 0.0
	return movement

func _send_movement_step(movement: Vector2) -> void:
	input_sequence += 1
	_predict_movement_step(movement, input_sequence)
	NetworkManager.send_loot_and_leave_input(movement, input_sequence)

func _predict_movement_step(movement: Vector2, sequence: int) -> void:
	var state: Dictionary = game.get("lootAndLeave", {})
	var local := _local_player(state)
	if local.is_empty() or bool(local.get("out", false)) or bool(local.get("escaped", false)) or not bool(local.get("alive", true)):
		return
	var start := predicted_tile if has_prediction else Vector2(float(local.get("x", 0)), float(local.get("y", 0)))
	var target := start + movement
	if not _can_predict_tile(state, int(target.x), int(target.y)):
		_show_blocked_prediction(target)
		return
	if not has_prediction:
		prediction_base_tile = start
	has_prediction = true
	predicted_tile = target
	pending_predictions.append({
		"sequence": sequence,
		"to": target
	})

func _can_predict_tile(state: Dictionary, x: int, y: int) -> bool:
	var cave: Dictionary = state.get("cave", {})
	var width := int(cave.get("width", 0))
	var height := int(cave.get("height", 0))
	if x < 0 or y < 0 or x >= width or y >= height:
		return false
	for slime in state.get("slimes", []):
		if int(slime.get("x", -1)) == x and int(slime.get("y", -1)) == y:
			return false
	var tiles: Array = cave.get("tiles", [])
	var tile := WALL
	var index := y * width + x
	if index >= 0 and index < tiles.size():
		tile = int(tiles[index])
	return tile != WALL and tile != ROCK

func _show_blocked_prediction(target: Vector2) -> void:
	animated_effects.append({
		"type": "blocked",
		"x": int(target.x),
		"y": int(target.y),
		"life": 0.16
	})

func _on_game_state_changed(next_game: Dictionary) -> void:
	_record_event(next_game)
	game = next_game
	_reconcile_local_prediction()

func _on_game_over(next_game: Dictionary, winner_id: String) -> void:
	_record_event(next_game)
	game = next_game
	_clear_prediction()
	var winner_name := "No winner"
	for player in NetworkManager.room.players:
		if player.get("id", "") == winner_id:
			winner_name = player.get("displayName", "Winner")
	winner_label.text = "%s wins!" % winner_name
	var winner_state := _player_by_id(next_game.get("lootAndLeave", {}), winner_id)
	winner_detail_label.text = "Banked cash: $%s" % winner_state.get("bankedCash", 0)
	winner_panel.visible = true
	return_button.visible = NetworkManager.room.host_id == NetworkManager.player_id

func _on_room_state_changed(room: RoomState, _player_id: String) -> void:
	if room.phase == "lobby":
		get_tree().change_scene_to_file("res://scenes/Lobby.tscn")
	else:
		game = room.game
		_reconcile_local_prediction()

func _record_event(next_game: Dictionary) -> void:
	var state: Dictionary = next_game.get("lootAndLeave", {})
	var event: Dictionary = state.get("lastEvent", {})
	if event.is_empty():
		return
	var key := "%s:%s:%s:%s:%s" % [event.get("type", ""), event.get("x", ""), event.get("y", ""), event.get("playerId", ""), state.get("tick", "")]
	if key == last_event_key:
		return
	last_event_key = key
	animated_effects.append({
		"type": event.get("type", ""),
		"x": int(event.get("x", 0)),
		"y": int(event.get("y", 0)),
		"life": EFFECT_SECONDS
	})
	if ["player_hit", "slime_hit", "rock_impact"].has(str(event.get("type", ""))):
		shake_timer = EFFECT_SECONDS
	_play_event_sound(str(event.get("type", "")), str(event.get("message", "")))

func _update_effects(delta: float) -> void:
	animated_effects = animated_effects.filter(func(effect: Dictionary) -> bool:
		effect["life"] = float(effect.get("life", 0.0)) - delta
		return float(effect["life"]) > 0.0
	)

func _local_player(state: Dictionary) -> Dictionary:
	return _player_by_id(state, NetworkManager.player_id)

func _player_by_id(state: Dictionary, player_id: String) -> Dictionary:
	for player in state.get("players", []):
		if str(player.get("id", "")) == player_id:
			return player
	return {}

func _visual_tile_for_player(player: Dictionary, is_local: bool) -> Vector2:
	if is_local and has_prediction:
		return predicted_tile
	return Vector2(float(player.get("x", 0)), float(player.get("y", 0)))

func _reconcile_local_prediction() -> void:
	var state: Dictionary = game.get("lootAndLeave", {})
	var local := _local_player(state)
	if local.is_empty():
		_clear_prediction()
		return
	if bool(local.get("out", false)) or bool(local.get("escaped", false)) or not bool(local.get("alive", true)):
		_clear_prediction()
		return
	var server_tile := Vector2(float(local.get("x", 0)), float(local.get("y", 0)))
	if pending_predictions.is_empty():
		has_prediction = false
		predicted_tile = server_tile
		prediction_base_tile = server_tile
		return
	var confirmed_index := -1
	for index in range(pending_predictions.size()):
		var move: Dictionary = pending_predictions[index]
		var target: Vector2 = move.get("to", server_tile)
		if target == server_tile:
			confirmed_index = index
			break
	if confirmed_index >= 0:
		pending_predictions = pending_predictions.slice(confirmed_index + 1)
		prediction_base_tile = server_tile
		if pending_predictions.is_empty():
			has_prediction = false
			predicted_tile = server_tile
		else:
			var last_move: Dictionary = pending_predictions[pending_predictions.size() - 1]
			predicted_tile = last_move.get("to", server_tile)
			has_prediction = true
		return
	if server_tile == prediction_base_tile:
		return
	pending_predictions.clear()
	prediction_base_tile = server_tile
	predicted_tile = server_tile
	has_prediction = false

func _clear_prediction() -> void:
	pending_predictions.clear()
	has_prediction = false

func _tile_center(origin: Vector2, scale: float, x: int, y: int) -> Vector2:
	return origin + Vector2(float(x) + 0.5, float(y) + 0.5) * TILE_SIZE * scale

func _vision_strength(state: Dictionary, x: int, y: int) -> float:
	var local := _local_player(state)
	if local.is_empty() or bool(local.get("out", false)) or bool(local.get("escaped", false)):
		return 1.0
	var dx := float(x) + 0.5 - float(local.get("x", 0))
	var dy := float(y) + 0.5 - float(local.get("y", 0))
	var distance := Vector2(dx, dy).length()
	if distance <= VISION_FULL_TILES:
		return 1.0
	if distance >= VISION_RADIUS_TILES:
		return 0.0
	return clampf(1.0 - ((distance - VISION_FULL_TILES) / (VISION_RADIUS_TILES - VISION_FULL_TILES)), 0.0, 1.0)

func _play_event_sound(event_type: String, message: String) -> void:
	var key := event_type
	if message.contains("trembles"):
		key = "earthquake"
	if not sfx_players.has(key):
		return
	var player: AudioStreamPlayer = sfx_players[key]
	player.stop()
	player.play()

func _smoothed_tile_center(origin: Vector2, scale: float, key: String, x: float, y: float) -> Vector2:
	var target := Vector2(float(x), float(y))
	if not display_positions.has(key):
		display_positions[key] = target
	var current: Vector2 = display_positions[key]
	current = current.lerp(target, 0.42)
	display_positions[key] = current
	return origin + (current + Vector2(0.5, 0.5)) * TILE_SIZE * scale

func _variant(x: int, y: int, salt: int) -> int:
	return abs(x * 73856093 ^ y * 19349663 ^ salt * 83492791)
