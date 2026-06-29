extends Control

var title: Label
var timer_label: Label
var scores_box: VBoxContainer
var action_button: Button
var result_label: Label
var return_button: Button

func _ready() -> void:
	NetworkManager.room_state_changed.connect(_on_room_state_changed)
	NetworkManager.game_state_changed.connect(_on_game_state_changed)
	NetworkManager.game_over.connect(_on_game_over)
	_build_ui()
	_render_game(NetworkManager.room.game)

func _process(_delta: float) -> void:
	var ends_at = NetworkManager.room.game.get("endsAt", 0)
	if ends_at > 0:
		var remaining := max(0.0, (float(ends_at) - Time.get_unix_time_from_system() * 1000.0) / 1000.0)
		timer_label.text = "%.1fs" % remaining

func _build_ui() -> void:
	var root := VBoxContainer.new()
	root.anchor_left = 0.5
	root.anchor_top = 0.5
	root.anchor_right = 0.5
	root.anchor_bottom = 0.5
	root.offset_left = -240
	root.offset_top = -220
	root.offset_right = 240
	root.offset_bottom = 220
	root.add_theme_constant_override("separation", 16)
	add_child(root)

	title = Label.new()
	title.text = "Button Race"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 38)
	root.add_child(title)

	timer_label = Label.new()
	timer_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	timer_label.add_theme_font_size_override("font_size", 28)
	root.add_child(timer_label)

	action_button = Button.new()
	action_button.text = "PRESS"
	action_button.custom_minimum_size = Vector2(320, 96)
	action_button.pressed.connect(NetworkManager.send_press)
	root.add_child(action_button)

	scores_box = VBoxContainer.new()
	root.add_child(scores_box)

	result_label = Label.new()
	result_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	result_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	root.add_child(result_label)

	return_button = Button.new()
	return_button.text = "Return to Lobby"
	return_button.visible = false
	return_button.pressed.connect(NetworkManager.return_to_lobby)
	root.add_child(return_button)

func _render_game(game: Dictionary) -> void:
	for child in scores_box.get_children():
		child.queue_free()

	var scores: Dictionary = game.get("scores", {})
	for player in NetworkManager.room.players:
		var row := Label.new()
		row.text = "%s: %s" % [player.get("displayName", "Unknown"), scores.get(player.get("id", ""), 0)]
		scores_box.add_child(row)

func _on_game_state_changed(game: Dictionary) -> void:
	NetworkManager.room.game = game
	_render_game(game)

func _on_game_over(game: Dictionary, winner_id: String) -> void:
	NetworkManager.room.game = game
	action_button.disabled = true
	return_button.visible = NetworkManager.room.host_id == NetworkManager.player_id
	var winner_name := "No winner"
	for player in NetworkManager.room.players:
		if player.get("id", "") == winner_id:
			winner_name = player.get("displayName", "Winner")
	result_label.text = "%s wins!" % winner_name
	_render_game(game)

func _on_room_state_changed(room: RoomState, _player_id: String) -> void:
	if room.phase == "lobby":
		get_tree().change_scene_to_file("res://scenes/Lobby.tscn")
	else:
		_render_game(room.game)
