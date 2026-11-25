class_name BellRingersRules
extends CrowdRules
## Bell Ringers: a few Ringers hide in the crowd and must ring every bell between them.
## Lookouts watch from above with a handful of arrows. Rung bells stay rung, for everyone to see.

const LOOKOUT_ARROWS := 2
const BELLS := [
	{"x": 170.0, "y": 160.0},
	{"x": 1110.0, "y": 160.0},
	{"x": 170.0, "y": 640.0},
	{"x": 1110.0, "y": 640.0},
]


func _init() -> void:
	mode = "bell_ringers"
	npc_count = 46
	can_run = false


func assign_roles(player_ids: Array, random: CrowdRandom) -> Dictionary:
	var ringers := random.shuffle(player_ids).slice(0, ceili(player_ids.size() / 3.0))
	var roles := {}
	for id in player_ids:
		roles[id] = "ringer" if ringers.has(id) else "lookout"
	return roles


func shots_for(role: String) -> int:
	return LOOKOUT_ARROWS if role == "lookout" else 0


func in_crowd(role: String) -> bool:
	return role != "lookout"


func shot_style(_role: String) -> String:
	return "aimed"


## Ringers start in the middle band, away from the bells.
func spawn_point(random: CrowdRandom, area: Dictionary) -> Dictionary:
	return CrowdMovement.vec(CrowdMovement.js_round(300 + random.next() * (area.width - 600)), CrowdMovement.js_round(120 + random.next() * (area.height - 200)))


func make_props(_area: Dictionary, _random: CrowdRandom) -> Array:
	return BELLS.map(func(spot: Dictionary) -> Dictionary: return {"kind": "bell", "x": spot.x, "y": spot.y, "on": false})


func npc_plan(entity: CrowdEntity, random: CrowdRandom, area: Dictionary, _crowd: CrowdMatch) -> Dictionary:
	return visit(entity, BELLS, random) if random.next() < 0.3 else wander(entity, random, area)


func can_act(_crowd: CrowdMatch, slot: CrowdSlot) -> bool:
	return slot.role == "ringer"


func on_act(crowd: CrowdMatch, slot: CrowdSlot) -> void:
	if slot.role != "ringer":
		return
	var bell := crowd.nearest_prop(slot.entity, PROP_REACH)
	if bell.is_empty() or bell.on:
		return
	bell.on = true
	slot.mine[bell.id] = true
	crowd.emit({"type": "flare", "prop": bell.id})
	if crowd.props.all(func(prop: Dictionary) -> bool: return prop.on):
		crowd.end(result("ringers", "", "ringer"))


func on_shot_hit(crowd: CrowdMatch, _shooter: CrowdSlot, target: CrowdEntity) -> void:
	crowd.kill(target)


func on_tick(crowd: CrowdMatch) -> void:
	var slots: Array = crowd.slots.values()
	if not slots.any(func(slot: CrowdSlot) -> bool: return slot.role == "ringer" and slot.connected and not slot.entity.dead):
		crowd.end(result("lookouts", "", "lookout"))
		return
	if not slots.any(func(slot: CrowdSlot) -> bool: return slot.role == "lookout" and slot.connected and slot.shots > 0):
		crowd.end(result("ringers", "", "ringer"))


func on_timeout(_crowd: CrowdMatch) -> Dictionary:
	return result("lookouts", "", "lookout")


func hud(crowd: CrowdMatch, _slot: CrowdSlot) -> Dictionary:
	return {"progress": crowd.props.filter(func(prop: Dictionary) -> bool: return prop.on).size(), "goal": BELLS.size()}
