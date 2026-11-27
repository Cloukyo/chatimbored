class_name PlayDriver
extends RefCounted
## Runs a game on one screen for a set of seats: quick play (a set of rooms, a point per win) or a whole
## night. A seat is {id, name, device}: device "keyboard", a controller's device id, or "bot" for a
## computer player who walks with the crowd. The 3D game and the flat test bench both use this.
##
## With more than one person at the screen it is a shared screen: nobody's figure is marked and
## controllers get their secrets as rumble. With one person, the view is theirs.

const PAD_SHOT_REACH := 400.0
const PAD_SHOT_CONE := PI / 7
const PAD_SHOT_RANGE := 900.0
const PAD_CURSOR_REACH := 40.0
const PAD_CURSOR_SPEED := 900.0
const STICK_DEADZONE := 0.4
const BOT_THINK_SECONDS := 1.2
## Rumble patterns: pulses of {ms, strong, gap}.
const CUES := {
	"special": [{"ms": 700, "strong": 0.9}],
	"ordinary": [{"ms": 120, "strong": 0.5, "gap": 120}, {"ms": 120, "strong": 0.5}],
	"tick": [{"ms": 90, "strong": 0.6}],
	"heartbeat": [{"ms": 80, "strong": 0.7, "gap": 90}, {"ms": 80, "strong": 0.5}],
	"dark": [{"ms": 160, "strong": 0.25}],
	"down": [{"ms": 500, "strong": 0.4}],
	"invite": [{"ms": 60, "strong": 0.3, "gap": 120}, {"ms": 60, "strong": 0.3, "gap": 120}, {"ms": 60, "strong": 0.3}],
}
const PULSE_MS := {"holding": 1000, "holdingLate": 500, "dark": 450, "invite": 3000}

var seats: Array = []
var kind := "quick"
var rumble_enabled := true

## Quick play: the rooms in order, and how many make a set (0: keep going).
var quick_rooms: Array = []
var quick_set := 0
var round_index := 0
var game: QuickPlayRound = null
var quick_players: Array = []
## "in_game", "results" or "over".
var quick_phase := "in_game"

var session: NightSession = null

## seat id -> arena point: where a Lookout's or the host's controller is aiming from above.
var cursors := {}
## For the keyboard seat when it aims from above: where the mouse points on the floor.
var mouse_point: Variant = null

var clock_ms := 0.0
var _accumulator := 0.0
var _seqs := {}
var _pad_was := {}
var _cue_state := {}
var _rumble_queue: Array = []
var _bot_wait := 0.0
var _round_crowd: CrowdMatch = null


func _init(seat_list: Array = []) -> void:
	seats = seat_list if not seat_list.is_empty() else default_seats()


## Keyboard as player 1, each connected controller next, computer players up to four seats.
static func default_seats(count := 4) -> Array:
	var list := [{"id": "p1", "name": "Player 1", "device": "keyboard"}]
	for device in Input.get_connected_joypads():
		if list.size() >= count:
			break
		list.append({"id": "p%d" % (list.size() + 1), "name": "Player %d" % (list.size() + 1), "device": device})
	while list.size() < count:
		list.append({"id": "p%d" % (list.size() + 1), "name": "Guest %d" % list.size(), "device": "bot"})
	return list


func humans() -> Array:
	return seats.filter(func(seat: Dictionary) -> bool: return not _is_bot(seat))


func shared() -> bool:
	return humans().size() > 1


func seat(player_id: String) -> Dictionary:
	for s in seats:
		if s.id == player_id:
			return s
	return {}


func name_of(player_id: String) -> String:
	var s := seat(player_id)
	return s.name if not s.is_empty() else "Someone"


# ------------------------------------------------------------------ starting

## rooms: mode ids in play order. set_size 0 keeps going round the list.
func start_quick(rooms: Array = [], set_size := 0) -> void:
	kind = "quick"
	session = null
	quick_rooms = rooms if not rooms.is_empty() else CrowdModes.ids()
	quick_set = set_size
	quick_players = seats.map(func(s: Dictionary) -> Dictionary: return {"id": s.id, "name": s.name, "score": 0})
	_start_quick_round()


func next_room() -> void:
	round_index += 1
	_start_quick_round()


func restart_room() -> void:
	if kind == "quick":
		_start_quick_round()


func start_night(rounds := 4, options := {}) -> void:
	kind = "night"
	game = null
	var players := seats.map(func(s: Dictionary) -> Dictionary: return {"id": s.id, "name": s.name})
	session = NightSession.new(players, rounds, shared(), null, options)
	_round_crowd = null


func _start_quick_round() -> void:
	var mode: String = quick_rooms[round_index % quick_rooms.size()]
	game = QuickPlayRound.new(mode, quick_players)
	quick_phase = "in_game"
	_new_round(game.crowd)


func _new_round(crowd_match: CrowdMatch) -> void:
	_round_crowd = crowd_match
	_cue_state.clear()
	cursors.clear()
	for s in seats:
		var slot: CrowdSlot = crowd_match.slots.get(s.id)
		if _is_bot(s) and slot != null and not slot.entity.hidden:
			slot.entity.give_brain()


# ------------------------------------------------------------------ where things are

## "in_game", "results", "over" in quick play; the night's phase in a night.
func phase() -> String:
	return session.phase if session != null else quick_phase


func crowd() -> CrowdMatch:
	if session != null:
		return session.crowd
	return game.crowd if game != null else null


func ms_left() -> int:
	return session.ms_left if session != null else (game.ms_left if game != null else 0)


## What the screen shows: the one person's own view, or on a shared screen a view that marks nobody.
func view() -> Dictionary:
	var c := crowd()
	if c == null:
		return {}
	if not shared():
		var people := humans()
		return seat_view(people[0].id if not people.is_empty() else seats[0].id)
	var shown := c.spectator_view("shared")
	if session != null and session.night.round != null:
		shown.party = session.night.round.party_view(c, "", name_of)
		var host_id := session.night.host_id
		if host_id != "":
			var host_party: Dictionary = session.night.round.party_view(c, host_id, name_of)
			shown.party.hostName = name_of(host_id)
			shown.party.trick = host_party.get("trick", "")
			shown.party.tricksLeft = host_party.get("tricksLeft", 0)
	return shown


## One seat's own view of the round.
func seat_view(player_id: String) -> Dictionary:
	if session != null:
		return session.crowd_view_for(player_id)
	if game == null:
		return {}
	return game.view_for(player_id)


static func aims_from_above(seat_view_dict: Dictionary) -> bool:
	return seat_view_dict.get("role", "") == "lookout" or seat_view_dict.get("role", "") == "host"


static func can_shoot(seat_view_dict: Dictionary) -> bool:
	if seat_view_dict.get("role", "") == "host":
		return seat_view_dict.get("party", {}).get("tricksLeft", 0) > 0
	return seat_view_dict.get("shots", 0) > 0


## [{at, ready}] for every seat aiming from above, to draw on the floor.
func crosshairs() -> Array:
	var list := []
	if crowd() == null or phase() != "in_game":
		return list
	for s in humans():
		var v := seat_view(s.id)
		if not aims_from_above(v):
			continue
		var at: Variant = mouse_point if s.device is String else cursors.get(s.id)
		if at != null:
			list.append({"at": at, "ready": can_shoot(v)})
	return list


# ------------------------------------------------------------------ running

## Steps the rules at their fixed rate. `keyboard` returns the keyboard seat's input for a tick (null: none).
func advance(delta: float, keyboard: Callable) -> void:
	clock_ms += delta * 1000.0
	_accumulator += delta
	while _accumulator >= CrowdMovement.TICK_SECONDS:
		_accumulator -= CrowdMovement.TICK_SECONDS
		_tick(keyboard)
	_bots_choose(delta)
	_fire_rumble()


func _tick(keyboard: Callable) -> void:
	if phase() != "in_game":
		_pad_was.clear()
		return
	for s in seats:
		if _is_bot(s):
			continue
		var input: Variant = keyboard.call() if s.device is String else _pad_input(s)
		if input != null:
			_send(s.id, input)
	if session != null:
		session.update()
	else:
		game.update()
		if game.should_finish() and not game.finished:
			game.finish()
			quick_phase = "results"
	var c := crowd()
	if c != null and c != _round_crowd:
		_new_round(c)
	if c != null:
		for s in humans():
			if not (s.device is String):
				_cue(s)


func _send(player_id: String, input: Dictionary) -> void:
	_seqs[player_id] = _seqs.get(player_id, 0) + 1
	input.seq = _seqs[player_id]
	if session != null:
		session.handle_input(player_id, input)
	else:
		game.handle_input(player_id, input)


## After a quick-play room's results: the next room, or the end of the set.
func continue_quick() -> void:
	if quick_phase == "results":
		if quick_set > 0 and round_index + 1 >= quick_set:
			quick_phase = "over"
		else:
			next_room()


## Quick-play standings, best first: [{id, name, score}].
func quick_standings() -> Array:
	var rows := quick_players.duplicate()
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.score > b.score)
	return rows


# ------------------------------------------------------------------ the night's choices

## On the night's board, the host (seat 1) picks for the picker: used by the test bench.
func pick(choice: int) -> void:
	if session == null or session.phase != "board" or choice >= session.night.offered.size():
		return
	session.pick_room(session.night.picker_id, session.night.offered[choice])


## Moves the night on as its host: past results, and skips the shop, the vote and backing.
func night_continue() -> void:
	if session == null:
		return
	match session.phase:
		"results":
			session.next(session.host_id())
		"shop", "mole_vote", "finale_pick":
			session.night_action(session.host_id(), {"kind": "skip"})


## Computer players make their between-room choices after a short pause.
func _bots_choose(delta: float) -> void:
	if session == null:
		return
	var phase_now := session.phase
	if phase_now == "in_game" or phase_now == "results" or phase_now == "night_over":
		_bot_wait = 0.0
		return
	_bot_wait += delta
	if _bot_wait < BOT_THINK_SECONDS:
		return
	_bot_wait = 0.0
	var night := session.night
	var random := RandomNumberGenerator.new()
	match phase_now:
		"board":
			var picker := seat(night.picker_id)
			if _is_bot(picker) and not night.offered.is_empty():
				session.pick_room(night.picker_id, night.offered[random.randi() % night.offered.size()])
		"shop":
			for s in seats:
				if _is_bot(s) and not night.shop_done.has(s.id):
					session.night_action(s.id, {"kind": "done"})
		"mole_vote":
			for s in seats:
				if _is_bot(s) and not night.mole_votes.has(s.id):
					var others: Array = night.player_ids().filter(func(id: String) -> bool: return id != s.id)
					if not others.is_empty():
						session.night_action(s.id, {"kind": "vote", "playerId": others[random.randi() % others.size()]})
		"finale_pick":
			for s in seats:
				if _is_bot(s) and not night.finalists.has(s.id) and not night.backers.has(s.id):
					session.night_action(s.id, {"kind": "back", "playerId": night.finalists[random.randi() % night.finalists.size()]})


# ------------------------------------------------------------------ controllers

func _pad_input(s: Dictionary) -> Variant:
	var device: int = s.device
	var v := seat_view(s.id)
	if v.is_empty() or v.has("result"):
		return null
	var was: Dictionary = _pad_was.get(device, {})
	var act_down := Input.is_joy_button_pressed(device, JOY_BUTTON_A)
	var shoot_down := Input.is_joy_button_pressed(device, JOY_BUTTON_X) or Input.get_joy_axis(device, JOY_AXIS_TRIGGER_RIGHT) > 0.5
	_pad_was[device] = {"act": act_down, "shoot": shoot_down}
	var move := _left_stick(device)
	var run: bool = (Input.is_joy_button_pressed(device, JOY_BUTTON_B) or Input.is_joy_button_pressed(device, JOY_BUTTON_RIGHT_SHOULDER)) and v.get("canRun", false) and not v.get("ghost", false)
	var input := {"move": {"x": move.x, "y": move.y}, "run": run, "act": act_down and not was.get("act", false)}
	if aims_from_above(v):
		_move_cursor(s.id, device, v)
	if shoot_down and not was.get("shoot", false) and can_shoot(v):
		var target := _pad_target(s.id, device, v)
		if not target.is_empty():
			input.shoot = target.at
			if target.has("id"):
				input.shootAt = target.id
	return input


static func _left_stick(device: int) -> Vector2:
	var x := float(Input.is_joy_button_pressed(device, JOY_BUTTON_DPAD_RIGHT)) - float(Input.is_joy_button_pressed(device, JOY_BUTTON_DPAD_LEFT))
	var y := float(Input.is_joy_button_pressed(device, JOY_BUTTON_DPAD_DOWN)) - float(Input.is_joy_button_pressed(device, JOY_BUTTON_DPAD_UP))
	if x != 0 or y != 0:
		return Vector2(x, y)
	return _stick(device, JOY_AXIS_LEFT_X, JOY_AXIS_LEFT_Y)


static func _stick(device: int, x_axis: JoyAxis, y_axis: JoyAxis) -> Vector2:
	var v := Vector2(Input.get_joy_axis(device, x_axis), Input.get_joy_axis(device, y_axis))
	return Vector2.ZERO if v.length() < STICK_DEADZONE else v


func _move_cursor(player_id: String, device: int, v: Dictionary) -> void:
	var arena: Dictionary = v.arena
	var cursor: Dictionary = cursors.get(player_id, {"x": arena.width / 2, "y": arena.height / 2})
	var right := _stick(device, JOY_AXIS_RIGHT_X, JOY_AXIS_RIGHT_Y)
	var stick := right if right != Vector2.ZERO else _left_stick(device)
	var step := PAD_CURSOR_SPEED * CrowdMovement.TICK_SECONDS
	cursors[player_id] = {"x": clampf(cursor.x + stick.x * step, 0, arena.width), "y": clampf(cursor.y + stick.y * step, 0, arena.height)}


## Controller shots go to whoever is nearest the right stick's direction (or the way the figure faces).
## A Lookout's cursor picks whoever is nearest it.
func _pad_target(player_id: String, device: int, v: Dictionary) -> Dictionary:
	var candidates := crowd().visible_entities().filter(func(e: CrowdEntity) -> bool: return e.id != v.you and not e.dead)
	if aims_from_above(v):
		if not cursors.has(player_id):
			return {}
		var cursor: Dictionary = cursors[player_id]
		var best: CrowdEntity = null
		var best_distance := PAD_CURSOR_REACH
		for e: CrowdEntity in candidates:
			var distance := Vector2(e.x - cursor.x, e.y - cursor.y).length()
			if distance <= best_distance:
				best = e
				best_distance = distance
		if best != null:
			return {"at": CrowdMovement.vec(best.x, best.y), "id": best.id}
		return {"at": CrowdMovement.vec(cursor.x, cursor.y)}
	var me: CrowdEntity = null
	for e: CrowdEntity in crowd().visible_entities():
		if e.id == v.you:
			me = e
	if me == null:
		return {}
	var aim := _stick(device, JOY_AXIS_RIGHT_X, JOY_AXIS_RIGHT_Y)
	var angle := aim.angle() if aim != Vector2.ZERO else me.facing * PI / 4
	var chosen: CrowdEntity = null
	var best_score := INF
	for e: CrowdEntity in candidates:
		var offset := Vector2(e.x - me.x, e.y - me.y)
		var distance := offset.length()
		var off := absf(wrapf(offset.angle() - angle, -PI, PI))
		if distance < 1 or distance > PAD_SHOT_RANGE or off > PAD_SHOT_CONE:
			continue
		var score := off + distance / PAD_SHOT_RANGE / 10
		if score < best_score:
			chosen = e
			best_score = score
	if chosen != null:
		return {"at": CrowdMovement.vec(chosen.x, chosen.y), "id": chosen.id}
	return {"at": CrowdMovement.vec(me.x + cos(angle) * PAD_SHOT_REACH, me.y + sin(angle) * PAD_SHOT_REACH)}


## Entity under a point, for mouse shots.
func entity_near(point: Vector2, reach: float) -> CrowdEntity:
	var best: CrowdEntity = null
	if crowd() == null:
		return null
	for e: CrowdEntity in crowd().visible_entities():
		if not e.dead and Vector2(e.x, e.y).distance_to(point) <= reach:
			if best == null or Vector2(e.x, e.y).distance_to(point) < Vector2(best.x, best.y).distance_to(point):
				best = e
	return best


# ------------------------------------------------------------------ rumble

## Private news for a controller player, felt rather than shown (the same cues as the web version).
func _cue(s: Dictionary) -> void:
	var v := seat_view(s.id)
	if v.is_empty() or v.has("result"):
		return
	var state: Dictionary = _cue_state.get(s.id, {})
	_cue_state[s.id] = state
	if not state.has("cued"):
		state.cued = true
		state.mine = v.mine.size()
		state.alive = v.alive
		state.pulse = 0.0
		state.invite = 0.0
		if v.role != "host":
			rumble(s.device, "special" if v.role == "killer" or v.role == "ringer" else "ordinary")
		return
	if state.alive and not v.alive:
		rumble(s.device, "down")
	state.alive = v.alive
	if v.mine.size() > state.mine:
		rumble(s.device, "tick")
	state.mine = v.mine.size()
	if v.get("party", {}).get("holdingInvite", false) and clock_ms - state.invite >= PULSE_MS.invite:
		state.invite = clock_ms
		rumble(s.device, "invite")
	if not v.alive:
		return
	var hud: Dictionary = v.hud
	if hud.get("holding", false):
		var every: int = PULSE_MS.holdingLate if hud.get("fuseSeconds", 10) <= 3 else PULSE_MS.holding
		if clock_ms - state.pulse >= every:
			state.pulse = clock_ms
			rumble(s.device, "heartbeat")
	elif hud.get("darkMs", 0) > 0 and clock_ms - state.pulse >= PULSE_MS.dark:
		state.pulse = clock_ms
		rumble(s.device, "dark")


func rumble(device: Variant, cue_name: String) -> void:
	if not rumble_enabled or device is String:
		return
	var at := clock_ms
	for pulse: Dictionary in CUES[cue_name]:
		_rumble_queue.append({"at": at, "device": device, "strong": pulse.strong, "ms": pulse.ms})
		at += pulse.ms + pulse.get("gap", 0)


func _fire_rumble() -> void:
	var waiting := []
	for pulse: Dictionary in _rumble_queue:
		if pulse.at <= clock_ms:
			Input.start_joy_vibration(pulse.device, pulse.strong * 0.6, pulse.strong, pulse.ms / 1000.0)
		else:
			waiting.append(pulse)
	_rumble_queue = waiting


static func _is_bot(s: Dictionary) -> bool:
	return s.get("device") is String and s.device == "bot"
