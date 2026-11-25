class_name CrowdRules
extends RefCounted
## One room's rules. Subclasses override what they need. A new instance is made for every round,
## so a mode keeps its round state (alarms, the parcel, the marks) on itself.

const PLAZA := {"width": 1280.0, "height": 720.0}
const PROP_REACH := 40.0
const STRIKE_RANGE := 30.0

var mode := ""
var arena: Dictionary = PLAZA
var npc_count := 44
var can_run := false


## player_id -> role. Defaults to everyone a "runner".
func assign_roles(player_ids: Array, _random: CrowdRandom) -> Dictionary:
	var roles := {}
	for id in player_ids:
		roles[id] = "runner"
	return roles


func shots_for(_role: String) -> int:
	return 0


## Roles that don't walk in the crowd (Lookouts watching from above).
func in_crowd(_role: String) -> bool:
	return true


## "aimed" shots land on the chosen point from above; "ray" shots fly from the shooter's figure.
func shot_style(_role: String) -> String:
	return "ray"


## [{kind, x, y, on}] without ids; the match numbers them.
func make_props(_arena: Dictionary, _random: CrowdRandom) -> Array:
	return []


func can_act(_crowd: CrowdMatch, _slot: CrowdSlot) -> bool:
	return false


func on_start(_crowd: CrowdMatch) -> void:
	pass


func spawn_point(random: CrowdRandom, area: Dictionary) -> Dictionary:
	return anywhere(random, area)


## The next thing an NPC does: {direction, duration_ms}.
func npc_plan(entity: CrowdEntity, random: CrowdRandom, area: Dictionary, _crowd: CrowdMatch) -> Dictionary:
	return wander(entity, random, area)


## The lit area {x, y, r}, or an empty dictionary for none.
func zone(_crowd: CrowdMatch) -> Dictionary:
	return {}


func on_act(_crowd: CrowdMatch, _slot: CrowdSlot) -> void:
	pass


func on_shot_hit(_crowd: CrowdMatch, _shooter: CrowdSlot, _target: CrowdEntity) -> void:
	pass


## cause: "shot", "sick" or "strike".
func on_entity_died(_crowd: CrowdMatch, _entity: CrowdEntity, _cause: String) -> void:
	pass


func on_tick(_crowd: CrowdMatch) -> void:
	pass


func on_player_left(_crowd: CrowdMatch, _slot: CrowdSlot) -> void:
	pass


## {winner, winnerPlayerId?, winnerRole?, reveal}
func on_timeout(_crowd: CrowdMatch) -> Dictionary:
	return result("none")


func hud(_crowd: CrowdMatch, _slot: CrowdSlot) -> Dictionary:
	return {}


# --- Helpers the modes share -------------------------------------------------

static func result(winner: String, player_id: String = "", role: String = "") -> Dictionary:
	var r := {"winner": winner, "reveal": []}
	if player_id != "":
		r.winnerPlayerId = player_id
	if role != "":
		r.winnerRole = role
	return r


static func dir(x: float, y: float) -> Dictionary:
	return CrowdMovement.snap_direction({"x": x, "y": y})


static var _all_directions: Array = []


## E, NE, N, NW, W, SW, S, SE.
static func all_directions() -> Array:
	if _all_directions.is_empty():
		_all_directions = [dir(1, 0), dir(1, -1), dir(0, -1), dir(-1, -1), dir(-1, 0), dir(-1, 1), dir(0, 1), dir(1, 1)]
	return _all_directions


static func plan(direction: Dictionary, duration_ms: float) -> Dictionary:
	return {"direction": direction, "duration_ms": duration_ms}


static func anywhere(random: CrowdRandom, area: Dictionary) -> Dictionary:
	var x := CrowdMovement.js_round(60 + random.next() * (area.width - 120))
	var y := CrowdMovement.js_round(80 + random.next() * (area.height - 140))
	return CrowdMovement.vec(x, y)


static func wander(entity: CrowdEntity, random: CrowdRandom, area: Dictionary) -> Dictionary:
	if random.next() < 0.3:
		return plan(CrowdMovement.vec(0, 0), random.between(600, 2600))
	var directions := all_directions()
	var direction: Dictionary = directions[random.index(directions.size())]
	return plan(away_from_edges(entity, direction, area), random.between(600, 2600))


## Strolls toward one of the map's landmarks, so players heading there have company.
static func visit(entity: CrowdEntity, spots: Array, random: CrowdRandom) -> Dictionary:
	var spot: Dictionary = spots[random.index(spots.size())]
	var distance := CrowdMovement.distance(spot.x, spot.y, entity.x, entity.y)
	if distance < PROP_REACH:
		return plan(CrowdMovement.vec(0, 0), random.between(800, 2200))
	var direction := dir(spot.x - entity.x, spot.y - entity.y)
	return plan(direction, minf(3000, CrowdMovement.js_round(distance / CrowdMovement.WALK_SPEED * 1000)))


static func away_from_edges(entity: CrowdEntity, direction: Dictionary, area: Dictionary) -> Dictionary:
	var margin := 70.0
	var x: float = direction.x
	var y: float = direction.y
	if (entity.x < margin and x < 0) or (entity.x > area.width - margin and x > 0):
		x = -x
	if (entity.y < margin + 30 and y < 0) or (entity.y > area.height - margin and y > 0):
		y = -y
	return CrowdMovement.vec(x, y)


## Players still in the race: alive and still connected.
static func active_slots(crowd: CrowdMatch) -> Array:
	return crowd.living_slots().filter(func(slot: CrowdSlot) -> bool: return slot.connected)


## Kills whoever is closest within arm's reach. Returns them, if anyone was there.
static func strike_nearest(crowd: CrowdMatch, slot: CrowdSlot) -> CrowdEntity:
	var victim := crowd.nearest_entity(slot.entity, STRIKE_RANGE)
	if victim == null:
		return null
	crowd.emit({"type": "strike", "at": CrowdMovement.vec(victim.x, victim.y)})
	crowd.kill(victim, "strike")
	return victim


static func last_one_standing(crowd: CrowdMatch) -> void:
	var active := active_slots(crowd)
	if active.is_empty():
		crowd.end(result("none"))
	elif active.size() == 1 and crowd.slots.size() > 1:
		crowd.end(result("player", active[0].player_id))


## The one player furthest ahead wins; a tie or no progress at all is nobody's round.
static func most_progress(crowd: CrowdMatch, score: Callable) -> Dictionary:
	var first: CrowdSlot = null
	var second: CrowdSlot = null
	for slot in active_slots(crowd):
		if first == null or score.call(slot) > score.call(first):
			second = first
			first = slot
		elif second == null or score.call(slot) > score.call(second):
			second = slot
	if first == null or score.call(first) == 0 or (second != null and score.call(second) == score.call(first)):
		return result("none")
	return result("player", first.player_id)
