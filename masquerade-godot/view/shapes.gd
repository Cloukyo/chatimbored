class_name Shapes
extends RefCounted
## Builds placeholder meshes out of primitives, merged into one mesh with the colours baked into the
## vertices, so a figure or a shelf of books is one draw call. Shared materials live here too.

var _vertices := PackedVector3Array()
var _normals := PackedVector3Array()
var _colors := PackedColorArray()
var _indices := PackedInt32Array()

static var _materials := {}


## Adds a primitive (BoxMesh, CylinderMesh, ...) or any ArrayMesh's arrays, painted one colour.
func add(mesh: Variant, colour: Variant, at := Vector3.ZERO, rotate := Vector3.ZERO) -> Shapes:
	var arrays: Array = mesh.get_mesh_arrays() if mesh is PrimitiveMesh else mesh
	var basis := Basis.from_euler(rotate, EULER_ORDER_XYZ)
	var xform := Transform3D(basis, at)
	var offset := _vertices.size()
	var col := Color(colour) if colour is String else colour as Color
	for v: Vector3 in arrays[Mesh.ARRAY_VERTEX]:
		_vertices.append(xform * v)
		_colors.append(col)
	for n: Vector3 in arrays[Mesh.ARRAY_NORMAL]:
		_normals.append(basis * n)
	var source_indices = arrays[Mesh.ARRAY_INDEX]
	if source_indices == null or source_indices.is_empty():
		for i in (arrays[Mesh.ARRAY_VERTEX] as PackedVector3Array).size():
			_indices.append(offset + i)
	else:
		for i: int in source_indices:
			_indices.append(offset + i)
	return self


func build() -> ArrayMesh:
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = _vertices
	arrays[Mesh.ARRAY_NORMAL] = _normals
	arrays[Mesh.ARRAY_COLOR] = _colors
	arrays[Mesh.ARRAY_INDEX] = _indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


## A surface of revolution around Y, like three.js's LatheGeometry. `profile` is (radius, height) pairs.
static func lathe(profile: Array, segments: int) -> Array:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for s in segments:
		var a0 := TAU * s / segments
		var a1 := TAU * (s + 1) / segments
		for i in profile.size() - 1:
			var p: Vector2 = profile[i]
			var q: Vector2 = profile[i + 1]
			var v00 := Vector3(sin(a0) * p.x, p.y, cos(a0) * p.x)
			var v01 := Vector3(sin(a1) * p.x, p.y, cos(a1) * p.x)
			var v10 := Vector3(sin(a0) * q.x, q.y, cos(a0) * q.x)
			var v11 := Vector3(sin(a1) * q.x, q.y, cos(a1) * q.x)
			for v in [v00, v10, v01, v01, v10, v11]:
				st.add_vertex(v)
	st.generate_normals()
	return st.commit_to_arrays()


static func box(x: float, y: float, z: float) -> BoxMesh:
	var mesh := BoxMesh.new()
	mesh.size = Vector3(x, y, z)
	return mesh


static func cylinder(top: float, bottom: float, height: float, segments := 12) -> CylinderMesh:
	var mesh := CylinderMesh.new()
	mesh.top_radius = top
	mesh.bottom_radius = bottom
	mesh.height = height
	mesh.radial_segments = segments
	mesh.rings = 1
	return mesh


static func sphere(radius: float, segments := 12, rings := 8, hemisphere := false) -> SphereMesh:
	var mesh := SphereMesh.new()
	mesh.radius = radius
	mesh.height = radius * (1.0 if hemisphere else 2.0)
	mesh.radial_segments = segments
	mesh.rings = rings
	mesh.is_hemisphere = hemisphere
	return mesh


static func torus(radius: float, tube: float, segments := 32) -> TorusMesh:
	var mesh := TorusMesh.new()
	mesh.inner_radius = radius - tube
	mesh.outer_radius = radius + tube
	mesh.rings = segments
	mesh.ring_segments = 6
	return mesh


## Shared lit material. `colour` "" means vertex colours.
static func material(colour := "", roughness := 0.62, metallic := 0.0, emission := "") -> StandardMaterial3D:
	var key := "%s|%s|%s|%s" % [colour, roughness, metallic, emission]
	if _materials.has(key):
		return _materials[key]
	var mat := StandardMaterial3D.new()
	if colour == "":
		mat.vertex_color_use_as_albedo = true
		mat.vertex_color_is_srgb = true
	else:
		mat.albedo_color = Color(colour)
	mat.roughness = roughness
	mat.metallic = metallic
	if emission != "":
		mat.emission_enabled = true
		mat.emission = Color(emission)
	_materials[key] = mat
	return mat


static func gold() -> StandardMaterial3D:
	return material(FigureLook.GOLD, 0.35, 1.0)


static func flame() -> StandardMaterial3D:
	var key := "flame"
	if not _materials.has(key):
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.albedo_color = Color("ffd890")
		_materials[key] = mat
	return _materials[key]


## A soft radial glow, added on top of whatever is behind it.
static func glow(size: float, opacity: float, colour := Color("ffc070")) -> Sprite3D:
	var sprite := Sprite3D.new()
	sprite.texture = radial(Color(1.0, 0.86, 0.59, 1.0), Color(1.0, 0.63, 0.24, 0.0))
	sprite.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	sprite.shaded = false
	sprite.alpha_cut = SpriteBase3D.ALPHA_CUT_DISABLED
	sprite.pixel_size = size / 128.0
	sprite.modulate = Color(colour, opacity)
	var mat := StandardMaterial3D.new()
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	mat.vertex_color_use_as_albedo = true
	mat.albedo_texture = sprite.texture
	mat.no_depth_test = false
	sprite.material_override = mat
	return sprite


static var _radials := {}


static func radial(inner: Color, outer: Color) -> GradientTexture2D:
	var key := "%s%s" % [inner, outer]
	if _radials.has(key):
		return _radials[key]
	var gradient := Gradient.new()
	gradient.set_color(0, inner)
	gradient.set_color(1, outer)
	if inner.a > 0.9:
		gradient.add_point(0.25, Color(inner.lerp(outer, 0.4), 0.5))
	var texture := GradientTexture2D.new()
	texture.gradient = gradient
	texture.fill = GradientTexture2D.FILL_RADIAL
	texture.fill_from = Vector2(0.5, 0.5)
	texture.fill_to = Vector2(1.0, 0.5)
	texture.width = 128
	texture.height = 128
	_radials[key] = texture
	return texture
