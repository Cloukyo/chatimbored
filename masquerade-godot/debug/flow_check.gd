extends Node
## Plays a whole night (or a quick-play set) through the real game scene, pressing buttons the way
## people would, and fails on anything stuck. Rooms are cut short so it runs in seconds.
## Run: godot --headless --fixed-fps 20 --path masquerade-godot res://debug/FlowCheck.tscn -- [--quick | --solo]

const LIMIT_FRAMES := 20000

var game: Node
var frames := 0
var phases := {}
var left := false
## --stop-at=<phase>: stop there for a moment and quit (for a screenshot with --write-movie).
var stop_at := ""
var _held := 0


func _ready() -> void:
	var quick := OS.get_cmdline_user_args().has("--quick")
	var solo := OS.get_cmdline_user_args().has("--solo")
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--stop-at="):
			stop_at = arg.substr(10)
	game = load("res://game/Game.tscn").instantiate()
	var seats := [
		{"id": "p1", "name": "Ada", "device": "keyboard"},
		{"id": "p2", "name": "Bram", "device": 0},
		{"id": "p3", "name": "Cleo", "device": "bot"},
		{"id": "p4", "name": "Dev", "device": "bot"},
		{"id": "p5", "name": "Edie", "device": "bot"},
	]
	if solo:
		# One person and computer players: a private screen, so the Mole and contracts are on.
		seats[1].device = "bot"
	if quick:
		game.config = {"kind": "quick", "seats": seats, "rounds": 3, "rooms": CrowdModes.ids()}
	else:
		var options := NightData.default_options(not solo)
		options.wanted = true
		options.twists = true
		game.config = {"kind": "night", "seats": seats, "rounds": 4, "options": options}
	game.left_game.connect(func() -> void: left = true)
	add_child(game)


func _process(_delta: float) -> void:
	frames += 1
	var driver: PlayDriver = game.driver
	var phase := driver.phase()
	phases[phase] = phases.get(phase, 0) + 1
	game.controls.clear_injected()
	if left:
		print("FLOW OK: reached the end after %d frames, phases seen: %s" % [frames, phases.keys()])
		get_tree().quit(0)
		return
	if stop_at != "" and phase == stop_at:
		_held += 1
		if _held > 25:
			get_tree().quit(0)
		return
	if frames > LIMIT_FRAMES:
		printerr("FLOW STUCK in phase %s" % phase)
		get_tree().quit(1)
		return
	if phase == "in_game":
		# Cut each room short once it's under way.
		if driver.session != null and driver.session.crowd != null and driver.session.crowd.tick > 40:
			driver.session.finish_round()
		elif driver.game != null and driver.game.crowd.tick > 40 and not driver.game.finished:
			driver.game.ms_left = 0
		return
	# Between rooms, both people press "choose" every few frames, and sometimes move down a row.
	if frames % 6 == 0:
		var press := "down" if frames % 24 == 0 and phase in ["shop", "board"] else "accept"
		if phase in ["over", "night_over"]:
			# Take "Back to the menu" (the second row).
			press = "down" if not game.has_meta("moved") else "accept"
			game.set_meta("moved", true)
		# Lists everyone shares take one person's press; each person has their own in the shop and votes.
		game.controls.injected = {"keyboard": [press]}
		if phase in ["shop", "mole_vote", "finale_pick", "board"]:
			game.controls.injected[0] = [press]
