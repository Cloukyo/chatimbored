extends Node3D
## The game on one screen, in 3D: quick play or a full night, keyboard as player 1 and a controller
## for each other player. Keys: WASD move, Shift run, E act, click to shoot. Tab next room,
## R restart, N full night, 1-3 pick a room, Enter to go on.

@onready var view: CrowdView3D = $View
@onready var hud: GameHud = $Hud

var driver := PlayDriver.new()
var _clock_ms := 0.0
var _mouse_was_down := false
## For screenshots: start a given room (--room=marked) or a night (--night). --demo lets player 1
## walk with the crowd and moves a night on by itself.
var _demo := false


func _ready() -> void:
	var room := ""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--room="):
			room = arg.substr(7)
		elif arg == "--demo":
			_demo = true
		elif arg == "--night":
			room = "night"
	if room == "night":
		driver.start_night()
	else:
		var index := CrowdModes.ids().find(room)
		driver.round_index = maxi(0, index)
		driver.start_quick()
	_demo_brain()


var _demo_wait := 0.0


## Demo nights pick the first room offered and move on by themselves after a couple of seconds.
func _demo_night(delta: float) -> void:
	if not _demo or driver.session == null:
		return
	var phase := driver.session.phase
	if phase == "in_game" or phase == "night_over":
		_demo_wait = 0.0
		return
	_demo_wait += delta
	if _demo_wait < 2.0:
		return
	_demo_wait = 0.0
	if phase == "board":
		driver.pick(0)
	else:
		driver.night_continue()


func _demo_brain() -> void:
	if _demo and driver.crowd() != null:
		var slot: CrowdSlot = driver.crowd().slots.get(PlayDriver.KEYBOARD)
		if slot != null and not slot.entity.has_brain and not slot.entity.hidden:
			slot.entity.give_brain()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_TAB:
				driver.next_room()
			KEY_R:
				driver.start_quick()
			KEY_N:
				driver.start_night()
			KEY_1, KEY_2, KEY_3:
				driver.pick(event.keycode - KEY_1)
			KEY_ENTER, KEY_KP_ENTER:
				driver.night_continue()


func _process(delta: float) -> void:
	_clock_ms += delta * 1000.0
	_demo_brain()
	_demo_night(delta)
	driver.advance(delta, _keyboard_input)
	var shown := driver.view()
	view.top_px = hud.top_space()
	if not shown.is_empty():
		view.show_view(shown, _clock_ms, delta)
	view.visible = not shown.is_empty()
	hud.show_state(driver, shown, view)


func _keyboard_input() -> Variant:
	if _demo:
		return null
	var move := Vector2(
		float(Input.is_physical_key_pressed(KEY_D)) - float(Input.is_physical_key_pressed(KEY_A)),
		float(Input.is_physical_key_pressed(KEY_S)) - float(Input.is_physical_key_pressed(KEY_W)),
	)
	var input := {"move": {"x": move.x, "y": move.y}, "run": Input.is_physical_key_pressed(KEY_SHIFT), "act": Input.is_physical_key_pressed(KEY_E)}
	var down := Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
	if down and not _mouse_was_down:
		var point: Variant = view.to_arena(get_viewport().get_mouse_position())
		if point != null:
			input.shoot = point
			var picked := driver.entity_near(Vector2(point.x, point.y), 30)
			if picked != null:
				input.shootAt = picked.id
	_mouse_was_down = down
	return input
