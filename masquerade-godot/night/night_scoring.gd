class_name NightScoring
extends RefCounted
## Points for one finished room. Works from the result and the match's bookkeeping, so the modes
## themselves don't need to know about the night. Ported from server/src/party/scoring.ts.


## {points: player -> points, claimant: who claims the room ("" for nobody)}
static func score_round(crowd: CrowdMatch) -> Dictionary:
	var r := crowd.result if crowd.is_over() else crowd.timeout()
	var team: bool = r.has("winnerRole")
	var points := {}
	for id in crowd.slots:
		points[id] = 0
	var winners := []
	for slot: CrowdSlot in crowd.slots.values():
		if (team and slot.role == r.winnerRole) or (not team and slot.player_id == r.get("winnerPlayerId", "")):
			winners.append(slot)
	for slot: CrowdSlot in winners:
		points[slot.player_id] += NightData.POINTS.teamWin if team else NightData.POINTS.soloWin
	for slot: CrowdSlot in crowd.slots.values():
		var opponents := 0
		for victim_id in slot.takedowns:
			if _is_opponent(slot, crowd.slots.get(victim_id)):
				opponents += 1
		points[slot.player_id] += opponents * NightData.POINTS.takedown
		# Lookouts never stand in the crowd, so surviving isn't an achievement for them.
		if not slot.entity.dead and not slot.entity.hidden and slot.connected:
			points[slot.player_id] += NightData.POINTS.survive
	return {"points": points, "claimant": _claimant(winners, points, team, crowd.random)}


## In free-for-all modes everyone is a "runner", so any other player counts. Otherwise only the other side does.
static func _is_opponent(slot: CrowdSlot, victim: CrowdSlot) -> bool:
	if victim == null:
		return false
	return slot.role == "runner" or victim.role != slot.role


## The solo winner, or the top scorer on the winning team (ties drawn at random).
static func _claimant(winners: Array, points: Dictionary, team: bool, random: CrowdRandom) -> String:
	if not team:
		return winners[0].player_id if not winners.is_empty() else ""
	if winners.is_empty():
		return ""
	var best := -INF
	for slot: CrowdSlot in winners:
		best = maxf(best, points[slot.player_id])
	var top := winners.filter(func(slot: CrowdSlot) -> bool: return points[slot.player_id] == best)
	return top[random.index(top.size())].player_id
