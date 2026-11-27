class_name MarkedRules
extends CrowdRules
## Marked: everyone secretly hunts one other player and is hunted by someone else. Strike your mark
## to take over theirs. Strike anyone else and you're left reeling for a few seconds, in plain view.

const GOAL := 3
const WRONG_STUN_MS := 3000
const STRIKE_COOLDOWN_MS := 800
const HINT_EVERY_MS := 8000
const HINT_FUZZ := 70.0

## Made the first time anything asks, as the server does, so a seed replays the same hunt.
var _state := {}


func _init() -> void:
	mode = "marked"
	npc_count = 44
	can_run = false


## {targets: hunter -> target, marks: player -> count, hints: hunter -> {x, y}}
func state(crowd: CrowdMatch) -> Dictionary:
	if _state.is_empty():
		# One loop through every player, so everyone is both hunter and hunted.
		var order := crowd.random.shuffle(crowd.slots.keys())
		var targets := {}
		for i in order.size():
			targets[order[i]] = order[(i + 1) % order.size()]
		_state = {"targets": targets, "marks": {}, "hints": {}}
	return _state


func can_act(_crowd: CrowdMatch, _slot: CrowdSlot) -> bool:
	return true


func on_act(crowd: CrowdMatch, slot: CrowdSlot) -> void:
	var hunt := state(crowd)
	# Read the mark before striking: a death hands the victim's mark on to whoever hunted them.
	var mark = hunt.targets.get(slot.player_id)
	var victim := strike_nearest(crowd, slot)
	if victim == null:
		return
	var victim_slot := crowd.slot_for_entity(victim)
	if mark != null and victim_slot != null and victim_slot.player_id == mark:
		hunt.marks[slot.player_id] = hunt.marks.get(slot.player_id, 0) + 1
		slot.act_cooldown_ms = STRIKE_COOLDOWN_MS
		if hunt.marks[slot.player_id] >= GOAL:
			crowd.end(result("player", slot.player_id))
		return
	crowd.stun(slot.entity, WRONG_STUN_MS)
	slot.act_cooldown_ms = WRONG_STUN_MS


func on_entity_died(crowd: CrowdMatch, entity: CrowdEntity, _cause: String) -> void:
	var slot := crowd.slot_for_entity(entity)
	if slot != null:
		_drop_from_hunt(crowd, slot.player_id)


func on_player_left(crowd: CrowdMatch, slot: CrowdSlot) -> void:
	_drop_from_hunt(crowd, slot.player_id)


func on_tick(crowd: CrowdMatch) -> void:
	last_one_standing(crowd)
	if crowd.is_over() or crowd.tick % (HINT_EVERY_MS / CrowdMovement.TICK_MS) != 1:
		return
	var hunt := state(crowd)
	for hunter in hunt.targets:
		var entity: CrowdEntity = crowd.slots[hunt.targets[hunter]].entity
		hunt.hints[hunter] = CrowdMovement.vec(
			CrowdMovement.js_round(entity.x + (crowd.random.next() * 2 - 1) * HINT_FUZZ),
			CrowdMovement.js_round(entity.y + (crowd.random.next() * 2 - 1) * HINT_FUZZ),
		)


func on_timeout(crowd: CrowdMatch) -> Dictionary:
	var hunt := state(crowd)
	return most_progress(crowd, func(slot: CrowdSlot) -> int: return hunt.marks.get(slot.player_id, 0))


func hud(crowd: CrowdMatch, slot: CrowdSlot) -> Dictionary:
	var hunt := state(crowd)
	var shown := {"progress": hunt.marks.get(slot.player_id, 0), "goal": GOAL}
	if hunt.targets.has(slot.player_id):
		shown.markName = hunt.targets[slot.player_id]
	if hunt.hints.has(slot.player_id):
		shown.hint = hunt.hints[slot.player_id]
	return shown


## Whoever was hunting the fallen player takes over their mark.
func _drop_from_hunt(crowd: CrowdMatch, player_id: String) -> void:
	var hunt := state(crowd)
	var inherited = hunt.targets.get(player_id)
	hunt.targets.erase(player_id)
	hunt.hints.erase(player_id)
	for hunter in hunt.targets.keys():
		if hunt.targets[hunter] != player_id:
			continue
		if inherited != null and inherited != hunter:
			hunt.targets[hunter] = inherited
		else:
			hunt.targets.erase(hunter)
		hunt.hints.erase(hunter)
