extends Node

signal room_state_changed(room: RoomState, player_id: String)
signal game_state_changed(game: Dictionary)
signal game_over(game: Dictionary, winner_id: String)
signal connection_error(message: String)

const DEFAULT_SERVER_URL := "ws://localhost:8787"

var socket := WebSocketPeer.new()
var server_url := DEFAULT_SERVER_URL
var room := RoomState.new()
var player_id := ""
var connected := false

func _ready() -> void:
	_apply_runtime_server_url()

func _process(_delta: float) -> void:
	socket.poll()
	var state := socket.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		connected = true
		while socket.get_available_packet_count() > 0:
			_handle_packet(socket.get_packet().get_string_from_utf8())
	elif connected and state == WebSocketPeer.STATE_CLOSED:
		connected = false
		connection_error.emit("Disconnected from server.")

func connect_to_server(url := DEFAULT_SERVER_URL) -> void:
	server_url = _configured_server_url(url)
	var error := socket.connect_to_url(server_url)
	if error != OK:
		connection_error.emit("Could not connect to %s" % server_url)

func create_room(display_name: String) -> void:
	_send({"type": "CREATE_ROOM", "displayName": display_name})

func join_room(room_code: String, display_name: String) -> void:
	_send({"type": "JOIN_ROOM", "roomCode": room_code, "displayName": display_name})

func set_ready(is_ready: bool) -> void:
	_send({"type": "PLAYER_READY", "isReady": is_ready})

func start_game(minigame_id := "") -> void:
	var selected := minigame_id if minigame_id != "" else room.selected_minigame_id
	_send({"type": "START_GAME", "minigameId": selected})

func send_press() -> void:
	_send({"type": "PLAYER_INPUT", "input": "PRESS"})

func send_act_natural_input(movement: Vector2, aim: Vector2, shoot: bool, run: bool, target_point = null) -> void:
	var input := {
		"movement": {"x": movement.x, "y": movement.y},
		"aim": {"x": aim.x, "y": aim.y},
		"shoot": shoot,
		"run": run
	}
	if target_point != null:
		input["targetPoint"] = {"x": target_point.x, "y": target_point.y}
	_send({
		"type": "PLAYER_INPUT",
		"input": input
	})

func send_loot_and_leave_input(movement: Vector2, sequence: int) -> void:
	_send({
		"type": "PLAYER_INPUT",
		"input": {
			"movement": {"x": movement.x, "y": movement.y},
			"sequence": sequence
		}
	})

func return_to_lobby() -> void:
	_send({"type": "RETURN_TO_LOBBY"})

func _send(message: Dictionary) -> void:
	if socket.get_ready_state() != WebSocketPeer.STATE_OPEN:
		connect_to_server(server_url)
		await get_tree().create_timer(0.2).timeout
	socket.send_text(JSON.stringify(message))

func _configured_server_url(requested_url: String) -> String:
	if requested_url != DEFAULT_SERVER_URL:
		return requested_url
	return server_url

func _apply_runtime_server_url() -> void:
	var env_url := OS.get_environment("CHATIMBORED_SERVER_URL").strip_edges()
	if env_url != "":
		server_url = env_url
		return

	if not OS.has_feature("web"):
		return

	var script := """
	(function () {
		const params = new URLSearchParams(window.location.search);
		const fromQuery = params.get("server");
		if (fromQuery) {
			window.localStorage.setItem("CHATIMBORED_SERVER_URL", fromQuery);
			return fromQuery;
		}
		return window.CHATIMBORED_SERVER_URL || window.localStorage.getItem("CHATIMBORED_SERVER_URL") || "";
	})()
	"""
	var web_url: Variant = JavaScriptBridge.eval(script)
	if typeof(web_url) == TYPE_STRING and str(web_url).strip_edges() != "":
		server_url = str(web_url).strip_edges()

func _handle_packet(text: String) -> void:
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		connection_error.emit("Received malformed server message.")
		return

	match parsed.get("type", ""):
		"ROOM_STATE":
			player_id = parsed.get("playerId", player_id)
			room.apply_snapshot(parsed.get("room", {}))
			room_state_changed.emit(room, player_id)
		"GAME_STATE":
			game_state_changed.emit(parsed.get("game", {}))
		"GAME_OVER":
			game_over.emit(parsed.get("game", {}), parsed.get("winnerId", ""))
		"ERROR":
			connection_error.emit(parsed.get("message", "Unknown server error."))
