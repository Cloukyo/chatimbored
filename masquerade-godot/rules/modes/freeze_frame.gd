class_name FreezeFrameRules
extends ActNaturalRules
## Freeze Frame: race to the exit as in Act Natural, but every so often the whole crowd stops dead
## for a couple of seconds. Nothing announces it: anyone still walking stands out. One shot each.

const GAP_MS := [5000, 9000]
const LENGTH_MS := [1600, 2600]
## NPCs restart a little out of step, so the thaw isn't a tell either.
const THAW_SPREAD_MS := 500

var _state := {}


func _init() -> void:
	super()
	mode = "freeze_frame"


## {until_freeze_ms, frozen_ms}, made the first time anything asks.
func state(crowd: CrowdMatch) -> Dictionary:
	if _state.is_empty():
		_state = {"until_freeze_ms": crowd.random.between(GAP_MS[0], GAP_MS[1]), "frozen_ms": 0}
	return _state


func npc_plan(entity: CrowdEntity, random: CrowdRandom, area: Dictionary, crowd: CrowdMatch) -> Dictionary:
	var frozen_ms: int = state(crowd).frozen_ms
	if frozen_ms > 0:
		return plan(CrowdMovement.vec(0, 0), frozen_ms)
	return super(entity, random, area, crowd)


func on_tick(crowd: CrowdMatch) -> void:
	var freeze := state(crowd)
	if freeze.frozen_ms > 0:
		freeze.frozen_ms = maxi(0, freeze.frozen_ms - CrowdMovement.TICK_MS)
		if freeze.frozen_ms == 0:
			freeze.until_freeze_ms = crowd.random.between(GAP_MS[0], GAP_MS[1])
	else:
		freeze.until_freeze_ms -= CrowdMovement.TICK_MS
		if freeze.until_freeze_ms <= 0:
			_freeze_crowd(crowd, freeze)
	super(crowd)


func _freeze_crowd(crowd: CrowdMatch, freeze: Dictionary) -> void:
	freeze.frozen_ms = crowd.random.between(LENGTH_MS[0], LENGTH_MS[1])
	for entity in crowd.entities:
		if not entity.has_brain or entity.dead:
			continue
		entity.stop()
		entity.brain_timer_ms = freeze.frozen_ms + CrowdMovement.js_round(crowd.random.next() * THAW_SPREAD_MS)
