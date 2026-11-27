class_name LanternFestivalRules
extends CrowdRules
## Lantern Festival: everyone for themselves. Light all five lanterns, or be the last one standing.
## Lighting a lantern makes it flare for everyone, so watch who's standing next to one.

const GOAL := 5
const COOLDOWN_MS := 600
const STRIKE_COOLDOWN_MS := 1500
const LANTERNS := [
	{"x": 210.0, "y": 180.0},
	{"x": 1070.0, "y": 180.0},
	{"x": 640.0, "y": 390.0},
	{"x": 210.0, "y": 620.0},
	{"x": 1070.0, "y": 620.0},
]


func _init() -> void:
	mode = "lantern_festival"
	npc_count = 46
	can_run = true


func make_props(_area: Dictionary, _random: CrowdRandom) -> Array:
	return LANTERNS.map(func(spot: Dictionary) -> Dictionary: return {"kind": "lantern", "x": spot.x, "y": spot.y, "on": false})


func npc_plan(entity: CrowdEntity, random: CrowdRandom, area: Dictionary, _crowd: CrowdMatch) -> Dictionary:
	return visit(entity, LANTERNS, random) if random.next() < 0.25 else wander(entity, random, area)


func can_act(_crowd: CrowdMatch, _slot: CrowdSlot) -> bool:
	return true


func on_act(crowd: CrowdMatch, slot: CrowdSlot) -> void:
	var lantern := crowd.nearest_prop(slot.entity, PROP_REACH)
	if not lantern.is_empty() and not slot.mine.has(lantern.id):
		slot.mine[lantern.id] = true
		crowd.emit({"type": "flare", "prop": lantern.id})
		slot.act_cooldown_ms = COOLDOWN_MS
		if slot.mine.size() >= GOAL:
			crowd.end(result("player", slot.player_id))
		return
	if strike_nearest(crowd, slot) != null:
		slot.act_cooldown_ms = STRIKE_COOLDOWN_MS


func on_tick(crowd: CrowdMatch) -> void:
	last_one_standing(crowd)


func on_timeout(crowd: CrowdMatch) -> Dictionary:
	return most_progress(crowd, func(slot: CrowdSlot) -> int: return slot.mine.size())


func hud(_crowd: CrowdMatch, slot: CrowdSlot) -> Dictionary:
	return {"progress": slot.mine.size(), "goal": GOAL}
