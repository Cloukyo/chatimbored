class_name GameHud
extends CanvasLayer
## The HUD, styled like an invitation: gold on burgundy. A bar across the top with the time, the room
## and what to do; shots and bumps drawn over the picture; a card in the middle between rounds.

const GOLD := Color("e0b85a")
const INK := Color("f5e6c8")
const BURGUNDY := Color(0.22, 0.04, 0.07, 0.86)

var _bar := PanelContainer.new()
var _time := Label.new()
var _title := Label.new()
var _lines := RichTextLabel.new()
var _card := PanelContainer.new()
var _card_text := RichTextLabel.new()
var _overlay := _Overlay.new()
var _serif := SystemFont.new()


func _ready() -> void:
	_serif.font_names = PackedStringArray(["Cinzel", "Cormorant Garamond", "Georgia", "Times New Roman", "Liberation Serif", "DejaVu Serif", "serif"])
	_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_overlay)

	_bar.add_theme_stylebox_override("panel", _panel_style(0))
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
	_style_label(_time, 26, GOLD)
	_time.custom_minimum_size.x = 80
	top.add_child(_time)
	_style_label(_title, 26, INK)
	_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(_title)
	var spacer := Control.new()
	spacer.custom_minimum_size.x = 80
	top.add_child(spacer)
	_style_rich(_lines, 17)
	_lines.fit_content = true
	_lines.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	rows.add_child(_lines)

	_card.add_theme_stylebox_override("panel", _panel_style(28))
	_card.set_anchors_preset(Control.PRESET_CENTER)
	_card.custom_minimum_size = Vector2(620, 0)
	_card.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_card.grow_vertical = Control.GROW_DIRECTION_BOTH
	_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_card)
	_style_rich(_card_text, 20)
	_card_text.fit_content = true
	_card.add_child(_card_text)


## Pixels the bar covers, so the camera keeps the floor clear of it.
func top_space() -> float:
	return maxf(96.0, _bar.size.y + 20) if _bar.visible else 20.0


func show_state(driver: PlayDriver, view: Dictionary, scene: CrowdView3D) -> void:
	var name_of := driver.name_of
	_overlay.scene = scene
	_overlay.effects = scene.overlay_effects() if not view.is_empty() else []
	_overlay.queue_redraw()
	var session := driver.session
	if view.is_empty():
		_bar.visible = false
		_card.visible = true
		_card_text.text = _night_card(session)
		return
	_bar.visible = true
	_time.text = "%ds" % ceili(driver.ms_left() / 1000.0)
	_title.text = CrowdModes.NAMES.get(view.mode, "The Last Dance")
	var keys := HudText.keys_for(false)
	_lines.text = "[center]%s[/center]" % "   ·   ".join(HudText.lines(view, keys, name_of))
	_card.visible = view.has("result")
	if view.has("result"):
		var text := "[center][font_size=34][color=#e0b85a]%s[/color][/font_size]\n\n" % HudText.result_line(view.result, name_of)
		for entry: Dictionary in view.result.reveal:
			var role: String = entry.role
			text += "%s%s%s\n" % [name_of.call(entry.playerId), " (%s)" % role.capitalize() if role != "" and role != "player" else "", "" if entry.alive else ", down"]
		if session != null:
			text += "\n[color=#e0b85a]Enter[/color] to go on"
		else:
			text += "\n[color=#e0b85a]Tab[/color] next room   [color=#e0b85a]R[/color] again   [color=#e0b85a]N[/color] a full night"
		_card_text.text = text + "[/center]"


## Between rooms of a night: the board, the shop, the vote, backing and the final standings.
func _night_card(session: NightSession) -> String:
	if session == null:
		return ""
	var night := session.night
	var text := "[center][font_size=30][color=#e0b85a]Room %d of %d[/color][/font_size]\n\n" % [mini(night.played.size() + 1, night.total_rounds), night.total_rounds]
	match session.phase:
		"board":
			text += "%s picks the next room\n\n" % session.name_of(night.picker_id)
			for i in night.offered.size():
				var room := NightData.room(night.offered[i])
				var claimed: String = "   [i]claimed by %s[/i]" % session.name_of(night.claims[room.key]) if night.claims.has(room.key) else ""
				text += "[color=#e0b85a]%d[/color]  %s, %s%s\n" % [i + 1, room.name, CrowdModes.NAMES[room.mode], claimed]
		"shop":
			text += "The shop is open\n\n[color=#e0b85a]Enter[/color] to skip"
		"mole_vote":
			text += "Who is the mole?\n\n[color=#e0b85a]Enter[/color] to skip the vote"
		"finale_pick":
			text += "Back a finalist for the Last Dance\n\n[color=#e0b85a]Enter[/color] to go on"
		"night_over":
			text = "[center][font_size=30][color=#e0b85a]The night is over[/color][/font_size]\n\n"
			for standing in night.standings():
				text += "%s   %d\n" % [session.name_of(standing.playerId), standing.total]
			text += "\n"
			for award in night.awards():
				text += "[color=#e0b85a]%s[/color]: %s, %s\n" % [award.title, session.name_of(award.playerId), award.detail]
			text += "\n[color=#e0b85a]N[/color] another night   [color=#e0b85a]R[/color] quick play"
	return text + "[/center]"


func _panel_style(padding: float) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = BURGUNDY
	style.border_color = GOLD
	style.set_border_width_all(2)
	style.set_corner_radius_all(6)
	style.content_margin_left = 18 + padding
	style.content_margin_right = 18 + padding
	style.content_margin_top = 6 + padding * 0.6
	style.content_margin_bottom = 8 + padding * 0.6
	return style


func _style_label(label: Label, size: int, colour: Color) -> void:
	label.add_theme_font_override("font", _serif)
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_color_override("font_color", colour)


func _style_rich(label: RichTextLabel, size: int) -> void:
	label.bbcode_enabled = true
	label.scroll_active = false
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	label.add_theme_font_override("normal_font", _serif)
	var bold := SystemFont.new()
	bold.font_names = _serif.font_names
	bold.font_weight = 700
	label.add_theme_font_override("bold_font", bold)
	label.add_theme_font_size_override("normal_font_size", size)
	label.add_theme_font_size_override("bold_font_size", size)
	label.add_theme_color_override("default_color", INK)


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
				draw_string(ThemeDB.fallback_font, at - Vector2(5, 0), "!", HORIZONTAL_ALIGNMENT_CENTER, -1, 22, Color8(255, 236, 170, int(life * 255)))
