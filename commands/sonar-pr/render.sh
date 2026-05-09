#!/usr/bin/env bash
# commands/sonar-pr/render.sh
# Reads sonar list issues JSON from stdin, prints grouped severity table.
#
# Usage:
#   render.sh --pr <num> --project <key> [--all]
#
# --all: include closed/fixed issues (default: OPEN only)

set -euo pipefail

PR=""
PROJECT=""
ALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr) PR="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --all) ALL=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PR" || -z "$PROJECT" ]]; then
  echo "render.sh: --pr and --project required" >&2
  exit 2
fi

input="$(cat)"

if [[ "$ALL" -eq 1 ]]; then
  filtered_issues="$(jq '.issues' <<<"$input")"
  total_label="Total"
else
  filtered_issues="$(jq '[.issues[] | select(.issueStatus == "OPEN")]' <<<"$input")"
  total_label="Total open"
fi

count="$(jq 'length' <<<"$filtered_issues")"

if [[ "$count" -eq 0 ]]; then
  echo "No open Sonar issues on PR #$PR. Sonar may not have scanned yet, or all issues are resolved."
  exit 0
fi

echo "Sonar issues on PR #$PR (project: $PROJECT)"

counts="$(jq -r '
  [.[] | .severity] as $sevs
  | ["BLOCKER","CRITICAL","MAJOR","MINOR","INFO"]
  | map(. as $s | "\([$sevs[] | select(. == $s)] | length) \($s)")
  | join(", ")
' <<<"$filtered_issues")"

echo "$total_label: $count (legacy: $counts)"
echo

for sev in BLOCKER CRITICAL MAJOR MINOR INFO; do
  bucket="$(jq --arg s "$sev" '[.[] | select(.severity == $s)]' <<<"$filtered_issues")"
  n="$(jq 'length' <<<"$bucket")"
  [[ "$n" -eq 0 ]] && continue

  echo "$sev ($n)"
  jq -r '
    .[] |
    "  " + ((.component | split(":")[1:] | join(":"))) +
    ":" + ((.line // .textRange.startLine // 0) | tostring) + "\n" +
    "    " + (.rule | split(":") | last) +
    "  [" + ((.impacts[0].softwareQuality // "?")) + "]" + "\n" +
    "    " + .message + "\n"
  ' <<<"$bucket"
done

if [[ "$ALL" -eq 1 ]]; then
  closed="$(jq '[.[] | select(.issueStatus != "OPEN")]' <<<"$filtered_issues")"
  cn="$(jq 'length' <<<"$closed")"
  if [[ "$cn" -gt 0 ]]; then
    echo "CLOSED ($cn)"
    jq -r '
      .[] |
      "  " + ((.component | split(":")[1:] | join(":"))) +
      ":" + ((.line // .textRange.startLine // 0) | tostring) +
      "  (" + .issueStatus + ")"
    ' <<<"$closed"
  fi
fi
