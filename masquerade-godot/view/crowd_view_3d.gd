class_name CrowdView3D
extends Node3D
## Shows a round in 3D from the view dictionaries the rules hand out (CrowdMatch.view_for), so it never
## reads the rules' state directly and works the same for a local round or one from the network.
## Camera, lights and room sizes match the web version: 1 arena pixel = 1/32 m, camera tilted 52°.

const UNIT := Room.UNIT
const FOV := 30.0
const PITCH := deg_to_rad(52.0)
const SHOT_HEIGHT := 1.2
const EFFECT_MS := {"shot": 260.0, "puff": 500.0, "strike": 300.0, "flare": 900.0, "bump": 600.0}
const GROUND_SCALE := 0.5

## A new event from the rules (a shot, a fall, a lantern lit...), once each, for sound. `prop_kind`
## names the prop for "flare" events.
signal event_seen(event: Dictionary, prop_kind: String)

## Screen pixels the HUD covers at the top; the camera keeps the floor below it.
var top_px := 96.0
## Draw this room style whatever the mode (the menus' backdrop uses the ballroom).
var style_override := ""
## [{at, ready}]: where Lookouts and the host aim from above, drawn on the floor.
var crosshairs: Array = []
var camera := Camera3D.new()
var key := SpotLight3D.new()
var environment := Environment.new()
var room: Room = null
var arena := {"width": 1280.0, "height": 720.0}

var _room_key := ""
var _fitted := ""
var _zone_key := ""
var _figures := {}
var _props := {}
var _seen_events := {}
var _effects: Array = []
var _flares := {}
var _ground: CanvasPainter = null
var _last_view := {}
var _now_ms := 0.0
## Painted floor markings this frame: hint, zone, strikes and puffs.
var _hint: Variant = null


func _ready() -> void:
	Figure.painter_host = self
	Figure.forget_masks()
	camera.fov = FOV
	camera.near = 1
	camera.far = 400
	add_child(camera)
	camera.make_current()
	key.light_color = Color("ffd7a0")
	key.light_energy = 4.0
	key.spot_range = 90
	key.spot_angle = rad_to_deg(0.75)
	key.spot_angle_attenuation = 0.7
	key.shadow_enabled = true
	key.shadow_bias = 0.03
	add_child(key)
	var world := WorldEnvironment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("070405")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("6a4a58").lerp(Color("1a0c08"), 0.35)
	environment.ambient_light_energy = 0.55
	environment.tonemap_mode = Environment.TONE_MAPPER_ACES
	environment.glow_enabled = true
	environment.glow_intensity = 0.6
	environment.glow_bloom = 0.1
	environment.glow_hdr_threshold = 0.9
	world.environment = environment
	add_child(world)
	get_viewport().size_changed.connect(func() -> void: _fitted = "")


## Feed one view (from CrowdMatch.view_for or spectator_view). `now_ms` is the screen's clock.
func show_view(view: Dictionary, now_ms: float, dt: float) -> void:
	_now_ms = now_ms
	_last_view = view
	_set_room(view.mode, view.arena)
	_fit()
	_sync_figures(view, dt)
	_take_events(view)
	_sync_props(view)
	_set_zone(view.get("zone", {}))
	_hint = view.hud.get("hint") if view.hud is Dictionary and not view.has("result") else null
	_effects = _effects.filter(func(effect: Dictionary) -> bool: return _now_ms - effect.born < EFFECT_MS[effect.kind])
	if _ground != null:
		_ground.refresh()


func clear() -> void:
	for figure in _figures.values():
		figure.queue_free()
	_figures.clear()
	for prop in _props.values():
		prop.queue_free()
	_props.clear()
	_effects.clear()
	_seen_events.clear()
	_flares.clear()


## Arena point to screen pixels, `height` metres above the floor.
func project(at: Dictionary, height := 0.0) -> Vector2:
	return camera.unproject_position(Vector3(_x(at.x), height, _z(at.y)))


func is_behind(at: Dictionary) -> bool:
	return camera.is_position_behind(Vector3(_x(at.x), 0, _z(at.y)))


## Screen pixel to the arena point on the floor under it, or null.
func to_arena(screen: Vector2) -> Variant:
	var origin := camera.project_ray_origin(screen)
	var normal := camera.project_ray_normal(screen)
	if absf(normal.y) < 0.0001:
		return null
	var t := -origin.y / normal.y
	if t < 0:
		return null
	var hit := origin + normal * t
	return {"x": hit.x * UNIT + arena.width / 2, "y": hit.z * UNIT + arena.height / 2}


## Shots and bumps float over the figures, so the HUD draws them flat over the picture.
func overlay_effects() -> Array:
	return _effects.filter(func(effect: Dictionary) -> bool: return effect.kind == "shot" or effect.kind == "bump")


func effect_age(effect: Dictionary) -> float:
	return clampf((_now_ms - effect.born) / EFFECT_MS[effect.kind], 0, 1)


func _x(arena_x: float) -> float:
	return (arena_x - arena.width / 2) / UNIT


func _z(arena_y: float) -> float:
	return (arena_y - arena.height / 2) / UNIT


func _set_room(mode: String, room_arena: Dictionary) -> void:
	var style: String = style_override if style_override != "" else Room.STYLE_OF.get(mode, "plaza")
	var room_key := "%s:%sx%s:%s" % [style, room_arena.width, room_arena.height, room_arena.get("exitX", "")]
	if room_key == _room_key:
		return
	_room_key = room_key
	arena = room_arena
	clear()
	if room != null:
		room.queue_free()
	room = Room.new(style, arena)
	add_child(room)
	_ground = CanvasPainter.new(Vector2i(int(arena.width * GROUND_SCALE), int(arena.height * GROUND_SCALE)), _paint_ground, true)
	room.add_child(_ground)
	var plane := PlaneMesh.new()
	plane.size = Vector2(arena.width / UNIT, arena.height / UNIT)
	var layer := MeshInstance3D.new()
	layer.mesh = plane
	layer.position.y = 0.03
	layer.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = _ground.get_texture()
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	layer.material_override = mat
	room.add_child(layer)
	_zone_key = ""
	_set_zone({})
	_fitted = ""


## Pull the camera back until the whole floor and the heads at the back fit below the HUD.
func _fit() -> void:
	var size := get_viewport().get_visible_rect().size
	var fit_key := "%s:%s:%s" % [_room_key, size, top_px]
	if fit_key == _fitted or size.x == 0:
		return
	_fitted = fit_key
	var w: float = arena.width / UNIT
	var d: float = arena.height / UNIT
	var corners := [
		Vector3(-w / 2 - 0.6, 0, -d / 2 - 0.6), Vector3(w / 2 + 0.6, 0, -d / 2 - 0.6),
		Vector3(-w / 2 - 0.6, 0, d / 2 + 0.6), Vector3(w / 2 + 0.6, 0, d / 2 + 0.6),
		# Heads at the back still need to show.
		Vector3(0, 2.4, -d / 2),
	]
	var top_limit := 1 - (top_px / size.y) * 2
	var aspect := size.x / size.y
	var tan_half := tan(deg_to_rad(FOV) / 2)
	# Shift the view a little toward the viewer so the HUD covers wall, not floor.
	var shift := -(top_px / size.y) * d * 0.9
	var low := 5.0
	var high := 300.0
	for step in 30:
		var mid := (low + high) / 2
		var xform := _camera_at(mid, shift)
		var fits := true
		for corner: Vector3 in corners:
			var p: Vector3 = xform.affine_inverse() * corner
			var ndc := Vector2(p.x / -p.z / (tan_half * aspect), p.y / -p.z / tan_half)
			if ndc.x < -0.98 or ndc.x > 0.98 or ndc.y < -0.98 or ndc.y > top_limit - 0.02:
				fits = false
				break
		if fits:
			high = mid
		else:
			low = mid
	camera.transform = _camera_at(high, shift)


func _camera_at(distance: float, shift: float) -> Transform3D:
	var at := Vector3(0, sin(PITCH) * distance, cos(PITCH) * distance + shift)
	return Transform3D(Basis(), at).looking_at(Vector3(0, 0, shift), Vector3.UP)


func _sync_figures(view: Dictionary, dt: float) -> void:
	var packed: Array = view.e
	var seen := {}
	var t := _now_ms / 1000.0
	for i in range(0, packed.size(), 5):
		var id: int = packed[i]
		var facing: int = packed[i + 3]
		var figure: Figure = _figures.get(id)
		if figure == null:
			figure = Figure.new(id, facing)
			_figures[id] = figure
			add_child(figure)
		seen[id] = true
		figure.position = Vector3(_x(packed[i + 1]), 0, _z(packed[i + 2]))
		figure.animate(facing, packed[i + 4], t, dt)
		figure.ring.visible = id == view.get("you", 0) and id != 0
	for id in _figures.keys():
		if not seen.has(id):
			_figures[id].queue_free()
			_figures.erase(id)


func _position_of(entity_id: int) -> Variant:
	var packed: Array = _last_view.e
	for i in range(0, packed.size(), 5):
		if packed[i] == entity_id:
			return {"x": packed[i + 1], "y": packed[i + 2]}
	return null


func _take_events(view: Dictionary) -> void:
	for event: Dictionary in view.events:
		if _seen_events.has(event.id):
			continue
		_seen_events[event.id] = true
		var prop_kind := ""
		if event.type == "flare":
			for prop: Dictionary in view.props:
				if prop.id == event.prop:
					prop_kind = prop.kind
		event_seen.emit(event, prop_kind)
		match event.type:
			"shot":
				_effects.append({"kind": "shot", "born": _now_ms, "from": event.from, "to": event.to})
			"strike":
				_effects.append({"kind": "strike", "born": _now_ms, "at": event.at})
			"bump":
				_effects.append({"kind": "bump", "born": _now_ms, "at": event.at})
			"down", "escaped":
				var at: Variant = _position_of(event.entity)
				if at != null:
					_effects.append({"kind": "puff", "born": _now_ms, "at": at})
			"flare":
				_flares[event.prop] = _now_ms


func _sync_props(view: Dictionary) -> void:
	var ids := {}
	for prop: Dictionary in view.props:
		ids[prop.id] = true
		var model: PropModel = _props.get(prop.id)
		if model == null:
			model = PropModel.new(prop.kind)
			_props[prop.id] = model
			add_child(model)
		model.position = Vector3(_x(prop.x), 0, _z(prop.y))
		var flare := 0.0
		if _flares.has(prop.id):
			flare = maxf(0.0, 1 - (_now_ms - _flares[prop.id]) / EFFECT_MS.flare)
		model.update(prop, view.mine.has(prop.id), flare, _now_ms)
	for id in _props.keys():
		if not ids.has(id):
			_props[id].queue_free()
			_props.erase(id)


## Closing Time and the Last Dance: the key light narrows to the circle still lit, the room goes dark.
func _set_zone(zone: Dictionary) -> void:
	var zone_key := "none" if zone.is_empty() else "%s,%s,%s" % [zone.x, zone.y, zone.r]
	if zone_key == _zone_key:
		return
	_zone_key = zone_key
	var w: float = arena.width / UNIT
	var d: float = arena.height / UNIT
	if room != null:
		for lamp in room.lamps:
			if not lamp.has_meta("energy"):
				lamp.set_meta("energy", lamp.light_energy)
			lamp.light_energy = lamp.get_meta("energy") * (1.0 if zone.is_empty() else 0.15)
	environment.ambient_light_energy = 0.55 if zone.is_empty() else 0.18
	if zone.is_empty():
		key.transform = Transform3D(Basis(), Vector3(0, maxf(w, d) * 0.9, d * 0.25)).looking_at(Vector3.ZERO, Vector3.FORWARD)
		key.spot_angle = rad_to_deg(0.75)
		key.spot_angle_attenuation = 0.7
		return
	var height := 30.0
	var below := Vector3(_x(zone.x), 0, _z(zone.y))
	key.transform = Transform3D(Basis(), below + Vector3(0, height, 0)).looking_at(below, Vector3.FORWARD)
	key.spot_angle = rad_to_deg(minf(1.2, atan(zone.r / UNIT / height) * 1.08))
	key.spot_angle_attenuation = 0.15


## Floor markings, painted in arena pixels at half size.
func _paint_ground(canvas: CanvasItem) -> void:
	canvas.draw_set_transform(Vector2.ZERO, 0, Vector2(GROUND_SCALE, GROUND_SCALE))
	if _hint != null:
		# Marked: a soft dashed ring around where your mark roughly was.
		var alpha := 0.35 + sin(_now_ms * 0.004) * 0.12
		var c := Vector2(_hint.x, _hint.y - 15)
		for i in 36:
			if i % 2 == 0:
				canvas.draw_arc(c, 95, TAU * i / 36, TAU * (i + 1) / 36, 4, Color8(233, 128, 107, int(alpha * 255)), 3)
	var zone: Dictionary = _last_view.get("zone", {})
	if not zone.is_empty():
		var c := Vector2(zone.x, zone.y)
		var outer := Vector2(arena.width, arena.height).length()
		canvas.draw_arc(c, (zone.r + outer) / 2, 0, TAU, 96, Color8(8, 10, 16, 158), outer - zone.r)
		canvas.draw_arc(c, zone.r, 0, TAU, 96, Color8(255, 220, 150, 89), 3)
	for crosshair: Dictionary in crosshairs:
		var c := Vector2(crosshair.at.x, crosshair.at.y)
		var colour := Color8(255, 226, 120, 230) if crosshair.ready else Color8(236, 230, 214, 100)
		canvas.draw_arc(c, 14, 0, TAU, 32, colour, 3)
		for direction in [Vector2.LEFT, Vector2.RIGHT, Vector2.UP, Vector2.DOWN]:
			canvas.draw_line(c + direction * 6, c + direction * 22, colour, 3)
	for effect: Dictionary in _effects:
		var age := effect_age(effect)
		match effect.kind:
			"strike":
				canvas.draw_arc(Vector2(effect.at.x, effect.at.y), 14 + age * 6 + 10, 0, TAU, 32, Color(0.94, 0.94, 0.94, 1 - age), 5)
			"puff":
				canvas.draw_arc(Vector2(effect.at.x, effect.at.y), 10 + age * 22, 0, TAU, 32, Color8(236, 230, 214, int((1 - age) * 0.8 * 255)), 4)
