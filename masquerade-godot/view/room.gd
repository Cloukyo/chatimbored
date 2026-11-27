class_name Room
extends Node3D
## The room a round is played in: floor, walls or garden edges, dressing on the back wall, and lamps.
## One room per mode, the same as the web version. All placeholder geometry, kept in one place so the
## modelled rooms can replace it room by room.

const UNIT := 32.0
const WALL_HEIGHT := 7.0

## mode -> floor style
const STYLE_OF := {
	"act_natural": "hall", "silent_witness": "library", "lantern_festival": "garden", "bell_ringers": "tower",
	"heist_hour": "vault", "marked": "gallery", "freeze_frame": "music", "hot_parcel": "post",
	"closing_time": "terrace", "last_dance": "ballroom",
}
const ROOMS := {
	"hall": {"walls": true, "wall": "#3a0c16"},
	"library": {"walls": true, "wall": "#2a1a10", "dressing": "shelves"},
	"garden": {"walls": false, "wall": "#1c2a1a", "outdoor": "garden"},
	"tower": {"walls": true, "wall": "#2a2622"},
	"vault": {"walls": true, "wall": "#1e2226", "dressing": "vaults"},
	"gallery": {"walls": true, "wall": "#2a1430", "dressing": "paintings"},
	"music": {"walls": true, "wall": "#3a0c16"},
	"post": {"walls": true, "wall": "#2c2216", "dressing": "pigeonholes"},
	"terrace": {"walls": false, "wall": "#1a1c2a", "outdoor": "terrace"},
	"ballroom": {"walls": true, "wall": "#3a0c16"},
	"plaza": {"walls": true, "wall": "#2a1a16"},
}
const FLOORS := {
	"plaza": {"base": [111, 119, 104], "pattern": "tiles", "size": 40, "jitter": 14, "edge": Color8(40, 44, 38, 140)},
	"hall": {"base": [160, 152, 136], "alt": [142, 134, 118], "pattern": "checker", "size": 48, "jitter": 6, "edge": Color8(70, 60, 44, 178)},
	"library": {"base": [120, 92, 66], "alt": [108, 82, 58], "pattern": "planks", "size": 26, "jitter": 10, "edge": Color8(52, 36, 24, 191)},
	"garden": {"base": [104, 128, 82], "pattern": "grass", "size": 20, "jitter": 16, "edge": Color8(58, 74, 44, 204)},
	"tower": {"base": [124, 122, 116], "pattern": "flagstones", "size": 64, "jitter": 16, "edge": Color8(54, 52, 48, 191)},
	"vault": {"base": [118, 116, 100], "alt": [104, 102, 88], "pattern": "checker", "size": 60, "jitter": 4, "edge": Color8(46, 44, 36, 217)},
	"gallery": {"base": [146, 114, 80], "alt": [134, 102, 70], "pattern": "planks", "size": 18, "jitter": 8, "edge": Color8(70, 48, 30, 191)},
	"music": {"base": [132, 70, 66], "pattern": "carpet", "size": 56, "jitter": 5, "edge": Color8(70, 34, 30, 204)},
	"post": {"base": [140, 128, 104], "pattern": "tiles", "size": 36, "jitter": 10, "edge": Color8(70, 60, 44, 178)},
	"terrace": {"base": [128, 118, 112], "pattern": "flagstones", "size": 52, "jitter": 14, "edge": Color8(58, 50, 46, 191)},
	"ballroom": {"base": [140, 112, 76], "alt": [116, 90, 62], "pattern": "checker", "size": 56, "jitter": 5, "edge": Color8(224, 166, 74, 153)},
}

var style := "plaza"
var arena := {}
var lamps: Array[OmniLight3D] = []


func _init(room_style: String, room_arena: Dictionary) -> void:
	style = room_style if ROOMS.has(room_style) else "plaza"
	arena = room_arena


func _ready() -> void:
	_build()


static func frac_hash(value: float) -> float:
	return FigureLook.frac_hash(value)


func _build() -> void:
	var room: Dictionary = ROOMS[style]
	var w: float = arena.width / UNIT
	var d: float = arena.height / UNIT
	var painter := CanvasPainter.new(Vector2i(int(arena.width), int(arena.height)), func(canvas: CanvasItem) -> void: Room.paint_floor(canvas, arena, style))
	painter.transparent_bg = false
	add_child(painter)
	var floor_mat := StandardMaterial3D.new()
	floor_mat.albedo_texture = painter.get_texture()
	floor_mat.roughness = 0.5
	floor_mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	_plane(w, d, floor_mat, 0.0)
	# A dark apron around the floor, and a gold rim.
	_plane(w + 30, d + 30, Shapes.material("#0c120c" if room.has("outdoor") else "#120708", 1.0), -0.02)
	for rim in [[0, -d / 2, w + 0.2, 0.1], [0, d / 2, w + 0.2, 0.1], [-w / 2, 0, 0.1, d], [w / 2, 0, 0.1, d]]:
		_solid(Shapes.box(rim[2], 0.04, rim[3]), Shapes.gold(), Vector3(rim[0], 0.02, rim[1]))
	var spots := [Vector2(-w / 4, -d / 6), Vector2(w / 4, -d / 6), Vector2(0, d / 6)]
	if room.walls:
		var wall := Shapes.material(room.wall, 0.85)
		_solid(Shapes.box(w + 1.2, WALL_HEIGHT, 0.4), wall, Vector3(0, WALL_HEIGHT / 2, -d / 2 - 0.5))
		for side in [-1, 1]:
			_solid(Shapes.box(0.4, WALL_HEIGHT, d + 1), wall, Vector3(side * (w / 2 + 0.5), WALL_HEIGHT / 2, 0))
		for y in [1.1, WALL_HEIGHT - 1]:
			_solid(Shapes.box(w + 1.2, 0.18, 0.08), Shapes.gold(), Vector3(0, y, -d / 2 - 0.28))
		_dress_wall(room.get("dressing", "windows"), w, -d / 2 - 0.3)
		# Columns in the back corners, clear of where anyone walks.
		for side in [-1, 1]:
			_solid(Shapes.cylinder(0.45, 0.5, WALL_HEIGHT, 18), Shapes.material("#e9e1d0", 0.35), Vector3(side * (w / 2 - 0.2), WALL_HEIGHT / 2, -d / 2 - 0.1))
			_solid(Shapes.box(1.3, 0.3, 1.3), Shapes.gold(), Vector3(side * (w / 2 - 0.2), WALL_HEIGHT, -d / 2 - 0.1))
		# Only the back chandeliers are hung: one over the middle would hide the crowd under it.
		for spot: Vector2 in spots:
			if spot.y < 0:
				_chandelier(Vector3(spot.x, 8.5, spot.y))
	else:
		# Out in the grounds: hedges or a stone balustrade, and lamps on posts.
		var garden: bool = room.outdoor == "garden"
		var edge := Shapes.material("#1f3a22" if garden else "#9a9284", 0.9)
		var height := 1.1 if garden else 0.8
		for block in [[0, -d / 2 - 0.6, w + 2.2, 0.9], [-w / 2 - 0.6, 0, 0.9, d + 2.2], [w / 2 + 0.6, 0, 0.9, d + 2.2]]:
			_solid(Shapes.box(block[2], height, block[3]), edge, Vector3(block[0], height / 2, block[1]))
		for post in [Vector2(-w / 2 - 0.6, -d / 2 - 0.6), Vector2(w / 2 + 0.6, -d / 2 - 0.6), Vector2(-w / 2 - 0.6, d / 2), Vector2(w / 2 + 0.6, d / 2)]:
			_solid(Shapes.cylinder(0.06, 0.08, 3, 8), Shapes.material("#1a1612", 0.5, 0.5), Vector3(post.x, 1.5, post.y))
			_solid(Shapes.sphere(0.18, 10, 8), Shapes.flame(), Vector3(post.x, 3.1, post.y))
			var glow := Shapes.glow(2.2, 0.8)
			glow.position = Vector3(post.x, 3.1, post.y)
			add_child(glow)
	for spot: Vector2 in spots:
		var lamp := OmniLight3D.new()
		lamp.light_color = Color("ffb860")
		lamp.light_energy = 2.2 if room.walls else 1.4
		lamp.omni_range = 30
		lamp.omni_attenuation = 1.6
		lamp.position = Vector3(spot.x, 6, spot.y)
		add_child(lamp)
		lamps.append(lamp)


func _plane(w: float, d: float, mat: Material, y: float) -> MeshInstance3D:
	var mesh := PlaneMesh.new()
	mesh.size = Vector2(w, d)
	var instance := MeshInstance3D.new()
	instance.mesh = mesh
	instance.material_override = mat
	instance.position.y = y
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(instance)
	return instance


func _solid(mesh: Mesh, mat: Material, at: Vector3, rot := Vector3.ZERO) -> MeshInstance3D:
	var instance := MeshInstance3D.new()
	instance.mesh = mesh
	instance.material_override = mat
	instance.position = at
	instance.rotation = rot
	add_child(instance)
	return instance


## Tall night windows between curtains, or the room's own furniture along the back wall at depth `back`.
func _dress_wall(dressing: String, w: float, back: float) -> void:
	var parts := Shapes.new()
	match dressing:
		"shelves":
			# Bookcases, each shelf a row of spines in leather colours.
			var spines := ["#6a1426", "#1f3e5a", "#2c4a2a", "#7a5a20", "#3a2440"]
			var cases := maxi(3, roundi(w / 5))
			var width := w / cases - 0.5
			for index in cases:
				var x := -w / 2 + (w / cases) * (index + 0.5)
				parts.add(Shapes.box(width + 0.3, 5, 0.3), "#3a2414", Vector3(x, 3.6, back + 0.1))
				for shelf in 4:
					var y := 1.6 + shelf * 1.2
					parts.add(Shapes.box(width, 0.08, 0.5), "#3a2414", Vector3(x, y, back + 0.25))
					var left := x - width / 2 + 0.05
					var book := index * 7 + shelf * 3
					while left < x + width / 2 - 0.2:
						var thick := 0.14 + frac_hash(book) * 0.12
						var tall := 0.75 + frac_hash(book + 0.5) * 0.25
						parts.add(Shapes.box(thick - 0.02, tall, 0.4), spines[int(frac_hash(book + 0.3) * spines.size())], Vector3(left + thick / 2, y + 0.04 + tall / 2, back + 0.27))
						left += thick
						book += 1
		"paintings":
			# Gilt-framed portraits under picture lights.
			var canvases := ["#3a2a1a", "#1c2a3a", "#4a2a2a", "#2a3a2a"]
			var count := maxi(3, roundi(w / 7))
			for index in count:
				var x := -w / 2 + (w / count) * (index + 0.5)
				var tall := index % 2 == 0
				var pw := 2.2 if tall else 3.0
				var ph := 3.0 if tall else 2.2
				_solid(Shapes.box(pw + 0.4, ph + 0.4, 0.12), Shapes.gold(), Vector3(x, 3.8, back + 0.05))
				_solid(Shapes.box(pw, ph, 0.14), Shapes.material(canvases[index % canvases.size()], 0.9), Vector3(x, 3.8, back + 0.07))
				_solid(Shapes.cylinder(0.35 * (ph / 3), 0.35 * (ph / 3), 0.02, 16), Shapes.material("#b89a7a", 0.9), Vector3(x, 3.8 + ph * 0.12, back + 0.15), Vector3(PI / 2, 0, 0))
				_solid(Shapes.box(0.9, 0.08, 0.2), Shapes.flame(), Vector3(x, 3.8 + ph / 2 + 0.4, back + 0.2))
			return
		"vaults":
			# Round steel vault doors set into the wall.
			var steel := Shapes.material("#5a606a", 0.35, 0.8)
			var count := maxi(2, roundi(w / 9))
			for index in count:
				var x := -w / 2 + (w / count) * (index + 0.5)
				_solid(Shapes.cylinder(1.7, 1.7, 0.3, 32), steel, Vector3(x, 3.4, back + 0.1), Vector3(PI / 2, 0, 0))
				_solid(Shapes.torus(1.7, 0.12), Shapes.gold(), Vector3(x, 3.4, back + 0.26), Vector3(PI / 2, 0, 0))
				for spoke in 3:
					_solid(Shapes.box(1.4, 0.1, 0.1), Shapes.gold(), Vector3(x, 3.4, back + 0.35), Vector3(0, 0, spoke * PI / 3))
			return
		"pigeonholes":
			# A sorting wall of pigeonholes, some with letters in them.
			_solid(Shapes.box(w * 0.8, 4.2, 0.2), Shapes.material("#1a1008", 1.0), Vector3(0, 3.6, back))
			var columns := roundi(w * 0.8 / 0.9)
			for column in columns + 1:
				parts.add(Shapes.box(0.08, 4.2, 0.5), "#4a3218", Vector3(-w * 0.4 + (w * 0.8 * column) / columns, 3.6, back + 0.2))
			for row in 6:
				parts.add(Shapes.box(w * 0.8, 0.08, 0.5), "#4a3218", Vector3(0, 1.5 + row * 0.84, back + 0.2))
			for column in columns:
				for row in 5:
					if frac_hash(column * 5 + row) < 0.55:
						continue
					parts.add(Shapes.box(0.6, 0.4, 0.05), "#e8dcc0", Vector3(-w * 0.4 + (w * 0.8 * (column + 0.5)) / columns, 1.75 + row * 0.84, back + 0.32))
		_:
			var glass := Shapes.material("#0c1830", 0.2, 0.0, "#20365e")
			var curtain := Shapes.material("#6a1426", 0.9)
			var count := maxi(2, roundi(w / 9))
			for index in count:
				var x := -w / 2 + (w / count) * (index + 0.5)
				_solid(Shapes.box(2.2, 4.2, 0.08), glass, Vector3(x, 3.6, back + 0.03))
				_solid(Shapes.box(2.45, 4.45, 0.04), Shapes.gold(), Vector3(x, 3.6, back))
				for side in [-1, 1]:
					_solid(Shapes.box(0.6, 5.4, 0.25), curtain, Vector3(x + side * 1.45, 3.7, back + 0.15))
			return
	_solid(parts.build(), Shapes.material("", 0.62), Vector3.ZERO)


func _chandelier(at: Vector3) -> void:
	var group := Node3D.new()
	group.position = at
	add_child(group)
	for tier in [[0.0, 1.2], [0.45, 0.72]]:
		var ring := MeshInstance3D.new()
		ring.mesh = Shapes.torus(tier[1], 0.05, 40)
		ring.material_override = Shapes.gold()
		ring.position.y = tier[0]
		group.add_child(ring)
		for i in 10:
			var angle := i / 10.0 * TAU
			var flame := MeshInstance3D.new()
			flame.mesh = Shapes.sphere(0.06, 6, 5)
			flame.material_override = Shapes.flame()
			flame.position = Vector3(cos(angle) * tier[1], tier[0] + 0.22, sin(angle) * tier[1])
			group.add_child(flame)
	var chain := MeshInstance3D.new()
	chain.mesh = Shapes.cylinder(0.03, 0.03, 6, 4)
	chain.material_override = Shapes.gold()
	chain.position.y = 3.3
	group.add_child(chain)
	var glow := Shapes.glow(4.6, 0.55)
	glow.position.y = 0.3
	group.add_child(glow)
	# Hung high in front of the key light; their shadows would be big rings on the floor.
	for child in group.get_children():
		if child is GeometryInstance3D:
			child.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


## Each mode is a room in the mansion, so each gets its own floor. Painted in arena pixels.
static func paint_floor(canvas: CanvasItem, arena: Dictionary, floor_style: String) -> void:
	var theme: Dictionary = FLOORS[floor_style]
	var width: float = arena.width
	var height: float = arena.height
	var rgb := func(c: Array, shade: float) -> Color: return Color8(clampi(int(c[0] + shade), 0, 255), clampi(int(c[1] + shade), 0, 255), clampi(int(c[2] + shade), 0, 255))
	var base: Array = theme.base
	canvas.draw_rect(Rect2(0, 0, width, height), rgb.call(base, -30))
	var size: float = theme.size
	var jitter: float = theme.jitter
	var noise := func(x: float, y: float) -> float: return frac_hash(x * 7 + y * 13) * jitter - jitter / 2
	match theme.pattern:
		"planks":
			# Staggered boards running across the room.
			var length := size * 5
			var row := 0
			var y := 0.0
			while y < height:
				var x := -(row % 3) * (length / 3)
				while x < width:
					var colour: Array = theme.alt if theme.has("alt") and (row + roundi(x / length)) % 2 != 0 else base
					canvas.draw_rect(Rect2(x + 1, y + 1, length - 2, size - 2), rgb.call(colour, noise.call(x, y)))
					x += length
				y += size
				row += 1
		"flagstones":
			# Uneven stones: rows of varying widths.
			var y := 0.0
			while y < height:
				var x := -frac_hash(y) * size
				while x < width:
					var stone := size * (0.7 + frac_hash(x * 3 + y) * 0.8)
					canvas.draw_rect(Rect2(x + 2, y + 2, stone - 4, size - 4), rgb.call(base, noise.call(x, y)))
					x += stone
				y += size
		"grass":
			var y := 0.0
			while y < height:
				var x := 0.0
				while x < width:
					canvas.draw_rect(Rect2(x, y, size, size), rgb.call(base, noise.call(x, y)))
					x += size
				y += size
			var tuft: Color = rgb.call(base, -18)
			for index in int(width * height / 900):
				var tx := frac_hash(index * 31) * width
				var ty := frac_hash(index * 57 + 3) * height
				canvas.draw_line(Vector2(tx - 3, ty), Vector2(tx - 1, ty - 5), tuft, 1.5)
				canvas.draw_line(Vector2(tx + 2, ty), Vector2(tx + 3, ty - 4), tuft, 1.5)
		"carpet":
			canvas.draw_rect(Rect2(0, 0, width, height), rgb.call(base, 0))
			# A repeating diamond motif.
			var line: Color = rgb.call(base, 16)
			var y := 0.0
			while y < height + size:
				var x := 0.0
				while x < width + size:
					var diamond := PackedVector2Array([Vector2(x, y - size / 3), Vector2(x + size / 3, y), Vector2(x, y + size / 3), Vector2(x - size / 3, y), Vector2(x, y - size / 3)])
					canvas.draw_polyline(diamond, line, 2)
					x += size
				y += size
			canvas.draw_rect(Rect2(24, 24, width - 48, height - 48), Color8(224, 166, 74, 89), false, 4)
		_:
			var row := 0
			var y := 0.0
			while y < height:
				var col := 0
				var x := 0.0
				while x < width:
					var colour: Array = theme.alt if theme.pattern == "checker" and theme.has("alt") and (row + col) % 2 != 0 else base
					canvas.draw_rect(Rect2(x + 1, y + 1, size - 2, size - 2), rgb.call(colour, noise.call(x, y)))
					x += size
					col += 1
				y += size
				row += 1
	canvas.draw_rect(Rect2(3, 3, width - 6, height - 6), theme.edge, false, 6)
	if arena.has("exitX"):
		var exit_x: float = arena.exitX
		var stripe := 18.0
		var y := 0.0
		while y < height:
			canvas.draw_rect(Rect2(exit_x, y, 8, stripe), Color("d9a441"))
			canvas.draw_rect(Rect2(exit_x, y + stripe, 8, stripe), Color("2d2a22"))
			y += stripe * 2
		canvas.draw_rect(Rect2(exit_x + 8, 0, width - exit_x - 8, height), Color8(217, 164, 65, 36))
		canvas.draw_set_transform(Vector2(exit_x + 50, height / 2), PI / 2)
		canvas.draw_string(ThemeDB.fallback_font, Vector2(-60, 10), "E X I T", HORIZONTAL_ALIGNMENT_CENTER, 120, 28, Color8(236, 230, 214, 140))
		canvas.draw_set_transform(Vector2.ZERO)
