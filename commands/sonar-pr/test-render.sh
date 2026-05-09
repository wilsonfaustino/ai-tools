#!/usr/bin/env bash
# commands/sonar-pr/test-render.sh
# Runs render.sh against sample-response.json and asserts on output.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDER="$SCRIPT_DIR/render.sh"
FIXTURE="$SCRIPT_DIR/sample-response.json"

fail() { echo "FAIL: $1" >&2; exit 1; }
pass() { echo "PASS: $1"; }

# Default mode: open issues only. Sample has 1 OPEN issue.
out="$("$RENDER" --pr 2227 --project syngenta-digital_protector-admin-client < "$FIXTURE")"

grep -q "Sonar issues on PR #2227" <<<"$out" || fail "header missing"
pass "header present"

grep -q "Total open: 1" <<<"$out" || fail "open count wrong"
pass "open count correct"

grep -q "MAJOR (1)" <<<"$out" || fail "MAJOR group missing"
pass "MAJOR group present"

grep -q "src/components/addPhenomemonModal/addPhenomenonModal.tsx:229" <<<"$out" || fail "path:line missing"
pass "path and line rendered"

grep -q "prettier/prettier" <<<"$out" || fail "rule key missing"
pass "rule key present"

grep -q "MAINTAINABILITY" <<<"$out" || fail "softwareQuality tag missing"
pass "softwareQuality tag present"

# Closed issues should NOT appear in default mode
if grep -q "characteristic-content.tsx" <<<"$out"; then
  fail "closed issue leaked into default output"
fi
pass "closed issues filtered out"

# --all mode should include closed issues
out_all="$("$RENDER" --pr 2227 --project syngenta-digital_protector-admin-client --all < "$FIXTURE")"
grep -q "characteristic-content.tsx" <<<"$out_all" || fail "--all did not include closed issues"
pass "--all includes closed issues"

grep -q "Total: 6" <<<"$out_all" || fail "--all total wrong"
pass "--all total correct"

# Empty input edge case
empty_json='{"paging":{"total":0},"issues":[],"components":[]}'
out_empty="$("$RENDER" --pr 2227 --project foo <<<"$empty_json")"
grep -q "No open Sonar issues" <<<"$out_empty" || fail "empty case message missing"
pass "empty case handled"

echo
echo "All renderer tests passed."
