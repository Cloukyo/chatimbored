extends Control

const BG := Color(0.07, 0.11, 0.10)
const TABLE := Color(0.11, 0.32, 0.23)
const TABLE_EDGE := Color(0.75, 0.58, 0.30)
const CARD_FACE := Color(0.96, 0.92, 0.84)
const CARD_BACK := Color(0.18, 0.25, 0.38)
const CARD_INK := Color(0.11, 0.10, 0.08)
const ACCENT := Color(0.98, 0.78, 0.28)
const DANGER := Color(0.92, 0.28, 0.18)
const MUTED := Color(0.68, 0.72, 0.68)
const CARD_SIZE := Vector2(78, 108)

var game: Dictionary = {}
var local_state: Dictionary = {}
var title_label: Label
var timer_label: Label
var status_label: Label
var controls_label: Label
var event_label: Label
var hit_button: Button
var stay_button: Button
var winner_panel: PanelContainer
var winner_label: Label
var winner_detail_label: Label
var return_button: Button

func _ready() -> void:
	NetworkManager.room_state_changed.connect(_on_room_state_changed)
	NetworkManager.game_state_changed.connect(_on_game_state_changed)
	NetworkManager.game_over.connect(_on_game_over)
	_build_ui()
	game = NetworkManager.room.game
	_refresh_local_state()
	_render_ui()
	queue_redraw()

func _process(_delta: float) -> void:
	_update_timer()

func _input(event: InputEvent) -> void:
	if winner_panel.visible:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_SPACE or event.keycode == KEY_ENTER or event.keycode == KEY_KP_ENTER:
			_send_action("hit")
		elif event.keycode == KEY_S or event.keycode == KEY_ESCAPE:
			_send_action("stay")
	if event is InputEventJoypadButton and event.pressed:
		if event.button_index == JOY_BUTTON_A:
			_send_action("hit")
		elif event.button_index == JOY_BUTTON_B:
			_send_action("stay")

func _build_ui() -> void:
	title_label = Label.new()
	title_label.offset_left = 24
	title_label.offset_top = 14
	title_label.add_theme_font_size_override("font_size", 32)
	add_child(title_label)

	timer_label = Label.new()
	timer_label.offset_left = 24
	timer_label.offset_top = 52
	timer_label.add_theme_font_size_override("font_size", 18)
	add_child(timer_label)

	status_label = Label.new()
	status_label.offset_left = 24
	status_label.offset_top = 78
	status_label.add_theme_font_size_override("font_size", 18)
	add_child(status_label)

	event_label = Label.new()
	event_label.offset_left = 24
	event_label.offset_top = 106
	event_label.add_theme_font_size_override("font_size", 18)
	event_label.add_theme_color_override("font_color", ACCENT)
	add_child(event_label)

	controls_label = Label.new()
	controls_label.offset_left = 24
	controls_label.offset_top = 134
	controls_label.add_theme_font_size_override("font_size", 15)
	add_child(controls_label)

	var actions := HBoxContainer.new()
	actions.anchor_left = 0.5
	actions.anchor_right = 0.5
	actions.anchor_top = 1.0
	actions.anchor_bottom = 1.0
	actions.offset_left = -190
	actions.offset_right = 190
	actions.offset_top = -82
	actions.offset_bottom = -24
	actions.add_theme_constant_override("separation", 12)
	add_child(actions)

	hit_button = Button.new()
	hit_button.text = "Hit"
	hit_button.custom_minimum_size = Vector2(184, 54)
	hit_button.pressed.connect(_on_hit_pressed)
	actions.add_child(hit_button)

	stay_button = Button.new()
	stay_button.text = "Stay"
	stay_button.custom_minimum_size = Vector2(184, 54)
	stay_button.pressed.connect(_on_stay_pressed)
	actions.add_child(stay_button)

	winner_panel = PanelContainer.new()
	winner_panel.visible = false
	winner_panel.anchor_left = 0.5
	winner_panel.anchor_top = 0.5
	winner_panel.anchor_right = 0.5
	winner_panel.anchor_bottom = 0.5
	winner_panel.offset_left = -230
	winner_panel.offset_top = -120
	winner_panel.offset_right = 230
	winner_panel.offset_bottom = 120
	add_child(winner_panel)

	var winner_box := VBoxContainer.new()
	winner_box.add_theme_constant_override("separation", 12)
	winner_panel.add_child(winner_box)

	winner_label = Label.new()
	winner_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	winner_label.add_theme_font_size_override("font_size", 32)
	winner_box.add_child(winner_label)

	winner_detail_label = Label.new()
	winner_detail_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	winner_detail_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	winner_box.add_child(winner_detail_label)

	return_button = Button.new()
	return_button.text = "Return to Lobby"
	return_button.visible = false
	return_button.pressed.connect(NetworkManager.return_to_lobby)
	winner_box.add_child(return_button)

func _draw() -> void:
	var state: Dictionary = game.get("luckySeven", {})
	if state.is_empty():
		return

	draw_rect(Rect2(Vector2.ZERO, size), BG, true)
	var table_rect := Rect2(Vector2(28, 184), Vector2(max(1.0, size.x - 56), max(1.0, size.y - 290)))
	draw_rect(table_rect, TABLE, true)
	draw_rect(table_rect, TABLE_EDGE, false, 3.0)

	_draw_score_rows(state)
	_draw_local_hand(state)
	_draw_deck(state)

func _draw_score_rows(state: Dictionary) -> void:
	var players: Array = state.get("players", [])
	var start := Vector2(size.x - 300, 24)
	draw_string(get_theme_default_font(), start, "Players", HORIZONTAL_ALIGNMENT_LEFT, 260, 18, Color.WHITE)
	for index in range(players.size()):
		var player: Dictionary = players[index]
		var row_y := start.y + 32 + index * 32
		var id := str(player.get("id", ""))
		var name := _player_name(id)
		var marker := "You" if id == NetworkManager.player_id else ""
		var state_text := str(player.get("roundState", "playing"))
		var color := Color.WHITE
		if state_text == "busted":
			color = DANGER
		elif state_text == "stayed":
			color = MUTED
		draw_string(get_theme_default_font(), Vector2(start.x, row_y), "%s %s" % [name, marker], HORIZONTAL_ALIGNMENT_LEFT, 150, 15, color)
		draw_string(get_theme_default_font(), Vector2(start.x + 155, row_y), "%s" % player.get("totalScore", 0), HORIZONTAL_ALIGNMENT_RIGHT, 48, 15, color)
		draw_string(get_theme_default_font(), Vector2(start.x + 212, row_y), state_text, HORIZONTAL_ALIGNMENT_LEFT, 78, 15, color)

func _draw_local_hand(state: Dictionary) -> void:
	var cards: Array = local_state.get("cards", [])
	var total_width: float = max(CARD_SIZE.x, float(cards.size() * 52) + CARD_SIZE.x - 52.0)
	var origin := Vector2((size.x - total_width) * 0.5, size.y - 238)
	for index in range(cards.size()):
		_draw_card(Rect2(origin + Vector2(index * 52, 0), CARD_SIZE), cards[index], true)

	if cards.is_empty():
		draw_string(get_theme_default_font(), Vector2(origin.x, origin.y + 54), "Hit to draw your first card.", HORIZONTAL_ALIGNMENT_CENTER, total_width, 18, Color(0.88, 0.91, 0.84))

	var round_score := int(local_state.get("roundScore", 0))
	var total_score := int(local_state.get("totalScore", 0))
	var label := "Round %s: %s   Banked: %s   Target: %s" % [state.get("round", 1), round_score, total_score, state.get("targetScore", 200)]
	draw_string(get_theme_default_font(), Vector2(36, size.y - 112), label, HORIZONTAL_ALIGNMENT_LEFT, size.x - 72, 22, Color.WHITE)

func _draw_deck(state: Dictionary) -> void:
	var rect := Rect2(Vector2(62, 226), CARD_SIZE)
	_draw_card(rect, {}, false)
	draw_string(get_theme_default_font(), rect.position + Vector2(-10, CARD_SIZE.y + 24), "Deck: %s" % state.get("deckCount", 0), HORIZONTAL_ALIGNMENT_CENTER, CARD_SIZE.x + 20, 16, Color.WHITE)

func _draw_card(rect: Rect2, card: Dictionary, face_up: bool) -> void:
	draw_rect(rect, CARD_FACE if face_up else CARD_BACK, true)
	draw_rect(rect, Color(0.05, 0.05, 0.05), false, 2.0)
	if not face_up:
		draw_rect(Rect2(rect.position + Vector2(10, 10), rect.size - Vector2(20, 20)), Color(0.28, 0.36, 0.52), false, 2.0)
		draw_string(get_theme_default_font(), rect.position + Vector2(0, 62), "?", HORIZONTAL_ALIGNMENT_CENTER, rect.size.x, 32, Color.WHITE)
		return
	var value := str(card.get("value", "?"))
	draw_string(get_theme_default_font(), rect.position + Vector2(8, 26), value, HORIZONTAL_ALIGNMENT_LEFT, rect.size.x - 16, 22, CARD_INK)
	draw_string(get_theme_default_font(), rect.position + Vector2(0, 70), value, HORIZONTAL_ALIGNMENT_CENTER, rect.size.x, 34, CARD_INK)

func _send_action(action: String) -> void:
	if local_state.is_empty() or str(local_state.get("roundState", "")) != "playing":
		return
	NetworkManager.send_lucky_seven_input(action)

func _render_ui() -> void:
	var state: Dictionary = game.get("luckySeven", {})
	title_label.text = "Lucky Seven"
	controls_label.text = "Space / Enter / A: Hit    S / Esc / B: Stay"
	var round_state := str(local_state.get("roundState", "playing"))
	status_label.text = "Shot-call: draw without repeating a number, or stay and bank."
	if round_state == "busted":
		status_label.text = "Busted for this round."
	elif round_state == "stayed":
		status_label.text = "Stayed. Waiting for the table."
	var last_event: Dictionary = state.get("lastEvent", {})
	event_label.text = str(last_event.get("message", ""))
	var can_act := round_state == "playing" and str(state.get("status", "playing")) == "playing"
	hit_button.disabled = not can_act
	stay_button.disabled = not can_act
	_update_timer()
	queue_redraw()

func _update_timer() -> void:
	var ends_at := float(game.get("endsAt", 0))
	var remaining: float = max(0.0, (ends_at - Time.get_unix_time_from_system() * 1000.0) / 1000.0)
	timer_label.text = "%.0fs" % remaining

func _refresh_local_state() -> void:
	var state: Dictionary = game.get("luckySeven", {})
	for player in state.get("players", []):
		if player.get("id", "") == NetworkManager.player_id:
			local_state = player
			return
	local_state = {}

func _player_name(id: String) -> String:
	for player in NetworkManager.room.players:
		if player.get("id", "") == id:
			return str(player.get("displayName", "Player"))
	return "Player"

func _show_winner(winner_id: String) -> void:
	var winner_name := "No winner"
	if winner_id != "":
		winner_name = _player_name(winner_id)
	winner_label.text = "%s wins!" % winner_name
	winner_detail_label.text = "Final scores are shown on the table."
	winner_panel.visible = true
	return_button.visible = NetworkManager.room.host_id == NetworkManager.player_id
	hit_button.disabled = true
	stay_button.disabled = true

func _on_hit_pressed() -> void:
	_send_action("hit")

func _on_stay_pressed() -> void:
	_send_action("stay")

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
