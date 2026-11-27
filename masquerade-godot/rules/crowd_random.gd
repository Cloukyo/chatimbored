class_name CrowdRandom
extends RefCounted
## Small seeded PRNG (mulberry32), the same generator the Node server uses, so a seed replays a round exactly.

const MASK := 0xFFFFFFFF

var _state: int


func _init(seed: int) -> void:
	_state = seed & MASK


## A fresh generator seeded from the engine's own randomness.
static func fresh() -> CrowdRandom:
	return CrowdRandom.new(randi() & 0x7FFFFFFF)


## A float in [0, 1).
func next() -> float:
	_state = (_state + 0x6d2b79f5) & MASK
	var t := _state
	t = _imul(t ^ (t >> 15), t | 1)
	t = t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & MASK)
	return float((t ^ (t >> 14)) & MASK) / 4294967296.0


## An int in [0, count).
func index(count: int) -> int:
	return int(floor(next() * count))


func shuffle(items: Array) -> Array:
	var copy := items.duplicate()
	for i in range(copy.size() - 1, 0, -1):
		var swap := int(floor(next() * (i + 1)))
		var held = copy[i]
		copy[i] = copy[swap]
		copy[swap] = held
	return copy


## options: [[value, weight], ...]
func pick_weighted(options: Array):
	var total := 0.0
	for option in options:
		total += option[1]
	var roll := next() * total
	for option in options:
		roll -= option[1]
		if roll < 0:
			return option[0]
	return options[options.size() - 1][0]


func between(low: float, high: float) -> int:
	return int(CrowdMovement.js_round(low + next() * (high - low)))


## 32-bit multiply that wraps like JavaScript's Math.imul, without overflowing 64-bit ints.
static func _imul(a: int, b: int) -> int:
	a &= MASK
	b &= MASK
	var low := (a & 0xFFFF) * b
	var high := ((a >> 16) * b) & 0xFFFF
	return (low + (high << 16)) & MASK
