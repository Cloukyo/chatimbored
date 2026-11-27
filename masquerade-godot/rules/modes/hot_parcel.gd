class_name HotParcelRules
extends CrowdRules
## Hot Parcel: one player secretly holds a ticking parcel and only they know it. Bump into another
## player to hand it over, but bump an NPC and you've just made a scene for nothing.
## When the fuse runs out, the holder is out and a new parcel starts. Last one standing wins.

const FUSE_MS := [14000, 22000]
const REACH := 30.0
const BUMP_COOLDOWN_MS := 700
## You can't hand it straight back to whoever just gave it to you.
const NO_RETURN_MS := 3000

## {holder, fuse_ms, from, no_return_ms}, made the first time anything asks.
var _state := {}


func _init() -> void:
	mode = "hot_parcel"
	npc_count = 44
	can_run = false


func state(crowd: CrowdMatch) -> Dictionary:
	if _state.is_empty():
		_state = {"holder": "", "fuse_ms": 0, "from": "", "no_return_ms": 0}
		_new_parcel(crowd)
	return _state


func can_act(crowd: CrowdMatch, slot: CrowdSlot) -> bool:
	return state(crowd).holder == slot.player_id


func on_act(crowd: CrowdMatch, slot: CrowdSlot) -> void:
	var parcel := state(crowd)
	if parcel.holder != slot.player_id:
		return
	var target := crowd.nearest_entity(slot.entity, REACH)
	if target == null:
		return
	crowd.emit({"type": "bump", "at": CrowdMovement.vec(target.x, target.y)})
	slot.act_cooldown_ms = BUMP_COOLDOWN_MS
	var receiver := crowd.slot_for_entity(target)
	if receiver == null or not receiver.connected:
		return
	if receiver.player_id == parcel.from and parcel.no_return_ms > 0:
		return
	parcel.from = slot.player_id
	parcel.holder = receiver.player_id
	parcel.no_return_ms = NO_RETURN_MS


func on_player_left(crowd: CrowdMatch, slot: CrowdSlot) -> void:
	if state(crowd).holder == slot.player_id:
		_new_parcel(crowd)


func on_tick(crowd: CrowdMatch) -> void:
	var parcel := state(crowd)
	parcel.no_return_ms = maxi(0, parcel.no_return_ms - CrowdMovement.TICK_MS)
	parcel.fuse_ms -= CrowdMovement.TICK_MS
	if parcel.fuse_ms <= 0 and parcel.holder != "":
		var entity: CrowdEntity = crowd.slots[parcel.holder].entity
		crowd.emit({"type": "strike", "at": CrowdMovement.vec(entity.x, entity.y)})
		crowd.kill(entity, "strike")
		last_one_standing(crowd)
		if not crowd.is_over():
			_new_parcel(crowd)
		return
	last_one_standing(crowd)


func on_timeout(crowd: CrowdMatch) -> Dictionary:
	return most_progress(crowd, func(_slot: CrowdSlot) -> int: return 1)


func hud(crowd: CrowdMatch, slot: CrowdSlot) -> Dictionary:
	var parcel := state(crowd)
	if parcel.holder != slot.player_id:
		return {"holding": false}
	return {"holding": true, "fuseSeconds": maxi(0, ceili(parcel.fuse_ms / 1000.0))}


func _new_parcel(crowd: CrowdMatch) -> void:
	var active := active_slots(crowd)
	_state.holder = active[crowd.random.index(active.size())].player_id if not active.is_empty() else ""
	_state.fuse_ms = crowd.random.between(FUSE_MS[0], FUSE_MS[1])
	_state.from = ""
	_state.no_return_ms = 0
