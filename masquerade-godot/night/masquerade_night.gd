class_name MasqueradeNight
extends RefCounted
## A full night: a run of rooms played through the mansion. Which rooms have been played, who owns what,
## who picks next, and every layer that carries over between rooms. Hidden parts (suspicion, the Mole,
## the invite holder) stay here; `snapshot_for` only shows what each player may see.
## Ported from server/src/party/PartyNight.ts, keeping its random draws in the same order.

const GUESTS := 60
## Even a nearly empty party keeps enough guests to hide among.
const MIN_GUESTS := 16
const ROUND_MS := 90000
const SHORT_ROUND_MS := 60000
const CROWDED_EXTRA := 12
const INVITE_PENALTY := 2
const LAST_PLACE_TIPS := 1

var total_rounds: int
var options: Dictionary
var shared_screen: bool
var random: CrowdRandom
## player -> points, in join order. Also the list of who is in the night.
var points := {}
var tips := {}
## room key -> owner
var claims := {}
var played: Array = []
## player -> perk bought for next room
var perks := {}
var shop_done := {}
var suspicion := {}
## victim -> who took them out last
var nemesis := {}
var twists: Array = []
## backer -> finalist
var backers := {}
var mole_votes := {}
## player -> {shots, wasted, takedowns, times_down, rounds_survived, rounds_with_invite, baits, contracts}
var stats := {}
var offered: Array = []
var picker_id := ""
var current := ""
var last_round := {}
var guests := GUESTS
var invite_holder := ""
var _invite_streak := 0
var host_id := ""
var _host_counts := {}
## {id, target_id}, or empty
var mole := {}
var mole_reveal := {}
var finalists: Array = []
var in_finale := false
var finale_winner := ""
var round: NightRound = null
var _rooms: Array


func _init(player_ids: Array, rounds: int, is_shared_screen: bool, night_random: CrowdRandom, chosen: Dictionary = {}) -> void:
	shared_screen = is_shared_screen
	random = night_random
	# A shared screen can't show anyone their secret words, so those rooms and layers sit the night out.
	_rooms = NightData.ROOMS.filter(func(r: Dictionary) -> bool: return not (shared_screen and r.get("needsPrivateText", false)))
	total_rounds = maxi(1, mini(rounds, _rooms.size()))
	var defaults := NightData.default_options(shared_screen)
	options = {}
	for layer in NightData.LAYERS:
		options[layer.key] = chosen.get(layer.key, defaults[layer.key]) and not (shared_screen and layer.get("needsPrivateText", false))
	for id in player_ids:
		points[id] = 0
		tips[id] = 0
		suspicion[id] = 0
		stats[id] = {"shots": 0, "wasted": 0, "takedowns": 0, "times_down": 0, "rounds_survived": 0, "rounds_with_invite": 0, "baits": 0, "contracts": 0}
	if options.invite:
		invite_holder = random.shuffle(player_ids)[0]
	if options.mole and player_ids.size() >= 3:
		var order := random.shuffle(player_ids)
		mole = {"id": order[0], "target_id": order[1]}
	_offer_rooms()


func is_over() -> bool:
	return played.size() >= total_rounds and current == ""


func player_ids() -> Array:
	return points.keys()


func can_pick(player_id: String, is_host: bool) -> bool:
	# The host can pick for anyone, so a picker who wandered off doesn't stall the night.
	return current == "" and not is_over() and (player_id == picker_id or is_host)


## Returns the room, or an empty dictionary if it isn't on offer.
func pick(key: String) -> Dictionary:
	var room := NightData.room(key)
	if room.is_empty() or not offered.has(key):
		return {}
	current = key
	offered = []
	host_id = _choose_host()
	return room


## Builds the round: the rules, who plays in the crowd, and the layers watching it.
## base: fresh rules for the room's mode (ignored for the Last Dance).
func prepare_round(base: CrowdRules) -> Dictionary:
	var finale := in_finale
	var crowd_ids := player_ids().filter(func(id: String) -> bool: return id != host_id)
	var rules: CrowdRules
	if finale:
		rules = LastDanceRules.new(finalists, maxi(MIN_GUESTS, mini(48, guests)), _calmest)
	else:
		rules = base
		var extra := CROWDED_EXTRA if twists.has("crowded") else 0
		var npcs := maxi(MIN_GUESTS, mini(base.npc_count, guests)) if options.emptyingParty else base.npc_count
		rules.npc_count = npcs + extra
		if twists.has("extra_shot"):
			rules.bonus_shots = 1
	rules.night_plan = _crowd_plan(crowd_ids)
	round = NightRound.new({
		"options": options,
		"shared_screen": shared_screen,
		"suspicion": suspicion,
		"invite_holder": invite_holder,
		"invite_paused": current == "post_room" or finale,
		"wanted_id": _leader(),
		"nemesis": nemesis,
		"host_id": host_id,
		"perks": perks,
		"finale": finale,
		"random": random,
	})
	var round_ms := LastDanceRules.LENGTH_MS if finale else (SHORT_ROUND_MS if twists.has("short_fuse") else ROUND_MS)
	return {"rules": rules, "player_ids": crowd_ids, "ghosts": options.ghosts or finale, "round_ms": round_ms}


## score: {points, claimant} from NightScoring. crowd: the finished match, or null for a skipped room.
func record_round(score: Dictionary, crowd: CrowdMatch = null) -> void:
	var key := current
	var result := round.outcome(crowd) if crowd != null and round != null else {}
	var round_points := {}
	for id in player_ids():
		round_points[id] = 0
	var add := func(id: String, amount: int) -> void:
		if round_points.has(id):
			round_points[id] += amount
	for id in score.get("points", {}):
		add.call(id, score.points[id])
	for id in result.get("bonus", {}):
		add.call(id, result.bonus[id])

	if in_finale:
		finale_winner = crowd.result.get("winnerPlayerId", "") if crowd != null else ""
		for backer in backers:
			if backers[backer] == finale_winner:
				add.call(backer, NightData.POINTS.backedFinalist)

	if not result.is_empty():
		for id in result.suspicion:
			suspicion[id] = result.suspicion[id]
		for victim in result.nemesis:
			nemesis[victim] = result.nemesis[victim]
		if options.emptyingParty and not in_finale:
			guests = maxi(MIN_GUESTS, guests - result.npc_deaths)
		if options.invite and not in_finale and key != "post_room" and result.invite_holder != "":
			_invite_streak = 0 if result.invite_passed else _invite_streak + 1
			invite_holder = result.invite_holder
			add.call(invite_holder, -(INVITE_PENALTY + _invite_streak))
			_bump_stat(invite_holder, "rounds_with_invite")
		for id in result.contracts_done:
			_bump_stat(id, "contracts")
	if crowd != null:
		_record_stats(crowd)

	for id in round_points:
		points[id] += round_points[id]
	# Tips follow what you earned, plus a little extra for whoever is last, and for ghosts who drew fire.
	if options.shop:
		for id in round_points:
			tips[id] += maxi(0, round_points[id])
		var last := _last_place()
		if last != "":
			tips[last] += LAST_PLACE_TIPS
		if crowd != null:
			for slot: CrowdSlot in crowd.slots.values():
				if tips.has(slot.player_id):
					tips[slot.player_id] += slot.baits
	perks.clear()

	var claimant: String = score.get("claimant", "")
	if in_finale or not points.has(claimant):
		claimant = ""
	if key != "" and claimant != "":
		claims[key] = claimant
	if key != "":
		last_round = {"room": key, "points": round_points.duplicate(), "claimedBy": claimant}
		played.append(key)
	if in_finale:
		last_round = {"room": "ballroom", "points": round_points.duplicate()}
	if options.twists and not in_finale and played.size() < total_rounds:
		_add_twist()
	current = ""
	round = null
	host_id = ""
	if not is_over():
		_offer_rooms()
	else:
		offered = []
		picker_id = ""


## A room that ended without a match (e.g. abandoned) still uses up the room.
func skip_round() -> void:
	record_round({"points": {}})


## Where the night goes once the results of a room are done: "board", "shop", "mole_vote",
## "finale_pick" or "night_over".
func after_results() -> String:
	if finale_winner != "" or in_finale:
		in_finale = false
		return "night_over"
	if not is_over():
		if options.shop:
			shop_done.clear()
			return "shop"
		return "board"
	return _after_rounds()


func _after_rounds() -> String:
	if not mole.is_empty() and mole_reveal.is_empty():
		return "mole_vote"
	if options.finale and player_ids().size() >= 2 and finalists.is_empty():
		finalists = standings().slice(0, 2).map(func(standing: Dictionary) -> String: return standing.playerId)
		backers.clear()
		return "finale_pick"
	return "night_over"


func perk_available(info: Dictionary) -> bool:
	return not (info.get("needsPrivateText", false) and shared_screen) and (not info.has("needs") or options[info.needs])


## Returns an error message, or "" if the perk was bought.
func buy(player_id: String, perk_key: String) -> String:
	var info := NightData.perk(perk_key)
	if info.is_empty() or not perk_available(info):
		return "That perk isn't for sale tonight."
	if shop_done.has(player_id):
		return "You've already finished shopping."
	var refund: int = NightData.perk(perks[player_id]).cost if perks.has(player_id) else 0
	var have: int = tips.get(player_id, 0) + refund
	if have < info.cost:
		return "Not enough tips."
	tips[player_id] = have - info.cost
	perks[player_id] = perk_key
	# Some perks act straight away.
	if perk_key == "clean_slate":
		suspicion[player_id] = 0
	if perk_key == "pass_invite" and invite_holder == player_id:
		var others := player_ids().filter(func(id: String) -> bool: return id != player_id)
		var pick_index := random.index(others.size())
		invite_holder = others[pick_index] if not others.is_empty() else player_id
		_invite_streak = 0
	return ""


## True once everyone has finished shopping.
func finish_shopping(player_id: String) -> bool:
	shop_done[player_id] = true
	return player_ids().all(func(id: String) -> bool: return shop_done.has(id))


## Returns true once everyone has voted; an invalid vote returns false and changes nothing.
func vote_mole(voter_id: String, suspect_id: String) -> bool:
	if mole.is_empty() or not mole_reveal.is_empty():
		return false
	if not points.has(suspect_id) or suspect_id == voter_id:
		return false
	mole_votes[voter_id] = suspect_id
	return player_ids().all(func(id: String) -> bool: return mole_votes.has(id))


func reveal_mole() -> String:
	var tally := {}
	for voter in mole_votes:
		tally[mole_votes[voter]] = tally.get(mole_votes[voter], 0) + 1
	var top := 0
	for suspect in tally:
		top = maxi(top, tally[suspect])
	var accused := tally.keys().filter(func(id: String) -> bool: return tally[id] == top)
	var caught: bool = accused.size() == 1 and accused[0] == mole.id
	var ranked := standings()
	var objective_met: bool = not ranked.is_empty() and ranked[ranked.size() - 1].playerId == mole.target_id
	for voter in mole_votes:
		if mole_votes[voter] == mole.id and voter != mole.id:
			points[voter] += NightData.POINTS.moleCaughtVoter
	if objective_met and not caught:
		points[mole.id] += NightData.POINTS.moleUnnoticed
	mole_reveal = {"moleId": mole.id, "targetId": mole.target_id, "objectiveMet": objective_met, "caught": caught}
	return _after_rounds()


## True once every non-finalist has backed a finalist.
func back(player_id: String, finalist_id: String) -> bool:
	if not finalists.has(finalist_id) or finalists.has(player_id):
		return false
	backers[player_id] = finalist_id
	return player_ids().all(func(id: String) -> bool: return finalists.has(id) or backers.has(id))


func start_finale() -> void:
	in_finale = true
	host_id = ""


func remove_player(player_id: String) -> void:
	for map in [points, tips, suspicion, perks, backers, mole_votes, stats]:
		map.erase(player_id)
	for key in claims.keys():
		if claims[key] == player_id:
			claims.erase(key)
	for victim in nemesis.keys():
		if victim == player_id or nemesis[victim] == player_id:
			nemesis.erase(victim)
	shop_done.erase(player_id)
	if picker_id == player_id:
		picker_id = _last_place()
	if invite_holder == player_id:
		invite_holder = player_ids()[0] if not points.is_empty() else ""
	if not mole.is_empty() and (mole.id == player_id or mole.target_id == player_id):
		mole = {}


## Best first: [{playerId, points, rooms, connectedPairs, total}]. The Last Dance winner goes top whatever the points say.
func standings() -> Array:
	var rows := []
	for id in player_ids():
		var owned := NightData.ROOMS.filter(func(r: Dictionary) -> bool: return claims.get(r.key, "") == id)
		var pairs := 0
		for i in owned.size():
			for j in range(i + 1, owned.size()):
				if NightData.rooms_connected(owned[i], owned[j]):
					pairs += 1
		var total: int = points[id] + owned.size() * NightData.POINTS.claimedRoom + pairs * NightData.POINTS.connectedPair
		rows.append({"playerId": id, "points": points[id], "rooms": owned.size(), "connectedPairs": pairs, "total": total})
	var ranked := NightData.stable_sorted(rows, func(a: Dictionary, b: Dictionary) -> int:
		return (b.total - a.total) if b.total != a.total else (b.rooms - a.rooms))
	for i in ranked.size():
		if ranked[i].playerId == finale_winner and i > 0:
			var winner = ranked.pop_at(i)
			ranked.push_front(winner)
			break
	return ranked


## [{title, playerId, detail}]: a clear leader on one measure, or no award at all.
func awards() -> Array:
	var given := []
	var rooms_of := func(id: String) -> int: return claims.values().count(id)
	var plural := func(count: int, word: String) -> String: return "%d %s%s" % [count, word, "" if count == 1 else "s"]
	var award := func(title: String, score: Callable, detail: Callable) -> void:
		var rows := []
		for id in stats:
			rows.append({"id": id, "value": score.call(id, stats[id])})
		var ranked := NightData.stable_sorted(rows, func(a: Dictionary, b: Dictionary) -> float: return b.value - a.value)
		if ranked.is_empty() or ranked[0].value <= 0 or (ranked.size() > 1 and ranked[1].value == ranked[0].value):
			return
		given.append({"title": title, "playerId": ranked[0].id, "detail": detail.call(ranked[0].value)})
	award.call("Sharpshooter", func(_id, s): return s.takedowns, func(v): return plural.call(v, "takedown"))
	award.call("Most Paranoid", func(_id, s): return s.wasted, func(v): return plural.call(v, "wasted shot"))
	award.call("Best Actor", func(_id, s): return s.rounds_survived, func(v): return "survived " + plural.call(v, "round"))
	award.call("Landlord", func(id, _s): return rooms_of.call(id), func(v): return plural.call(v, "room") + " claimed")
	if options.invite:
		award.call("Social Butterfly", func(_id, s): return s.rounds_with_invite, func(v): return "ended %s holding the invite" % plural.call(v, "round"))
	if options.ghosts:
		award.call("Poltergeist", func(_id, s): return s.baits, func(v): return "drew %s as a ghost" % plural.call(v, "shot"))
	if options.contracts:
		award.call("Professional", func(_id, s): return s.contracts, func(v): return plural.call(v, "contract") + " done")
	if options.suspicion:
		award.call("Party Animal", func(id, _s): return suspicion.get(id, 0), func(v): return "ended the night on %d suspicion" % v)
	return given


## Everything public, plus `secret` for the one player it belongs to.
func snapshot_for(player_id: String, night_over: bool) -> Dictionary:
	var snap := {
		"totalRounds": total_rounds,
		"roundsPlayed": played.size(),
		"sharedScreen": shared_screen,
		"options": options.duplicate(),
		"guests": guests,
		"points": points.duplicate(),
		"tips": tips.duplicate(),
		"perks": perks.duplicate(),
		"shopDone": shop_done.keys(),
		"claims": claims.duplicate(),
		"played": played.duplicate(),
		"offered": offered.duplicate(),
		"pickerId": picker_id,
		"current": current,
		"lastRound": last_round.duplicate(true),
		"twists": twists.duplicate(),
		"hostId": host_id,
		"wantedId": _leader() if options.wanted else "",
		"nemesis": nemesis.duplicate() if options.nemesis else {},
		"finalists": finalists.duplicate(),
		"backers": backers.duplicate(),
		"finaleWinner": finale_winner,
		"moleVoted": mole_votes.keys(),
		"moleReveal": mole_reveal.duplicate(),
	}
	if night_over:
		snap.standings = standings()
		snap.awards = awards()
	if not mole.is_empty() and mole.id == player_id and mole_reveal.is_empty():
		snap.secret = {"moleTargetId": mole.target_id}
	return snap


func _record_stats(crowd: CrowdMatch) -> void:
	for slot: CrowdSlot in crowd.slots.values():
		var s: Dictionary = stats.get(slot.player_id, {})
		if s.is_empty():
			continue
		s.shots += slot.shots_fired
		s.wasted += slot.wasted_shots
		s.takedowns += slot.takedowns.size()
		s.baits += slot.baits
		if slot.entity.dead:
			s.times_down += 1
		elif not slot.entity.hidden:
			s.rounds_survived += 1


func _bump_stat(player_id: String, key: String) -> void:
	if stats.has(player_id):
		stats[player_id][key] += 1


## Guests edge away from very suspicious players, and a restless crowd rarely stands still.
## The wrapper reaches the mode's own plan through crowd.rules, so it holds no reference back to the rules.
func _crowd_plan(crowd_ids: Array) -> Callable:
	var suspects: Array = crowd_ids.filter(func(id: String) -> bool: return suspicion.get(id, 0) >= NightRound.SUSPICION.avoidedAt) if options.suspicion else []
	var restless := twists.has("restless")
	if suspects.is_empty() and not restless:
		return Callable()
	return func(entity: CrowdEntity, plan_random: CrowdRandom, area: Dictionary, crowd: CrowdMatch) -> Dictionary:
		var next := crowd.rules.npc_plan(entity, plan_random, area, crowd)
		if restless and CrowdMovement.is_still(next.direction) and plan_random.next() < 0.7:
			next = crowd.rules.npc_plan(entity, plan_random, area, crowd)
		for id in suspects:
			var slot: CrowdSlot = crowd.slots.get(id)
			if slot == null or slot.entity.dead or slot.entity.hidden:
				continue
			var dx := entity.x - slot.entity.x
			var dy := entity.y - slot.entity.y
			var gap := sqrt(dx * dx + dy * dy)
			if gap < 90 and plan_random.next() < 0.6:
				var length := gap if gap != 0 else 1.0
				var away_x := signf(CrowdMovement.js_round(dx / length * 2))
				var away_y := signf(CrowdMovement.js_round(dy / length * 2))
				var diagonal := sqrt(0.5) if away_x != 0 and away_y != 0 else 1.0
				return CrowdRules.plan(CrowdMovement.vec(away_x * diagonal, away_y * diagonal), 900)
		return next


## Lowest suspicion wins a Last Dance where nobody was hit; a tie goes to the higher total.
func _calmest(ids: Array) -> String:
	if ids.is_empty():
		return ""
	var ranked := NightData.stable_sorted(ids, func(a: String, b: String) -> float: return suspicion.get(a, 0) - suspicion.get(b, 0))
	if ranked.size() >= 2 and suspicion.get(ranked[0]) == suspicion.get(ranked[1]):
		var totals := {}
		for standing in standings():
			totals[standing.playerId] = standing.total
		ranked = NightData.stable_sorted(ranked, func(a: String, b: String) -> float: return totals.get(b, 0) - totals.get(a, 0))
	return ranked[0]


func _choose_host() -> String:
	var ids := player_ids()
	if not options.host or ids.size() < NightData.HOST_MIN_PLAYERS:
		return ""
	var fewest := INF
	for id in ids:
		fewest = minf(fewest, _host_counts.get(id, 0))
	var candidates := random.shuffle(ids.filter(func(id: String) -> bool: return _host_counts.get(id, 0) == fewest))
	var chosen: String = candidates[0]
	_host_counts[chosen] = int(fewest) + 1
	return chosen


## The clear points leader, if there is one.
func _leader() -> String:
	var ranked := NightData.stable_sorted(points.keys(), func(a: String, b: String) -> int: return points[b] - points[a])
	if ranked.is_empty() or points[ranked[0]] <= 0 or (ranked.size() > 1 and points[ranked[1]] == points[ranked[0]]):
		return ""
	return ranked[0]


func _add_twist() -> void:
	var left := NightData.TWISTS.filter(func(twist: Dictionary) -> bool: return not twists.has(twist.key))
	if not left.is_empty():
		twists.append(left[random.index(left.size())].key)


func _offer_rooms() -> void:
	var open := _rooms.filter(func(r: Dictionary) -> bool: return not played.has(r.key)).map(func(r: Dictionary) -> String: return r.key)
	offered = random.shuffle(open).slice(0, NightData.OPTION_COUNT)
	picker_id = _last_place()


## Last place picks. Ties go to whoever owns fewer rooms, then to chance.
func _last_place() -> String:
	var ids := player_ids()
	if ids.is_empty():
		return ""
	var owned := func(id: String) -> int: return claims.values().count(id)
	var order := NightData.stable_sorted(random.shuffle(ids), func(a: String, b: String) -> int:
		return (points[a] - points[b]) if points[a] != points[b] else (owned.call(a) - owned.call(b)))
	return order[0]
