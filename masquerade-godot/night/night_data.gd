class_name NightData
extends RefCounted
## The full night's fixed data: the mansion's rooms, points, layers, perks, twists and host tricks.
## Ported from shared/party/night.ts. (The mode's display name is still to be decided; the code calls it "the night".)

const ROOMS := [
	{"key": "bell_tower", "name": "Bell Tower", "mode": "bell_ringers", "col": 0, "row": 0},
	{"key": "gallery", "name": "Gallery", "mode": "marked", "col": 1, "row": 0, "needsPrivateText": true},
	{"key": "library", "name": "Library", "mode": "silent_witness", "col": 2, "row": 0},
	{"key": "garden", "name": "Garden", "mode": "lantern_festival", "col": 0, "row": 1},
	{"key": "grand_hall", "name": "Grand Hall", "mode": "act_natural", "col": 1, "row": 1},
	{"key": "music_room", "name": "Music Room", "mode": "freeze_frame", "col": 2, "row": 1},
	{"key": "terrace", "name": "Terrace", "mode": "closing_time", "col": 0, "row": 2},
	{"key": "vault", "name": "Vault", "mode": "heist_hour", "col": 1, "row": 2},
	{"key": "post_room", "name": "Post Room", "mode": "hot_parcel", "col": 2, "row": 2},
]

const LENGTHS := [4, 6, 8]
const OPTION_COUNT := 3

const POINTS := {
	"soloWin": 5,
	"teamWin": 3,
	"takedown": 2,
	"survive": 1,
	"claimedRoom": 2,
	"connectedPair": 1,
	"contract": 2,
	"wantedBounty": 3,
	"hostTrick": 2,
	"hostCap": 6,
	"backedFinalist": 3,
	"moleCaughtVoter": 3,
	"moleUnnoticed": 8,
}

## Everything on top of the basic points race. Each one is a switch in the lobby.
const LAYERS := [
	{"key": "emptyingParty", "name": "The party empties out", "blurb": "Guests who die stay gone, so later rooms are thinner.", "onByDefault": true},
	{"key": "ghosts", "name": "Ghosts", "blurb": "Knocked-out players steer an NPC for the rest of the round.", "onByDefault": true},
	{"key": "shop", "name": "Shop", "blurb": "Spend tips on one perk between rounds.", "onByDefault": true},
	{"key": "suspicion", "name": "Suspicion", "blurb": "A hidden score. Act oddly and nearby guests start edging away from you.", "onByDefault": true},
	{"key": "invite", "name": "Cursed invitation", "blurb": "Passed by bumping into players. Whoever holds it when a round ends loses points.", "onByDefault": true},
	{"key": "finale", "name": "Last Dance", "blurb": "The top two duel in the Ballroom to decide the night.", "onByDefault": true},
	{"key": "host", "name": "Party Host", "blurb": "With 5 or more players, one player sits out each round and plays tricks on the crowd.", "onByDefault": true},
	{"key": "contracts", "name": "Secret contracts", "blurb": "A private side mission each round, worth 2 points.", "onByDefault": true, "needsPrivateText": true},
	{"key": "mole", "name": "The Mole", "blurb": "One player has a secret objective all night. Everyone votes at the end.", "onByDefault": true, "needsPrivateText": true},
	{"key": "wanted", "name": "Wanted", "blurb": "The leader gets a bounty and a vague public hint about where they are.", "onByDefault": false},
	{"key": "nemesis", "name": "Nemesis", "blurb": "Taking out whoever took you out pays double.", "onByDefault": false},
	{"key": "twists", "name": "Stacking twists", "blurb": "A new twist is added after every round and stays.", "onByDefault": false},
]

const HOST_MIN_PLAYERS := 5

const PERKS := [
	{"key": "extra_shot", "name": "Extra shot", "blurb": "One more shot next round, in modes that have shots.", "cost": 3},
	{"key": "glimpse", "name": "Glimpse", "blurb": "For the first 3 seconds of next round, see one real player outlined.", "cost": 4, "needsPrivateText": true},
	{"key": "clean_slate", "name": "Clean slate", "blurb": "Clears your suspicion.", "cost": 3, "needs": "suspicion"},
	{"key": "pass_invite", "name": "Pass the invite", "blurb": "If you're holding the cursed invite, it goes to someone at random.", "cost": 3, "needs": "invite"},
]

const TWISTS := [
	{"key": "extra_shot", "name": "Loaded", "blurb": "Everyone with shots gets one more."},
	{"key": "crowded", "name": "Gatecrashers", "blurb": "A dozen extra guests turn up in every room."},
	{"key": "restless", "name": "Restless crowd", "blurb": "Guests hardly ever stand still."},
	{"key": "short_fuse", "name": "Short fuse", "blurb": "Rounds last 60 seconds instead of 90."},
]

const HOST_TRICKS := [
	{"key": "toast", "name": "Toast", "blurb": "Nearby guests turn and walk towards the spot."},
	{"key": "conga", "name": "Conga", "blurb": "Nearby guests fall into a line heading the same way."},
	{"key": "spotlight", "name": "Spotlight", "blurb": "Guests under the beam stop dead for a moment."},
]
const HOST_TRICKS_PER_ROUND := 3


static func default_options(shared_screen: bool) -> Dictionary:
	var options := {}
	for layer in LAYERS:
		options[layer.key] = layer.onByDefault and not (shared_screen and layer.get("needsPrivateText", false))
	return options


static func room(key: String) -> Dictionary:
	for candidate in ROOMS:
		if candidate.key == key:
			return candidate
	return {}


static func perk(key: String) -> Dictionary:
	for candidate in PERKS:
		if candidate.key == key:
			return candidate
	return {}


static func rooms_connected(a: Dictionary, b: Dictionary) -> bool:
	return absi(a.col - b.col) + absi(a.row - b.row) == 1


## A stable sort with a JavaScript-style comparator (negative: a goes first), so ties keep their order
## exactly as the server's Array.sort does. Godot's own sort_custom isn't stable.
static func stable_sorted(items: Array, compare: Callable) -> Array:
	var sorted := items.duplicate()
	for i in range(1, sorted.size()):
		var held = sorted[i]
		var j := i - 1
		while j >= 0 and compare.call(sorted[j], held) > 0:
			sorted[j + 1] = sorted[j]
			j -= 1
		sorted[j + 1] = held
	return sorted
