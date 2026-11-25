class_name ActNaturalRules
extends CrowdRules
## Act Natural: everyone starts in a crowd drifting right. First player through the exit wins;
## each player has one shot to stop someone they think is a rival.

const EXIT_X := 1180.0


func _init() -> void:
	mode = "act_natural"
	arena = {"width": 1280.0, "height": 720.0, "exitX": EXIT_X}
	npc_count = 44
	can_run = true


func shots_for(_role: String) -> int:
	return 1


func spawn_point(random: CrowdRandom, area: Dictionary) -> Dictionary:
	return CrowdMovement.vec(CrowdMovement.js_round(40 + random.next() * 300), CrowdMovement.js_round(60 + random.next() * (area.height - 100)))


func npc_plan(entity: CrowdEntity, random: CrowdRandom, _area: Dictionary, _crowd: CrowdMatch) -> Dictionary:
	if random.next() < 0.4:
		return plan(CrowdMovement.vec(0, 0), random.between(600, 2600))
	# Near the exit the crowd mills about instead of walking through it.
	if entity.x > EXIT_X - 120:
		var milling = random.pick_weighted([[dir(0, -1), 3], [dir(0, 1), 3], [dir(-1, 0), 2], [dir(-1, -1), 1], [dir(-1, 1), 1]])
		return plan(away_from_edges(entity, milling, arena), random.between(500, 1200))
	# Tuned so the crowd drifts right at roughly 12 px/s and reaches the exit late in the round.
	var drift = random.pick_weighted([
		[dir(1, 0), 4], [dir(1, -1), 2], [dir(1, 1), 2], [dir(0, -1), 3], [dir(0, 1), 3], [dir(-1, 0), 1.4], [dir(-1, -1), 0.5], [dir(-1, 1), 0.5],
	])
	return plan(away_from_edges(entity, drift, arena), random.between(700, 2600))


func on_shot_hit(crowd: CrowdMatch, _shooter: CrowdSlot, target: CrowdEntity) -> void:
	crowd.kill(target)


func on_tick(crowd: CrowdMatch) -> void:
	for slot: CrowdSlot in active_slots(crowd):
		if slot.entity.x >= EXIT_X:
			crowd.emit({"type": "escaped", "entity": slot.entity.id})
			crowd.end(result("player", slot.player_id))
			return
	if active_slots(crowd).is_empty():
		crowd.end(result("none"))


func on_timeout(crowd: CrowdMatch) -> Dictionary:
	var leader: CrowdSlot = null
	for slot: CrowdSlot in active_slots(crowd):
		if leader == null or slot.entity.x > leader.entity.x:
			leader = slot
	return result("player", leader.player_id) if leader != null else result("none")
