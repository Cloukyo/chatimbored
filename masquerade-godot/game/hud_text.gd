class_name HudText
extends RefCounted
## What the HUD says for each room, worded as in the web version. Lines use BBCode for bold.

## role -> how a win reads
const ROLE_WINS := {"killer": "The Killer wins", "hunter": "The Hunters win", "ringer": "The Ringers win", "lookout": "The Lookouts win"}


static func keys_for(pad: bool) -> Dictionary:
	if pad:
		return {"shoot": "X", "act": "A", "run": "B"}
	return {"shoot": "Click", "act": "E", "run": "Shift"}


const TRICK_NAMES := {"toast": "Toast", "conga": "Conga", "spotlight": "Spotlight"}


## A shared screen: what everyone needs, with nothing that gives anyone away. Secrets come as rumble.
static func shared_lines(view: Dictionary, name_of: Callable) -> Array:
	var hud: Dictionary = view.hud
	var progress := "%s/%s" % [hud.get("progress", 0), hud.get("goal", 0)]
	var out := []
	match view.mode:
		"act_natural", "freeze_frame":
			out = ["Reach the exit first"]
		"silent_witness":
			out = ["One long buzz: you're the Killer", "Bodies %s/%s" % [hud.get("kills", 0), hud.get("killTarget", 5)]]
		"bell_ringers":
			out = ["One long buzz: you're a Ringer", "No figure? You're a Lookout: aim from above", "Bells " + progress]
		"lantern_festival":
			out = ["Light all five lanterns", "A buzz means you lit one"]
		"heist_hour":
			out = ["Crack three different vaults", "A buzz means you cracked one"]
		"hot_parcel":
			out = ["A heartbeat means you have the parcel", "Last one standing wins"]
		"closing_time":
			out = ["Stay in the light", "A buzz means you're in the dark"]
		"marked":
			out = ["Marked needs a private screen for each player"]
		"last_dance":
			out = ["The finalists hit each other to win the night", "Everyone else steers a guest as a ghost"]
	out.append("Stick moves · A acts · X shoots · B runs")
	var party: Dictionary = view.get("party", {})
	if party.has("hostName"):
		out.append_array(host_lines(party, keys_for(true), party.hostName))
	if party.has("wanted"):
		out.append("Wanted: the leader is %s" % name_of.call(party.wanted))
	return out


static func host_lines(party: Dictionary, keys: Dictionary, host_name := "") -> Array:
	var trick: String = TRICK_NAMES.get(party.get("trick", ""), "Toast")
	return [
		"[b]Party Host[/b]%s" % (": " + host_name if host_name != "" else ""),
		"%s plays [b]%s[/b] (%d left)" % [keys.shoot, trick, party.tricksLeft] if party.get("tricksLeft", 0) > 0 else "Out of tricks",
		"%s changes trick" % keys.act,
	]


static func lines(view: Dictionary, keys: Dictionary, name_of: Callable) -> Array:
	if view.is_empty():
		return []
	if view.role == "host":
		return host_lines(view.get("party", {}), keys)
	var hud: Dictionary = view.hud
	var progress := "%s/%s" % [hud.get("progress", 0), hud.get("goal", 0)]
	var shot := func(aim: String) -> String: return "%s to shoot %s (%d left)" % [keys.shoot, aim, view.shots] if view.shots > 0 else "Out of shots"
	var out := []
	match view.mode:
		"act_natural":
			out = ["Reach the exit first", shot.call("a rival"), "Running (%s) gets noticed" % keys.run]
		"silent_witness":
			var bodies := "Bodies %s/%s" % [hud.get("kills", 0), hud.get("killTarget", 5)]
			if view.role == "killer":
				out = ["You are the [b]Killer[/b]", "%s to strike someone close" % keys.act if view.canAct else "Strike recharging", bodies]
			else:
				out = ["You are a [b]Hunter[/b]", shot.call("the Killer"), bodies]
		"lantern_festival":
			out = ["Lanterns " + progress, "%s next to a lantern lights it" % keys.act, "%s next to anyone else strikes them" % keys.act, "Last one standing also wins"]
		"bell_ringers":
			if view.role == "ringer":
				out = ["You are a [b]Ringer[/b]", "%s next to a bell rings it" % keys.act, "Bells " + progress]
			else:
				out = ["You are a [b]Lookout[/b]", shot.call("a Ringer"), "Bells " + progress]
		"heist_hour":
			out = ["Vaults " + progress, "%s at a vault cracks it (3 different ones)" % keys.act, shot.call("a rival")]
		"marked":
			out = [
				"Your mark: [b]%s[/b]" % name_of.call(hud.markName) if hud.has("markName") else "No mark left",
				"the red ring is roughly where they were",
				"Marks " + progress,
				"%s strikes, but the wrong person leaves you dazed" % keys.act if view.canAct else "Recovering",
			]
		"freeze_frame":
			out = ["Reach the exit first", "When the crowd freezes, freeze with it", shot.call("whoever kept walking")]
		"hot_parcel":
			if hud.get("holding", false):
				out = ["[b]You have the parcel![/b] %ss" % hud.get("fuseSeconds", 0), "%s next to someone hands it over, if they're a player" % keys.act]
			else:
				out = ["Someone has the parcel", "Keep clear of anyone bumping into people", "Last one standing wins"]
		"closing_time":
			var dark: float = hud.get("darkMs", 0)
			out = [
				"[b]You're in the dark![/b] %.1fs" % ((hud.get("darkLimitMs", 0) - dark) / 1000.0) if view.alive and dark > 0 else "Stay in the light",
				"%s strikes anyone close" % keys.act,
				"Last one standing wins",
			]
		"last_dance":
			if view.role == "backer":
				out = ["You're backing a finalist", "Steer your guest to crowd round your finalist"]
			else:
				out = ["Hit the other finalist to win the night", shot.call("them"), "A miss makes nearby guests flinch", "The floor is shrinking"]
	var party: Dictionary = view.get("party", {})
	if party.has("contract"):
		out.append(("[s]%s[/s]" if party.get("contractDone", false) else "Contract: %s") % party.contract)
	if party.get("holdingInvite", false):
		out.append("[b]You hold the invitation[/b]: keep it to the end of the room")
	if party.has("nemesisName"):
		out.append("Your nemesis: %s" % party.nemesisName)
	if party.has("wanted"):
		out.append("Wanted: the leader is %s" % name_of.call(party.wanted))
	if view.get("ghost", false):
		out.append("[b]You're a ghost[/b]: steer your guest")
	elif not view.alive:
		out.append("[b]You're down[/b]")
	return out


static func result_line(result: Dictionary, name_of: Callable) -> String:
	if result.has("winnerPlayerId"):
		return "%s wins" % name_of.call(result.winnerPlayerId)
	if result.has("winnerRole"):
		return ROLE_WINS.get(result.winnerRole, "%s wins" % str(result.winnerRole).capitalize())
	return "Nobody wins"
