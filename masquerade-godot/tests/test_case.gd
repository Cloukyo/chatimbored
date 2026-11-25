class_name TestCase
extends RefCounted
## Base for test files. Assertions record a failure and carry on, so one run shows every problem.

var failures: Array[String] = []


func ok(condition: bool, message: String = "expected true") -> void:
	if not condition:
		failures.append(message)


func eq(actual, expected, message: String = "") -> void:
	if typeof(actual) in [TYPE_INT, TYPE_FLOAT] and typeof(expected) in [TYPE_INT, TYPE_FLOAT]:
		if is_equal_approx(float(actual), float(expected)):
			return
	elif actual == expected:
		return
	failures.append("%sexpected %s, got %s" % [message + ": " if message else "", str(expected), str(actual)])
