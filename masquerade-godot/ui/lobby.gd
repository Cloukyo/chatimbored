class_name Lobby
extends Control
## The guest list before a game: everyone joins with their own controller or the keyboard, computer
## players fill seats, and the first person to join sets the rules and starts.

signal start(config: Dictionary)
signal back

const MAX_SEATS := 8
const NAMES := ["The Countess", "The Duke", "Lady Vane", "Lord Ashby", "The Widow", "Doctor Crane", "Madame Rook", "Captain Hale", "Baron Quill", "Miss Thorne", "The Abbess", "Count Morrow", "Lady Ember", "Sir Gideon", "The Magician", "Mister Grey"]

var kind := "quick"
## [{name, device}]: people and computer players, in join order.
var seats: Array = []
var bots := 0
var _cards: HBoxContainer
var _list: MenuList
var _rules: MenuList = null
var _rules_card: Control = null
var _hint: Label
var _key := ""


func _init(game_kind: String) -> void:
	kind = game_kind


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(UiStyle.shade(0.72))
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	var title := UiStyle.label("The Night" if kind == "night" else "Quick Play", 46, UiStyle.GOLD)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(title)
	var blurb := UiStyle.label(_blurb(), 18, UiStyle.INK)
	blurb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	blurb.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	blurb.custom_minimum_size = Vector2(900, 0)
	column.add_child(blurb)
	_cards = HBoxContainer.new()
	_cards.alignment = BoxContainer.ALIGNMENT_CENTER
	_cards.add_theme_constant_override("separation", 10)
	_cards.custom_minimum_size = Vector2(0, 130)
	column.add_child(_cards)
	_hint = UiStyle.label("", 17, UiStyle.DIM)
	_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_hint.custom_minimum_size = Vector2(900, 0)
	column.add_child(_hint)
	_list = MenuList.new(_rows(), 22, 560)
	var holder := CenterContainer.new()
	holder.add_child(_list)
	column.add_child(holder)
	add_child(UiStyle.centered(column))
	_refresh_cards()


func _blurb() -> String:
	if kind == "night":
		return "A whole night at the masquerade: pick rooms on the mansion board, win them to claim them, shop between rooms, and finish with the Last Dance."
	return "One room after another. Win a room, score a point. Most points at the end of the set wins."


func _rows() -> Array:
	var rows := [
		{"label": "Computer players", "value": func() -> String: return str(bots), "left": func() -> void: _set_bots(bots - 1), "right": func() -> void: _set_bots(bots + 1)},
	]
	if kind == "night":
		rows.append({"label": "Rooms in the night", "value": func() -> String: return str(Settings.night_rounds), "left": _rounds.bind(-1), "right": _rounds.bind(1)})
		rows.append({"label": "House rules", "value": func() -> String: return "%d on" % _layers_on(), "accept": _open_rules})
	else:
		rows.append({"label": "Rooms in the set", "value": func() -> String: return str(Settings.quick_rounds), "left": _rounds.bind(-1), "right": _rounds.bind(1)})
	rows.append({"label": "Start", "accept": _start, "enabled": func() -> bool: return seats.size() + bots >= 2 and not seats.is_empty()})
	rows.append({"label": "Back", "accept": func() -> void: back.emit()})
	return rows


## Call every frame.
func update_screen(controls: SeatControls) -> void:
	if _rules != null:
		var lead: Variant = _lead_device()
		for device in controls.active_devices():
			if lead == null or device == lead:
				var presses: Dictionary = controls.presses(device)
				if presses.back or presses.start:
					_close_rules()
					return
				_rules.handle(presses)
		return
	for device in controls.active_devices():
		var presses: Dictionary = controls.presses(device)
		var seated := _seat_index(device)
		if seated == -1:
			if presses.accept and seats.size() + bots < MAX_SEATS:
				_join(device)
			elif presses.accept and bots > 0:
				bots -= 1
				_join(device)
			elif (presses.start or presses.back) and device is String and seats.is_empty():
				back.emit()
			continue
		if presses.extra:
			seats[seated].name = _fresh_name()
			Audio.play("tick")
			_refresh_cards()
		elif presses.back:
			_leave(seated)
		elif device == _lead_device():
			_list.handle(presses)
	_list.active = not seats.is_empty()
	var key := "%d:%d" % [seats.size(), bots]
	if key != _key:
		_key = key
		_list.refresh()


func _seat_index(device: Variant) -> int:
	for i in seats.size():
		if typeof(seats[i].device) == typeof(device) and seats[i].device == device:
			return i
	return -1


func _lead_device() -> Variant:
	return seats[0].device if not seats.is_empty() else null


func _join(device: Variant) -> void:
	seats.append({"name": _fresh_name(), "device": device})
	Audio.play("chime")
	_refresh_cards()


func _leave(index: int) -> void:
	seats.remove_at(index)
	Audio.play("tick")
	_refresh_cards()


func _fresh_name() -> String:
	var taken := seats.map(func(s: Dictionary) -> String: return s.name)
	var free := NAMES.filter(func(n: String) -> bool: return not taken.has(n))
	return free[randi() % free.size()] if not free.is_empty() else "Guest %d" % (seats.size() + 1)


func _set_bots(count: int) -> void:
	bots = clampi(count, 0, MAX_SEATS - seats.size())
	_refresh_cards()


func _rounds(step: int) -> void:
	if kind == "night":
		Settings.night_rounds = clampi(Settings.night_rounds + step, 3, 9)
	else:
		Settings.quick_rounds = clampi(Settings.quick_rounds + step, 1, 20)
	Settings.save()


func _layers_on() -> int:
	var options := Settings.night_options_for(seats.size() > 1)
	return options.values().count(true)


func _refresh_cards() -> void:
	for child in _cards.get_children():
		child.queue_free()
	for s in seats:
		_cards.add_child(_card(s.name, SeatControls.device_name(s.device), true))
	for i in bots:
		_cards.add_child(_card("Computer %d" % (i + 1), "walks with the crowd", false))
	if seats.size() + bots < MAX_SEATS:
		_cards.add_child(_card("Free seat", "A or Enter to join", false, true))
	if seats.is_empty():
		_hint.text = "Press A on a controller, or Enter on the keyboard, to join."
	else:
		_hint.text = "%s sets the rules.   Y / Tab: another name.   B / Backspace: leave." % seats[0].name
	if seats.size() > 1:
		_hint.text += "\nOn a shared screen nobody is marked: your secrets come as controller rumble."


func _card(title: String, detail: String, person: bool, empty := false) -> PanelContainer:
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", UiStyle.panel(10, UiStyle.SELECTED if person else Color(UiStyle.BURGUNDY, 0.5 if empty else 0.8), UiStyle.GOLD if person else Color(UiStyle.GOLD, 0.3)))
	card.custom_minimum_size = Vector2(140, 120)
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	card.add_child(box)
	box.add_child(_mask_icon(title, empty))
	var name := UiStyle.label(title, 17, UiStyle.INK if not empty else UiStyle.DIM, person)
	name.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(name)
	var line := UiStyle.label(detail, 13, UiStyle.DIM)
	line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(line)
	return card


func _mask_icon(seed_text: String, empty: bool) -> Control:
	var icon := _MaskIcon.new()
	var look := FigureLook.for_id(absi(seed_text.hash()) % 997 + 1)
	icon.animal = look.animal
	icon.colour = look.mask
	icon.faded = empty
	icon.custom_minimum_size = Vector2(120, 54)
	return icon


func _start() -> void:
	var list := []
	for i in seats.size():
		list.append({"id": "p%d" % (i + 1), "name": seats[i].name, "device": seats[i].device})
	for i in bots:
		list.append({"id": "p%d" % (list.size() + 1), "name": "Computer %d" % (i + 1), "device": "bot"})
	var config := {"kind": kind, "seats": list}
	if kind == "night":
		config.rounds = Settings.night_rounds
		config.options = Settings.night_options_for(seats.size() > 1)
	else:
		var rooms := CrowdModes.ids().duplicate()
		rooms.shuffle()
		config.rooms = rooms
		config.rounds = Settings.quick_rounds
	start.emit(config)


# ------------------------------------------------------------------ house rules

func _open_rules() -> void:
	var shared := seats.size() > 1
	var rows := []
	for layer in NightData.LAYERS:
		var key: String = layer.key
		var private: bool = layer.get("needsPrivateText", false)
		rows.append({
			"label": layer.name,
			"value": func() -> String: return "needs phones" if private and shared else ("On" if Settings.night_options_for(shared)[key] else "Off"),
			"enabled": func() -> bool: return not (private and shared),
			"left": _toggle_layer.bind(key), "right": _toggle_layer.bind(key),
		})
	rows.append({"label": "Done", "accept": _close_rules})
	_rules = MenuList.new(rows, 18, 620)
	_rules_card = Control.new()
	_rules_card.set_anchors_preset(Control.PRESET_FULL_RECT)
	_rules_card.add_child(UiStyle.shade(0.6))
	var card := UiStyle.card(20)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 10)
	card.add_child(body)
	var title := UiStyle.label("House rules", 32, UiStyle.GOLD)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	body.add_child(title)
	body.add_child(_rules)
	var help := UiStyle.label("", 15, UiStyle.DIM)
	help.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	help.custom_minimum_size = Vector2(620, 44)
	body.add_child(help)
	_rules.set_meta("help", help)
	_rules_card.add_child(UiStyle.centered(card))
	add_child(_rules_card)


func _process(_delta: float) -> void:
	if _rules != null and _rules.has_meta("help"):
		var index := _rules.cursor
		var help: Label = _rules.get_meta("help")
		help.text = NightData.LAYERS[index].blurb if index < NightData.LAYERS.size() else ""


func _toggle_layer(key: String) -> void:
	var options := Settings.night_options_for(seats.size() > 1)
	Settings.night_options[key] = not options[key]
	Settings.save()


func _close_rules() -> void:
	if _rules_card != null:
		_rules_card.queue_free()
	_rules_card = null
	_rules = null
	_list.refresh()


class _MaskIcon:
	extends Control
	var animal := "fox"
	var colour := "gold"
	var faded := false

	func _draw() -> void:
		draw_set_transform(size / 2 + Vector2(0, 8), 0, Vector2(2.4, 2.4))
		if faded:
			modulate = Color(1, 1, 1, 0.3)
		MaskArt.draw(self, animal, colour)
