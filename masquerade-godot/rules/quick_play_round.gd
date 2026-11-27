class_name QuickPlayRound
extends RefCounted
## One quick-play room for a group of players: runs the CrowdMatch on a fixed 20 Hz step, keeps the
## score table and hands out per-player views. Ported from server/src/minigames/CrowdGames.ts.
## Hidden state stays on the match; nothing here names a role or ties a player to a figure.

const ROUND_MS := 90_000

var mode: String
var crowd: CrowdMatch
## [{id, name, score}], in join order.
var players: Array = []
var ms_left := ROUND_MS
## Who won: a player id, or a team ("hunters", "lookouts", ...). Empty while the round is on.
var winner_id := ""
var finished := false


## players: [{id, name, score}]. Scores carry over between rounds.
func _init(round_mode: String, round_players: Array, random: CrowdRandom = null) -> void:
	mode = round_mode
	players = round_players
	var ids := players.map(func(player: Dictionary) -> String: return player.id)
	crowd = CrowdMatch.new(CrowdModes.make(mode), ids, random if random != null else CrowdRandom.fresh())


func handle_input(player_id: String, input: Dictionary) -> void:
	crowd.queue_input(player_id, input)


## One 50 ms step.
func update() -> void:
	if finished:
		return
	crowd.step()
	ms_left = maxi(0, ms_left - CrowdMovement.TICK_MS)
	if crowd.is_over():
		winner_id = _winner_of()


func player_left(player_id: String) -> void:
	crowd.remove_player(player_id)
	if crowd.is_over():
		winner_id = _winner_of()


## Ends the round (on time or after a win) and scores it: one point for every winner.
func finish() -> void:
	if finished:
		return
	crowd.timeout()
	winner_id = _winner_of()
	var winners := _winning_ids()
	for player in players:
		if winners.has(player.id):
			player.score += 1
	finished = true


func should_finish() -> bool:
	return crowd.is_over() or ms_left <= 0


func scores() -> Dictionary:
	var table := {}
	for player in players:
		table[player.id] = player.score
	return table


func view_for(player_id: String) -> Dictionary:
	var view := crowd.view_for(player_id)
	if view.is_empty():
		view = crowd.spectator_view("lookout")
	return view


func _winner_of() -> String:
	var r := crowd.result
	return r.get("winnerPlayerId", r.winner)


func _winning_ids() -> Dictionary:
	var r := crowd.result
	var ids := {}
	if r.has("winnerRole"):
		for slot: CrowdSlot in crowd.slots.values():
			if slot.role == r.winnerRole:
				ids[slot.player_id] = true
	elif r.has("winnerPlayerId"):
		ids[r.winnerPlayerId] = true
	return ids
