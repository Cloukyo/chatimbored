class_name Figure
extends Node3D
## One masked guest (a player or a crowd member, they look the same). The body is a placeholder made
## of primitives. To swap in modelled art later, replace `_build_body` with an instanced .glb that
## uses the shared rig; the rest (position, turning, the mask card, the ring) stays as it is.

const TURN_RATE := 12.0
const MASK_SIZE := 1.6

static var _bodies := {}
static var _mask_materials := {}
## Set by the view so mask textures have somewhere to be painted.
static var painter_host: Node = null

var id := 0
var yaw := 0.0
var body := Node3D.new()
var legs: Array[Node3D] = []
var mask := MeshInstance3D.new()
var ring := MeshInstance3D.new()
var stars: Node3D = null


func _init(entity_id: int, facing: int) -> void:
	id = entity_id
	var look := FigureLook.for_id(id)
	add_child(body)
	var mesh := MeshInstance3D.new()
	mesh.mesh = _body_mesh(look)
	mesh.material_override = Shapes.material("", 0.62)
	body.add_child(mesh)
	if not look.gown:
		for side in [-1, 1]:
			var pivot := Node3D.new()
			pivot.position = Vector3(side * 0.1, 0.75, 0)
			var leg := MeshInstance3D.new()
			leg.mesh = Shapes.cylinder(0.08, 0.07, 0.75, 8)
			leg.position.y = -0.375
			leg.material_override = Shapes.material("#0c0a0c", 0.6)
			pivot.add_child(leg)
			add_child(pivot)
			legs.append(pivot)
	var quad := QuadMesh.new()
	quad.size = Vector2(MASK_SIZE, MASK_SIZE)
	mask.mesh = quad
	mask.material_override = _mask_material(look.animal, look.mask)
	mask.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	body.add_child(mask)
	var blob := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(1.3, 1.3)
	blob.mesh = plane
	blob.position.y = 0.02
	blob.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	blob.material_override = _blob_material()
	add_child(blob)
	ring.mesh = Shapes.torus(0.595, 0.045, 40)
	ring.scale = Vector3(1, 0.2, 1)
	ring.position.y = 0.04
	ring.material_override = _unshaded(Color("f4e6c4"))
	ring.visible = false
	add_child(ring)
	yaw = yaw_of(facing)


## facing 0-7 counts eighths of a turn clockwise from +x, with arena y pointing toward the camera.
static func yaw_of(facing: int) -> float:
	var angle := facing * PI / 4
	return atan2(cos(angle), sin(angle))


## state: CrowdEntity.State. t: seconds. dt: seconds since the last frame.
func animate(facing: int, state: int, t: float, dt: float) -> void:
	var phase := t + id * 0.37
	body.rotation = Vector3.ZERO
	body.position = Vector3.ZERO
	if stars != null:
		stars.visible = false
	if state == CrowdEntity.State.DEAD:
		# Fallen over sideways, mask still on.
		body.rotation.z = PI / 2
		body.position = Vector3(0.25, 0.28, 0)
		for leg in legs:
			leg.rotation.x = 0
			leg.visible = false
		rotation.y = yaw
		_turn_mask()
		return
	for leg in legs:
		leg.visible = true
	var delta := wrapf(yaw_of(facing) - yaw, -PI, PI)
	yaw += delta * minf(1.0, dt * TURN_RATE)
	rotation.y = yaw
	_turn_mask()
	var moving := state == CrowdEntity.State.WALK or state == CrowdEntity.State.RUN
	var running := state == CrowdEntity.State.RUN
	var swing := sin(phase * (15.0 if running else 9.0)) if moving else 0.0
	for i in legs.size():
		legs[i].rotation.x = swing * (0.7 if running else 0.45) * (1 if i == 0 else -1)
	body.position.y = absf(swing) * 0.06 if moving else sin(phase * 2) * 0.012
	body.rotation.z = swing * 0.04 if moving else 0.0
	if running:
		body.rotation.x = 0.18
	if state == CrowdEntity.State.STUNNED or state == CrowdEntity.State.SICK:
		var fast := state == CrowdEntity.State.STUNNED
		body.rotation.z = sin(phase * (9.0 if fast else 5.0)) * 0.14
		body.rotation.x = cos(phase * (7.0 if fast else 4.0)) * 0.08
		if fast:
			if stars == null:
				stars = _make_stars()
			stars.visible = true
			stars.rotation.y = phase * 5


## Masks face the room's audience whichever way their wearer turns, so every one can be read.
## Tipped back toward the camera above.
func _turn_mask() -> void:
	var turn := -yaw - body.rotation.y
	mask.rotation = Vector3(-0.55, turn, 0)
	mask.position = Vector3(sin(turn) * 0.25, 1.62, cos(turn) * 0.25)
	if body.rotation.z != 0.0:
		# Lying down or wobbling: let the mask follow the body.
		pass


func _make_stars() -> Node3D:
	var group := Node3D.new()
	for i in 3:
		var star := MeshInstance3D.new()
		star.mesh = Shapes.sphere(0.07, 4, 2)
		star.material_override = _unshaded(Color("f3d36b"))
		var angle := i * TAU / 3
		star.position = Vector3(cos(angle) * 0.35, 2.05, sin(angle) * 0.35)
		group.add_child(star)
	add_child(group)
	return group


## Everything that doesn't move on its own, merged into one mesh per look.
static func _body_mesh(look: FigureLook) -> ArrayMesh:
	if _bodies.has(look.key()):
		return _bodies[look.key()]
	var s := Shapes.new()
	if look.gown:
		var skirt := Shapes.lathe([Vector2(0, 0), Vector2(0.62, 0), Vector2(0.58, 0.12), Vector2(0.4, 0.5), Vector2(0.22, 0.88), Vector2(0.16, 0.96)], 20)
		s.add(skirt, look.cloth)
		s.add(Shapes.cylinder(0.15, 0.18, 0.42), Color(look.cloth) * 1.12, Vector3(0, 1.13, 0))
		for side in [-1, 1]:
			s.add(Shapes.cylinder(0.04, 0.04, 0.42, 6), FigureLook.SKIN, Vector3(side * 0.22, 1.08, 0.04), Vector3(0, 0, side * 0.25))
		s.add(Shapes.sphere(0.09, 8, 6), look.hair, Vector3(0, 1.68, -0.13))
	else:
		s.add(Shapes.box(0.44, 0.58, 0.26), look.cloth, Vector3(0, 1.0, 0))
		s.add(Shapes.box(0.38, 0.38, 0.05), look.cloth, Vector3(0, 0.6, -0.12), Vector3(0.15, 0, 0))
		s.add(Shapes.box(0.14, 0.42, 0.02), "#f2ece0", Vector3(0, 1.07, 0.135))
		s.add(Shapes.box(0.12, 0.04, 0.03), "#0c0a0c", Vector3(0, 1.26, 0.15))
		for side in [-1, 1]:
			s.add(Shapes.cylinder(0.065, 0.06, 0.52, 8), look.cloth, Vector3(side * 0.28, 0.98, 0), Vector3(0, 0, side * 0.12))
	s.add(Shapes.cylinder(0.06, 0.07, 0.13, 8), FigureLook.SKIN, Vector3(0, 1.36, 0))
	s.add(Shapes.sphere(0.19, 14, 10), FigureLook.SKIN, Vector3(0, 1.56, 0))
	s.add(Shapes.sphere(0.2, 14, 6, true), look.hair, Vector3(0, 1.58, -0.01), Vector3(-0.35, 0, 0))
	# The mask's ribbon tied behind the head, the one part of the mask you see from behind.
	s.add(Shapes.box(0.05, 0.26, 0.02), FigureLook.MASK_COLOURS[look.mask], Vector3(0, 1.47, -0.2))
	var mesh := s.build()
	_bodies[look.key()] = mesh
	return mesh


static func _mask_material(animal: String, colour: String) -> StandardMaterial3D:
	var key := animal + ":" + colour
	if _mask_materials.has(key):
		return _mask_materials[key]
	var painter := CanvasPainter.new(Vector2i(128, 128), func(canvas: CanvasItem) -> void:
		canvas.draw_set_transform(Vector2(64, 76), 0, Vector2(4.4, 4.4))
		MaskArt.draw(canvas, animal, colour))
	painter_host.add_child(painter)
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = painter.get_texture()
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	mat.alpha_scissor_threshold = 0.4
	mat.roughness = 0.3
	mat.metallic = 0.15
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_mask_materials[key] = mat
	return mat


## Mask textures are painted under the view; a new view repaints them.
static func forget_masks() -> void:
	_mask_materials.clear()


static var _blob: StandardMaterial3D = null


static func _blob_material() -> StandardMaterial3D:
	if _blob == null:
		_blob = StandardMaterial3D.new()
		_blob.albedo_texture = Shapes.radial(Color(0, 0, 0, 0.7), Color(0, 0, 0, 0))
		_blob.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_blob.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_blob.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	return _blob


static func _unshaded(colour: Color) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = colour
	return mat
