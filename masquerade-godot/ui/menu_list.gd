class_name MenuList
extends VBoxContainer
## A list of rows moved through with any controller or the keyboard, or clicked with the mouse.
## Each row: {label, value (Callable returning text, optional), accept (Callable), left / right (Callable),
## enabled (Callable returning bool, optional)}. Call handle(presses) with SeatControls presses.

signal chosen(index: int)

var rows: Array = []
var cursor := 0
var row_size := 26
var width := 520.0
## Whether the cursor shows (false while someone else is choosing).
var active := true
var _panels: Array[PanelContainer] = []
var _values: Array[Label] = []
var _labels: Array[Label] = []


func _init(menu_rows: Array = [], size := 26, row_width := 520.0) -> void:
	rows = menu_rows
	row_size = size
	width = row_width
	add_theme_constant_override("separation", 6)
	mouse_filter = Control.MOUSE_FILTER_PASS


func _ready() -> void:
	rebuild()


func set_rows(menu_rows: Array) -> void:
	rows = menu_rows
	cursor = clampi(cursor, 0, maxi(0, rows.size() - 1))
	if is_inside_tree():
		rebuild()


func rebuild() -> void:
	for child in get_children():
		child.queue_free()
	_panels.clear()
	_values.clear()
	_labels.clear()
	for i in rows.size():
		var row: Dictionary = rows[i]
		var panel := PanelContainer.new()
		panel.custom_minimum_size = Vector2(width, 0)
		panel.mouse_filter = Control.MOUSE_FILTER_STOP
		var line := HBoxContainer.new()
		line.mouse_filter = Control.MOUSE_FILTER_IGNORE
		panel.add_child(line)
		var name := UiStyle.label(row.label, row_size)
		name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		line.add_child(name)
		var value := UiStyle.label("", row_size, UiStyle.GOLD)
		line.add_child(value)
		add_child(panel)
		_panels.append(panel)
		_labels.append(name)
		_values.append(value)
		var index := i
		panel.mouse_entered.connect(func() -> void:
			if active:
				cursor = index
				refresh())
		panel.gui_input.connect(func(event: InputEvent) -> void: _click(index, event))
	refresh()


func refresh() -> void:
	for i in _panels.size():
		var row: Dictionary = rows[i]
		var selected := active and i == cursor
		var enabled := _enabled(i)
		_panels[i].add_theme_stylebox_override("panel", UiStyle.panel(10, UiStyle.SELECTED if selected else Color(UiStyle.BURGUNDY, 0.55), UiStyle.GOLD if selected else Color(UiStyle.GOLD, 0.25)))
		_labels[i].text = (row.label as String)
		_labels[i].add_theme_color_override("font_color", UiStyle.INK if enabled else UiStyle.DIM)
		_values[i].text = (row.value as Callable).call() if row.has("value") else ""
		if row.has("left") and selected:
			_values[i].text = "‹  %s  ›" % _values[i].text


func handle(presses: Dictionary) -> void:
	if rows.is_empty() or not active:
		return
	if presses.get("up", false):
		_move(-1)
	elif presses.get("down", false):
		_move(1)
	elif presses.get("left", false):
		_side("left")
	elif presses.get("right", false):
		_side("right")
	elif presses.get("accept", false):
		_accept(cursor)


func _move(step: int) -> void:
	for attempt in rows.size():
		cursor = posmod(cursor + step, rows.size())
		if _enabled(cursor):
			break
	Audio.play("tick", -8)
	refresh()


func _side(which: String) -> void:
	var row: Dictionary = rows[cursor]
	if row.has(which) and _enabled(cursor):
		(row[which] as Callable).call()
		Audio.play("tick", -6)
		refresh()


func _accept(index: int) -> void:
	var row: Dictionary = rows[index]
	if not _enabled(index):
		return
	Audio.play("click")
	if row.has("accept"):
		(row.accept as Callable).call()
	elif row.has("right"):
		(row.right as Callable).call()
	chosen.emit(index)
	if is_inside_tree():
		refresh()


func _enabled(index: int) -> bool:
	var row: Dictionary = rows[index]
	return (row.enabled as Callable).call() if row.has("enabled") else true


func _click(index: int, event: InputEvent) -> void:
	if not active or not (event is InputEventMouseButton) or not event.pressed:
		return
	cursor = index
	var row: Dictionary = rows[index]
	if event.button_index == MOUSE_BUTTON_LEFT:
		if row.has("left") and not row.has("accept"):
			# Clicking the left half of a setting turns it down, the right half up.
			_side("left" if event.position.x < _panels[index].size.x * 0.6 else "right")
		else:
			_accept(index)
	elif event.button_index == MOUSE_BUTTON_RIGHT and row.has("left"):
		_side("left")
