class_name CrowdEntity
extends RefCounted
## One figure in the crowd. Players and NPCs are the same kind of thing; only `has_brain` differs.

enum State { IDLE, WALK, RUN, DEAD, SICK, STUNNED }

var id: int
var x: float
var y: float
## 0-7, clockwise from east.
var facing: int
var direction: Dictionary = {"x": 0.0, "y": 0.0}
var running := false
var dead := false
var sick_ms := 0
## Frozen in place but alive, e.g. after a clumsy strike.
var stun_ms := 0
## Lookouts have an entity for bookkeeping, but it never appears in the crowd.
var hidden := false
## NPC brain; players have none unless they leave mid-round.
var has_brain := false
var brain_timer_ms := 0.0


func give_brain(timer_ms: float = 0.0) -> void:
	has_brain = true
	brain_timer_ms = timer_ms


func stop() -> void:
	direction = {"x": 0.0, "y": 0.0}
	running = false


func state() -> int:
	if dead:
		return State.DEAD
	if sick_ms > 0:
		return State.SICK
	if stun_ms > 0:
		return State.STUNNED
	if CrowdMovement.is_still(direction):
		return State.IDLE
	return State.RUN if running else State.WALK
