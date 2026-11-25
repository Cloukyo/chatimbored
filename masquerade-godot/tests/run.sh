#!/usr/bin/env bash
# Runs the Godot tests headless. Fails on any failed test or any script error.
# Usage: masquerade-godot/tests/run.sh [filter]   (GODOT=/path/to/godot to pick the binary)
set -u
cd "$(dirname "$0")/.."
GODOT="${GODOT:-godot}"
"$GODOT" --headless --import --path . >/dev/null 2>&1
out=$("$GODOT" --headless --path . --script res://tests/run_tests.gd -- "${1:-}" 2>&1)
status=$?
echo "$out" | grep -vE '^Godot Engine|^$'
if echo "$out" | grep -q "SCRIPT ERROR"; then
  echo "Script errors above." >&2
  exit 1
fi
exit $status
