class_name ClosingTimeRules
extends CrowdRules
## Closing Time: the lights go out from the edges of the plaza inward. Linger in the dark and you're
## caught; the crowd drifts in with you. Strike anyone close to thin out the competition.

const START_RADIUS := 760.0
const END_RADIUS := 130.0
const SHRINK_FROM_MS := 8000.0
const SHRINK_FOR_MS := 72000.0
const DARK_LIMIT_MS := 2500
const STRIKE_COOLDOWN_MS := 1500

## {center, dark_ms: player -> ms}, made the first time anything asks.
var _state := {}


func _init() -> void:
	mode = "closing_time"
	npc_count = 46
	can_run = true


func state(crowd: CrowdMatch) -> Dictionary:
	if _state.is_empty():
		var center := CrowdMovement.vec(
			CrowdMovement.js_round(crowd.arena.width / 2 + (crowd.random.next() * 2 - 1) * 200),
			CrowdMovement.js_round(crowd.arena.height / 2 + (crowd.random.next() * 2 - 1) * 110),
		)
		_state = {"center": center, "dark_ms": {}}
	return _state


func zone(crowd: CrowdMatch) -> Dictionary:
	var center: Dictionary = state(crowd).center
	var t := clampf((crowd.tick * CrowdMovement.TICK_MS - SHRINK_FROM_MS) / SHRINK_FOR_MS, 0.0, 1.0)
	return {"x": center.x, "y": center.y, "r": CrowdMovement.js_round(START_RADIUS - (START_RADIUS - END_RADIUS) * t)}


func npc_plan(entity: CrowdEntity, random: CrowdRandom, area: Dictionary, crowd: CrowdMatch) -> Dictionary:
	var lit := zone(crowd)
	var distance := CrowdMovement.distance(entity.x, entity.y, lit.x, lit.y)
	# Stay comfortably inside the light, like anyone sensible would.
	if distance > lit.r * 0.75 and random.next() < 0.7:
		return plan(dir(lit.x - entity.x, lit.y - entity.y), random.between(500, 1400))
	return wander(entity, random, area)


func can_act(_crowd: CrowdMatch, _slot: CrowdSlot) -> bool:
	return true


func on_act(crowd: CrowdMatch, slot: CrowdSlot) -> void:
	if strike_nearest(crowd, slot) != null:
		slot.act_cooldown_ms = STRIKE_COOLDOWN_MS


func on_tick(crowd: CrowdMatch) -> void:
	var lit := zone(crowd)
	var dark: Dictionary = state(crowd).dark_ms
	for slot: CrowdSlot in active_slots(crowd):
		var outside: bool = CrowdMovement.distance(slot.entity.x, slot.entity.y, lit.x, lit.y) > lit.r
		var dark_ms: int = dark.get(slot.player_id, 0) + CrowdMovement.TICK_MS if outside else 0
		dark[slot.player_id] = dark_ms
		if dark_ms >= DARK_LIMIT_MS:
			crowd.kill(slot.entity, "sick")
	last_one_standing(crowd)


func on_timeout(crowd: CrowdMatch) -> Dictionary:
	return most_progress(crowd, func(_slot: CrowdSlot) -> int: return 1)


func hud(crowd: CrowdMatch, slot: CrowdSlot) -> Dictionary:
	return {"darkMs": state(crowd).dark_ms.get(slot.player_id, 0), "darkLimitMs": DARK_LIMIT_MS}
