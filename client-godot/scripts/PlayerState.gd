class_name PlayerState
extends RefCounted

var id := ""
var display_name := ""
var is_host := false
var is_ready := false
var score := 0

func apply_snapshot(snapshot: Dictionary) -> void:
	id = snapshot.get("id", "")
	display_name = snapshot.get("displayName", "")
	is_host = snapshot.get("isHost", false)
	is_ready = snapshot.get("isReady", false)
	score = snapshot.get("score", 0)
