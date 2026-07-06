extends Control

var players_box: VBoxContainer
var room_label: Label
var minigame_label: Label
var status_label: Label
var ready_button: Button
var start_button: Button
var minigame_selector: OptionButton

func _ready() -> void:
	NetworkManager.room_state_changed.connect(_on_room_state_changed)
	NetworkManager.connection_error.connect(_on_connection_error)
	_build_ui()
	_render()

func _build_ui() -> void:
	var root := VBoxContainer.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.offset_left = 56
	root.offset_top = 42
	root.offset_right = -56
	root.offset_bottom = -42
	root.add_theme_constant_override("separation", 12)
	add_child(root)

	room_label = Label.new()
	room_label.add_theme_font_size_override("font_size", 34)
	root.add_child(room_label)

	var share_label := Label.new()
	share_label.text = "Share link placeholder: copy the room code into chat for now."
	root.add_child(share_label)

	minigame_label = Label.new()
	root.add_child(minigame_label)

	minigame_selector = OptionButton.new()
	minigame_selector.add_item("Button Race")
	minigame_selector.set_item_metadata(0, "button_race")
	minigame_selector.add_item("Act Natural")
	minigame_selector.set_item_metadata(1, "act_natural")
	minigame_selector.add_item("Loot & Leave")
	minigame_selector.set_item_metadata(2, "loot_and_leave")
	minigame_selector.add_item("Silent Witness")
	minigame_selector.set_item_metadata(3, "silent_witness")
	root.add_child(minigame_selector)

	players_box = VBoxContainer.new()
	players_box.add_theme_constant_override("separation", 8)
	root.add_child(players_box)

	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 10)
	root.add_child(actions)

	ready_button = Button.new()
	ready_button.pressed.connect(_on_ready_pressed)
	actions.add_child(ready_button)

	start_button = Button.new()
	start_button.text = "Start Minigame"
	start_button.pressed.connect(_on_start_pressed)
	actions.add_child(start_button)

	status_label = Label.new()
	root.add_child(status_label)

func _render() -> void:
	var room := NetworkManager.room
	room_label.text = "Room %s" % room.code
	minigame_label.text = "Selected minigame: %s" % minigame_selector.get_item_text(minigame_selector.selected)

	for child in players_box.get_children():
		child.queue_free()

	for player in room.players:
		var row := Label.new()
		var host := "Host" if player.get("isHost", false) else "Player"
		var ready := "Ready" if player.get("isReady", false) else "Not ready"
		row.text = "%s - %s - %s" % [player.get("displayName", "Unknown"), host, ready]
		players_box.add_child(row)

	var local := room.local_player(NetworkManager.player_id)
	ready_button.text = "Unready" if local.get("isReady", false) else "Ready"
	start_button.disabled = not _can_local_host_start()

	if room.phase == "in_game":
		var game_id: String = str(room.game.get("minigameId", room.selected_minigame_id))
		if game_id == "act_natural":
			get_tree().change_scene_to_file("res://scenes/ActNatural.tscn")
		elif game_id == "loot_and_leave":
			get_tree().change_scene_to_file("res://scenes/LootAndLeave.tscn")
		elif game_id == "silent_witness":
			get_tree().change_scene_to_file("res://scenes/SilentWitness.tscn")
		else:
			get_tree().change_scene_to_file("res://scenes/GameScreen.tscn")

func _can_local_host_start() -> bool:
	var room := NetworkManager.room
	if room.host_id != NetworkManager.player_id or room.players.size() < 2:
		return false
	for player in room.players:
		if not player.get("isHost", false) and not player.get("isReady", false):
			return false
	return true

func _on_ready_pressed() -> void:
	var local := NetworkManager.room.local_player(NetworkManager.player_id)
	NetworkManager.set_ready(not local.get("isReady", false))

func _on_start_pressed() -> void:
	NetworkManager.start_game(str(minigame_selector.get_selected_metadata()))

func _on_room_state_changed(_room: RoomState, _player_id: String) -> void:
	_render()

func _on_connection_error(message: String) -> void:
	status_label.text = message
