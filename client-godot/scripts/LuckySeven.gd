extends Control

const BG := Color(0.055, 0.075, 0.07)
const TABLE := Color(0.09, 0.31, 0.22)
const TABLE_EDGE := Color(0.76, 0.57, 0.26)
const CARD_FACE := Color(0.96, 0.93, 0.86)
const CARD_BACK := Color(0.17, 0.23, 0.34)
const CARD_INK := Color(0.10, 0.09, 0.08)
const MODIFIER_FACE := Color(0.98, 0.76, 0.25)
const ACTION_FACE := Color(0.42, 0.74, 0.78)
const ACCENT := Color(0.98, 0.78, 0.28)
const ACTIVE := Color(0.42, 0.90, 0.62)
const DANGER := Color(0.94, 0.28, 0.20)
const MUTED := Color(0.67, 0.72, 0.68)
const CARD_SIZE := Vector2(58, 80)

var game: Dictionary = {}
var local_state: Dictionary = {}
var title_label: Label
var timer_label: Label
var status_label: Label
var event_label: Label
var hit_button: Button
var stay_button: Button
var dealer_button: Button
var discard_button: Button
var discard_panel: PanelContainer
var discard_label: Label
var summary_panel: PanelContainer
var summary_title: Label
var summary_label: Label
var continue_button: Button
var winner_panel: PanelContainer
var winner_label: Label
var winner_detail_label: Label
var return_button: Button
var last_event_sequence := -1
var draw_animation_progress := 1.0
var animated_player_id := ""
var animated_card: Dictionary = {}
var flash_player_id := ""
var flash_strength := 0.0
var card_tween: Tween

func _ready() -> void:
	NetworkManager.room_state_changed.connect(_on_room_state_changed)
	NetworkManager.game_state_changed.connect(_on_game_state_changed)
	NetworkManager.game_over.connect(_on_game_over)
	_build_ui()
	game = NetworkManager.room.game
	_refresh_local_state()
	_render_ui()

func _process(delta: float) -> void:
	_update_timer()
	if draw_animation_progress < 1.0 or flash_strength > 0.0:
		flash_strength = max(0.0, flash_strength - delta * 2.8)
		queue_redraw()

func _input(event: InputEvent) -> void:
	if winner_panel.visible:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_C and summary_panel.visible and continue_button.visible:
			_send_action("continue")
			return
		if event.keycode == KEY_TAB:
			_toggle_discards()
			return
		if event.keycode == KEY_SPACE or event.keycode == KEY_ENTER or event.keycode == KEY_KP_ENTER:
			_send_primary_action()
		elif event.keycode == KEY_S or event.keycode == KEY_ESCAPE:
			_send_action("request_stay")
	if event is InputEventJoypadButton and event.pressed:
		if event.button_index == JOY_BUTTON_A:
			_send_primary_action()
		elif event.button_index == JOY_BUTTON_B:
			_send_action("request_stay")

func _build_ui() -> void:
	title_label = Label.new()
	title_label.offset_left = 24
	title_label.offset_top = 12
	title_label.add_theme_font_size_override("font_size", 30)
	add_child(title_label)

	timer_label = Label.new()
	timer_label.anchor_left = 1.0
	timer_label.anchor_right = 1.0
	timer_label.offset_left = -108
	timer_label.offset_right = -24
	timer_label.offset_top = 18
	timer_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	timer_label.add_theme_font_size_override("font_size", 18)
	add_child(timer_label)

	status_label = Label.new()
	status_label.offset_left = 24
	status_label.offset_top = 52
	status_label.offset_right = 780
	status_label.add_theme_font_size_override("font_size", 17)
	add_child(status_label)

	event_label = Label.new()
	event_label.offset_left = 24
	event_label.offset_top = 80
	event_label.offset_right = 840
	event_label.add_theme_font_size_override("font_size", 17)
	event_label.add_theme_color_override("font_color", ACCENT)
	add_child(event_label)

	discard_button = Button.new()
	discard_button.anchor_left = 1.0
	discard_button.anchor_right = 1.0
	discard_button.offset_left = -190
	discard_button.offset_right = -24
	discard_button.offset_top = 62
	discard_button.offset_bottom = 102
	discard_button.text = "Discards"
	discard_button.pressed.connect(_toggle_discards)
	add_child(discard_button)

	var actions := HBoxContainer.new()
	actions.anchor_left = 0.5
	actions.anchor_right = 0.5
	actions.anchor_top = 1.0
	actions.anchor_bottom = 1.0
	actions.offset_left = -290
	actions.offset_right = 290
	actions.offset_top = -68
	actions.offset_bottom = -18
	actions.alignment = BoxContainer.ALIGNMENT_CENTER
	actions.add_theme_constant_override("separation", 10)
	add_child(actions)

	hit_button = _action_button("Hit Me")
	hit_button.pressed.connect(_on_hit_pressed)
	actions.add_child(hit_button)

	stay_button = _action_button("Stay")
	stay_button.pressed.connect(_on_stay_pressed)
	actions.add_child(stay_button)

	dealer_button = _action_button("Deal")
	dealer_button.pressed.connect(_on_dealer_pressed)
	actions.add_child(dealer_button)

	_build_discard_panel()
	_build_summary_panel()
	_build_winner_panel()

func _action_button(text: String) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(170, 48)
	return button

func _build_discard_panel() -> void:
	discard_panel = PanelContainer.new()
	discard_panel.visible = false
	discard_panel.anchor_left = 1.0
	discard_panel.anchor_right = 1.0
	discard_panel.offset_left = -300
	discard_panel.offset_right = -24
	discard_panel.offset_top = 112
	discard_panel.offset_bottom = 430
	add_child(discard_panel)

	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	discard_panel.add_child(scroll)
	discard_label = Label.new()
	discard_label.custom_minimum_size = Vector2(246, 0)
	discard_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	discard_label.add_theme_font_size_override("font_size", 16)
	scroll.add_child(discard_label)

func _build_summary_panel() -> void:
	summary_panel = PanelContainer.new()
	summary_panel.visible = false
	summary_panel.anchor_left = 0.5
	summary_panel.anchor_top = 0.5
	summary_panel.anchor_right = 0.5
	summary_panel.anchor_bottom = 0.5
	summary_panel.offset_left = -230
	summary_panel.offset_top = -170
	summary_panel.offset_right = 230
	summary_panel.offset_bottom = 170
	add_child(summary_panel)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	summary_panel.add_child(box)
	summary_title = Label.new()
	summary_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	summary_title.add_theme_font_size_override("font_size", 30)
	box.add_child(summary_title)
	summary_label = Label.new()
	summary_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	summary_label.add_theme_font_size_override("font_size", 18)
	box.add_child(summary_label)
	continue_button = Button.new()
	continue_button.text = "Next Round"
	continue_button.custom_minimum_size = Vector2(210, 48)
	continue_button.pressed.connect(_on_continue_pressed)
	box.add_child(continue_button)

func _build_winner_panel() -> void:
	winner_panel = PanelContainer.new()
	winner_panel.visible = false
	winner_panel.anchor_left = 0.5
	winner_panel.anchor_top = 0.5
	winner_panel.anchor_right = 0.5
	winner_panel.anchor_bottom = 0.5
	winner_panel.offset_left = -260
	winner_panel.offset_top = -190
	winner_panel.offset_right = 260
	winner_panel.offset_bottom = 190
	add_child(winner_panel)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	winner_panel.add_child(box)
	winner_label = Label.new()
	winner_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	winner_label.add_theme_font_size_override("font_size", 34)
	box.add_child(winner_label)
	winner_detail_label = Label.new()
	winner_detail_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	winner_detail_label.add_theme_font_size_override("font_size", 18)
	box.add_child(winner_detail_label)
	return_button = Button.new()
	return_button.text = "Return to Lobby"
	return_button.visible = false
	return_button.custom_minimum_size = Vector2(220, 48)
	return_button.pressed.connect(NetworkManager.return_to_lobby)
	box.add_child(return_button)

func _draw() -> void:
	var state: Dictionary = game.get("luckySeven", {})
	draw_rect(Rect2(Vector2.ZERO, size), BG, true)
	if state.is_empty():
		return
	var table_rect := Rect2(Vector2(28, 116), Vector2(max(1.0, size.x - 56), max(1.0, size.y - 202)))
	draw_style_box(_table_style(), table_rect)
	_draw_table_players(state, table_rect)
	_draw_deck(state, table_rect)
	_draw_card_animation(state, table_rect)

func _table_style() -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = TABLE
	style.border_color = TABLE_EDGE
	style.set_border_width_all(3)
	style.corner_radius_top_left = 8
	style.corner_radius_top_right = 8
	style.corner_radius_bottom_left = 8
	style.corner_radius_bottom_right = 8
	return style

func _draw_table_players(state: Dictionary, table_rect: Rect2) -> void:
	var players: Array = state.get("players", [])
	for index in range(players.size()):
		var player: Dictionary = players[index]
		_draw_player_seat(player, _seat_center(table_rect, index, players.size()), state)

func _seat_center(table_rect: Rect2, index: int, count: int) -> Vector2:
	var angle: float = -PI * 0.5 + TAU * float(index) / max(1.0, float(count))
	var radius := Vector2(table_rect.size.x * 0.36, table_rect.size.y * 0.34)
	return table_rect.position + table_rect.size * 0.5 + Vector2(cos(angle) * radius.x, sin(angle) * radius.y)

func _draw_player_seat(player: Dictionary, center: Vector2, state: Dictionary) -> void:
	var cards: Array = player.get("cards", []).duplicate()
	var is_local := str(player.get("id", "")) == NetworkManager.player_id
	var player_id := str(player.get("id", ""))
	if draw_animation_progress < 1.0 and player_id == animated_player_id and not animated_card.is_empty():
		for index in range(cards.size() - 1, -1, -1):
			if str(cards[index].get("id", "")) == str(animated_card.get("id", "")):
				cards.remove_at(index)
				break
	var card_size := CARD_SIZE if is_local else CARD_SIZE * 0.72
	var max_cards := cards.size()
	var max_hand_width := 250.0 if is_local else 190.0
	var overlap: float = min(
		card_size.x * 0.56,
		max(5.0, (max_hand_width - card_size.x) / max(1.0, float(max_cards - 1)))
	)
	var total_width: float = max(card_size.x, float(max_cards - 1) * overlap + card_size.x)
	var origin := center - Vector2(total_width * 0.5, card_size.y * 0.5)
	var panel_rect := Rect2(origin + Vector2(-10, -38), Vector2(total_width + 20, card_size.y + 66))
	var is_dealer := player_id == str(state.get("dealerId", ""))
	var is_active := player_id == str(state.get("activePlayerId", ""))
	var border := ACCENT if is_dealer else ACTIVE if is_active else Color(0.23, 0.34, 0.28)
	if player_id == flash_player_id and flash_strength > 0.0:
		border = DANGER.lerp(Color.WHITE, 1.0 - flash_strength)
	draw_rect(panel_rect, Color(0.035, 0.06, 0.05, 0.78), true)
	draw_rect(panel_rect, border, false, 3.0 if is_active or is_dealer else 1.5)

	for index in range(max_cards):
		_draw_card(Rect2(origin + Vector2(index * overlap, 0), card_size), cards[index], true)
	if cards.is_empty():
		draw_string(get_theme_default_font(), origin + Vector2(0, card_size.y * 0.52), "Waiting", HORIZONTAL_ALIGNMENT_CENTER, total_width, 13, MUTED)

	var badges: Array[String] = []
	if is_dealer:
		badges.append("DEALER")
	if is_active:
		badges.append("TURN")
	if bool(player.get("hasSecondChance", false)):
		badges.append("SHIELD")
	var name := _player_name(player_id)
	if is_local:
		name += " (You)"
	var state_text := str(player.get("roundState", "playing"))
	var text_color := DANGER if state_text == "busted" else MUTED if state_text != "playing" else Color.WHITE
	draw_string(get_theme_default_font(), panel_rect.position + Vector2(7, 17), name, HORIZONTAL_ALIGNMENT_LEFT, panel_rect.size.x - 14, 13, text_color)
	draw_string(get_theme_default_font(), panel_rect.position + Vector2(7, 34), " ".join(badges), HORIZONTAL_ALIGNMENT_LEFT, panel_rect.size.x - 14, 10, border)
	var score_text := "%s / %s" % [player.get("roundScore", 0), player.get("totalScore", 0)]
	draw_string(get_theme_default_font(), panel_rect.position + Vector2(7, panel_rect.size.y - 9), score_text, HORIZONTAL_ALIGNMENT_LEFT, panel_rect.size.x - 14, 13, text_color)

func _draw_deck(state: Dictionary, table_rect: Rect2) -> void:
	var rect := Rect2(table_rect.position + table_rect.size * 0.5 - CARD_SIZE * 0.5, CARD_SIZE)
	_draw_card(rect, {}, false)
	draw_string(get_theme_default_font(), rect.position + Vector2(-18, rect.size.y + 20), "%s left" % state.get("deckCount", 0), HORIZONTAL_ALIGNMENT_CENTER, rect.size.x + 36, 14, Color.WHITE)

func _draw_card_animation(state: Dictionary, table_rect: Rect2) -> void:
	if draw_animation_progress >= 1.0 or animated_card.is_empty():
		return
	var players: Array = state.get("players", [])
	var target_index := -1
	for index in range(players.size()):
		if str(players[index].get("id", "")) == animated_player_id:
			target_index = index
			break
	if target_index < 0:
		return
	var start := table_rect.position + table_rect.size * 0.5 - CARD_SIZE * 0.5
	var target := _seat_center(table_rect, target_index, players.size()) - CARD_SIZE * 0.5
	var eased := ease(draw_animation_progress, -2.0)
	var rect := Rect2(start.lerp(target, eased), CARD_SIZE)
	_draw_card(rect, animated_card, true)

func _draw_card(rect: Rect2, card: Dictionary, face_up: bool) -> void:
	var kind := str(card.get("kind", "number"))
	var fill := CARD_FACE
	if kind == "modifier":
		fill = MODIFIER_FACE
	elif kind == "action":
		fill = ACTION_FACE
	if not face_up:
		fill = CARD_BACK
	draw_rect(rect, fill, true)
	draw_rect(rect, Color(0.05, 0.05, 0.05), false, 2.0)
	if not face_up:
		draw_rect(Rect2(rect.position + Vector2(8, 8), rect.size - Vector2(16, 16)), Color(0.28, 0.36, 0.52), false, 2.0)
		draw_string(get_theme_default_font(), rect.position + Vector2(0, rect.size.y * 0.65), "7", HORIZONTAL_ALIGNMENT_CENTER, rect.size.x, 28, Color.WHITE)
		return
	var value := str(card.get("label", card.get("value", "?")))
	var small_size := 13 if rect.size.x < 50.0 else 16
	var big_size := 18 if rect.size.x < 50.0 else 25
	draw_string(get_theme_default_font(), rect.position + Vector2(5, rect.size.y * 0.24), value, HORIZONTAL_ALIGNMENT_LEFT, rect.size.x - 10, small_size, CARD_INK)
	draw_string(get_theme_default_font(), rect.position + Vector2(2, rect.size.y * 0.65), value, HORIZONTAL_ALIGNMENT_CENTER, rect.size.x - 4, big_size, CARD_INK)

func _send_primary_action() -> void:
	var state: Dictionary = game.get("luckySeven", {})
	var turn_state := str(state.get("turnState", ""))
	if turn_state == "awaiting_dealer" and str(state.get("dealerId", "")) == NetworkManager.player_id:
		_send_action("dealer_deal" if str(state.get("pendingDecision", "")) == "hit" else "dealer_confirm_stay")
	elif turn_state == "awaiting_player" and str(state.get("activePlayerId", "")) == NetworkManager.player_id:
		_send_action("request_hit")

func _send_action(action: String) -> void:
	NetworkManager.send_lucky_seven_input(action)

func _render_ui() -> void:
	var state: Dictionary = game.get("luckySeven", {})
	title_label.text = "Lucky Seven  ·  Round %s" % state.get("round", 1)
	var turn_state := str(state.get("turnState", ""))
	var active_name := _player_name(str(state.get("activePlayerId", "")))
	var dealer_name := _player_name(str(state.get("dealerId", "")))
	status_label.text = "%s's turn  ·  %s is dealing" % [active_name, dealer_name]
	if turn_state == "awaiting_dealer":
		status_label.text = "%s is waiting for %s to confirm." % [active_name, dealer_name]
	elif turn_state == "round_summary":
		status_label.text = "Round complete"
	elif turn_state == "complete":
		status_label.text = "Game complete"

	var last_event: Dictionary = state.get("lastEvent", {})
	event_label.text = _friendly_event_message(str(last_event.get("message", "")))
	_update_event_animation(last_event)

	var is_active := str(state.get("activePlayerId", "")) == NetworkManager.player_id
	var is_dealer := str(state.get("dealerId", "")) == NetworkManager.player_id
	hit_button.visible = turn_state == "awaiting_player" and is_active
	stay_button.visible = turn_state == "awaiting_player" and is_active
	hit_button.disabled = not is_active
	stay_button.disabled = not is_active
	dealer_button.visible = turn_state == "awaiting_dealer" and is_dealer
	dealer_button.disabled = not is_dealer
	dealer_button.text = "Deal Card" if str(state.get("pendingDecision", "")) == "hit" else "Confirm Stay"

	discard_button.text = "Hide Discards" if discard_panel.visible else "Discards (%s)" % state.get("discardPile", []).size()
	discard_label.text = _discard_text(state)
	_render_summary(state, is_dealer)
	if str(state.get("status", "playing")) == "complete":
		_show_winner(str(game.get("winnerId", "")))
	_update_timer()
	queue_redraw()

func _update_event_animation(last_event: Dictionary) -> void:
	var sequence := int(last_event.get("sequence", -1))
	if sequence <= last_event_sequence:
		return
	last_event_sequence = sequence
	var event_type := str(last_event.get("type", ""))
	animated_player_id = str(last_event.get("playerId", ""))
	animated_card = last_event.get("card", {})
	if not animated_card.is_empty() and event_type in ["card_drawn", "bust", "second_chance", "freeze", "flip_three", "lucky_seven"]:
		if card_tween != null and card_tween.is_valid():
			card_tween.kill()
		draw_animation_progress = 0.0
		card_tween = create_tween()
		card_tween.tween_property(self, "draw_animation_progress", 1.0, 0.30).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	if event_type in ["bust", "freeze", "second_chance", "lucky_seven"]:
		flash_player_id = animated_player_id
		flash_strength = 1.0

func _discard_text(state: Dictionary) -> String:
	var counts: Dictionary = {}
	for card in state.get("discardPile", []):
		var label := str(card.get("label", card.get("value", "?")))
		counts[label] = int(counts.get(label, 0)) + 1
	var labels := counts.keys()
	labels.sort()
	var lines: Array[String] = ["DISCARD PILE", "", "Deck remaining: %s" % state.get("deckCount", 0), ""]
	if labels.is_empty():
		lines.append("No cards discarded yet.")
	else:
		for label in labels:
			lines.append("%s  × %s" % [label, counts[label]])
	return "\n".join(lines)

func _friendly_event_message(message: String) -> String:
	var friendly := message
	for player in NetworkManager.room.players:
		var player_id := str(player.get("id", ""))
		if player_id != "":
			friendly = friendly.replace(player_id, str(player.get("displayName", "Player")))
	return friendly

func _render_summary(state: Dictionary, is_dealer: bool) -> void:
	var was_visible := summary_panel.visible
	var show_summary := str(state.get("turnState", "")) == "round_summary"
	summary_panel.visible = show_summary
	if not show_summary:
		return
	summary_title.text = "Round %s" % state.get("round", 1)
	var lines: Array[String] = []
	for row in state.get("roundSummary", []):
		lines.append("%s   +%s   Total %s" % [
			_player_name(str(row.get("id", ""))),
			row.get("roundPoints", 0),
			row.get("totalScore", 0),
		])
	summary_label.text = "\n".join(lines)
	continue_button.visible = is_dealer
	continue_button.disabled = not is_dealer
	if not was_visible:
		_fade_in(summary_panel)

func _show_winner(winner_id: String) -> void:
	if winner_panel.visible:
		return
	var winner_name := _player_name(winner_id) if winner_id != "" else "No winner"
	winner_label.text = "%s wins!" % winner_name
	var state: Dictionary = game.get("luckySeven", {})
	var lines: Array[String] = []
	for row in state.get("finalResults", []):
		lines.append("%s.  %s  —  %s" % [
			row.get("rank", 0),
			_player_name(str(row.get("id", ""))),
			row.get("totalScore", 0),
		])
	winner_detail_label.text = "\n".join(lines)
	winner_panel.visible = true
	return_button.visible = NetworkManager.room.host_id == NetworkManager.player_id
	hit_button.disabled = true
	stay_button.disabled = true
	dealer_button.disabled = true
	_fade_in(winner_panel)

func _fade_in(control: Control) -> void:
	control.modulate.a = 0.0
	var tween := create_tween()
	tween.tween_property(control, "modulate:a", 1.0, 0.24)

func _toggle_discards() -> void:
	discard_panel.visible = not discard_panel.visible
	if discard_panel.visible:
		discard_panel.modulate.a = 0.0
		var tween := create_tween()
		tween.tween_property(discard_panel, "modulate:a", 1.0, 0.18)
	_render_ui()

func _update_timer() -> void:
	var ends_at := float(game.get("endsAt", 0))
	var remaining: float = max(0.0, (ends_at - Time.get_unix_time_from_system() * 1000.0) / 1000.0)
	timer_label.text = "%.0fs" % remaining

func _refresh_local_state() -> void:
	local_state = {}
	var state: Dictionary = game.get("luckySeven", {})
	for player in state.get("players", []):
		if str(player.get("id", "")) == NetworkManager.player_id:
			local_state = player
			return

func _player_name(id: String) -> String:
	if id == "":
		return "Table"
	for player in NetworkManager.room.players:
		if str(player.get("id", "")) == id:
			return str(player.get("displayName", "Player"))
	return "Player"

func _on_hit_pressed() -> void:
	_send_action("request_hit")

func _on_stay_pressed() -> void:
	_send_action("request_stay")

func _on_dealer_pressed() -> void:
	var state: Dictionary = game.get("luckySeven", {})
	_send_action("dealer_deal" if str(state.get("pendingDecision", "")) == "hit" else "dealer_confirm_stay")

func _on_continue_pressed() -> void:
	_send_action("continue")

func _on_game_state_changed(next_game: Dictionary) -> void:
	NetworkManager.room.game = next_game
	game = next_game
	_refresh_local_state()
	_render_ui()

func _on_game_over(next_game: Dictionary, winner_id: String) -> void:
	NetworkManager.room.game = next_game
	game = next_game
	_refresh_local_state()
	_render_ui()
	_show_winner(winner_id)

func _on_room_state_changed(room: RoomState, _player_id: String) -> void:
	if room.phase == "lobby":
		get_tree().change_scene_to_file("res://scenes/Lobby.tscn")
	else:
		game = room.game
		_refresh_local_state()
		_render_ui()
