extends Node
## Sound effects and the ballroom band. Autoloaded as `Audio`. The files are baked by audio/make_audio.py
## from the web version's recipes; swap in real recordings with the same names.

const EFFECTS := ["shot", "down", "strike", "bump", "bell", "chime", "vault", "step", "tick", "click", "start", "win", "lose", "reveal"]
const TRACKS := ["lobby", "round", "round_tense", "finale"]

var _effects := {}
var _tracks := {}
var _pool: Array[AudioStreamPlayer] = []
var _music := AudioStreamPlayer.new()
var _hubbub := AudioStreamPlayer.new()
var _scene := ""
var _tense := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for bus in ["Music", "Effects"]:
		if AudioServer.get_bus_index(bus) == -1:
			AudioServer.add_bus()
			AudioServer.set_bus_name(AudioServer.bus_count - 1, bus)
			AudioServer.set_bus_send(AudioServer.bus_count - 1, "Master")
	for name in EFFECTS:
		var path := "res://audio/sfx/%s.wav" % name
		if ResourceLoader.exists(path):
			_effects[name] = load(path)
	for name in TRACKS + ["hubbub"]:
		var path := "res://audio/music/%s.ogg" % name
		if ResourceLoader.exists(path):
			var stream: AudioStreamOggVorbis = load(path)
			stream.loop = true
			_tracks[name] = stream
	_music.bus = "Music"
	add_child(_music)
	_hubbub.bus = "Effects"
	_hubbub.volume_db = -60
	add_child(_hubbub)
	for i in 10:
		var player := AudioStreamPlayer.new()
		player.bus = "Effects"
		add_child(player)
		_pool.append(player)


## 0..1 levels for music and effects.
func set_levels(music: float, effects: float) -> void:
	_set_bus("Music", music * 0.7)
	_set_bus("Effects", effects)


func _set_bus(bus: String, level: float) -> void:
	var index := AudioServer.get_bus_index(bus)
	if index == -1:
		return
	AudioServer.set_bus_mute(index, level <= 0.001)
	AudioServer.set_bus_volume_db(index, linear_to_db(maxf(level, 0.001)))


func play(cue: String, volume_db := 0.0) -> void:
	if not _effects.has(cue):
		return
	for player in _pool:
		if not player.playing:
			player.stream = _effects[cue]
			player.volume_db = volume_db
			player.play()
			return


## "lobby" (the music box), "round" (the full band) or "finale". A new scene starts from the top.
func set_scene(scene: String) -> void:
	if scene == _scene:
		return
	_scene = scene
	_tense = false
	_switch(scene, 0.0)


## The last stretch of a round: the band speeds up and the drums come in, keeping its place in the tune.
func set_tense(tense: bool) -> void:
	if tense == _tense or _scene != "round":
		return
	_tense = tense
	var from := "round" if tense else "round_tense"
	var to := "round_tense" if tense else "round"
	if not _tracks.has(from) or not _tracks.has(to):
		return
	var from_stream: AudioStream = _tracks[from]
	var to_stream: AudioStream = _tracks[to]
	var at: float = _music.get_playback_position() / from_stream.get_length()
	_switch(to, at * to_stream.get_length())


func _switch(track: String, at: float) -> void:
	if not _tracks.has(track):
		_music.stop()
		return
	_music.stream = _tracks[track]
	_music.play(at)


## The murmur of a full room while a round is on.
func set_crowd(on: bool) -> void:
	if not _tracks.has("hubbub"):
		return
	if on and not _hubbub.playing:
		_hubbub.stream = _tracks.hubbub
		_hubbub.play()
	var tween := create_tween()
	tween.tween_property(_hubbub, "volume_db", -14.0 if on else -60.0, 1.5 if on else 0.8)
	if not on:
		tween.tween_callback(_hubbub.stop)


## Let go of the streams on the way out, or the engine reports them as leaked.
func _exit_tree() -> void:
	for player in _pool + [_music, _hubbub]:
		player.stop()
		player.stream = null
	_tracks.clear()
	_effects.clear()
