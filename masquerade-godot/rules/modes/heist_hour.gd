class_name HeistHourRules
extends CrowdRules
## Heist Hour: crack three different vaults to win. Each crack sets off that vault's alarm for a few
## seconds, which everyone sees. One shot each for whoever was standing there.

const GOAL := 3
const ALARM_MS := 5000
const VAULTS := [
	{"x": 640.0, "y": 140.0},
	{"x": 640.0, "y": 640.0},
	{"x": 170.0, "y": 390.0},
	{"x": 1110.0, "y": 390.0},
]

## prop id -> ms left on its alarm.
var alarms := {}


func _init() -> void:
	mode = "heist_hour"
	npc_count = 46
	can_run = true


func shots_for(_role: String) -> int:
	return 1


func make_props(_area: Dictionary, _random: CrowdRandom) -> Array:
	return VAULTS.map(func(spot: Dictionary) -> Dictionary: return {"kind": "vault", "x": spot.x, "y": spot.y, "on": false})


func npc_plan(entity: CrowdEntity, random: CrowdRandom, area: Dictionary, _crowd: CrowdMatch) -> Dictionary:
	return visit(entity, VAULTS, random) if random.next() < 0.25 else wander(entity, random, area)


func can_act(_crowd: CrowdMatch, _slot: CrowdSlot) -> bool:
	return true


func on_act(crowd: CrowdMatch, slot: CrowdSlot) -> void:
	var vault := crowd.nearest_prop(slot.entity, PROP_REACH)
	if vault.is_empty() or vault.on or slot.mine.has(vault.id):
		return
	slot.mine[vault.id] = true
	vault.on = true
	alarms[vault.id] = ALARM_MS
	crowd.emit({"type": "flare", "prop": vault.id})
	if slot.mine.size() >= GOAL:
		crowd.end(result("player", slot.player_id))


func on_shot_hit(crowd: CrowdMatch, _shooter: CrowdSlot, target: CrowdEntity) -> void:
	crowd.kill(target)


func on_tick(crowd: CrowdMatch) -> void:
	for id in alarms.keys():
		if alarms[id] > CrowdMovement.TICK_MS:
			alarms[id] -= CrowdMovement.TICK_MS
			continue
		alarms.erase(id)
		for prop in crowd.props:
			if prop.id == id:
				prop.on = false
	if active_slots(crowd).is_empty():
		crowd.end(result("none"))


func on_timeout(crowd: CrowdMatch) -> Dictionary:
	return most_progress(crowd, func(slot: CrowdSlot) -> int: return slot.mine.size())


func hud(_crowd: CrowdMatch, slot: CrowdSlot) -> Dictionary:
	return {"progress": slot.mine.size(), "goal": GOAL}
