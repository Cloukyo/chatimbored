extends Control

var name_input: LineEdit
var code_input: LineEdit
var status_label: Label

func _ready() -> void:
	NetworkManager.room_state_changed.connect(_on_room_state_changed)
	NetworkManager.connection_error.connect(_on_connection_error)
	NetworkManager.connect_to_server()
	_build_ui()

func _build_ui() -> void:
	var root := VBoxContainer.new()
	root.anchor_left = 0.5
	root.anchor_top = 0.5
	root.anchor_right = 0.5
	root.anchor_bottom = 0.5
	root.offset_left = -220
	root.offset_top = -180
	root.offset_right = 220
	root.offset_bottom = 180
	root.add_theme_constant_override("separation", 14)
	add_child(root)

	var title := Label.new()
	title.text = "chatImbored"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 42)
	root.add_child(title)

	var subtitle := Label.new()
	subtitle.text = "Create a room, share the code, play quick browser party games."
	subtitle.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(subtitle)

	name_input = LineEdit.new()
	name_input.placeholder_text = "Display name"
	root.add_child(name_input)

	var create_button := Button.new()
	create_button.text = "Create Room"
	create_button.pressed.connect(_on_create_pressed)
	root.add_child(create_button)

	code_input = LineEdit.new()
	code_input.placeholder_text = "Room code"
	code_input.max_length = 5
	root.add_child(code_input)

	var join_button := Button.new()
	join_button.text = "Join Room"
	join_button.pressed.connect(_on_join_pressed)
	root.add_child(join_button)

	status_label = Label.new()
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	root.add_child(status_label)

func _on_create_pressed() -> void:
	if _display_name() == "":
		status_label.text = "Enter a display name first."
		return
	NetworkManager.create_room(_display_name())

func _on_join_pressed() -> void:
	if _display_name() == "" or code_input.text.strip_edges() == "":
		status_label.text = "Enter a display name and room code."
		return
	NetworkManager.join_room(code_input.text.strip_edges().to_upper(), _display_name())

func _display_name() -> String:
	return name_input.text.strip_edges()

func _on_room_state_changed(_room: RoomState, _player_id: String) -> void:
	get_tree().change_scene_to_file("res://scenes/Lobby.tscn")

func _on_connection_error(message: String) -> void:
	status_label.text = message
