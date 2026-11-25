class_name SilentWitnessRules
extends CrowdRules
## Silent Witness: one hidden Killer quietly poisons the crowd; Hunters each get one shot to find them.

const KILL_TARGET := 5
const KILL_RANGE := 34.0
const SICK_MS := 2800
const KILL_COOLDOWN_MS := 900

var kills := 0


func _init() -> void:
	mode = "silent_witness"
	npc_count = 48
	can_run = false


func assign_roles(player_ids: Array, random: CrowdRandom) -> Dictionary:
	var killer = player_ids[random.index(player_ids.size())]
	var roles := {}
	for id in player_ids:
		roles[id] = "killer" if id == killer else "hunter"
	return roles


func shots_for(role: String) -> int:
	return 1 if role == "hunter" else 0


func can_act(_crowd: CrowdMatch, slot: CrowdSlot) -> bool:
	return slot.role == "killer"


func on_act(crowd: CrowdMatch, slot: CrowdSlot) -> void:
	if slot.role != "killer":
		return
	var victim: CrowdEntity = null
	var best := INF
	for entity: CrowdEntity in crowd.visible_entities():
		if entity == slot.entity or entity.dead or entity.sick_ms != 0:
			continue
		var distance := CrowdMovement.distance(entity.x, entity.y, slot.entity.x, slot.entity.y)
		if distance <= KILL_RANGE and distance < best:
			victim = entity
			best = distance
	if victim == null:
		return
	crowd.make_sick(victim, SICK_MS)
	slot.act_cooldown_ms = KILL_COOLDOWN_MS


func on_shot_hit(crowd: CrowdMatch, _shooter: CrowdSlot, target: CrowdEntity) -> void:
	var target_slot := crowd.slot_for_entity(target)
	crowd.kill(target)
	if target_slot != null and target_slot.role == "killer":
		crowd.end(result("hunters", "", "hunter"))


func on_entity_died(_crowd: CrowdMatch, _entity: CrowdEntity, cause: String) -> void:
	if cause == "sick":
		kills += 1


func on_tick(crowd: CrowdMatch) -> void:
	var killer := _killer(crowd)
	var killer_id := killer.player_id if killer != null else ""
	if kills >= KILL_TARGET:
		crowd.end(result("killer", killer_id))
		return
	for slot: CrowdSlot in crowd.slots.values():
		if slot.role == "hunter" and slot.connected and not slot.entity.dead and slot.shots > 0:
			return
	crowd.end(result("killer", killer_id))


func on_player_left(crowd: CrowdMatch, slot: CrowdSlot) -> void:
	if slot.role == "killer":
		crowd.end(result("hunters", "", "hunter"))


func on_timeout(_crowd: CrowdMatch) -> Dictionary:
	return result("hunters", "", "hunter")


func hud(_crowd: CrowdMatch, _slot: CrowdSlot) -> Dictionary:
	return {"kills": kills, "killTarget": KILL_TARGET}


func _killer(crowd: CrowdMatch) -> CrowdSlot:
	for slot: CrowdSlot in crowd.slots.values():
		if slot.role == "killer":
			return slot
	return null
