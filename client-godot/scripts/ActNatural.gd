extends Control

const INPUT_INTERVAL := 0.1
const HUD_HEIGHT := 82.0

var game := {}
var local_state := {}
var send_timer := 0.0
var shot_pressed := false
var result_label: Label
var return_button: Button

func _ready() -> void:
	NetworkManager.room_state_changed.connect(_on_room_state_changed)
	NetworkManager.game_state_changed.connect(_on_game_state_changed)
	NetworkManager.game_over.connect(_on_game_over)
	_build_ui()
	game = NetworkManager.room.game
	queue_redraw()

func _process(delta: float) -> void:
	send_timer -= delta
	if Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		shot_pressed = true
	if send_timer <= 0.0:
		send_timer = INPUT_INTERVAL
		_send_input()
	queue_redraw()

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
			local_state = player
			var pos: Vector2 = origin + Vector2(float(player.get("x", 0)), float(player.get("y", 0))) * scale
			var aim_dict: Dictionary = player.get("aim", {"x": 1, "y": 0})
			var aim: Vector2 = Vector2(float(aim_dict.get("x", 1)), float(aim_dict.get("y", 0)))
			draw_line(pos, pos + aim.normalized() * 48, Color.WHITE, 2)
			draw_string(get_theme_default_font(), pos + Vector2(-16, -26), "You", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Color.WHITE)

	var seconds_left: float = max(0.0, (float(game.get("endsAt", 0)) - Time.get_unix_time_from_system() * 1000.0) / 1000.0)
	var shot_text: String = "Shot ready" if local_state.get("shotAvailable", false) else "Shot spent"
	result_label.text = "Act Natural   %.0fs   %s" % [seconds_left, shot_text]

func _draw_actor(origin: Vector2, scale: float, actor: Dictionary, is_local: bool, running: bool, dead: bool) -> void:
	var pos: Vector2 = origin + Vector2(float(actor.get("x", 0)), float(actor.get("y", 0))) * scale
	var color: Color = Color(0.78, 0.78, 0.72)
	if dead:
		color = Color(0.35, 0.35, 0.35)
	elif is_local:
		color = Color(0.9, 0.9, 0.84)
	draw_circle(pos, 12, color)
	draw_rect(Rect2(pos + Vector2(-7, 8), Vector2(14, 18)), color, true)
	if running:
		draw_line(pos + Vector2(-22, 8), pos + Vector2(-42, 14), Color(0.95, 0.72, 0.25), 3)
		draw_line(pos + Vector2(-20, -4), pos + Vector2(-38, -8), Color(0.95, 0.72, 0.25), 2)

func _send_input() -> void:
	var movement: Vector2 = Vector2.ZERO
	if Input.is_key_pressed(KEY_A):
		movement.x -= 1
	if Input.is_key_pressed(KEY_D):
		movement.x += 1
	if Input.is_key_pressed(KEY_W):
		movement.y -= 1
	if Input.is_key_pressed(KEY_S):
		movement.y += 1

	if Input.get_connected_joypads().size() > 0:
		var pad := Input.get_connected_joypads()[0]
		movement += Vector2(Input.get_joy_axis(pad, JOY_AXIS_LEFT_X), Input.get_joy_axis(pad, JOY_AXIS_LEFT_Y))
		if Input.is_joy_button_pressed(pad, JOY_BUTTON_A):
			shot_pressed = true

	if movement.length() > 1.0:
		movement = movement.normalized()

	var aim: Vector2 = _mouse_aim()
	var running: bool = Input.is_key_pressed(KEY_SHIFT)
	if Input.get_connected_joypads().size() > 0:
		var pad := Input.get_connected_joypads()[0]
		var stick_aim: Vector2 = Vector2(Input.get_joy_axis(pad, JOY_AXIS_RIGHT_X), Input.get_joy_axis(pad, JOY_AXIS_RIGHT_Y))
		if stick_aim.length() > 0.25:
			aim = stick_aim.normalized()
		running = running or Input.get_joy_axis(pad, JOY_AXIS_TRIGGER_RIGHT) > 0.4 or Input.is_joy_button_pressed(pad, JOY_BUTTON_B)

	NetworkManager.send_act_natural_input(movement, aim, shot_pressed, running)
	shot_pressed = false

func _mouse_aim() -> Vector2:
	if local_state.is_empty():
		return Vector2.RIGHT
	var state: Dictionary = game.get("actNatural", {})
	var arena: Dictionary = state.get("arena", {})
	var arena_size: Vector2 = Vector2(float(arena.get("width", 1200)), float(arena.get("height", 620)))
	var scale: float = min(size.x / arena_size.x, max(1.0, size.y - HUD_HEIGHT) / arena_size.y)
	var origin: Vector2 = Vector2((size.x - arena_size.x * scale) * 0.5, HUD_HEIGHT)
	var local_pos: Vector2 = origin + Vector2(float(local_state.get("x", 0)), float(local_state.get("y", 0))) * scale
	var aim: Vector2 = get_local_mouse_position() - local_pos
	return aim.normalized() if aim.length() > 0.001 else Vector2.RIGHT

func _on_game_state_changed(next_game: Dictionary) -> void:
	game = next_game

func _on_game_over(next_game: Dictionary, winner_id: String) -> void:
	game = next_game
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
