class_name BetweenScreens
extends Control
## Everything between rooms: a room's results, the night's board, the shop, the Mole vote, backing a
## finalist, and the final standings (or a quick-play set's). Each person chooses with their own
## controller or the keyboard; computer players choose by themselves.

signal leave
signal again

var driver: PlayDriver
var _key := ""
## seat id -> MenuList: each person's own choices.
var _lists := {}
## A list anyone at the screen can use (or only `_owners`, when set).
var _shared_list: MenuList = null
var _owners: Array = []
## seat id -> Label showing where they are ("Done", "Voted").
var _status := {}
var _body: VBoxContainer


func _init(play_driver: PlayDriver) -> void:
	driver = play_driver
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_PASS


## Call every frame with the frame's presses. Rebuilds when the screen changes.
func update_screen(controls: SeatControls) -> void:
	var key := _screen_key()
	visible = key != ""
	if key != _key:
		_key = key
		_build()
	if not visible:
		return
	for s in driver.humans():
		var presses := controls.presses(s.device)
		if _lists.has(s.id):
			(_lists[s.id] as MenuList).handle(presses)
		if _shared_list != null and (_owners.is_empty() or _owners.has(s.id)):
			_shared_list.handle(presses)
	_update_status()


func _screen_key() -> String:
	var phase := driver.phase()
	if phase == "in_game":
		return ""
	if driver.session != null:
		var night := driver.session.night
		return "%s:%d:%s" % [phase, night.played.size(), night.picker_id]
	return "%s:%d" % [phase, driver.round_index]


func _build() -> void:
	for child in get_children():
		child.queue_free()
	_lists.clear()
	_status.clear()
	_shared_list = null
	_owners = []
	if _key == "":
		return
	add_child(UiStyle.shade(0.55 if driver.phase() == "results" else 0.75))
	var card := UiStyle.card(26)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 12)
	_body.alignment = BoxContainer.ALIGNMENT_CENTER
	card.add_child(_body)
	add_child(UiStyle.centered(card))
	if driver.session == null:
		_build_quick()
		return
	match driver.phase():
		"results":
			_build_night_results()
		"board":
			_build_board()
		"shop":
			_build_shop()
		"mole_vote":
			_build_vote()
		"finale_pick":
			_build_backing()
		"night_over":
			_build_night_over()


func _title(text: String, size := 34) -> void:
	var l := UiStyle.label(text, size, UiStyle.GOLD)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_body.add_child(l)


func _text(bbcode: String, size := 20) -> RichTextLabel:
	var r := UiStyle.rich(size)
	r.custom_minimum_size = Vector2(640, 0)
	r.text = "[center]%s[/center]" % bbcode
	_body.add_child(r)
	return r


func _shared(rows: Array, owners: Array = [], row_width := 420.0) -> void:
	_shared_list = MenuList.new(rows, 24, row_width)
	_owners = owners
	var holder := CenterContainer.new()
	holder.add_child(_shared_list)
	_body.add_child(holder)


func _name(player_id: String) -> String:
	return driver.name_of(player_id)


# ------------------------------------------------------------------ quick play

func _build_quick() -> void:
	var standings := driver.quick_standings()
	if driver.phase() == "over":
		_title("The set is over")
		_text(_quick_table(standings), 24)
		_shared([{"label": "Play another set", "accept": func() -> void: again.emit()}, {"label": "Back to the menu", "accept": func() -> void: leave.emit()}])
		return
	var result: Dictionary = driver.game.crowd.result
	_title(HudText.result_line(result, driver.name_of))
	_text(_reveal_text(result.get("reveal", [])), 18)
	_text(_quick_table(standings), 22)
	var last := driver.quick_set > 0 and driver.round_index + 1 >= driver.quick_set
	var next_label := "See the final scores" if last else "Next room: %s" % CrowdModes.NAMES[driver.quick_rooms[(driver.round_index + 1) % driver.quick_rooms.size()]]
	_shared([{"label": next_label, "accept": driver.continue_quick}], [], 480)


func _quick_table(standings: Array) -> String:
	var lines := []
	for row in standings:
		lines.append("%s   [color=#e0b85a]%d[/color]" % [row.name, row.score])
	return "\n".join(lines)


func _reveal_text(reveal: Array) -> String:
	var lines := []
	for entry: Dictionary in reveal:
		var role: String = entry.role
		var shown_role := " (%s)" % role.capitalize() if role != "" and role != "player" and role != "racer" else ""
		lines.append("%s%s%s" % [_name(entry.playerId), shown_role, "" if entry.alive else ", [i]down[/i]"])
	return "[color=#f5e6c8aa]%s[/color]" % "   ·   ".join(lines)


# ------------------------------------------------------------------ the night

func _build_night_results() -> void:
	var night := driver.session.night
	var last: Dictionary = night.last_round
	var room_name: String = "The Last Dance" if last.get("room", "") == "ballroom" else NightData.room(last.get("room", "")).get("name", "")
	_title(room_name)
	var crowd := driver.crowd()
	if crowd != null and crowd.is_over():
		_text("[b]%s[/b]" % HudText.result_line(crowd.result, driver.name_of), 24)
		_text(_reveal_text(crowd.result.get("reveal", [])), 18)
	var lines := []
	for standing in night.standings():
		var got: int = last.get("points", {}).get(standing.playerId, 0)
		lines.append("%s   [color=#e0b85a]%d[/color]%s" % [_name(standing.playerId), standing.total, "   (+%d)" % got if got > 0 else ""])
	_text("\n".join(lines), 22)
	if last.get("claimedBy", "") != "":
		_text("%s claims the %s" % [_name(last.claimedBy), room_name], 18)
	_shared([{"label": "Go on", "accept": func() -> void: driver.session.next(driver.session.host_id())}], [], 360)


func _build_board() -> void:
	var night := driver.session.night
	_title("Room %d of %d" % [mini(night.played.size() + 1, night.total_rounds), night.total_rounds])
	var picker := driver.seat(night.picker_id)
	var secret := _secret_line()
	if secret != "":
		_text(secret, 18)
	if night.twists.size() > 0:
		var twist_names := night.twists.map(func(key: String) -> String:
			for twist in NightData.TWISTS:
				if twist.key == key:
					return twist.name
			return key)
		_text("Twists: " + ", ".join(twist_names), 18)
	_text("%s is in last place, so they pick the next room" % _name(night.picker_id) if night.played.size() > 0 else "%s picks the first room" % _name(night.picker_id), 20)
	var rows := []
	for key in night.offered:
		var room := NightData.room(key)
		var claimed: String = "  ·  %s's" % _name(night.claims[key]) if night.claims.has(key) else ""
		var pick_key: String = key
		rows.append({"label": "%s  ·  %s" % [room.name, CrowdModes.NAMES[room.mode]], "value": func() -> String: return claimed, "accept": func() -> void: driver.session.pick_room(night.picker_id, pick_key)})
	var bot_picks := PlayDriver._is_bot(picker)
	_shared(rows, [night.picker_id] if not bot_picks and not picker.is_empty() else ["nobody"], 560)
	if bot_picks:
		_shared_list.active = false
		_shared_list.refresh()
		_text("[i]%s is choosing...[/i]" % _name(night.picker_id), 18)
	_text(_claims_text(), 16)


func _claims_text() -> String:
	var night := driver.session.night
	if night.claims.is_empty():
		return "[color=#f5e6c8aa]Winning a room claims it. Claimed rooms, and pairs next to each other, add to your total.[/color]"
	var lines := []
	for key in night.claims:
		lines.append("%s: %s" % [NightData.room(key).name, _name(night.claims[key])])
	return "[color=#f5e6c8aa]%s[/color]" % "   ·   ".join(lines)


## A single person's secret (the Mole), shown only when nobody else can see the screen.
func _secret_line() -> String:
	if driver.shared() or driver.humans().is_empty():
		return ""
	var snap := driver.session.night_view_for(driver.humans()[0].id)
	if snap.has("secret"):
		return "[color=#e9806b]You're the Mole. Make %s finish the night in last place without being caught.[/color]" % _name(snap.secret.moleTargetId)
	return ""


func _columns() -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 18)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	_body.add_child(row)
	return row


func _column(parent: HBoxContainer, s: Dictionary, header: String) -> VBoxContainer:
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 6)
	parent.add_child(column)
	column.add_child(UiStyle.label(s.name, 24, UiStyle.GOLD))
	column.add_child(UiStyle.label(SeatControls.device_name(s.device), 14, UiStyle.DIM))
	if header != "":
		column.add_child(UiStyle.label(header, 18))
	var status := UiStyle.label("", 18, UiStyle.GOLD)
	column.add_child(status)
	_status[s.id] = status
	return column


func _build_shop() -> void:
	var night := driver.session.night
	_title("The shop")
	_text("Spend tips on one perk for the next room.", 18)
	var row := _columns()
	var width := 300.0 if driver.humans().size() <= 3 else 230.0
	for s in driver.humans():
		var id: String = s.id
		var column := _column(row, s, "")
		var rows := []
		for info in NightData.PERKS:
			if not night.perk_available(info):
				continue
			var key: String = info.key
			rows.append({
				"label": "%s (%d)" % [info.name, info.cost],
				"value": func() -> String: return "yours" if night.perks.get(id, "") == key else "",
				"enabled": func() -> bool: return not night.shop_done.has(id),
				"accept": func() -> void:
					var error := driver.session.night_action(id, {"kind": "buy", "perk": key})
					if error != "":
						Audio.play("lose", -10),
			})
		rows.append({"label": "Done", "enabled": func() -> bool: return not night.shop_done.has(id), "accept": func() -> void: driver.session.night_action(id, {"kind": "done"})})
		var list := MenuList.new(rows, 18, width)
		column.add_child(list)
		_lists[id] = list
	_text(_perk_help(), 15)


func _perk_help() -> String:
	var lines := []
	for info in NightData.PERKS:
		if driver.session.night.perk_available(info):
			lines.append("[b]%s[/b]: %s" % [info.name, info.blurb])
	return "[color=#f5e6c8aa]%s[/color]" % "\n".join(lines)


func _build_vote() -> void:
	var night := driver.session.night
	_title("Who is the Mole?")
	_text("One of you has been working against someone all night. Vote for who you think it is.", 18)
	var row := _columns()
	for s in driver.humans():
		var id: String = s.id
		var column := _column(row, s, "")
		var rows := []
		for other in night.player_ids():
			if other == id:
				continue
			var suspect: String = other
			rows.append({"label": _name(other), "enabled": func() -> bool: return not night.mole_votes.has(id), "accept": func() -> void: driver.session.night_action(id, {"kind": "vote", "playerId": suspect})})
		var list := MenuList.new(rows, 18, 240)
		column.add_child(list)
		_lists[id] = list


func _build_backing() -> void:
	var night := driver.session.night
	_title("The Last Dance")
	_text("%s and %s dance for the night. Everyone else backs one of them and steers a guest as a ghost." % [_name(night.finalists[0]), _name(night.finalists[1])], 18)
	var row := _columns()
	for s in driver.humans():
		var id: String = s.id
		if night.finalists.has(id):
			_column(row, s, "You're dancing")
			continue
		var column := _column(row, s, "Back:")
		var rows := []
		for finalist in night.finalists:
			var chosen: String = finalist
			rows.append({"label": _name(finalist), "enabled": func() -> bool: return not night.backers.has(id), "accept": func() -> void: driver.session.night_action(id, {"kind": "back", "playerId": chosen})})
		var list := MenuList.new(rows, 18, 240)
		column.add_child(list)
		_lists[id] = list


func _build_night_over() -> void:
	var night := driver.session.night
	var standings := night.standings()
	_title("%s wins the night" % _name(standings[0].playerId) if not standings.is_empty() else "The night is over", 38)
	var lines := []
	for i in standings.size():
		var row: Dictionary = standings[i]
		lines.append("%d.  %s   [color=#e0b85a]%d[/color]   [color=#f5e6c8aa](%d points, %d rooms)[/color]" % [i + 1, _name(row.playerId), row.total, row.points, row.rooms])
	_text("\n".join(lines), 22)
	if not night.mole_reveal.is_empty():
		var reveal: Dictionary = night.mole_reveal
		_text("The Mole was [b]%s[/b], working against %s. %s" % [_name(reveal.moleId), _name(reveal.targetId), "They were caught." if reveal.caught else ("They got away with it." if reveal.objectiveMet else "They didn't pull it off.")], 18)
	var awards := []
	for award in night.awards():
		awards.append("[color=#e0b85a]%s[/color]: %s, %s" % [award.title, _name(award.playerId), award.detail])
	if not awards.is_empty():
		_text("\n".join(awards), 18)
	_shared([{"label": "Another night", "accept": func() -> void: again.emit()}, {"label": "Back to the menu", "accept": func() -> void: leave.emit()}])


func _update_status() -> void:
	if driver.session == null:
		return
	var night := driver.session.night
	for id in _status:
		var label: Label = _status[id]
		match driver.phase():
			"shop":
				label.text = "%d tips%s" % [night.tips.get(id, 0), ", done" if night.shop_done.has(id) else ""]
			"mole_vote":
				label.text = "Voted" if night.mole_votes.has(id) else ""
			"finale_pick":
				label.text = "Backing %s" % _name(night.backers[id]) if night.backers.has(id) else ""
		if _lists.has(id):
			(_lists[id] as MenuList).refresh()
