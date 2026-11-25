class_name CanvasPainter
extends SubViewport
## A small off-screen canvas: `paint(canvas)` draws on it with the usual CanvasItem calls and the
## result is a texture for 3D materials. Floors, masks and floor markings are painted this way so the
## drawing code reads like the web version's 2D canvas code.

var _canvas: _Canvas


func _init(size_px: Vector2i, paint: Callable, every_frame := false) -> void:
	size = size_px
	transparent_bg = true
	disable_3d = true
	render_target_update_mode = SubViewport.UPDATE_ALWAYS if every_frame else SubViewport.UPDATE_ONCE
	_canvas = _Canvas.new()
	_canvas.paint = paint
	add_child(_canvas)


## Paint again (for painters that only update once).
func repaint() -> void:
	_canvas.queue_redraw()
	render_target_update_mode = SubViewport.UPDATE_ONCE


func refresh() -> void:
	_canvas.queue_redraw()


class _Canvas:
	extends Node2D
	var paint: Callable

	func _draw() -> void:
		paint.call(self)


## An ellipse outline as points, for filled shapes and strokes.
static func ellipse(center: Vector2, rx: float, ry: float, tilt := 0.0, steps := 32) -> PackedVector2Array:
	var points := PackedVector2Array()
	for i in steps:
		var a := TAU * i / steps
		points.append(center + Vector2(cos(a) * rx, sin(a) * ry).rotated(tilt))
	return points


static func closed(points: PackedVector2Array) -> PackedVector2Array:
	var loop := points.duplicate()
	loop.append(points[0])
	return loop
