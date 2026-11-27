class_name LastDanceRules
extends CrowdRules
## The finale: two finalists, one shot each, a dance floor that keeps shrinking.
## Everyone else watches as a ghost steering one of the guests.

const LENGTH_MS := 75000
const START_RADIUS := 620.0
const END_RADIUS := 110.0
const CENTER := {"x": 640.0, "y": 380.0}

var finalists: Array
## Picks the winner if nobody is hit (lower suspicion), given the finalists still standing.
var tiebreak: Callable


func _init(finalist_ids: Array, guests: int, pick_winner: Callable) -> void:
	mode = "last_dance"
	npc_count = guests
	can_run = false
	finalists = finalist_ids
	tiebreak = pick_winner


func _is_finalist(role: String) -> bool:
	return role == "runner"


func assign_roles(player_ids: Array, _random: CrowdRandom) -> Dictionary:
	var roles := {}
	for id in player_ids:
		roles[id] = "runner" if finalists.has(id) else "backer"
	return roles


func shots_for(role: String) -> int:
	return 1 if _is_finalist(role) else 0


func in_crowd(role: String) -> bool:
	return _is_finalist(role)


func spawn_point(random: CrowdRandom, _area: Dictionary) -> Dictionary:
	return CrowdMovement.vec(
		CrowdMovement.js_round(CENTER.x + (random.next() * 2 - 1) * 380),
		CrowdMovement.js_round(CENTER.y + (random.next() * 2 - 1) * 220),
	)


func zone(crowd: CrowdMatch) -> Dictionary:
	var t := minf(1.0, (crowd.tick * CrowdMovement.TICK_MS) / float(LENGTH_MS - 5000))
	return {"x": CENTER.x, "y": CENTER.y, "r": CrowdMovement.js_round(START_RADIUS - (START_RADIUS - END_RADIUS) * t)}


func on_start(crowd: CrowdMatch) -> void:
	for slot: CrowdSlot in crowd.slots.values():
		if slot.role == "backer":
			crowd.make_ghost(slot)


func npc_plan(entity: CrowdEntity, random: CrowdRandom, area: Dictionary, crowd: CrowdMatch) -> Dictionary:
	var lit := zone(crowd)
	if CrowdMovement.distance(entity.x, entity.y, lit.x, lit.y) > lit.r * 0.7 and random.next() < 0.75:
		return plan(dir(lit.x - entity.x, lit.y - entity.y), 900)
	return wander(entity, random, area)


func on_shot_hit(crowd: CrowdMatch, shooter: CrowdSlot, target: CrowdEntity) -> void:
	crowd.kill(target)
	var hit := crowd.slot_for_entity(target)
	if hit != null and _is_finalist(hit.role):
		crowd.end(result("player", shooter.player_id))


func on_tick(crowd: CrowdMatch) -> void:
	var left := crowd.slots.values().filter(func(slot: CrowdSlot) -> bool: return _is_finalist(slot.role) and slot.connected and not slot.entity.dead)
	if left.size() == 1:
		crowd.end(result("player", left[0].player_id))
	elif left.is_empty():
		crowd.end(result("none"))


func on_timeout(crowd: CrowdMatch) -> Dictionary:
	var left := []
	for slot: CrowdSlot in crowd.slots.values():
		if _is_finalist(slot.role) and not slot.entity.dead:
			left.append(slot.player_id)
	var winner: String = left[0] if left.size() == 1 else tiebreak.call(left)
	return result("player", winner) if winner != "" else result("none")
