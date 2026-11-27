class_name OptionsMenu
extends Control
## Sound, picture and controller settings. Changes apply and save straight away.

signal closed

var list: MenuList


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(UiStyle.shade(0.7))
	var card := UiStyle.card(28)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 14)
	card.add_child(body)
	var title := UiStyle.label("Options", 40, UiStyle.GOLD)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.add_child(title)
	var percent := func(value: float) -> String: return "%d%%" % roundi(value * 100)
	var on_off := func(value: bool) -> String: return "On" if value else "Off"
	list = MenuList.new([
		{"label": "Music", "value": func() -> String: return percent.call(Settings.music), "left": func() -> void: _set_level("music", Settings.music - 0.1), "right": func() -> void: _set_level("music", Settings.music + 0.1)},
		{"label": "Sound effects", "value": func() -> String: return percent.call(Settings.effects), "left": func() -> void: _set_level("effects", Settings.effects - 0.1), "right": func() -> void: _set_level("effects", Settings.effects + 0.1)},
		{"label": "Fullscreen", "value": func() -> String: return on_off.call(Settings.fullscreen), "left": _toggle.bind("fullscreen"), "right": _toggle.bind("fullscreen")},
		{"label": "Window size", "value": func() -> String: return "%d x %d" % [Settings.resolution.x, Settings.resolution.y], "left": _resolution.bind(-1), "right": _resolution.bind(1), "enabled": func() -> bool: return not Settings.fullscreen},
		{"label": "V-Sync", "value": func() -> String: return on_off.call(Settings.vsync), "left": _toggle.bind("vsync"), "right": _toggle.bind("vsync")},
		{"label": "Controller rumble", "value": func() -> String: return on_off.call(Settings.rumble), "left": _toggle.bind("rumble"), "right": _toggle.bind("rumble")},
		{"label": "Back", "accept": func() -> void: closed.emit()},
	], 26, 560)
	body.add_child(list)
	var hint := UiStyle.label("Left and right change a setting. Rumble carries secrets on a shared screen, so leave it on for couch play.", 15, UiStyle.DIM)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.custom_minimum_size = Vector2(560, 0)
	body.add_child(hint)
	add_child(UiStyle.centered(card))


func handle(presses: Dictionary) -> void:
	if presses.get("back", false) or presses.get("start", false):
		closed.emit()
		return
	list.handle(presses)


func _set_level(key: String, value: float) -> void:
	Settings.set(key, clampf(snappedf(value, 0.1), 0, 1))
	Settings.apply()
	Settings.save()


func _toggle(key: String) -> void:
	Settings.set(key, not Settings.get(key))
	Settings.apply()
	Settings.save()


func _resolution(step: int) -> void:
	var sizes: Array = Settings.RESOLUTIONS
	var index := maxi(0, sizes.find(Settings.resolution))
	Settings.resolution = sizes[posmod(index + step, sizes.size())]
	Settings.apply()
	Settings.save()
