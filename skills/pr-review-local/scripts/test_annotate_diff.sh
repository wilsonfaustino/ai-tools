#!/usr/bin/env bash
# Fails if the [L<n>] counter drifts on the golden fixture, or if a
# hunk-less input stops being an error.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 scripts/annotate_diff.py < fixtures/sample.diff \
  | diff -u fixtures/sample.annotated.diff -

if echo "no hunks here" | python3 scripts/annotate_diff.py 2>/dev/null; then
  echo "FAIL: hunk-less input should exit non-zero" >&2
  exit 1
fi

echo "PASS"
