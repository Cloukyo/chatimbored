class_name UiStyle
extends RefCounted
## The game's look for menus and cards: gold on burgundy, like an invitation.

const GOLD := Color("e0b85a")
const INK := Color("f5e6c8")
const DIM := Color(0.96, 0.9, 0.78, 0.55)
const BURGUNDY := Color(0.22, 0.04, 0.07, 0.9)
const SHADE := Color(0.03, 0.01, 0.02, 0.6)
const SELECTED := Color(0.5, 0.12, 0.16, 0.95)

static var _serif: SystemFont = null
static var _bold: SystemFont = null


static func serif(bold := false) -> SystemFont:
	if _serif == null:
		var names := PackedStringArray(["Cinzel", "Cormorant Garamond", "Georgia", "Times New Roman", "Liberation Serif", "DejaVu Serif", "serif"])
		_serif = SystemFont.new()
		_serif.font_names = names
		_bold = SystemFont.new()
		_bold.font_names = names
		_bold.font_weight = 700
	return _bold if bold else _serif


static func label(text: String, size := 20, colour := INK, bold := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", serif(bold))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", colour)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


static func rich(size := 20) -> RichTextLabel:
	var r := RichTextLabel.new()
	r.bbcode_enabled = true
	r.fit_content = true
	r.scroll_active = false
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	r.add_theme_font_override("normal_font", serif())
	r.add_theme_font_override("bold_font", serif(true))
	r.add_theme_font_override("italics_font", serif())
	r.add_theme_font_size_override("normal_font_size", size)
	r.add_theme_font_size_override("bold_font_size", size)
	r.add_theme_font_size_override("italics_font_size", size)
	r.add_theme_color_override("default_color", INK)
	return r


static func panel(padding := 18.0, fill := BURGUNDY, border := GOLD) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = fill
	style.border_color = border
	style.set_border_width_all(2)
	style.set_corner_radius_all(6)
	style.content_margin_left = padding + 6
	style.content_margin_right = padding + 6
	style.content_margin_top = padding * 0.7
	style.content_margin_bottom = padding * 0.8
	return style


static func card(padding := 18.0) -> PanelContainer:
	var c := PanelContainer.new()
	c.add_theme_stylebox_override("panel", panel(padding))
	c.mouse_filter = Control.MOUSE_FILTER_PASS
	return c


## A full-screen layer dimming whatever is behind it.
static func shade(alpha := 0.6) -> ColorRect:
	var rect := ColorRect.new()
	rect.color = Color(SHADE, alpha)
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return rect


static func centered(child: Control) -> CenterContainer:
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_PASS
	center.add_child(child)
	return center
