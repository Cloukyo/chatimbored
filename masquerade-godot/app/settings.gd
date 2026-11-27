extends Node
## Player settings, saved to user://settings.cfg and applied at start-up. Autoloaded as `Settings`.

signal changed

const PATH := "user://settings.cfg"
const RESOLUTIONS := [Vector2i(1280, 720), Vector2i(1600, 900), Vector2i(1920, 1080), Vector2i(2560, 1440), Vector2i(3840, 2160)]

var music := 0.6
var effects := 0.8
var fullscreen := false
var resolution := Vector2i(1280, 720)
var vsync := true
var rumble := true
## Rooms in a night and in a quick-play set.
var night_rounds := 5
var quick_rounds := 5
## The night's layer switches (NightData.LAYERS keys), as last chosen.
var night_options := {}
## Seat names as last typed, by seat number.
var names := {}


func _ready() -> void:
	load_settings()
	apply()


func load_settings() -> void:
	var file := ConfigFile.new()
	if file.load(PATH) != OK:
		return
	music = clampf(file.get_value("audio", "music", music), 0, 1)
	effects = clampf(file.get_value("audio", "effects", effects), 0, 1)
	fullscreen = file.get_value("video", "fullscreen", fullscreen)
	resolution = file.get_value("video", "resolution", resolution)
	vsync = file.get_value("video", "vsync", vsync)
	rumble = file.get_value("input", "rumble", rumble)
	night_rounds = clampi(file.get_value("game", "night_rounds", night_rounds), 3, 9)
	quick_rounds = clampi(file.get_value("game", "quick_rounds", quick_rounds), 1, 20)
	night_options = file.get_value("game", "night_options", night_options)
	names = file.get_value("game", "names", names)


func save() -> void:
	var file := ConfigFile.new()
	file.set_value("audio", "music", music)
	file.set_value("audio", "effects", effects)
	file.set_value("video", "fullscreen", fullscreen)
	file.set_value("video", "resolution", resolution)
	file.set_value("video", "vsync", vsync)
	file.set_value("input", "rumble", rumble)
	file.set_value("game", "night_rounds", night_rounds)
	file.set_value("game", "quick_rounds", quick_rounds)
	file.set_value("game", "night_options", night_options)
	file.set_value("game", "names", names)
	file.save(PATH)
	changed.emit()


## Sets sound levels, the window and V-Sync from the current values.
func apply() -> void:
	Audio.set_levels(music, effects)
	if DisplayServer.get_name() == "headless":
		return
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if vsync else DisplayServer.VSYNC_DISABLED)
	if fullscreen:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
	else:
		if DisplayServer.window_get_mode() != DisplayServer.WINDOW_MODE_WINDOWED:
			DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
		var screen := DisplayServer.screen_get_usable_rect().size
		var size := Vector2i(mini(resolution.x, screen.x), mini(resolution.y, screen.y))
		if size.x > 0 and size.y > 0:
			DisplayServer.window_set_size(size)
			var origin := DisplayServer.screen_get_usable_rect().position
			DisplayServer.window_set_position(origin + (screen - size) / 2)


## The night's layer switches, with defaults for any not chosen yet.
func night_options_for(shared_screen: bool) -> Dictionary:
	var options := NightData.default_options(shared_screen)
	for key in night_options:
		if options.has(key):
			options[key] = night_options[key]
	if shared_screen:
		for layer in NightData.LAYERS:
			if layer.get("needsPrivateText", false):
				options[layer.key] = false
	return options
