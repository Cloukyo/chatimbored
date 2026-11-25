class_name CrowdObserver
extends RefCounted
## Lets a layer on top of the modes (Party Night) watch a round without the modes knowing.


func on_tick(_crowd: CrowdMatch) -> void:
	pass


func on_death(_crowd: CrowdMatch, _entity: CrowdEntity, _victim: CrowdSlot, _actor: CrowdSlot) -> void:
	pass


func on_shot(_crowd: CrowdMatch, _shooter: CrowdSlot, _from: Dictionary, _to: Dictionary, _hit: CrowdEntity) -> void:
	pass
