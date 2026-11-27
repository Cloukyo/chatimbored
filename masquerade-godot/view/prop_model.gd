class_name PropModel
extends Node3D
## A lantern, a bell or a vault: things players use with "act". Placeholder geometry like the web version.

var kind := ""
var light: MeshInstance3D = null
var light_mat: StandardMaterial3D = null
var swing: Node3D = null
var glow: Sprite3D


func _init(prop_kind: String) -> void:
	kind = prop_kind
	var iron := Shapes.material("#2a2420", 0.5, 0.4)
	match kind:
		"lantern":
			_solid(Shapes.cylinder(0.05, 0.07, 1.6, 8), iron, Vector3(0, 0.8, 0))
			light_mat = _own("#8a4d3a", 0.5)
			light = _solid(Shapes.cylinder(0.2, 0.16, 0.42, 8), light_mat, Vector3(0, 1.82, 0))
			_solid(Shapes.cylinder(0.0, 0.26, 0.18, 8), iron, Vector3(0, 2.12, 0))
		"bell":
			var wood := Shapes.material("#4b3a2a", 0.8)
			_solid(Shapes.box(0.12, 2.1, 0.12), wood, Vector3(-0.55, 1.05, 0))
			_solid(Shapes.box(0.12, 2.1, 0.12), wood, Vector3(0.55, 1.05, 0))
			_solid(Shapes.box(1.35, 0.14, 0.16), wood, Vector3(0, 2.12, 0))
			swing = Node3D.new()
			swing.position = Vector3(0, 2.04, 0)
			add_child(swing)
			var arrays := Shapes.lathe([Vector2(0.06, 0), Vector2(0.18, -0.08), Vector2(0.22, -0.4), Vector2(0.34, -0.62), Vector2(0.3, -0.64)], 16)
			var mesh := ArrayMesh.new()
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
			light_mat = _own("#9b7b3a", 0.35, 0.9)
			light_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
			light = MeshInstance3D.new()
			light.mesh = mesh
			light.material_override = light_mat
			swing.add_child(light)
		_:
			_solid(Shapes.box(0.9, 0.95, 0.7), Shapes.material("#3b4048", 0.4, 0.6), Vector3(0, 0.48, 0))
			_solid(Shapes.cylinder(0.17, 0.17, 0.05, 16), Shapes.gold(), Vector3(0, 0.55, 0.37), Vector3(PI / 2, 0, 0))
			light_mat = _own("#5a1414", 0.5)
			light = _solid(Shapes.sphere(0.07, 8, 6), light_mat, Vector3(0, 1.02, 0.2))
	glow = Shapes.glow(2.4, 0.0)
	glow.position.y = 1.0 if kind == "vault" else 1.8
	add_child(glow)


## `mine`: this screen's player has used it. `flare` runs 1 to 0 just after anyone used it.
func update(prop: Dictionary, mine: bool, flare: float, now_ms: float) -> void:
	match kind:
		"lantern":
			var lit := 0.85 + sin(now_ms * 0.005) * 0.12 if mine else 0.0
			light_mat.albedo_color = Color("f4a046") if mine else Color("8a4d3a")
			light_mat.emission_enabled = mine
			light_mat.emission = Color("ff9a40")
			light_mat.emission_energy_multiplier = lit * 1.6
		"bell":
			light_mat.albedo_color = Color("f0c25a") if prop.on else Color("9b7b3a")
			swing.rotation.z = sin(now_ms * 0.01) * 0.3 if prop.on else 0.0
		"vault":
			var blink: bool = prop.on and int(now_ms / 250) % 2 == 0
			light_mat.emission_enabled = blink
			light_mat.emission = Color("ff4030")
			light_mat.emission_energy_multiplier = 3.0
	var opacity := maxf(flare * 0.9, 0.45 if kind == "lantern" and mine else 0.0)
	glow.modulate.a = opacity
	var size := 2.4 + ((1 - flare) * 2 if flare > 0 else 0.0)
	glow.pixel_size = size / 128.0


func _own(colour: String, roughness: float, metallic := 0.0) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(colour)
	mat.roughness = roughness
	mat.metallic = metallic
	return mat


func _solid(mesh: Mesh, mat: Material, at: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.mesh = mesh
	instance.material_override = mat
	instance.position = at
	instance.rotation = rot
	add_child(instance)
	return instance
