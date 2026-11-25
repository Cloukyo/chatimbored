class_name CrowdTestHelpers
extends TestCase
## Shared setup for the crowd tests, mirroring server/src/minigames/CrowdGames.test.ts.

static var _seed := 1
var game: QuickPlayRound
var crowd: CrowdMatch
var _seqs := {}


func start(mode: String, player_count: int = 3) -> void:
	var players := []
	for i in player_count:
		players.append({"id": "p%d" % (i + 1), "name": "Player %d" % (i + 1), "score": 0})
	game = QuickPlayRound.new(mode, players, CrowdRandom.new(_seed))
	_seed += 1
	crowd = game.crowd


func view(player_id: String) -> Dictionary:
	return game.view_for(player_id)


func input(player_id: String, overrides: Dictionary = {}) -> Dictionary:
	var seq: int = _seqs.get(player_id, 0) + 1
	_seqs[player_id] = seq
	var made := {"seq": seq, "move": {"x": 0.0, "y": 0.0}, "run": false, "act": false}
	made.merge(overrides, true)
	return made


func send(player_id: String, overrides: Dictionary = {}) -> void:
	game.handle_input(player_id, input(player_id, overrides))
	game.update()


func steps(count: int) -> void:
	for i in count:
		game.update()


func entity_of(player_id: String) -> CrowdEntity:
	return crowd.slots[player_id].entity


func slot_with_role(role: String) -> CrowdSlot:
	for slot: CrowdSlot in crowd.slots.values():
		if slot.role == role:
			return slot
	return null


func npcs() -> Array:
	return crowd.entities.filter(func(e: CrowdEntity) -> bool: return e.has_brain)


## Parks every NPC in a far corner so they can't get in the way.
func clear_crowd(x: float = 30, y: float = 690) -> void:
	for npc: CrowdEntity in npcs():
		npc.x = x
		npc.y = y
		npc.stop()
		npc.brain_timer_ms = 1e9


func stand_at(player_id: String, spot: Dictionary) -> void:
	var entity := entity_of(player_id)
	entity.x = spot.x
	entity.y = spot.y + 10
	crowd.slots[player_id].act_cooldown_ms = 0


func score_of(player_id: String) -> int:
	for player in game.players:
		if player.id == player_id:
			return player.score
	return -1


func has_event(events: Array, type: String, key: String = "", value = null) -> bool:
	for event in events:
		if event.type == type and (key == "" or event.get(key) == value):
			return true
	return false
