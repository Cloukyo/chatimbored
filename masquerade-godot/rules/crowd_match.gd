class_name CrowdMatch
extends RefCounted
## One round in a room full of guests. The host's copy of the game runs this; everyone else only
## ever gets per-player views from `view_for`, in which players and NPCs look exactly alike.
## Ported from server/src/crowd/CrowdMatch.ts, and kept call-for-call identical so a seed replays the same round.

const MAX_QUEUED_INPUTS := 4
const EVENT_WINDOW_TICKS := 40
## A shot at a floor point hits whoever stands within this of it.
const SHOT_HIT_RADIUS := 16.0
## How far a named target may have moved from where the shooter saw them, which covers network lag.
const NAMED_TARGET_DRIFT := 160.0

var rules: CrowdRules
var random: CrowdRandom
var entities: Array[CrowdEntity] = []
## player_id -> CrowdSlot, in join order.
var slots: Dictionary = {}
var props: Array = []
var tick := 0
## Empty until the round is decided.
var result: Dictionary = {}
## Players who go down take over an NPC instead of sitting out.
var ghosts := false
var observer: CrowdObserver = null

var _events: Array = []
var _next_event_id := 1
var _packed_tick := -1
var _packed: Array = []
## Whoever's shot or strike is being resolved, so a death can be credited to them.
var _actor: CrowdSlot = null


func _init(round_rules: CrowdRules, player_ids: Array, round_random: CrowdRandom, options: Dictionary = {}) -> void:
	rules = round_rules
	random = round_random
	ghosts = options.get("ghosts", false)
	observer = options.get("observer", null)
	var total := rules.npc_count + player_ids.size()
	var ids := random.shuffle(range(1, total + 1))
	var roles := rules.assign_roles(player_ids, random)
	var made := rules.make_props(rules.arena, random)
	for i in made.size():
		var prop: Dictionary = made[i].duplicate()
		prop.id = i + 1
		props.append(prop)

	for i in total:
		var spawn := rules.spawn_point(random, rules.arena)
		var entity := CrowdEntity.new()
		entity.id = ids[i]
		entity.x = spawn.x
		entity.y = spawn.y
		entity.facing = int(floor(random.next() * 8))
		entities.append(entity)
		if i < rules.npc_count or i - rules.npc_count >= player_ids.size():
			entity.give_brain(random.next() * 1200)
			continue
		var player_id: String = player_ids[i - rules.npc_count]
		var slot := CrowdSlot.new()
		slot.player_id = player_id
		slot.entity = entity
		slot.role = roles.get(player_id, "runner")
		slot.shots = rules.starting_shots(slot.role)
		entity.hidden = not rules.in_crowd(slot.role)
		slots[player_id] = slot
	rules.on_start(self)


var arena: Dictionary:
	get:
		return rules.arena


func is_over() -> bool:
	return not result.is_empty()


## input: {seq, move: {x, y}, run, act, shoot?: {x, y}, shootAt?: entity id}
func queue_input(player_id: String, input: Dictionary) -> void:
	var slot: CrowdSlot = slots.get(player_id)
	if slot == null:
		return
	var seq := int(input.get("seq", 0))
	if seq <= slot.ack:
		return
	for queued in slot.queue:
		if queued.seq == seq:
			return
	slot.queue.append(input)
	# Keep latency bounded if a client bursts inputs after a stall; the newest inputs win.
	while slot.queue.size() > MAX_QUEUED_INPUTS:
		var dropped: Dictionary = slot.queue.pop_front()
		slot.ack = maxi(slot.ack, int(dropped.seq))


func step() -> void:
	if is_over():
		return
	tick += 1

	for slot: CrowdSlot in slots.values():
		slot.act_cooldown_ms = maxi(0, slot.act_cooldown_ms - CrowdMovement.TICK_MS)
		var input = slot.queue.pop_front() if not slot.queue.is_empty() else null
		if input != null:
			slot.ack = int(input.seq)
			slot.last_direction = CrowdMovement.snap_direction(input.get("move", {}))
			slot.last_run = bool(input.get("run", false)) and rules.can_run
		var entity := slot.entity
		if slot.ghost != null:
			if not slot.away:
				_move_ghost(slot)
			continue
		if entity.dead or entity.has_brain:
			continue
		if entity.hidden:
			if input != null and input.has("shoot") and slot.shots > 0:
				_shoot(slot, input.shoot, input.get("shootAt", -1))
			if is_over():
				return
			continue
		if entity.sick_ms > 0 or entity.stun_ms > 0:
			entity.stop()
			continue
		entity.direction = slot.last_direction
		entity.running = slot.last_run and not CrowdMovement.is_still(slot.last_direction)
		_move(entity)
		if input == null:
			continue
		if input.has("shoot") and slot.shots > 0:
			_shoot(slot, input.shoot, input.get("shootAt", -1))
		if is_over():
			return
		if input.get("act", false) and slot.act_cooldown_ms <= 0:
			_actor = slot
			rules.on_act(self, slot)
			_actor = null

	for entity in entities:
		if entity.dead or entity.hidden:
			continue
		if entity.stun_ms > 0:
			entity.stun_ms = maxi(0, entity.stun_ms - CrowdMovement.TICK_MS)
			entity.direction = CrowdMovement.vec(0, 0)
			continue
		if entity.sick_ms > 0:
			entity.sick_ms = maxi(0, entity.sick_ms - CrowdMovement.TICK_MS)
			if entity.sick_ms == 0:
				kill(entity, "sick")
			continue
		if not entity.has_brain:
			continue
		entity.brain_timer_ms -= CrowdMovement.TICK_MS
		if entity.brain_timer_ms <= 0:
			var next := rules.plan_for(entity, random, arena, self)
			entity.direction = next.direction
			entity.brain_timer_ms = next.duration_ms
		_move(entity)

	if not is_over():
		rules.on_tick(self)
	if not is_over() and observer != null:
		observer.on_tick(self)


func timeout() -> Dictionary:
	if not is_over():
		result = rules.on_timeout(self)
	return result


## outcome: {winner, winnerPlayerId?, winnerRole?}
func end(outcome: Dictionary) -> void:
	if is_over():
		return
	result = outcome.duplicate()
	result.reveal = []


func remove_player(player_id: String) -> void:
	var slot: CrowdSlot = slots.get(player_id)
	if slot == null or not slot.connected:
		return
	slot.connected = false
	slot.queue.clear()
	# A player who leaves keeps wandering as part of the crowd, so their body doesn't give anything away.
	if not slot.entity.dead and not slot.entity.hidden:
		slot.entity.give_brain()
	if slot.ghost != null and not slot.ghost.dead:
		slot.ghost.give_brain()
	slot.ghost = null
	rules.on_player_left(self, slot)


func set_away(player_id: String, away: bool) -> void:
	var slot: CrowdSlot = slots.get(player_id)
	if slot == null or not slot.connected or slot.away == away:
		return
	slot.away = away
	slot.queue.clear()
	slot.last_direction = CrowdMovement.vec(0, 0)
	slot.last_run = false
	for entity in [slot.entity, slot.ghost]:
		if entity == null or entity.dead or entity.hidden:
			continue
		entity.has_brain = away
		entity.brain_timer_ms = 0
		if not away:
			entity.stop()


func slot_for_entity(entity: CrowdEntity) -> CrowdSlot:
	for slot: CrowdSlot in slots.values():
		if slot.entity == entity:
			return slot
	return null


## Everything a player can see and touch: lookouts excluded.
func visible_entities() -> Array:
	return entities.filter(func(entity: CrowdEntity) -> bool: return not entity.hidden)


func nearest_entity(from: CrowdEntity, reach: float) -> CrowdEntity:
	var best: CrowdEntity = null
	var best_distance := INF
	for entity in entities:
		if entity == from or entity.dead or entity.hidden:
			continue
		var distance := CrowdMovement.distance(entity.x, entity.y, from.x, from.y)
		if distance <= reach and distance < best_distance:
			best = entity
			best_distance = distance
	return best


func nearest_prop(from: CrowdEntity, reach: float) -> Dictionary:
	var best := {}
	var best_distance := INF
	for prop in props:
		var distance := CrowdMovement.distance(prop.x, prop.y, from.x, from.y)
		if distance <= reach and distance < best_distance:
			best = prop
			best_distance = distance
	return best


func stun(entity: CrowdEntity, duration_ms: int) -> void:
	if entity.dead:
		return
	entity.stun_ms = maxi(entity.stun_ms, duration_ms)
	entity.stop()


func living_slots() -> Array:
	return slots.values().filter(func(slot: CrowdSlot) -> bool: return not slot.entity.dead)


func make_sick(entity: CrowdEntity, duration_ms: int) -> void:
	if entity.dead or entity.sick_ms > 0:
		return
	entity.sick_ms = duration_ms
	entity.direction = CrowdMovement.vec(0, 0)


func kill(entity: CrowdEntity, cause: String = "shot") -> void:
	if entity.dead:
		return
	entity.dead = true
	entity.sick_ms = 0
	entity.stun_ms = 0
	entity.stop()
	emit({"type": "down", "entity": entity.id})
	var victim := slot_for_entity(entity)
	if victim != null and _actor != null and victim != _actor:
		_actor.takedowns.append(victim.player_id)
	var haunted := ghost_slot_for(entity)
	if haunted != null:
		if _actor != null and _actor != haunted:
			haunted.baits += 1
		haunted.ghost = null
		make_ghost(haunted)
	rules.on_entity_died(self, entity, cause)
	if observer != null:
		observer.on_death(self, entity, victim, _actor)
	if victim != null and ghosts and victim.connected:
		make_ghost(victim)


## Hands a player who is out of the round a random NPC to steer.
func make_ghost(slot: CrowdSlot) -> void:
	# Not another ghost, and not a player who is away and only walking like the crowd for now.
	var taken := {}
	for other: CrowdSlot in slots.values():
		if other.ghost != null:
			taken[other.ghost] = true
		if other.away:
			taken[other.entity] = true
	var free := entities.filter(func(e: CrowdEntity) -> bool: return e.has_brain and not e.dead and not e.hidden and not taken.has(e))
	if free.is_empty():
		return
	var ghost: CrowdEntity = free[random.index(free.size())]
	ghost.has_brain = false
	slot.ghost = ghost


func ghost_slot_for(entity: CrowdEntity) -> CrowdSlot:
	for slot: CrowdSlot in slots.values():
		if slot.ghost == entity:
			return slot
	return null


## event: {type, ...}. Gets an id; views carry the last couple of seconds of them.
func emit(event: Dictionary) -> void:
	var stored := event.duplicate()
	stored.id = _next_event_id
	_next_event_id += 1
	_events.append({"tick": tick, "event": stored})
	while not _events.is_empty() and _events[0].tick < tick - EVENT_WINDOW_TICKS:
		_events.pop_front()


## What one player may know right now. Never names another player or their role.
func view_for(player_id: String) -> Dictionary:
	var slot: CrowdSlot = slots.get(player_id)
	if slot == null:
		return {}
	var you := 0
	if slot.ghost != null:
		you = slot.ghost.id
	elif not slot.entity.hidden:
		you = slot.entity.id
	var view := _base_view()
	view.you = you
	if slot.ghost != null:
		view.ghost = true
	view.ack = slot.ack
	view.role = slot.role
	view.alive = not slot.entity.dead
	view.shots = slot.shots
	view.canAct = slot.act_cooldown_ms <= 0 and slot.entity.stun_ms <= 0 and rules.can_act(self, slot)
	view.canRun = rules.can_run
	view.mine = slot.mine.keys()
	view.hud = rules.hud(self, slot)
	return view


## For someone watching from outside the crowd, like a TV seat or Party Night's host.
func spectator_view(role: String) -> Dictionary:
	var view := _base_view()
	view.role = role
	return view


func _base_view() -> Dictionary:
	var view := {
		"mode": rules.mode,
		"arena": arena,
		"tick": tick,
		"you": 0,
		"ack": 0,
		"role": "",
		"alive": true,
		"shots": 0,
		"canAct": false,
		"canRun": false,
		"e": _pack_entities(),
		"events": _recent_events(),
		"props": props,
		"mine": [],
		"hud": {},
	}
	var lit := rules.zone(self)
	if not lit.is_empty():
		view.zone = lit
	if is_over():
		var shown := result.duplicate()
		shown.reveal = _reveal()
		view.result = shown
	return view


func _recent_events() -> Array:
	var recent := []
	for stored in _events:
		if stored.tick >= tick - EVENT_WINDOW_TICKS:
			recent.append(stored.event)
	return recent


func _reveal() -> Array:
	var reveal := []
	for slot: CrowdSlot in slots.values():
		reveal.append({"entity": slot.entity.id, "playerId": slot.player_id, "role": slot.role, "alive": not slot.entity.dead})
	return reveal


## Flat list, 5 numbers per entity: id, x, y, facing, state. Sorted by id so the order doesn't leak who is a player.
func _pack_entities() -> Array:
	if _packed_tick == tick:
		return _packed
	var sorted := visible_entities()
	sorted.sort_custom(func(a: CrowdEntity, b: CrowdEntity) -> bool: return a.id < b.id)
	_packed = []
	for entity in sorted:
		_packed.append_array([entity.id, entity.x, entity.y, entity.facing, entity.state()])
	_packed_tick = tick
	return _packed


## Ghosts walk at crowd pace and can't run, shoot or act.
func _move_ghost(slot: CrowdSlot) -> void:
	var ghost := slot.ghost
	if ghost.dead or ghost.stun_ms > 0 or ghost.sick_ms > 0:
		return
	ghost.direction = slot.last_direction
	ghost.running = false
	_move(ghost)


func _move(entity: CrowdEntity) -> void:
	var next := CrowdMovement.step_position(entity.x, entity.y, entity.direction, entity.running, arena)
	entity.x = next.x
	entity.y = next.y
	entity.facing = CrowdMovement.facing_of(entity.direction, entity.facing)


func _shoot(slot: CrowdSlot, point: Dictionary, target_id: int) -> void:
	slot.shots -= 1
	slot.shots_fired += 1
	var before := slot.takedowns.size()
	_resolve_shot(slot, point, target_id)
	if slot.takedowns.size() == before:
		slot.wasted_shots += 1


## Aiming isn't a skill here: whoever the player pointed at is shot, and nobody in between gets in the way.
## "Aimed" shots (Lookouts, from above) drop as an arrow; the rest fly from the shooter's figure.
func _resolve_shot(slot: CrowdSlot, point: Dictionary, target_id: int) -> void:
	var hit := _shot_target(slot, point, target_id)
	var to := CrowdMovement.vec(hit.x, hit.y) if hit != null else CrowdMovement.vec(CrowdMovement.js_round(point.x), CrowdMovement.js_round(point.y))
	var aimed := rules.shot_style(slot.role) == "aimed"
	var from := to if aimed else CrowdMovement.vec(slot.entity.x, slot.entity.y)
	# An arrow is drawn falling in from the top of the screen.
	emit({"type": "shot", "from": CrowdMovement.vec(to.x - 60, -40) if aimed else from, "to": to})
	if observer != null:
		observer.on_shot(self, slot, from, to, hit)
	if hit != null:
		_actor = slot
		rules.on_shot_hit(self, slot, hit)
		_actor = null


## The entity the player named, if it's still there to be shot near where they saw it;
## otherwise whoever stands closest to the point.
func _shot_target(slot: CrowdSlot, point: Dictionary, target_id: int) -> CrowdEntity:
	var shootable := func(entity: CrowdEntity) -> bool: return entity != slot.entity and not entity.dead and not entity.hidden
	if target_id >= 0:
		for entity in entities:
			if entity.id == target_id:
				if shootable.call(entity) and CrowdMovement.distance(entity.x, entity.y, point.x, point.y) <= NAMED_TARGET_DRIFT:
					return entity
				break
	var best: CrowdEntity = null
	var best_distance := INF
	for entity in entities:
		if not shootable.call(entity):
			continue
		var distance := CrowdMovement.distance(entity.x, entity.y, point.x, point.y)
		if distance <= SHOT_HIT_RADIUS and distance < best_distance:
			best = entity
			best_distance = distance
	return best
