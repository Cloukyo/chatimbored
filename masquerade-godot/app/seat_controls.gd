class_name SeatControls
extends RefCounted
## Menu buttons for each device, as presses (a button that went down this frame). Devices are
## "keyboard" or a controller's device id. Call update() once a frame, then read presses(device).
##
## Keyboard: arrows or WASD move, Enter / Space / E choose, Backspace back, Esc pause, Tab extra.
## Controller: d-pad or left stick move, A choose, B back, Start pause, Y extra, X second.

const KEYS := {
	"up": [KEY_UP, KEY_W], "down": [KEY_DOWN, KEY_S], "left": [KEY_LEFT, KEY_A], "right": [KEY_RIGHT, KEY_D],
	"accept": [KEY_ENTER, KEY_KP_ENTER, KEY_SPACE, KEY_E], "back": [KEY_BACKSPACE], "start": [KEY_ESCAPE],
	"extra": [KEY_TAB], "second": [KEY_X],
}
const BUTTONS := {
	"up": [JOY_BUTTON_DPAD_UP], "down": [JOY_BUTTON_DPAD_DOWN], "left": [JOY_BUTTON_DPAD_LEFT], "right": [JOY_BUTTON_DPAD_RIGHT],
	"accept": [JOY_BUTTON_A], "back": [JOY_BUTTON_B], "start": [JOY_BUTTON_START], "extra": [JOY_BUTTON_Y], "second": [JOY_BUTTON_X],
}
const STICK := 0.55

var _was := {}
var _now := {}
## Simulated presses for screenshots and tests: device -> [names].
var injected := {}


func update() -> void:
	_was = _now
	_now = {}
	_now["keyboard"] = _keyboard_state()
	for device in Input.get_connected_joypads():
		_now[device] = _pad_state(device)


## {up, down, left, right, accept, back, start, extra, second}: true when pressed this frame.
func presses(device: Variant) -> Dictionary:
	var now: Dictionary = _now.get(device, {})
	var was: Dictionary = _was.get(device, {})
	var out := {}
	for name in KEYS:
		out[name] = now.get(name, false) and not was.get(name, false)
	for name in injected.get(device, []):
		out[name] = true
	return out


## Every device that pressed something this frame, keyboard first.
func active_devices() -> Array:
	var devices := []
	for device in _now:
		var p := presses(device)
		if p.values().has(true):
			devices.append(device)
	for device in injected:
		if not devices.has(device):
			devices.append(device)
	return devices


func clear_injected() -> void:
	injected.clear()


func any_pressed() -> bool:
	return not active_devices().is_empty()


static func device_name(device: Variant) -> String:
	if device is String:
		return "Keyboard & mouse" if device == "keyboard" else "Computer"
	return "Controller %d" % (int(device) + 1)


func _keyboard_state() -> Dictionary:
	var state := {}
	for name in KEYS:
		for key in KEYS[name]:
			if Input.is_physical_key_pressed(key):
				state[name] = true
	return state


func _pad_state(device: int) -> Dictionary:
	var state := {}
	for name in BUTTONS:
		for button in BUTTONS[name]:
			if Input.is_joy_button_pressed(device, button):
				state[name] = true
	var x := Input.get_joy_axis(device, JOY_AXIS_LEFT_X)
	var y := Input.get_joy_axis(device, JOY_AXIS_LEFT_Y)
	if y < -STICK:
		state.up = true
	if y > STICK:
		state.down = true
	if x < -STICK:
		state.left = true
	if x > STICK:
		state.right = true
	return state
