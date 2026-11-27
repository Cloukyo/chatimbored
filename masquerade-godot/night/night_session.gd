class_name NightSession
extends RefCounted
## Runs a whole night for one group, start to finish: the board, each room's match, results, the shop,
## the Mole vote, the Last Dance and the final standings. This is what the host's copy of the game runs;
## it plays the part of the server's Room and RoomManager for a night.
##
## phase: "board" -> "in_game" -> "results" -> ("shop" ->) "board" ... then "mole_vote", "finale_pick",
## the Last Dance ("in_game" -> "results"), and "night_over".

var night: MasqueradeNight
## [{id, name}], in join order. The first player is the group's host.
var players: Array
var phase := "board"
var crowd: CrowdMatch = null
var ms_left := 0
## Makes the random generator for each room's match. Tests pass a seeded one.
var match_random: Callable


func _init(night_players: Array, rounds: int, shared_screen: bool, night_random: CrowdRandom = null, options: Dictionary = {}, make_match_random: Callable = Callable()) -> void:
	players = night_players
	var ids := players.map(func(player: Dictionary) -> String: return player.id)
	night = MasqueradeNight.new(ids, rounds, shared_screen, night_random if night_random != null else CrowdRandom.fresh(), options)
	match_random = make_match_random if make_match_random.is_valid() else CrowdRandom.fresh


func host_id() -> String:
	return players[0].id if not players.is_empty() else ""


func name_of(player_id: String) -> String:
	for player in players:
		if player.id == player_id:
			return player.name
	return "Someone"


## Returns an error message, or "" once the room has started.
func pick_room(player_id: String, key: String) -> String:
	if phase != "board":
		return "Nothing to pick right now."
	if not night.can_pick(player_id, player_id == host_id()):
		return "It's someone else's pick."
	if players.size() < 2:
		return "A round needs at least 2 players."
	var room := night.pick(key)
	if room.is_empty():
		return "That room isn't on offer."
	_start(CrowdModes.make(room.mode))
	return ""


func handle_input(player_id: String, input: Dictionary) -> void:
	if phase != "in_game" or crowd == null:
		return
	if player_id == night.host_id and night.round != null:
		night.round.host_input(crowd, input)
	else:
		crowd.queue_input(player_id, input)


## One 50 ms step. Ends the room once it's decided or out of time.
func update() -> void:
	if phase != "in_game" or crowd == null:
		return
	crowd.step()
	ms_left = maxi(0, ms_left - CrowdMovement.TICK_MS)
	if crowd.is_over() or ms_left <= 0:
		finish_round()


func finish_round() -> void:
	if phase != "in_game":
		return
	crowd.timeout()
	night.record_round(NightScoring.score_round(crowd), crowd)
	phase = "results"


## The host moves on from a room's results.
func next(player_id: String) -> void:
	if phase == "results" and player_id == host_id():
		crowd = null
		phase = night.after_results()


## Between-room choices. action: {kind: "buy" | "done" | "vote" | "back" | "skip", perk?, playerId?}
## Returns an error message, or "".
func night_action(player_id: String, action: Dictionary) -> String:
	var is_host := player_id == host_id()
	var kind: String = action.get("kind", "")
	match phase:
		"shop":
			if kind == "buy":
				var error := night.buy(player_id, action.get("perk", ""))
				if error != "":
					return error
			if (kind == "done" and night.finish_shopping(player_id)) or (kind == "skip" and is_host):
				phase = "board"
		"mole_vote":
			if (kind == "vote" and night.vote_mole(player_id, action.get("playerId", ""))) or (kind == "skip" and is_host):
				phase = night.reveal_mole()
		"finale_pick":
			if (kind == "back" and night.back(player_id, action.get("playerId", ""))) or (kind == "skip" and is_host):
				night.start_finale()
				_start(null)
		_:
			return "Nothing to do right now."
	return ""


func remove_player(player_id: String) -> void:
	players = players.filter(func(player: Dictionary) -> bool: return player.id != player_id)
	if crowd != null and phase == "in_game":
		crowd.remove_player(player_id)
	night.remove_player(player_id)


## The room as one player may see it right now. The night's host watches from above.
func crowd_view_for(player_id: String) -> Dictionary:
	if crowd == null:
		return {}
	var view := crowd.view_for(player_id) if crowd.slots.has(player_id) else crowd.spectator_view("host")
	if night.round != null:
		view.party = night.round.party_view(crowd, player_id, name_of)
	return view


func night_view_for(player_id: String) -> Dictionary:
	return night.snapshot_for(player_id, phase == "night_over")


func _start(base: CrowdRules) -> void:
	var prep := night.prepare_round(base)
	crowd = CrowdMatch.new(prep.rules, prep.player_ids, match_random.call(), {"ghosts": prep.ghosts, "observer": night.round})
	night.round.begin(crowd)
	ms_left = prep.round_ms
	phase = "in_game"
