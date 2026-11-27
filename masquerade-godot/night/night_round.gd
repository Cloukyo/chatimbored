class_name NightRound
extends CrowdObserver
## The night's layers for one room, watching the match from outside the mode: contracts, suspicion,
## the cursed invite, Wanted, Nemesis, glimpses and the Party Host's tricks.
## Ported from server/src/party/round.ts.

const SUSPICION := {"max": 100, "runningPerTick": 0.05, "nearMiss": 15, "nearBody": 10, "cleanRound": -20, "avoidedAt": 50}
const NEAR_MISS_RANGE := 40.0
const NEAR_BODY_RANGE := 60.0
const INVITE_REACH := 26.0
const INVITE_COOLDOWN := 60
const INVITE_NO_RETURN := 120
const WANTED_EVERY := 300
const GLIMPSE_FOR := 60
const TRICK_COOLDOWN := 160
const TRICK_CREDIT := 80
const TRICK_RANGE := {"toast": 260.0, "conga": 170.0, "spotlight": 200.0}
const FLINCH_RANGE := 80.0
const FLINCH_MS := 700

## {options, shared_screen, suspicion, invite_holder, invite_paused, wanted_id, nemesis, host_id, perks, finale, random}
var setup: Dictionary
var _contracts := {}
var _suspicion_gained := {}
var _bonus := {}
var _nemesis_updates := {}
var _invite_holder := ""
var _invite_passed := false
var _previous_holder := ""
var _last_pass_tick := -INVITE_COOLDOWN
var _wanted_hint := ""
var _glimpses := {}
var _trick := "toast"
var _tricks_left := NightData.HOST_TRICKS_PER_ROUND
var _last_trick_tick := -TRICK_COOLDOWN
var _host_points := 0
var _npc_deaths := 0


func _init(round_setup: Dictionary) -> void:
	setup = round_setup
	_invite_holder = setup.invite_holder


func _option(key: String) -> bool:
	return setup.options.get(key, false)


## Called once the match exists, before the first tick.
func begin(crowd: CrowdMatch) -> void:
	var random: CrowdRandom = setup.random
	var keys := random.shuffle(NightContract.TEXTS.keys())
	var index := 0
	for slot: CrowdSlot in crowd.slots.values():
		var perk: String = setup.perks.get(slot.player_id, "")
		if perk == "extra_shot" and slot.shots > 0:
			slot.shots += 1
		if perk == "glimpse":
			var others := crowd.slots.values().filter(func(other: CrowdSlot) -> bool: return other != slot and not other.entity.hidden)
			var seen: CrowdSlot = others[random.index(others.size())] if not others.is_empty() else null
			# The server draws the number even when nobody is there to see.
			if others.is_empty():
				random.next()
			if seen != null:
				_glimpses[slot.player_id] = seen.entity.id
		if _option("contracts") and not setup.finale and not slot.entity.hidden:
			_contracts[slot.player_id] = NightContract.new(keys[index % keys.size()])
			index += 1


func on_tick(crowd: CrowdMatch) -> void:
	for player_id in _contracts:
		var slot: CrowdSlot = crowd.slots.get(player_id)
		if slot != null:
			_contracts[player_id].tick(crowd, slot)
	if _option("suspicion"):
		for slot: CrowdSlot in crowd.slots.values():
			if slot.entity.running and not slot.entity.dead:
				_suspect(slot.player_id, SUSPICION.runningPerTick)
	if _option("invite") and not setup.invite_paused:
		_pass_invite(crowd)
	if _option("wanted") and setup.wanted_id != "" and crowd.tick % WANTED_EVERY == 1:
		_update_wanted(crowd)


func on_death(crowd: CrowdMatch, entity: CrowdEntity, victim: CrowdSlot, actor: CrowdSlot) -> void:
	if victim == null and crowd.ghost_slot_for(entity) == null:
		_npc_deaths += 1
	for player_id in _contracts:
		var slot: CrowdSlot = crowd.slots.get(player_id)
		if slot != null and slot != victim:
			_contracts[player_id].death(slot, entity)
	if _option("suspicion"):
		for slot: CrowdSlot in crowd.slots.values():
			if slot == victim or slot.entity.dead or slot.entity.hidden:
				continue
			if CrowdMovement.distance(slot.entity.x, slot.entity.y, entity.x, entity.y) <= NEAR_BODY_RANGE:
				_suspect(slot.player_id, SUSPICION.nearBody)
	if victim == null or actor == null or victim == actor:
		return
	if _option("nemesis"):
		if setup.nemesis.get(actor.player_id, "") == victim.player_id:
			_add(actor.player_id, NightData.POINTS.takedown)
		_nemesis_updates[victim.player_id] = actor.player_id
	if _option("wanted") and victim.player_id == setup.wanted_id:
		_add(actor.player_id, NightData.POINTS.wantedBounty)
	var host_id: String = setup.host_id
	if host_id != "" and crowd.tick - _last_trick_tick <= TRICK_CREDIT and _host_points < NightData.POINTS.hostCap:
		_host_points += NightData.POINTS.hostTrick
		_add(host_id, NightData.POINTS.hostTrick)


func on_shot(crowd: CrowdMatch, shooter: CrowdSlot, from: Dictionary, to: Dictionary, hit: CrowdEntity) -> void:
	if _option("suspicion"):
		for slot: CrowdSlot in crowd.slots.values():
			var entity := slot.entity
			if slot == shooter or entity == hit or entity.dead or entity.hidden:
				continue
			if _distance_to_segment(entity, from, to) <= NEAR_MISS_RANGE:
				_suspect(slot.player_id, SUSPICION.nearMiss)
	# Last Dance: a miss makes the guests around the shooter flinch.
	if setup.finale and (hit == null or crowd.slot_for_entity(hit) == null):
		for entity in crowd.entities:
			if not entity.has_brain or entity.dead:
				continue
			if CrowdMovement.distance(entity.x, entity.y, shooter.entity.x, shooter.entity.y) <= FLINCH_RANGE:
				crowd.stun(entity, FLINCH_MS)


## The Party Host's controls: act cycles the trick, a shot plays it at that spot.
func host_input(crowd: CrowdMatch, input: Dictionary) -> void:
	if input.get("act", false):
		var keys := NightData.HOST_TRICKS.map(func(trick: Dictionary) -> String: return trick.key)
		_trick = keys[(keys.find(_trick) + 1) % keys.size()]
	if not input.has("shoot") or _tricks_left <= 0 or crowd.tick - _last_trick_tick < TRICK_COOLDOWN or crowd.is_over():
		return
	_tricks_left -= 1
	_last_trick_tick = crowd.tick
	_play_trick(crowd, _trick, input.shoot)


## Night extras for one player's view: public, or this player's own.
func party_view(crowd: CrowdMatch, player_id: String, name_of: Callable) -> Dictionary:
	var view := {}
	if _wanted_hint != "" and not setup.finale:
		view.wanted = _wanted_hint
	# Who's hosting is public, so their trick can show even on a shared screen.
	if player_id == setup.host_id:
		view.trick = _trick
		view.tricksLeft = _tricks_left
	var holding: bool = _invite_holder == player_id and _option("invite") and not setup.invite_paused
	if setup.shared_screen:
		if holding:
			view.holdingInvite = true
		return view
	if _contracts.has(player_id):
		view.contract = _contracts[player_id].text
		view.contractDone = _contracts[player_id].done
	if holding:
		view.holdingInvite = true
	if _glimpses.has(player_id) and crowd.tick <= GLIMPSE_FOR:
		view.glimpse = _glimpses[player_id]
	var nemesis: String = setup.nemesis.get(player_id, "") if _option("nemesis") else ""
	if nemesis != "":
		view.nemesisName = name_of.call(nemesis)
	if player_id == setup.host_id:
		var players := []
		for slot: CrowdSlot in crowd.slots.values():
			if not slot.entity.dead and not slot.entity.hidden:
				players.append(slot.entity.id)
		view.players = players
	return view


## What the round hands back to the night when it ends.
func outcome(crowd: CrowdMatch) -> Dictionary:
	var contracts_done := []
	for player_id in _contracts:
		var contract: NightContract = _contracts[player_id]
		var slot: CrowdSlot = crowd.slots.get(player_id)
		if slot != null:
			contract.finish(crowd, slot)
		if contract.done:
			contracts_done.append(player_id)
			_add(player_id, NightData.POINTS.contract)
	var suspicion := {}
	for player_id in setup.suspicion:
		var base: float = setup.suspicion[player_id]
		var gained: float = _suspicion_gained.get(player_id, 0.0)
		var next := base + gained if gained > 0 else base + SUSPICION.cleanRound
		suspicion[player_id] = int(clampf(CrowdMovement.js_round(next), 0, SUSPICION.max))
	return {
		"bonus": _bonus,
		"suspicion": suspicion,
		"invite_holder": _invite_holder,
		"invite_passed": _invite_passed,
		"nemesis": _nemesis_updates,
		"contracts_done": contracts_done,
		"npc_deaths": _npc_deaths,
	}


func _pass_invite(crowd: CrowdMatch) -> void:
	var holder: CrowdSlot = crowd.slots.get(_invite_holder) if _invite_holder != "" else null
	if holder == null or holder.entity.dead or holder.entity.hidden or crowd.tick - _last_pass_tick < INVITE_COOLDOWN:
		return
	for slot: CrowdSlot in crowd.slots.values():
		var entity := slot.entity
		if slot == holder or entity.dead or entity.hidden or not slot.connected:
			continue
		if slot.player_id == _previous_holder and crowd.tick - _last_pass_tick < INVITE_NO_RETURN:
			continue
		if CrowdMovement.distance(entity.x, entity.y, holder.entity.x, holder.entity.y) > INVITE_REACH:
			continue
		_previous_holder = holder.player_id
		_invite_holder = slot.player_id
		_last_pass_tick = crowd.tick
		_invite_passed = true
		return


func _update_wanted(crowd: CrowdMatch) -> void:
	var slot: CrowdSlot = crowd.slots.get(setup.wanted_id)
	if slot == null or slot.entity.dead or slot.entity.hidden:
		_wanted_hint = ""
		return
	# Alternate between the two halves so the hints don't pin anyone down.
	var vertical := (crowd.tick / WANTED_EVERY) % 2 == 0
	if vertical:
		_wanted_hint = "north" if slot.entity.y < crowd.arena.height / 2 else "south"
	else:
		_wanted_hint = "west" if slot.entity.x < crowd.arena.width / 2 else "east"


func _suspect(player_id: String, amount: float) -> void:
	_suspicion_gained[player_id] = _suspicion_gained.get(player_id, 0.0) + amount


func _add(player_id: String, amount: int) -> void:
	_bonus[player_id] = _bonus.get(player_id, 0) + amount


## Tricks move the NPCs only. Any figure that doesn't play along is a person.
static func _play_trick(crowd: CrowdMatch, trick: String, at: Dictionary) -> void:
	var reach: float = TRICK_RANGE[trick]
	var heading := CrowdMovement.snap_direction({"x": 1.0 if crowd.random.next() < 0.5 else -1.0, "y": 0.0})
	for entity in crowd.entities:
		if not entity.has_brain or entity.dead or entity.hidden:
			continue
		var dx: float = at.x - entity.x
		var dy: float = at.y - entity.y
		if sqrt(dx * dx + dy * dy) > reach:
			continue
		if trick == "spotlight":
			entity.direction = CrowdMovement.vec(0, 0)
			entity.brain_timer_ms = 1500
		elif trick == "toast":
			entity.direction = CrowdMovement.snap_direction({"x": dx, "y": dy})
			entity.brain_timer_ms = 2000
		else:
			entity.direction = heading
			entity.brain_timer_ms = 3000


static func _distance_to_segment(point: CrowdEntity, start: Dictionary, end: Dictionary) -> float:
	var dx: float = end.x - start.x
	var dy: float = end.y - start.y
	var length_squared := dx * dx + dy * dy
	if length_squared < 0.001:
		return CrowdMovement.distance(point.x, point.y, start.x, start.y)
	var t := clampf(((point.x - start.x) * dx + (point.y - start.y) * dy) / length_squared, 0.0, 1.0)
	return CrowdMovement.distance(point.x, point.y, start.x + dx * t, start.y + dy * t)
