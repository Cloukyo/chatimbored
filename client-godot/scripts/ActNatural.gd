extends Control

const INPUT_INTERVAL: float = 0.05
const HUD_HEIGHT: float = 82.0
const LEFT_STICK_DEADZONE: float = 0.22
const RIGHT_STICK_DEADZONE: float = 0.25
const EFFECT_SECONDS: float = 0.18

var game: Dictionary = {}
var local_state: Dictionary = {}
var send_timer: float = 0.0
var shot_pressed: bool = false
var pending_mouse_target = null
var last_aim: Vector2 = Vector2.RIGHT
var last_shot_key: String = ""
var display_positions: Dictionary = {}
var previous_alive: Dictionary = {}
var shot_effects: Array[Dictionary] = []
var death_effects: Array[Dictionary] = []
var result_label: Label
var return_button: Button

func _ready() -> void:
	NetworkManager.room_state_changed.connect(_on_room_state_changed)
	NetworkManager.game_state_changed.connect(_on_game_state_changed)
	NetworkManager.game_over.connect(_on_game_over)
	Input.set_mouse_mode(Input.MOUSE_MODE_HIDDEN)
	_build_ui()
	game = NetworkManager.room.game
	_refresh_local_state()
	queue_redraw()

func _exit_tree() -> void:
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)

func _process(delta: float) -> void:
	send_timer -= delta
	_update_effects(delta)
	if send_timer <= 0.0:
		send_timer = INPUT_INTERVAL
		_send_input()
	queue_redraw()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		shot_pressed = true
		pending_mouse_target = _mouse_world_point()

func _build_ui() -> void:
	result_label = Label.new()
	result_label.offset_left = 18
	result_label.offset_top = 14
	result_label.add_theme_font_size_override("font_size", 24)
	add_child(result_label)

	var controls := Label.new()
	controls.text = "WASD/D-pad or left stick move | Shift / right trigger / B run | Mouse/right stick aim | Click/A shoot"
	controls.offset_left = 18
	controls.offset_top = 48
	add_child(controls)

	return_button = Button.new()
	return_button.text = "Return to Lobby"
	return_button.visible = false
	return_button.offset_left = 18
	return_button.offset_top = 590
	return_button.pressed.connect(NetworkManager.return_to_lobby)
	add_child(return_button)

func _draw() -> void:
	var state: Dictionary = game.get("actNatural", {})
	if state.is_empty():
		return

	var arena: Dictionary = state.get("arena", {})
	var arena_size: Vector2 = Vector2(float(arena.get("width", 1200)), float(arena.get("height", 620)))
	var scale: float = min(size.x / arena_size.x, max(1.0, size.y - HUD_HEIGHT) / arena_size.y)
	var origin: Vector2 = Vector2((size.x - arena_size.x * scale) * 0.5, HUD_HEIGHT)
	var exit_x: float = float(arena.get("exitX", 1120))

	draw_rect(Rect2(origin, arena_size * scale), Color(0.16, 0.18, 0.18), true)
	draw_rect(Rect2(origin + Vector2(exit_x * scale, 0), Vector2(22, arena_size.y * scale)), Color(0.2, 0.65, 0.38), true)

	for npc in state.get("npcs", []):
		_draw_actor(origin, scale, npc, false, false, false)

	for player in state.get("players", []):
		var is_local: bool = player.get("id", "") == NetworkManager.player_id
		_draw_actor(origin, scale, player, is_local, player.get("running", false), not player.get("alive", true))
		if is_local:
			_draw_local_marker(origin, scale, player)

	_draw_shot_effects(origin, scale)
	_draw_death_effects(origin, scale)
	_draw_reticule()
	_draw_hud()

func _draw_hud() -> void:
	var seconds_left: float = max(0.0, (float(game.get("endsAt", 0)) - Time.get_unix_time_from_system() * 1000.0) / 1000.0)
	var shot_text: String = "Shot ready" if local_state.get("shotAvailable", false) else "Shot used"
	result_label.text = "Act Natural   %.0fs   %s" % [seconds_left, shot_text]

func _draw_actor(origin: Vector2, scale: float, actor: Dictionary, is_local: bool, running: bool, dead: bool) -> void:
	var world_pos: Vector2 = _smoothed_position(actor)
	var pos: Vector2 = origin + world_pos * scale
	var color: Color = Color(0.78, 0.78, 0.72)
	if dead:
		color = Color(0.35, 0.35, 0.35)
	elif is_local:
		color = Color(0.9, 0.9, 0.84)
	draw_circle(pos, 12, color)
	draw_rect(Rect2(pos + Vector2(-7, 8), Vector2(14, 18)), color, true)
	if is_local:
		draw_arc(pos, 19, 0.0, TAU, 28, Color(0.35, 0.75, 1.0, 0.45), 2.0)
	if running:
		draw_line(pos + Vector2(-22, 8), pos + Vector2(-42, 14), Color(0.95, 0.72, 0.25), 3)
		draw_line(pos + Vector2(-20, -4), pos + Vector2(-38, -8), Color(0.95, 0.72, 0.25), 2)

func _draw_local_marker(origin: Vector2, scale: float, player: Dictionary) -> void:
	var pos: Vector2 = origin + _smoothed_position(player) * scale
	var aim_dict: Dictionary = player.get("aim", {"x": 1, "y": 0})
	var aim: Vector2 = Vector2(float(aim_dict.get("x", 1)), float(aim_dict.get("y", 0))).normalized()
	draw_line(pos, pos + aim * 52, Color.WHITE, 2)
	draw_string(get_theme_default_font(), pos + Vector2(-16, -28), "You", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color.WHITE)

func _draw_reticule() -> void:
	var mouse_pos: Vector2 = get_local_mouse_position()
	draw_circle(mouse_pos, 9, Color(1.0, 1.0, 1.0, 0.1))
	draw_arc(mouse_pos, 13, 0.0, TAU, 32, Color(1.0, 1.0, 1.0, 0.8), 1.5)
	draw_line(mouse_pos + Vector2(-18, 0), mouse_pos + Vector2(-6, 0), Color.WHITE, 1)
	draw_line(mouse_pos + Vector2(6, 0), mouse_pos + Vector2(18, 0), Color.WHITE, 1)
	draw_line(mouse_pos + Vector2(0, -18), mouse_pos + Vector2(0, -6), Color.WHITE, 1)
	draw_line(mouse_pos + Vector2(0, 6), mouse_pos + Vector2(0, 18), Color.WHITE, 1)

func _draw_shot_effects(origin: Vector2, scale: float) -> void:
	for effect in shot_effects:
		var alpha: float = float(effect.get("life", 0.0)) / EFFECT_SECONDS
		var start: Vector2 = origin + effect.get("start", Vector2.ZERO) * scale
		var end: Vector2 = origin + effect.get("end", Vector2.ZERO) * scale
		draw_line(start, end, Color(1.0, 0.9, 0.35, alpha), 4)
		draw_circle(end, 10 + (1.0 - alpha) * 12.0, Color(1.0, 0.55, 0.2, alpha * 0.65))

func _draw_death_effects(origin: Vector2, scale: float) -> void:
	for effect in death_effects:
		var alpha: float = float(effect.get("life", 0.0)) / EFFECT_SECONDS
		var pos: Vector2 = origin + effect.get("pos", Vector2.ZERO) * scale
		draw_arc(pos, 28 + (1.0 - alpha) * 12.0, 0.0, TAU, 32, Color(1.0, 0.25, 0.2, alpha), 3)
		draw_line(pos + Vector2(-12, -12), pos + Vector2(12, 12), Color(1.0, 0.25, 0.2, alpha), 3)
		draw_line(pos + Vector2(12, -12), pos + Vector2(-12, 12), Color(1.0, 0.25, 0.2, alpha), 3)

func _send_input() -> void:
	var movement: Vector2 = _keyboard_movement()
	var joypads: Array = Input.get_connected_joypads()
	if joypads.size() > 0:
		var pad: int = int(joypads[0])
		movement += _controller_movement(pad)
		if Input.is_joy_button_pressed(pad, JOY_BUTTON_A):
			shot_pressed = true

	movement = _apply_deadzone(movement, LEFT_STICK_DEADZONE)
	if movement.length() > 1.0:
		movement = movement.normalized()

	var aim: Vector2 = _mouse_aim()
	var running: bool = Input.is_key_pressed(KEY_SHIFT)
	if joypads.size() > 0:
		var pad: int = int(joypads[0])
		var stick_aim: Vector2 = _apply_deadzone(Vector2(Input.get_joy_axis(pad, JOY_AXIS_RIGHT_X), Input.get_joy_axis(pad, JOY_AXIS_RIGHT_Y)), RIGHT_STICK_DEADZONE)
		if stick_aim != Vector2.ZERO:
			aim = stick_aim.normalized()
		running = running or Input.get_joy_axis(pad, JOY_AXIS_TRIGGER_RIGHT) > 0.45 or Input.is_joy_button_pressed(pad, JOY_BUTTON_B)

	last_aim = aim
	NetworkManager.send_act_natural_input(movement, aim, shot_pressed, running, pending_mouse_target)
	shot_pressed = false
	pending_mouse_target = null

func _keyboard_movement() -> Vector2:
	var movement: Vector2 = Vector2.ZERO
	if Input.is_key_pressed(KEY_A):
		movement.x -= 1.0
	if Input.is_key_pressed(KEY_D):
		movement.x += 1.0
	if Input.is_key_pressed(KEY_W):
		movement.y -= 1.0
	if Input.is_key_pressed(KEY_S):
		movement.y += 1.0
	return movement

func _controller_movement(pad: int) -> Vector2:
	var movement: Vector2 = Vector2(Input.get_joy_axis(pad, JOY_AXIS_LEFT_X), Input.get_joy_axis(pad, JOY_AXIS_LEFT_Y))
	if Input.is_joy_button_pressed(pad, JOY_BUTTON_DPAD_LEFT):
		movement.x -= 1.0
	if Input.is_joy_button_pressed(pad, JOY_BUTTON_DPAD_RIGHT):
		movement.x += 1.0
	if Input.is_joy_button_pressed(pad, JOY_BUTTON_DPAD_UP):
		movement.y -= 1.0
	if Input.is_joy_button_pressed(pad, JOY_BUTTON_DPAD_DOWN):
		movement.y += 1.0
	return movement

func _apply_deadzone(vector: Vector2, deadzone: float) -> Vector2:
	return Vector2.ZERO if vector.length() < deadzone else vector

func _mouse_aim() -> Vector2:
	if local_state.is_empty():
		return last_aim
	var state: Dictionary = game.get("actNatural", {})
	var arena: Dictionary = state.get("arena", {})
	var arena_size: Vector2 = Vector2(float(arena.get("width", 1200)), float(arena.get("height", 620)))
	var scale: float = min(size.x / arena_size.x, max(1.0, size.y - HUD_HEIGHT) / arena_size.y)
	var origin: Vector2 = Vector2((size.x - arena_size.x * scale) * 0.5, HUD_HEIGHT)
	var local_pos: Vector2 = origin + _smoothed_position(local_state) * scale
	var aim: Vector2 = get_local_mouse_position() - local_pos
	return aim.normalized() if aim.length() > 0.001 else last_aim

func _mouse_world_point() -> Vector2:
	var state: Dictionary = game.get("actNatural", {})
	var arena: Dictionary = state.get("arena", {})
	var arena_size: Vector2 = Vector2(float(arena.get("width", 1200)), float(arena.get("height", 620)))
	var scale: float = min(size.x / arena_size.x, max(1.0, size.y - HUD_HEIGHT) / arena_size.y)
	var origin: Vector2 = Vector2((size.x - arena_size.x * scale) * 0.5, HUD_HEIGHT)
	return (get_local_mouse_position() - origin) / scale

func _update_effects(delta: float) -> void:
	shot_effects = shot_effects.filter(func(effect: Dictionary) -> bool:
		effect["life"] = float(effect.get("life", 0.0)) - delta
		return float(effect["life"]) > 0.0
	)
	death_effects = death_effects.filter(func(effect: Dictionary) -> bool:
		effect["life"] = float(effect.get("life", 0.0)) - delta
		return float(effect["life"]) > 0.0
	)

func _smoothed_position(actor: Dictionary) -> Vector2:
	var id: String = str(actor.get("id", ""))
	var target: Vector2 = Vector2(float(actor.get("x", 0)), float(actor.get("y", 0)))
	if not display_positions.has(id):
		display_positions[id] = target
	var current: Vector2 = display_positions[id]
	current = current.lerp(target, 0.35)
	display_positions[id] = current
	return current

func _refresh_local_state() -> void:
	var state: Dictionary = game.get("actNatural", {})
	for player in state.get("players", []):
		if player.get("id", "") == NetworkManager.player_id:
			local_state = player
			return
	local_state = {}

func _record_death_transitions(next_game: Dictionary) -> void:
	var state: Dictionary = next_game.get("actNatural", {})
	for player in state.get("players", []):
		var id: String = str(player.get("id", ""))
		var alive: bool = player.get("alive", true)
		if previous_alive.has(id) and previous_alive[id] == true and not alive:
			death_effects.append({
				"pos": Vector2(float(player.get("x", 0)), float(player.get("y", 0))),
				"life": EFFECT_SECONDS
			})
		previous_alive[id] = alive

func _record_shot_transition(next_game: Dictionary) -> void:
	var state: Dictionary = next_game.get("actNatural", {})
	var shot: Dictionary = state.get("lastShot", {})
	if shot.is_empty():
		return
	var start_dict: Dictionary = shot.get("start", {})
	var end_dict: Dictionary = shot.get("end", {})
	var key: String = "%s:%s:%s:%s:%s" % [
		shot.get("shooterId", ""),
		start_dict.get("x", 0),
		start_dict.get("y", 0),
		end_dict.get("x", 0),
		end_dict.get("y", 0)
	]
	if key == last_shot_key:
		return
	last_shot_key = key
	shot_effects.append({
		"start": Vector2(float(start_dict.get("x", 0)), float(start_dict.get("y", 0))),
		"end": Vector2(float(end_dict.get("x", 0)), float(end_dict.get("y", 0))),
		"life": EFFECT_SECONDS
	})

func _on_game_state_changed(next_game: Dictionary) -> void:
	_record_shot_transition(next_game)
	_record_death_transitions(next_game)
	game = next_game
	_refresh_local_state()

func _on_game_over(next_game: Dictionary, winner_id: String) -> void:
	_record_shot_transition(next_game)
	_record_death_transitions(next_game)
	game = next_game
	_refresh_local_state()
	var winner_name := "No winner"
	for player in NetworkManager.room.players:
		if player.get("id", "") == winner_id:
			winner_name = player.get("displayName", "Winner")
	result_label.text = "%s escaped!" % winner_name
	return_button.visible = NetworkManager.room.host_id == NetworkManager.player_id

func _on_room_state_changed(room: RoomState, _player_id: String) -> void:
	if room.phase == "lobby":
		get_tree().change_scene_to_file("res://scenes/Lobby.tscn")
	else:
		game = room.game
		_refresh_local_state()
