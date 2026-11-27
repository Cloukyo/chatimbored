extends Node
## The whole game, start to finish: the title, the main menu, the guest list, a game, and back.
## A crowd keeps dancing in the ballroom behind the menus.
##
## For screenshots: -- --screen=title|menu|how|options|lobby_quick|lobby_night  (and --guests=3 to seat
## pretend players in a guest list).

const GAME_SCENE := "res://game/Game.tscn"

var controls := SeatControls.new()
var _backdrop: Node3D = null
var _backdrop_view: CrowdView3D = null
var _backdrop_round: QuickPlayRound = null
var _ui := CanvasLayer.new()
var _screen: Control = null
var _screen_name := ""
var _game: Node = null
var _menu_list: MenuList = null
var _clock := 0.0


func _ready() -> void:
	add_child(_ui)
	_open_backdrop()
	var start := "title"
	var guests := 0
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--screen="):
			start = arg.substr(9)
		elif arg.begins_with("--guests="):
			guests = int(arg.substr(9))
	match start:
		"lobby_quick", "lobby_night":
			_open_lobby(start.substr(6))
			for i in guests:
				(_screen as Lobby)._join("keyboard" if i == 0 else i - 1)
		"menu", "how", "options":
			_show(start)
		_:
			_show("title")


func _process(delta: float) -> void:
	controls.update()
	_clock += delta
	if _game != null:
		return
	_step_backdrop(delta)
	match _screen_name:
		"title":
			if controls.any_pressed() or Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
				Audio.play("chime")
				_show("menu")
		"menu":
			for device in controls.active_devices():
				_menu_list.handle(controls.presses(device))
		"how":
			for device in controls.active_devices():
				var p := controls.presses(device)
				if p.accept or p.back or p.start:
					_show("menu")
		"options":
			for device in controls.active_devices():
				(_screen as OptionsMenu).handle(controls.presses(device))
		"lobby":
			(_screen as Lobby).update_screen(controls)


func _show(screen_name: String) -> void:
	if _screen != null:
		_screen.queue_free()
	_screen_name = screen_name
	match screen_name:
		"title":
			_screen = _title_screen()
		"menu":
			_screen = _main_menu()
		"how":
			_screen = _how_to_play()
		"options":
			var options := OptionsMenu.new()
			options.closed.connect(_show.bind("menu"))
			_screen = options
	_ui.add_child(_screen)
	Audio.set_scene("lobby")


func _title_screen() -> Control:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(UiStyle.shade(0.35))
	var column := VBoxContainer.new()
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	column.add_theme_constant_override("separation", 10)
	var name := UiStyle.label("Morbid Masquerade", 84, UiStyle.GOLD, true)
	name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name.add_theme_constant_override("outline_size", 10)
	name.add_theme_color_override("font_outline_color", Color(0.1, 0.01, 0.03, 0.9))
	column.add_child(name)
	var line := UiStyle.label("Hide in the crowd. Find the others. Trust no mask.", 24)
	line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	line.add_theme_constant_override("outline_size", 6)
	line.add_theme_color_override("font_outline_color", Color(0.05, 0.0, 0.02, 0.9))
	column.add_child(line)
	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(0, 160)
	column.add_child(spacer)
	var press := UiStyle.label("Press any button", 26, UiStyle.INK)
	press.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	press.add_theme_constant_override("outline_size", 6)
	press.add_theme_color_override("font_outline_color", Color(0.05, 0.0, 0.02, 0.9))
	column.add_child(press)
	var tween := press.create_tween().set_loops()
	tween.tween_property(press, "modulate:a", 0.35, 1.1)
	tween.tween_property(press, "modulate:a", 1.0, 1.1)
	root.add_child(UiStyle.centered(column))
	return root


func _main_menu() -> Control:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(UiStyle.shade(0.45))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 26)
	var name := UiStyle.label("Morbid Masquerade", 58, UiStyle.GOLD, true)
	name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name.add_theme_constant_override("outline_size", 8)
	name.add_theme_color_override("font_outline_color", Color(0.1, 0.01, 0.03, 0.9))
	column.add_child(name)
	_menu_list = MenuList.new([
		{"label": "The Night", "value": func() -> String: return "the full party", "accept": _open_lobby.bind("night")},
		{"label": "Quick Play", "value": func() -> String: return "room after room", "accept": _open_lobby.bind("quick")},
		{"label": "How to play", "accept": _show.bind("how")},
		{"label": "Options", "accept": _show.bind("options")},
		{"label": "Quit", "accept": func() -> void: get_tree().quit()},
	], 30, 520)
	var holder := CenterContainer.new()
	holder.add_child(_menu_list)
	column.add_child(holder)
	var foot := UiStyle.label("Keyboard, mouse or controllers. Up to 8 at one screen.", 16, UiStyle.DIM)
	foot.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(foot)
	root.add_child(UiStyle.centered(column))
	return root


func _how_to_play() -> Control:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(UiStyle.shade(0.7))
	var card := UiStyle.card(28)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 12)
	card.add_child(body)
	var title := UiStyle.label("How to play", 40, UiStyle.GOLD)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.add_child(title)
	var text := UiStyle.rich(19)
	text.custom_minimum_size = Vector2(860, 0)
	text.text = "\n".join([
		"Every guest at the masquerade wears an animal mask, and the guests all look alike. Some of them are your friends. [b]Blend in[/b]: walk like the crowd walks, and don't run unless you have to.",
		"",
		"Each room is a different game: race for the exit, light lanterns, ring bells, crack vaults, hunt a killer, or hold your nerve as the lights go out. You get [b]one shot[/b] (sometimes more): use it on someone who moves wrong. Shoot a guest by mistake and everyone saw where it came from.",
		"",
		"[color=#e0b85a]The Night[/color] strings the rooms together on a mansion board. Win a room to claim it, spend tips in the shop, watch out for the cursed invitation, and finish with the Last Dance between the top two.",
		"[color=#e0b85a]Quick Play[/color] is room after room, a point for every win.",
		"",
		"[color=#e0b85a]Keyboard[/color]: WASD moves, Shift runs, E acts, click to shoot, Esc pauses.",
		"[color=#e0b85a]Controller[/color]: left stick moves, B runs, A acts, X shoots toward the right stick, Start pauses.",
		"On a shared screen, secrets (your role, the parcel, the dark) come as controller rumble.",
	])
	body.add_child(text)
	var back := UiStyle.label("A / Enter: back", 17, UiStyle.DIM)
	back.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.add_child(back)
	root.add_child(UiStyle.centered(card))
	return root


func _open_lobby(kind: String) -> void:
	if _screen != null:
		_screen.queue_free()
	var lobby := Lobby.new(kind)
	lobby.back.connect(_show.bind("menu"))
	lobby.start.connect(_start_game)
	_screen = lobby
	_screen_name = "lobby"
	_ui.add_child(lobby)


func _start_game(config: Dictionary) -> void:
	if _screen != null:
		_screen.queue_free()
		_screen = null
	_screen_name = ""
	_close_backdrop()
	_game = load(GAME_SCENE).instantiate()
	_game.config = config
	_game.left_game.connect(_end_game)
	add_child(_game)


func _end_game() -> void:
	Audio.set_crowd(false)
	_game.queue_free()
	_game = null
	_open_backdrop()
	_show("menu")


# ------------------------------------------------------------------ the ballroom behind the menus

func _open_backdrop() -> void:
	_backdrop = Node3D.new()
	add_child(_backdrop)
	move_child(_backdrop, 0)
	_backdrop_view = CrowdView3D.new()
	_backdrop_view.style_override = "ballroom"
	_backdrop_view.top_px = 20
	_backdrop.add_child(_backdrop_view)
	_new_backdrop_round()


func _new_backdrop_round() -> void:
	var players := [{"id": "a", "name": "a", "score": 0}, {"id": "b", "name": "b", "score": 0}]
	_backdrop_round = QuickPlayRound.new("silent_witness", players)
	for slot: CrowdSlot in _backdrop_round.crowd.slots.values():
		slot.entity.give_brain()
	_backdrop_view.clear()


func _step_backdrop(delta: float) -> void:
	if _backdrop_round == null:
		return
	_backdrop_accumulator += delta
	while _backdrop_accumulator >= CrowdMovement.TICK_SECONDS:
		_backdrop_accumulator -= CrowdMovement.TICK_SECONDS
		_backdrop_round.update()
	if _backdrop_round.should_finish():
		_new_backdrop_round()
	_backdrop_view.show_view(_backdrop_round.crowd.spectator_view("menu"), _clock * 1000.0, delta)
	# A slow drift across the room.
	var camera := _backdrop_view.camera
	camera.position.x = sin(_clock * 0.08) * 3.0


var _backdrop_accumulator := 0.0


func _close_backdrop() -> void:
	if _backdrop != null:
		_backdrop.queue_free()
	_backdrop = null
	_backdrop_view = null
	_backdrop_round = null
