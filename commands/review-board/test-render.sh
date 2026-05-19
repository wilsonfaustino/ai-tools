#!/usr/bin/env bash
# Smoke-test the review-board renderer against the captured fixture.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="/tmp/review-board-render-test.html"

python3 "$HERE/render.py" \
  < "$HERE/sample.json" \
  > "$OUT"

bytes=$(wc -c <"$OUT" | tr -d ' ')
echo "Wrote $OUT (${bytes} bytes)"

# Assertions: every severity present, out-of-diff badge rendered, submit button present.
grep -q 'data-severity="critical"' "$OUT" || { echo "FAIL: critical section missing" >&2; exit 1; }
grep -q 'data-severity="major"'    "$OUT" || { echo "FAIL: major section missing"    >&2; exit 1; }
grep -q 'data-severity="minor"'    "$OUT" || { echo "FAIL: minor section missing"    >&2; exit 1; }
grep -q 'data-severity="nit"'      "$OUT" || { echo "FAIL: nit section missing"      >&2; exit 1; }
grep -q 'class="badge out-of-diff"' "$OUT" || { echo "FAIL: out-of-diff badge missing" >&2; exit 1; }
grep -q 'id="submit-btn"'          "$OUT" || { echo "FAIL: submit button missing"    >&2; exit 1; }
grep -q 'src/db.ts:88'             "$OUT" || { echo "FAIL: known finding path missing" >&2; exit 1; }

echo "PASS"

if [[ "${1:-}" == "--open" ]]; then
  open "$OUT"
fi
