extends CrowdTestHelpers
## The 3D view's side of things that can be checked without a screen: outfits, rooms and HUD text.

## Worked out with the web version's lookFor, so a guest wears the same outfit on both.
const WEB_LOOKS := [[1, true, "#8a6418", "#5a3a1e", "cat", "violet"], [2, true, "#7a1a34", "#2a1a12", "cat", "blue"], [3, false, "#121212", "#d8d0c0", "owl", "crimson"], [7, true, "#2c2c48", "#151515", "raven", "blue"], [19, false, "#121212", "#5a3a1e", "stag", "violet"], [42, false, "#161a26", "#7a3a1a", "owl", "violet"], [77, true, "#55307c", "#5a3a1e", "bear", "jade"], [108, false, "#22141c", "#d8d0c0", "bear", "jade"]]


func test_outfits_match_the_web_version() -> void:
	for expected in WEB_LOOKS:
		var look := FigureLook.for_id(expected[0])
		eq([expected[0], look.gown, look.cloth, look.hair, look.animal, look.mask], expected, "look %d" % expected[0])


func test_every_room_has_a_room_to_play_in() -> void:
	for mode in CrowdModes.ids() + ["last_dance"]:
		ok(Room.STYLE_OF.has(mode), "style for " + mode)
		ok(Room.ROOMS.has(Room.STYLE_OF.get(mode, "")), "room for " + mode)
		ok(Room.FLOORS.has(Room.STYLE_OF.get(mode, "")), "floor for " + mode)


func test_facing_turns_the_figure_the_web_way() -> void:
	# Facing 0 is +x (east), 2 is +y (toward the camera, +z).
	ok(is_equal_approx(Figure.yaw_of(0), PI / 2), "east")
	ok(is_equal_approx(Figure.yaw_of(2), 0.0), "toward the camera")
	ok(is_equal_approx(absf(Figure.yaw_of(6)), PI), "away")


func test_every_room_has_hud_lines_for_every_role() -> void:
	var name_of := func(id: String) -> String: return id.to_upper()
	for mode in CrowdModes.ids():
		start(mode, 4)
		steps(3)
		for player_id in ["p1", "p2", "p3", "p4"]:
			var lines := HudText.lines(view(player_id), HudText.keys_for(false), name_of)
			ok(lines.size() >= 2, "%s %s has lines" % [mode, player_id])
			for line in lines:
				ok(not str(line).contains("%"), "%s line formatted: %s" % [mode, line])


func test_results_name_the_winner() -> void:
	var name_of := func(id: String) -> String: return "Player " + id.substr(1)
	eq(HudText.result_line({"winnerPlayerId": "p2"}, name_of), "Player 2 wins", "player")
	eq(HudText.result_line({"winnerRole": "killer"}, name_of), "The Killer wins", "killer")
	eq(HudText.result_line({"winnerRole": "hunter"}, name_of), "The Hunters win", "hunters")
	eq(HudText.result_line({}, name_of), "Nobody wins", "nobody")
