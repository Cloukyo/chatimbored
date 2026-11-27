extends Node3D
## A game on one screen, in 3D: a quick-play set or a whole night, from the first room to the final
## standings. Set `config` before adding it to the tree: {kind: "quick" | "night", seats, rounds,
## options (the night's layers), rooms (quick play's room order)}.
##
## Keyboard: WASD move, Shift run, E act, click to shoot, Esc pauses. Controllers: left stick moves,
## B runs, A acts, X shoots (right stick aims), Start pauses.

signal left_game

var config := {}
var driver: PlayDriver
var controls := SeatControls.new()
var view := CrowdView3D.new()
var hud := GameHud.new()
var between: BetweenScreens
var _menus := CanvasLayer.new()
var _pause: Control = null
var _options: OptionsMenu = null
var _paused := false
var _act_pending := false
var _mouse_shot: Variant = null
var _shown_crowd: CrowdMatch = null
var _result_played := false
var _demo := false
var _demo_wait := 0.0


func _ready() -> void:
	_read_command_line()
	add_child(view)
	add_child(hud)
	_menus.layer = 5
	add_child(_menus)
	view.event_seen.connect(_on_event)
	_start()


## Starts (or starts again) from the config.
func _start() -> void:
	var seats: Array = config.get("seats", [])
	driver = PlayDriver.new(seats)
	driver.rumble_enabled = Settings.rumble
	if config.get("kind", "quick") == "night":
		driver.start_night(config.get("rounds", 5), config.get("options", Settings.night_options_for(driver.shared())))
	else:
		var rooms: Array = config.get("rooms", [])
		driver.start_quick(rooms, config.get("rounds", 0))
	if between != null:
		between.queue_free()
	between = BetweenScreens.new(driver)
	between.leave.connect(func() -> void: left_game.emit())
	between.again.connect(_start)
	_menus.add_child(between)
	_menus.move_child(between, 0)
	_shown_crowd = null


## For screenshots: --room=<mode> or --night starts straight away; --demo plays every seat as a computer
## player and moves on by itself.
func _read_command_line() -> void:
	if not config.is_empty():
		return
	config = {"kind": "quick", "rounds": 0}
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--room="):
			config.rooms = [arg.substr(7)]
		elif arg == "--night":
			config.kind = "night"
			config.rounds = 4
		elif arg == "--demo":
			_demo = true
	if _demo:
		config.seats = [{"id": "p1", "name": "Ada", "device": "bot"}, {"id": "p2", "name": "Bram", "device": "bot"}, {"id": "p3", "name": "Cleo", "device": "bot"}, {"id": "p4", "name": "Dev", "device": "bot"}]


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_E:
		_act_pending = true
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT and not _paused:
		_mouse_shot = view.to_arena(event.position)


func _process(delta: float) -> void:
	controls.update()
	if _demo:
		_demo_step(delta)
	if _options != null:
		for device in controls.active_devices():
			_options.handle(controls.presses(device))
		return
	if _pause != null:
		_pause_input()
		return
	for device in controls.active_devices():
		if controls.presses(device).get("start", false) and driver.phase() == "in_game":
			_open_pause()
			return
	driver.mouse_point = view.to_arena(get_viewport().get_mouse_position())
	driver.advance(delta, _keyboard_input)
	_show(delta)
	between.update_screen(controls)


func _show(delta: float) -> void:
	var crowd := driver.crowd()
	if crowd != _shown_crowd:
		_shown_crowd = crowd
		view.clear()
		_result_played = false
		if crowd != null:
			Audio.play("start")
	var shown := driver.view()
	view.top_px = hud.top_space()
	view.crosshairs = driver.crosshairs()
	if not shown.is_empty():
		view.show_view(shown, driver.clock_ms, delta)
	view.visible = not shown.is_empty()
	hud.show_state(driver, shown, view)
	_music(shown)


func _music(shown: Dictionary) -> void:
	var playing := driver.phase() == "in_game" and not shown.is_empty()
	Audio.set_crowd(playing)
	if playing:
		Audio.set_scene("finale" if shown.mode == "last_dance" else "round")
		Audio.set_tense(driver.ms_left() <= 20000)
	elif driver.phase() in ["over", "night_over"]:
		Audio.set_scene("lobby")
	if not shown.is_empty() and shown.has("result") and not _result_played:
		_result_played = true
		Audio.play(_result_cue(shown))


## A win or a loss for one person at the screen, a plain reveal on a shared one.
func _result_cue(shown: Dictionary) -> String:
	if driver.shared() or driver.humans().is_empty():
		return "reveal"
	var me: String = driver.humans()[0].id
	var result: Dictionary = shown.result
	for entry: Dictionary in result.get("reveal", []):
		if entry.playerId == me:
			var won: bool = result.get("winnerPlayerId", "") == me or (result.has("winnerRole") and entry.role == result.winnerRole)
			return "win" if won else "lose"
	return "reveal"


func _on_event(event: Dictionary, prop_kind: String) -> void:
	match event.type:
		"shot":
			Audio.play("shot")
		"down":
			Audio.play("down")
		"strike":
			Audio.play("strike")
		"bump":
			Audio.play("bump")
		"escaped":
			Audio.play("chime")
		"flare":
			Audio.play({"lantern": "chime", "bell": "bell", "vault": "vault"}.get(prop_kind, "chime"))


func _keyboard_input() -> Variant:
	var move := Vector2(
		float(Input.is_physical_key_pressed(KEY_D) or Input.is_physical_key_pressed(KEY_RIGHT)) - float(Input.is_physical_key_pressed(KEY_A) or Input.is_physical_key_pressed(KEY_LEFT)),
		float(Input.is_physical_key_pressed(KEY_S) or Input.is_physical_key_pressed(KEY_DOWN)) - float(Input.is_physical_key_pressed(KEY_W) or Input.is_physical_key_pressed(KEY_UP)),
	)
	var input := {"move": {"x": move.x, "y": move.y}, "run": Input.is_physical_key_pressed(KEY_SHIFT), "act": _act_pending}
	_act_pending = false
	if _mouse_shot != null:
		input.shoot = _mouse_shot
		var picked := driver.entity_near(Vector2(_mouse_shot.x, _mouse_shot.y), 30)
		if picked != null:
			input.shootAt = picked.id
		_mouse_shot = null
	return input


# ------------------------------------------------------------------ pause

func _open_pause() -> void:
	_paused = true
	_pause = Control.new()
	_pause.set_anchors_preset(Control.PRESET_FULL_RECT)
	_pause.add_child(UiStyle.shade(0.6))
	var card := UiStyle.card(28)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 14)
	card.add_child(body)
	var title := UiStyle.label("Paused", 40, UiStyle.GOLD)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.add_child(title)
	var list := MenuList.new([
		{"label": "Carry on", "accept": _close_pause},
		{"label": "Options", "accept": _open_options},
		{"label": "Leave this %s" % ("night" if driver.session != null else "game"), "accept": func() -> void: left_game.emit()},
	], 28, 420)
	list.name = "List"
	body.add_child(list)
	_pause.add_child(UiStyle.centered(card))
	_menus.add_child(_pause)
	_pause.set_meta("list", list)
	Audio.play("click")


func _pause_input() -> void:
	var list: MenuList = _pause.get_meta("list")
	for device in controls.active_devices():
		var presses := controls.presses(device)
		if presses.start or presses.back:
			_close_pause()
			return
		list.handle(presses)


func _close_pause() -> void:
	if _pause != null:
		_pause.queue_free()
		_pause = null
	_paused = false


func _open_options() -> void:
	_options = OptionsMenu.new()
	_options.closed.connect(func() -> void:
		_options.queue_free()
		_options = null
		driver.rumble_enabled = Settings.rumble)
	_menus.add_child(_options)


# ------------------------------------------------------------------ demo

## Every seat is a computer player; between rooms the first choice is taken after a moment.
func _demo_step(delta: float) -> void:
	if driver.phase() == "in_game":
		_demo_wait = 0.0
		return
	_demo_wait += delta
	if _demo_wait < 2.5:
		return
	_demo_wait = 0.0
	match driver.phase():
		"results":
			if driver.session != null:
				driver.session.next(driver.session.host_id())
			else:
				driver.continue_quick()
