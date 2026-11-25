class_name NightContract
extends RefCounted
## One player's side mission for one room, checked from what their figure does.

const STILL_TICKS := 5000 / CrowdMovement.TICK_MS
const MOVING_TICKS := 12000 / CrowdMovement.TICK_MS
const BODY_RANGE := 90.0
const CENTRE_RANGE := 170.0

## In the server's order, which the shuffle that deals them depends on.
const TEXTS := {
	"still": "Stand perfectly still for 5 seconds in a row.",
	"quarters": "Set foot in all four quarters of the room.",
	"body": "Be close by when someone drops.",
	"moving": "Keep walking for 12 seconds without stopping.",
	"centre": "Finish the round near the middle of the room.",
}

var key: String
var done := false
var _streak := 0
var _quarters := {}


func _init(contract_key: String) -> void:
	key = contract_key


var text: String:
	get:
		return TEXTS[key]


func tick(crowd: CrowdMatch, slot: CrowdSlot) -> void:
	var entity := slot.entity
	if done or entity.dead or entity.hidden:
		return
	var moving := not CrowdMovement.is_still(entity.direction)
	if key == "still":
		_streak = 0 if moving else _streak + 1
		if _streak >= STILL_TICKS:
			done = true
	elif key == "moving":
		_streak = _streak + 1 if moving else 0
		if _streak >= MOVING_TICKS:
			done = true
	elif key == "quarters":
		_quarters[(0 if entity.x < crowd.arena.width / 2 else 1) + (0 if entity.y < crowd.arena.height / 2 else 2)] = true
		if _quarters.size() == 4:
			done = true


func death(slot: CrowdSlot, at: CrowdEntity) -> void:
	var entity := slot.entity
	if done or key != "body" or entity.dead or entity.hidden:
		return
	if CrowdMovement.distance(entity.x, entity.y, at.x, at.y) <= BODY_RANGE:
		done = true


func finish(crowd: CrowdMatch, slot: CrowdSlot) -> void:
	var entity := slot.entity
	if done or key != "centre" or entity.dead or entity.hidden:
		return
	if CrowdMovement.distance(entity.x, entity.y, crowd.arena.width / 2, crowd.arena.height / 2) <= CENTRE_RANGE:
		done = true
