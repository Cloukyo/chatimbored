class_name MaskArt
extends RefCounted
## The animal masks, drawn flat and front-on with ears up, the same shapes as the web version's
## drawMask. A mask is a 128px texture on a card that always turns to face the camera.
## When the real masks are modelled, they replace these cards (see view/README.md).

const TRIM := Color("e8c66a")


## Draws around (0, 0) in mask units (the face is 15.6 wide); scale with draw_set_transform first.
static func draw(canvas: CanvasItem, animal: String, colour: String) -> void:
	var fill := Color(FigureLook.MASK_COLOURS[colour])
	var ears := PackedVector2Array()
	match animal:
		"fox", "cat", "wolf":
			var tip := -9.0 if animal == "cat" else -11.0
			ears = PackedVector2Array([Vector2(-7, -1), Vector2(-6, tip), Vector2(-2, -4), Vector2(2, -4), Vector2(6, tip), Vector2(7, -1)])
		"owl":
			ears = PackedVector2Array([Vector2(-7, -2), Vector2(-7.5, -9), Vector2(-3, -4), Vector2(3, -4), Vector2(7.5, -9), Vector2(7, -2)])
	if not ears.is_empty():
		canvas.draw_colored_polygon(ears, fill)
		canvas.draw_polyline(CanvasPainter.closed(ears), TRIM, 0.9, true)
	if animal == "hare":
		for side in [-1, 1]:
			var ear := CanvasPainter.ellipse(Vector2(side * 3, -10), 2, 7, side * 0.15, 20)
			canvas.draw_colored_polygon(ear, fill)
			canvas.draw_polyline(CanvasPainter.closed(ear), TRIM, 0.9, true)
	if animal == "bear":
		for side in [-1, 1]:
			var ear := CanvasPainter.ellipse(Vector2(side * 6, -5), 3, 3, 0, 20)
			canvas.draw_colored_polygon(ear, fill)
			canvas.draw_polyline(CanvasPainter.closed(ear), TRIM, 0.9, true)
	if animal == "stag":
		for side in [-1, 1]:
			canvas.draw_line(Vector2(side * 3, -4), Vector2(side * 8, -13), fill, 1.8, true)
			canvas.draw_line(Vector2(side * 6, -9), Vector2(side * 11, -10), fill, 1.8, true)
	var face := CanvasPainter.ellipse(Vector2.ZERO, 7.8, 5.2, 0, 40)
	canvas.draw_colored_polygon(face, fill)
	# Sheen: light at the top, shadow at the bottom.
	var sheen := PackedColorArray()
	for point in face:
		var t := (point.y + 5.2) / 10.4
		sheen.append(Color(1, 1, 1, 0.35).lerp(Color(0, 0, 0, 0.25), t))
	canvas.draw_polygon(face, sheen)
	canvas.draw_polyline(CanvasPainter.closed(face), TRIM, 0.9, true)
	for side in [-1, 1]:
		canvas.draw_colored_polygon(CanvasPainter.ellipse(Vector2(side * 3.1, -0.6), 2, 1.3, -side * 0.15, 20), Color("0e0608"))
		canvas.draw_polyline(CanvasPainter.closed(CanvasPainter.ellipse(Vector2(side * 3.1, -0.6), 2.4, 1.7, -side * 0.15, 20)), TRIM, 0.6, true)
	if animal in ["fox", "wolf", "bear"]:
		var snout := PackedVector2Array([Vector2(-2.5, 3), Vector2(0, 8), Vector2(2.5, 3)])
		canvas.draw_colored_polygon(snout, fill)
		canvas.draw_polyline(CanvasPainter.closed(snout), TRIM, 0.9, true)
	if animal in ["raven", "owl"]:
		canvas.draw_colored_polygon(PackedVector2Array([Vector2(-1.7, 2), Vector2(0, 9), Vector2(1.7, 2)]), TRIM)
