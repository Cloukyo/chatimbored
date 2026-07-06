extends Control

const INPUT_INTERVAL := 0.05
const HUD_HEIGHT := 92.0
const LEFT_STICK_DEADZONE := 0.22
const RIGHT_STICK_DEADZONE := 0.25
const EFFECT_SECONDS := 0.24

var game: Dictionary = {}
var local_state: Dictionary = {}
var send_timer := 0.0
var shoot_pressed := false
var kill_pressed := false
var pending_mouse_target = null
var last_aim := Vector2.RIGHT
var display_positions: Dictionary = {}
var npc_states: Dictionary = {}
var last_shot_key := ""
var last_event_key := ""
var shot_effects: Array[Dictionary] = []
var death_effects: Array[Dictionary] = []
var role_label: Label
var controls_label: Label
var status_label: Label
var winner_panel: PanelContainer
var winner_label: Label
var winner_detail_label: Label
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

func _input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		shoot_pressed = true
		pending_mouse_target = _mouse_world_point()
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_SPACE or event.keycode == KEY_E:
			kill_pressed = true

func _build_ui() -> void:
	role_label = Label.new()
	role_label.offset_left = 18
	role_label.offset_top = 12
	role_label.add_theme_font_size_override("font_size", 24)
	add_child(role_label)

	status_label = Label.new()
	status_label.offset_left = 18
	status_label.offset_top = 42
	add_child(status_label)

	controls_label = Label.new()
	controls_label.offset_left = 18
	controls_label.offset_top = 66
	add_child(controls_label)

	winner_panel = PanelContainer.new()
	winner_panel.visible = false
	winner_panel.anchor_left = 0.5
	winner_panel.anchor_top = 0.5
	winner_panel.anchor_right = 0.5
	winner_panel.anchor_bottom = 0.5
	winner_panel.offset_left = -205
	winner_panel.offset_top = -105
	winner_panel.offset_right = 205
	winner_panel.offset_bottom = 105
	add_child(winner_panel)

	var winner_box := VBoxContainer.new()
	winner_box.add_theme_constant_override("separation", 12)
	winner_panel.add_child(winner_box)

	winner_label = Label.new()
	winner_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	winner_label.add_theme_font_size_override("font_size", 30)
	winner_box.add_child(winner_label)

	winner_detail_label = Label.new()
	winner_detail_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	winner_detail_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	winner_box.add_child(winner_detail_label)

	return_button = Button.new()
	return_button.text = "Return to Lobby"
	return_button.visible = false
	return_button.pressed.connect(NetworkManager.return_to_lobby)
	winner_box.add_child(return_button)

func _draw() -> void:
	var state: Dictionary = game.get("silentWitness", {})
	if state.is_empty():
		return
	var arena: Dictionary = state.get("arena", {})
	var arena_size := Vector2(float(arena.get("width", 1200)), float(arena.get("height", 620)))
	var scale: float = min(size.x / arena_size.x, max(1.0, size.y - HUD_HEIGHT) / arena_size.y)
	var origin := Vector2((size.x - arena_size.x * scale) * 0.5, HUD_HEIGHT)

	draw_rect(Rect2(origin, arena_size * scale), Color(0.10, 0.12, 0.13), true)
	draw_rect(Rect2(origin, arena_size * scale), Color(0.42, 0.38, 0.28), false, 2.0)

	for npc in state.get("npcs", []):
		_draw_npc(origin, scale, npc)

	for player in state.get("players", []):
		var is_local: bool = player.get("id", "") == NetworkManager.player_id
		_draw_player(origin, scale, player, is_local)

	_draw_shot_effects(origin, scale)
	_draw_death_effects(origin, scale)
	if _local_role() == "hunter":
		_draw_reticule()
	_draw_hud()

func _draw_hud() -> void:
	var state: Dictionary = game.get("silentWitness", {})
	var seconds_left: float = max(0.0, (float(game.get("endsAt", 0)) - Time.get_unix_time_from_system() * 1000.0) / 1000.0)
	var role := _local_role()
	if role == "killer":
		role_label.text = "You are the Killer"
		var cooldown := float(local_state.get("killCooldownMs", 0.0)) / 1000.0
		var kill_text := "Kill ready" if cooldown <= 0.0 else "Kill %.1fs" % cooldown
		status_label.text = "%.0fs   Bodies %s/%s   %s" % [seconds_left, state.get("publicKillCount", 0), state.get("killTarget", 5), kill_text]
		controls_label.text = "WASD / left stick move | Space or E / X or B kill nearby NPC"
	else:
		role_label.text = "You are a Hunter"
		var shot_text := "Shot ready" if bool(local_state.get("shotAvailable", false)) else "Shot used"
		status_label.text = "%.0fs   Bodies discovered %s/%s   %s" % [seconds_left, state.get("publicKillCount", 0), state.get("killTarget", 5), shot_text]
		controls_label.text = "WASD / left stick move | Mouse / right stick aim | Click / A shoot"

func _draw_npc(origin: Vector2, scale: float, npc: Dictionary) -> void:
	var pos := origin + _smoothed_position(npc) * scale
	var state := str(npc.get("state", "alive"))
	var color := Color(0.76, 0.76, 0.70)
	if state == "dying":
		color = Color(0.72, 0.68, 0.62)
	elif state == "dead":
		color = Color(0.28, 0.28, 0.27)
	draw_circle(pos, 12, color)
	draw_rect(Rect2(pos + Vector2(-7, 8), Vector2(14, 18)), color, true)
	if state == "dying":
		draw_arc(pos, 19, 0.0, TAU, 24, Color(0.95, 0.72, 0.18, 0.45), 2.0)
	elif state == "dead":
		draw_line(pos + Vector2(-13, -10), pos + Vector2(13, 10), Color(0.85, 0.12, 0.08), 3)
		draw_line(pos + Vector2(13, -10), pos + Vector2(-13, 10), Color(0.85, 0.12, 0.08), 3)

func _draw_player(origin: Vector2, scale: float, player: Dictionary, is_local: bool) -> void:
	var pos := origin + _smoothed_position(player) * scale
	var dead := not bool(player.get("alive", true))
	var color := Color(0.78, 0.78, 0.72) if not dead else Color(0.34, 0.34, 0.34)
	if is_local and not dead:
		color = Color(0.92, 0.90, 0.82)
	draw_circle(pos, 12, color)
	draw_rect(Rect2(pos + Vector2(-7, 8), Vector2(14, 18)), color, true)
	if is_local:
		draw_arc(pos, 20, 0.0, TAU, 28, Color(0.35, 0.75, 1.0, 0.50), 2.0)
		draw_string(get_theme_default_font(), pos + Vector2(-15, -27), "You", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color.WHITE)
		if _local_role() == "hunter":
			var aim_dict: Dictionary = player.get("aim", {"x": 1, "y": 0})
			var aim := Vector2(float(aim_dict.get("x", 1)), float(aim_dict.get("y", 0))).normalized()
			draw_line(pos, pos + aim * 52, Color.WHITE, 2)

func _draw_reticule() -> void:
	var mouse_pos := get_local_mouse_position()
	draw_circle(mouse_pos, 9, Color(1.0, 1.0, 1.0, 0.1))
	draw_arc(mouse_pos, 13, 0.0, TAU, 32, Color(1.0, 1.0, 1.0, 0.82), 1.5)
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
		draw_circle(pos, (18.0 + (1.0 - alpha) * 18.0) * scale, Color(0.9, 0.10, 0.06, 0.28 * alpha))

func _send_input() -> void:
	var movement := _keyboard_movement()
	var joypads := Input.get_connected_joypads()
	if joypads.size() > 0:
		var pad := int(joypads[0])
		movement += _controller_movement(pad)
		if Input.is_joy_button_pressed(pad, JOY_BUTTON_A):
			shoot_pressed = true
		if Input.is_joy_button_pressed(pad, JOY_BUTTON_X) or Input.is_joy_button_pressed(pad, JOY_BUTTON_B):
			kill_pressed = true
	movement = _apply_deadzone(movement, LEFT_STICK_DEADZONE)
	if movement.length() > 1.0:
		movement = movement.normalized()

	var aim := _mouse_aim()
	if joypads.size() > 0:
		var pad := int(joypads[0])
		var stick_aim := _apply_deadzone(Vector2(Input.get_joy_axis(pad, JOY_AXIS_RIGHT_X), Input.get_joy_axis(pad, JOY_AXIS_RIGHT_Y)), RIGHT_STICK_DEADZONE)
		if stick_aim != Vector2.ZERO:
			aim = stick_aim.normalized()
	last_aim = aim

	NetworkManager.send_silent_witness_input(movement, aim, shoot_pressed, kill_pressed, pending_mouse_target)
	shoot_pressed = false
	kill_pressed = false
	pending_mouse_target = null

func _keyboard_movement() -> Vector2:
	var movement := Vector2.ZERO
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
	var movement := Vector2(Input.get_joy_axis(pad, JOY_AXIS_LEFT_X), Input.get_joy_axis(pad, JOY_AXIS_LEFT_Y))
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
	var local_pos := _screen_position(local_state)
	var aim := get_local_mouse_position() - local_pos
	return aim.normalized() if aim.length() > 0.001 else last_aim

func _mouse_world_point() -> Vector2:
	var state: Dictionary = game.get("silentWitness", {})
	var arena: Dictionary = state.get("arena", {})
	var arena_size := Vector2(float(arena.get("width", 1200)), float(arena.get("height", 620)))
	var scale: float = min(size.x / arena_size.x, max(1.0, size.y - HUD_HEIGHT) / arena_size.y)
	var origin := Vector2((size.x - arena_size.x * scale) * 0.5, HUD_HEIGHT)
	return (get_local_mouse_position() - origin) / scale

func _screen_position(actor: Dictionary) -> Vector2:
	var state: Dictionary = game.get("silentWitness", {})
	var arena: Dictionary = state.get("arena", {})
	var arena_size := Vector2(float(arena.get("width", 1200)), float(arena.get("height", 620)))
	var scale: float = min(size.x / arena_size.x, max(1.0, size.y - HUD_HEIGHT) / arena_size.y)
	var origin := Vector2((size.x - arena_size.x * scale) * 0.5, HUD_HEIGHT)
	return origin + _smoothed_position(actor) * scale

func _smoothed_position(actor: Dictionary) -> Vector2:
	var id := str(actor.get("id", ""))
	var target := Vector2(float(actor.get("x", 0)), float(actor.get("y", 0)))
	if not display_positions.has(id):
		display_positions[id] = target
	var current: Vector2 = display_positions[id]
	current = current.lerp(target, 0.35)
	display_positions[id] = current
	return current

func _update_effects(delta: float) -> void:
	shot_effects = shot_effects.filter(func(effect: Dictionary) -> bool:
		effect["life"] = float(effect.get("life", 0.0)) - delta
		return float(effect["life"]) > 0.0
	)
	death_effects = death_effects.filter(func(effect: Dictionary) -> bool:
		effect["life"] = float(effect.get("life", 0.0)) - delta
		return float(effect["life"]) > 0.0
	)

func _refresh_local_state() -> void:
	var state: Dictionary = game.get("silentWitness", {})
	for player in state.get("players", []):
		if player.get("id", "") == NetworkManager.player_id:
			local_state = player
			return
	local_state = {}

func _local_role() -> String:
	return str(local_state.get("role", "hunter"))

func _record_shot_transition(next_game: Dictionary) -> void:
	var state: Dictionary = next_game.get("silentWitness", {})
	var shot: Dictionary = state.get("lastShot", {})
	if shot.is_empty():
		return
	var start_dict: Dictionary = shot.get("start", {})
	var end_dict: Dictionary = shot.get("end", {})
	var key := "%s:%s:%s:%s:%s" % [shot.get("shooterId", ""), start_dict.get("x", 0), start_dict.get("y", 0), end_dict.get("x", 0), end_dict.get("y", 0)]
	if key == last_shot_key:
		return
	last_shot_key = key
	shot_effects.append({
		"start": Vector2(float(start_dict.get("x", 0)), float(start_dict.get("y", 0))),
		"end": Vector2(float(end_dict.get("x", 0)), float(end_dict.get("y", 0))),
		"life": EFFECT_SECONDS
	})

func _record_event_transition(next_game: Dictionary) -> void:
	var state: Dictionary = next_game.get("silentWitness", {})
	var event: Dictionary = state.get("lastEvent", {})
	if event.is_empty():
		return
	var key := "%s:%s:%s:%s" % [event.get("type", ""), event.get("x", ""), event.get("y", ""), event.get("targetId", "")]
	if key == last_event_key:
		return
	last_event_key = key
	if str(event.get("type", "")) == "npc_dead" or str(event.get("type", "")) == "killer_hit":
		death_effects.append({
			"pos": Vector2(float(event.get("x", 0)), float(event.get("y", 0))),
			"life": EFFECT_SECONDS
		})

func _on_game_state_changed(next_game: Dictionary) -> void:
	_record_shot_transition(next_game)
	_record_event_transition(next_game)
	game = next_game
	_refresh_local_state()

func _on_game_over(next_game: Dictionary, winner_id: String) -> void:
	_record_shot_transition(next_game)
	_record_event_transition(next_game)
	game = next_game
	_refresh_local_state()
	var state: Dictionary = game.get("silentWitness", {})
	var result := str(state.get("result", "hunters"))
	winner_label.text = "Killer wins!" if result == "killer" else "Hunters win!"
	winner_detail_label.text = "Bodies discovered: %s/%s" % [state.get("publicKillCount", 0), state.get("killTarget", 5)]
	if winner_id != "" and winner_id != "hunters":
		for player in NetworkManager.room.players:
			if player.get("id", "") == winner_id:
				winner_detail_label.text += "\n%s made the decisive play." % player.get("displayName", "Winner")
	winner_panel.visible = true
	return_button.visible = NetworkManager.room.host_id == NetworkManager.player_id

func _on_room_state_changed(room: RoomState, _player_id: String) -> void:
	if room.phase == "lobby":
		get_tree().change_scene_to_file("res://scenes/Lobby.tscn")
	else:
		game = room.game
		_refresh_local_state()
