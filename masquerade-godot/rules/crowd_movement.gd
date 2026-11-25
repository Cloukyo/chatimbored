class_name CrowdMovement
extends RefCounted
## Movement rules for every figure in the crowd. Players and NPCs step through exactly the same code,
## so speed and direction alone never give a player away.
## Vectors are plain {x, y} dictionaries of 64-bit floats (Vector2 is 32-bit and would drift).

const TICK_MS := 50
const TICK_SECONDS := 0.05
const WALK_SPEED := 72.0
const RUN_SPEED := 150.0
const EDGE_MARGIN := 24.0
## Figures are drawn upward from their feet, so keep feet further from the top edge.
const TOP_MARGIN := 52.0
const MOVE_DEADZONE := 0.2

const STILL := {"x": 0.0, "y": 0.0}


static func vec(x: float, y: float) -> Dictionary:
	return {"x": x, "y": y}


static func is_still(direction: Dictionary) -> bool:
	return direction.x == 0.0 and direction.y == 0.0


## JavaScript's Math.round: halves round up, toward +infinity.
static func js_round(value: float) -> float:
	return floor(value + 0.5)


static func distance(ax: float, ay: float, bx: float, by: float) -> float:
	return sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by))


## Snaps any input to one of 8 directions (or none). NPCs move the same way, so direction alone is no tell.
static func snap_direction(move: Dictionary) -> Dictionary:
	var x := float(move.get("x", 0.0))
	var y := float(move.get("y", 0.0))
	var length := sqrt(x * x + y * y)
	if is_nan(length) or is_inf(length) or length < MOVE_DEADZONE:
		return vec(0.0, 0.0)
	var octant := js_round(atan2(y, x) / (PI / 4.0))
	var angle := octant * (PI / 4.0)
	return vec(_round_unit(cos(angle)), _round_unit(sin(angle)))


## Facing index 0-7 clockwise from east (screen y points down).
static func facing_of(direction: Dictionary, fallback: int) -> int:
	if is_still(direction):
		return fallback
	return posmod(int(js_round(atan2(direction.y, direction.x) / (PI / 4.0))) + 8, 8)


static func step_position(x: float, y: float, direction: Dictionary, running: bool, arena: Dictionary) -> Dictionary:
	var speed := RUN_SPEED if running else WALK_SPEED
	return vec(
		clampf(_round1(x + direction.x * speed * TICK_SECONDS), EDGE_MARGIN, arena.width - EDGE_MARGIN),
		clampf(_round1(y + direction.y * speed * TICK_SECONDS), TOP_MARGIN, arena.height - EDGE_MARGIN),
	)


## Positions travel at 0.1px precision; rounding here keeps prediction and the host in lockstep.
static func _round1(value: float) -> float:
	return js_round(value * 10.0) / 10.0


static func _round_unit(value: float) -> float:
	return js_round(value * 1e6) / 1e6
