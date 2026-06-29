class_name RoomState
extends RefCounted

var code := ""
var phase := "lobby"
var host_id := ""
var selected_minigame_id := "button_race"
var players: Array = []
var game := {}

func apply_snapshot(snapshot: Dictionary) -> void:
	code = snapshot.get("code", "")
	phase = snapshot.get("phase", "lobby")
	host_id = snapshot.get("hostId", "")
	selected_minigame_id = snapshot.get("selectedMinigameId", "button_race")
	players = snapshot.get("players", [])
	game = snapshot.get("game", {})

func local_player(player_id: String) -> Dictionary:
	for player in players:
		if player.get("id", "") == player_id:
			return player
	return {}
