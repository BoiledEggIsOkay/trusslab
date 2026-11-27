#!/bin/sh
# Headless checks for TrussLab: a syntax check of every .js file, then every test/*.test.js suite.
# Uses Node when it is installed, otherwise macOS JavaScriptCore (jsc). Exits non-zero on any failure.
# The browser smoke test (index.html?smoke) is not run here: it needs a real browser.
set -u
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd) || exit 2
cd "$ROOT" || exit 2
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
if command -v node >/dev/null 2>&1; then ENGINE=node
elif [ -x "$JSC" ]; then ENGINE=jsc
else echo "No JavaScript engine found: install Node, or run on macOS (JavaScriptCore)."; exit 2
fi
echo "TrussLab headless checks in $ROOT (engine: $ENGINE)"
fail=0

echo "Syntax:"
for f in $(find . -name '*.js' -not -path './.git/*' -not -path './node_modules/*' | sort); do
  if [ "$ENGINE" = node ]; then out=$(node --check "$f" 2>&1); st=$?
  else out=$("$JSC" -e "new Function(readFile('$f'))" 2>&1); st=$?
  fi
  if [ "$st" -eq 0 ]; then echo "  ok    $f"
  else echo "  FAIL  $f"; printf '%s\n' "$out" | head -5 | sed 's/^/        /'; fail=1
  fi
done

echo "Suites:"
found=0
for t in test/*.test.js; do
  [ -e "$t" ] || continue
  found=1
  if [ "$ENGINE" = node ]; then out=$(node "$t" 2>&1); st=$?
  else out=$("$JSC" "$t" 2>&1); st=$?
  fi
  summary=$(printf '%s\n' "$out" | grep -E '[0-9]+ passed, [0-9]+ failed' | tail -1)
  if [ "$st" -eq 0 ]; then echo "  PASS  $t: $summary"
  else
    echo "  FAIL  $t (exit $st): $summary"
    printf '%s\n' "$out" | grep -E '^FAIL|Exception|Error' | head -20 | sed 's/^/        /'
    fail=1
  fi
done
[ "$found" -eq 1 ] || { echo "  FAIL  no test/*.test.js suites found"; fail=1; }

if [ "$fail" -eq 0 ]; then echo "All headless checks passed."; else echo "Some headless checks FAILED."; fi
exit "$fail"
