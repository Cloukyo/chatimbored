class_name PlayDriver
extends RefCounted
## Runs a local game on one screen: quick play (one room after another) or a full night, with the
## keyboard as player 1 and each controller as the next player. Seats nobody sits in walk with the crowd.
## Both the 3D game and the flat test bench use this, so they play the same.

const PLAYER_COUNT := 4
const KEYBOARD := "p1"

var round_index := 0
var game: QuickPlayRound = null
## Set while a full night is running instead of quick play.
var session: NightSession = null
## device id -> player id
var pads := {}
var _accumulator := 0.0
var _seqs := {}
var _pad_shot_down := {}


func players() -> Array:
	var list := []
	for i in PLAYER_COUNT:
		list.append({"id": "p%d" % (i + 1), "name": "Player %d" % (i + 1), "score": 0})
	return list


func name_of(player_id: String) -> String:
	if session != null:
		return session.name_of(player_id)
	return "Player " + player_id.substr(1)


func start_quick() -> void:
	session = null
	var mode: String = CrowdModes.ids()[round_index % CrowdModes.ids().size()]
	game = QuickPlayRound.new(mode, players())
	_fill_empty_seats(game.crowd, _seat_pads())


func next_room() -> void:
	round_index += 1
	start_quick()


func start_night() -> void:
	session = NightSession.new(players(), 4, false)
	_seat_pads()


## On the night's board: the picker chooses one of the offered rooms (0-2).
func pick(choice: int) -> void:
	if session == null or session.phase != "board" or choice >= session.night.offered.size():
		return
	session.pick_room(session.night.picker_id, session.night.offered[choice])
	_fill_empty_seats(session.crowd, pads.size() + 2)


## Moves the night on: past results, and skips the shop, the vote and backing as the group's host.
func night_continue() -> void:
	if session == null:
		return
	match session.phase:
		"results":
			session.next(session.host_id())
		"shop", "mole_vote":
			session.night_action(session.host_id(), {"kind": "skip"})
		"finale_pick":
			session.night_action(session.host_id(), {"kind": "skip"})
			if session.crowd != null:
				_fill_empty_seats(session.crowd, pads.size() + 2)


## Steps the rules at their fixed rate. `keyboard` returns player 1's input for a tick (null: none).
func advance(delta: float, keyboard: Callable) -> void:
	_accumulator += delta
	while _accumulator >= CrowdMovement.TICK_SECONDS:
		_accumulator -= CrowdMovement.TICK_SECONDS
		var input: Variant = keyboard.call()
		if input != null:
			_send(KEYBOARD, input)
		for device in pads:
			_send(pads[device], _pad_input(device, pads[device]))
		if session != null:
			session.update()
		else:
			game.update()
			if game.should_finish() and not game.finished:
				game.finish()


func crowd() -> CrowdMatch:
	if session != null:
		return session.crowd
	return game.crowd


## The keyboard player's view of the round on screen, or {} between rounds of a night.
func view() -> Dictionary:
	if session != null:
		return session.crowd_view_for(KEYBOARD) if session.crowd != null else {}
	return game.view_for(KEYBOARD)


func ms_left() -> int:
	return session.ms_left if session != null else game.ms_left


func _seat_pads() -> int:
	pads.clear()
	var next := 2
	for device in Input.get_connected_joypads():
		if next > PLAYER_COUNT:
			break
		pads[device] = "p%d" % next
		next += 1
	return next


func _fill_empty_seats(round_crowd: CrowdMatch, first_empty: int) -> void:
	for i in range(first_empty, PLAYER_COUNT + 1):
		var slot: CrowdSlot = round_crowd.slots.get("p%d" % i)
		if slot != null and not slot.entity.hidden:
			slot.entity.give_brain()


func _send(player_id: String, input: Dictionary) -> void:
	_seqs[player_id] = _seqs.get(player_id, 0) + 1
	input.seq = _seqs[player_id]
	if session != null:
		session.handle_input(player_id, input)
	else:
		game.handle_input(player_id, input)


func _pad_input(device: int, player_id: String) -> Dictionary:
	var stick := Vector2(Input.get_joy_axis(device, JOY_AXIS_LEFT_X), Input.get_joy_axis(device, JOY_AXIS_LEFT_Y))
	var input := {"move": {"x": stick.x, "y": stick.y}, "run": Input.is_joy_button_pressed(device, JOY_BUTTON_B), "act": Input.is_joy_button_pressed(device, JOY_BUTTON_A)}
	var shooting := Input.is_joy_button_pressed(device, JOY_BUTTON_X)
	if shooting and not _pad_shot_down.get(device, false):
		var target := nearest_ahead(player_id, stick)
		if target != null:
			input.shoot = {"x": target.x, "y": target.y}
			input.shootAt = target.id
	_pad_shot_down[device] = shooting
	return input


## Controller shots pick the nearest person roughly along the stick, so aiming isn't a skill.
func nearest_ahead(player_id: String, stick: Vector2) -> CrowdEntity:
	if crowd() == null or not crowd().slots.has(player_id):
		return null
	var me: CrowdEntity = crowd().slots[player_id].entity
	var facing := stick.normalized() if stick.length() > 0.3 else Vector2.RIGHT.rotated(me.facing * PI / 4)
	var best: CrowdEntity = null
	var best_score := INF
	for e: CrowdEntity in crowd().visible_entities():
		if e == me or e.dead:
			continue
		var offset := Vector2(e.x - me.x, e.y - me.y)
		if offset.length() > 400 or offset.normalized().dot(facing) < 0.8:
			continue
		if offset.length() < best_score:
			best = e
			best_score = offset.length()
	return best


func entity_near(point: Vector2, reach: float) -> CrowdEntity:
	var best: CrowdEntity = null
	if crowd() == null:
		return null
	for e: CrowdEntity in crowd().visible_entities():
		if not e.dead and Vector2(e.x, e.y).distance_to(point) <= reach:
			if best == null or Vector2(e.x, e.y).distance_to(point) < Vector2(best.x, best.y).distance_to(point):
				best = e
	return best
