class_name CrowdModes
extends RefCounted
## The quick-play rooms, by id. Each call makes fresh rules, since a mode keeps its round state on itself.

const NAMES := {
	"act_natural": "Act Natural",
	"silent_witness": "Silent Witness",
	"lantern_festival": "Lantern Festival",
	"bell_ringers": "Bell Ringers",
	"heist_hour": "Heist Hour",
	"marked": "Marked",
	"freeze_frame": "Freeze Frame",
	"hot_parcel": "Hot Parcel",
	"closing_time": "Closing Time",
}


static func ids() -> Array:
	return NAMES.keys()


static func make(mode: String) -> CrowdRules:
	match mode:
		"act_natural":
			return ActNaturalRules.new()
		"silent_witness":
			return SilentWitnessRules.new()
		"lantern_festival":
			return LanternFestivalRules.new()
		"bell_ringers":
			return BellRingersRules.new()
		"heist_hour":
			return HeistHourRules.new()
		"marked":
			return MarkedRules.new()
		"freeze_frame":
			return FreezeFrameRules.new()
		"hot_parcel":
			return HotParcelRules.new()
		"closing_time":
			return ClosingTimeRules.new()
	push_error("Unknown crowd mode: %s" % mode)
	return null
