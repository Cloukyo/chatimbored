class_name CrowdSlot
extends RefCounted
## A player's seat in a round: their figure, role, ammo and private progress.

var player_id: String
var entity: CrowdEntity
var role: String
var shots := 0
var act_cooldown_ms := 0
## Props this player has used, e.g. lanterns they lit. Used as an ordered set.
var mine: Dictionary = {}
var queue: Array = []
var last_direction: Dictionary = {"x": 0.0, "y": 0.0}
var last_run := false
var ack := 0
var connected := true
## Lost their connection for now: their figure wanders like the crowd until they're back.
var away := false
## Other players this player took down with a shot or a strike, for scoring across rounds.
var takedowns: Array[String] = []
var shots_fired := 0
## Shots that didn't take down another player.
var wasted_shots := 0
## Party Night: once down, a player can steer one NPC around as a ghost.
var ghost: CrowdEntity = null
## Shots other players wasted on this player's ghost.
var baits := 0
