#!/usr/bin/env bash
# Smoke-test the ccusage-html renderer against the captured fixture.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="/tmp/ccusage-render-test.html"

python3 "$HERE/render.py" \
  --mode daily \
  --source-cmd 'npx ccusage daily --json' \
  < "$HERE/sample.json" \
  > "$OUT"

bytes=$(wc -c <"$OUT" | tr -d ' ')
rows=$(grep -c '<tr>' "$OUT" || true)
echo "Wrote $OUT (${bytes} bytes, ${rows} <tr> tags)"

if [[ "${1:-}" == "--open" ]]; then
  open "$OUT"
fi
