class_name GameHud
extends CanvasLayer
## The HUD during a room, styled like an invitation: a bar across the top with the time, the room and
## what to do, and shots and bumps drawn over the picture.

var _bar := PanelContainer.new()
var _time: Label
var _title: Label
var _lines: RichTextLabel
var _overlay := _Overlay.new()


func _ready() -> void:
	_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_overlay)
	_bar.add_theme_stylebox_override("panel", UiStyle.panel(0))
	_bar.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_bar.offset_left = 16
	_bar.offset_right = -16
	_bar.offset_top = 10
	_bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_bar)
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override("separation", 2)
	_bar.add_child(rows)
	var top := HBoxContainer.new()
	rows.add_child(top)
	_time = UiStyle.label("", 26, UiStyle.GOLD)
	_time.custom_minimum_size.x = 90
	top.add_child(_time)
	_title = UiStyle.label("", 26)
	_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(_title)
	var spacer := Control.new()
	spacer.custom_minimum_size.x = 90
	top.add_child(spacer)
	_lines = UiStyle.rich(17)
	rows.add_child(_lines)


## Pixels the bar covers, so the camera keeps the floor clear of it.
func top_space() -> float:
	return maxf(96.0, _bar.size.y + 20) if _bar.visible else 20.0


func show_state(driver: PlayDriver, view: Dictionary, scene: CrowdView3D) -> void:
	var in_round := not view.is_empty() and driver.phase() == "in_game"
	_overlay.scene = scene
	_overlay.effects = scene.overlay_effects() if in_round else []
	_overlay.queue_redraw()
	_bar.visible = in_round
	if not in_round:
		return
	var seconds := ceili(driver.ms_left() / 1000.0)
	_time.text = "%d:%02d" % [seconds / 60, seconds % 60]
	_time.add_theme_color_override("font_color", Color("e9806b") if seconds <= 15 else UiStyle.GOLD)
	_title.text = CrowdModes.NAMES.get(view.mode, "The Last Dance")
	var lines: Array
	if driver.shared():
		lines = HudText.shared_lines(view, driver.name_of)
	else:
		var me: Dictionary = driver.humans()[0] if not driver.humans().is_empty() else {"device": "keyboard"}
		lines = HudText.lines(view, HudText.keys_for(not (me.device is String)), driver.name_of)
	_lines.text = "[center]%s[/center]" % "   ·   ".join(lines)


## Shots and bumps, drawn flat over the 3D picture.
class _Overlay:
	extends Control
	var scene: CrowdView3D
	var effects: Array = []

	func _draw() -> void:
		for effect: Dictionary in effects:
			var age := scene.effect_age(effect)
			var life := 1 - age
			if effect.kind == "shot":
				var from := scene.project(effect.from, CrowdView3D.SHOT_HEIGHT)
				var to := scene.project(effect.to, CrowdView3D.SHOT_HEIGHT)
				draw_line(from, to, Color8(255, 226, 120, int(life * 255)), 3 * life + 1, true)
				draw_circle(from, 10 * life + 3, Color8(255, 170, 70, int(life * 0.8 * 255)))
			else:
				var at := scene.project(effect.at, 2.3) + Vector2(0, -age * 10)
				draw_string(UiStyle.serif(true), at - Vector2(5, 0), "!", HORIZONTAL_ALIGNMENT_CENTER, -1, 24, Color8(255, 236, 170, int(life * 255)))
