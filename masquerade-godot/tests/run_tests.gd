extends SceneTree
## Headless test runner: godot --headless --path masquerade-godot --script res://tests/run_tests.gd
## Runs every test_* method in every tests/test_*.gd file and exits non-zero on any failure.
## Pass a filter after `--` to run matching tests only: ... -- marked


func _init() -> void:
	var filter := ""
	var args := OS.get_cmdline_user_args()
	if not args.is_empty():
		filter = args[0]
	var passed := 0
	var failed: Array[String] = []
	var files := DirAccess.get_files_at("res://tests")
	for file in files:
		if not file.begins_with("test_") or not file.ends_with(".gd"):
			continue
		var script: GDScript = load("res://tests/" + file)
		for method in script.get_script_method_list():
			var name: String = method.name
			if not name.begins_with("test_") or (filter != "" and not (file + ":" + name).contains(filter)):
				continue
			var case: TestCase = script.new()
			case.call(name)
			if case.failures.is_empty():
				passed += 1
			else:
				failed.append("%s:%s\n    %s" % [file, name, "\n    ".join(case.failures)])
	for failure in failed:
		printerr("FAIL " + failure)
	print("%d passed, %d failed" % [passed, failed.size()])
	quit(1 if not failed.is_empty() else 0)
