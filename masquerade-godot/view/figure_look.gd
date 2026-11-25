class_name FigureLook
extends RefCounted
## Who wears what. An outfit comes from the entity id, which the rules shuffle every round, so players
## and guests share one wardrobe and an outfit says nothing about who is inside it. Same picks as the
## web version, so a room looks the same on both.

const ANIMALS := ["fox", "owl", "hare", "raven", "cat", "wolf", "stag", "bear"]
const MASK_COLOURS := {"crimson": "#c0303c", "blue": "#3a68c8", "gold": "#e0b040", "jade": "#2f9a72", "violet": "#8250c0"}
const COATS := ["#141012", "#1c1216", "#161a26", "#22141c", "#121212", "#1e1a14"]
const GOWNS := ["#7a1a34", "#1f3e78", "#8a6418", "#1f5c42", "#55307c", "#9a2c3e", "#2c2c48", "#b8a070"]
const HAIRS := ["#2a1a12", "#5a3a1e", "#c8a060", "#151515", "#7a3a1a", "#d8d0c0"]
const SKIN := "#e2c4a6"
const GOLD := "#c9a14a"

var gown: bool
var cloth: String
var hair: String
var animal: String
var mask: String


static func frac_hash(value: float) -> float:
	var x := sin(value * 12.9898) * 43758.5453
	return x - floor(x)


static func for_id(id: int) -> FigureLook:
	var look := FigureLook.new()
	look.gown = frac_hash(id * 31 + 2) < 0.5
	look.cloth = _pick(GOWNS if look.gown else COATS, id, 1)
	look.hair = _pick(HAIRS, id, 3)
	look.animal = _pick(ANIMALS, id, 4)
	look.mask = _pick(MASK_COLOURS.keys(), id, 5)
	return look


static func _pick(items: Array, id: int, salt: int) -> Variant:
	return items[int(floor(frac_hash(id * 31 + salt) * items.size()))]


func key() -> String:
	return "%s:%s:%s:%s" % [gown, cloth, hair, mask]
