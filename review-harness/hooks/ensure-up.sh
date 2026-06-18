#!/usr/bin/env bash
# Health-check the review-harness app and start it detached if it is down.
# Wired as a PreToolUse hook for the review skills. Idempotent and silent on
# success; never blocks the triggering tool call.
set -euo pipefail

port="${REVIEW_HARNESS_PORT:-7777}"
app_dir="$(cd "$(dirname "$0")/../app" && pwd)"

if curl -fsS --max-time 1 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
  exit 0
fi

if [ ! -d "${app_dir}/dist" ]; then
  echo "review-harness app not built (run: npm run build --prefix ${app_dir})" >&2
  exit 0
fi

nohup node "${app_dir}/server.js" >"${app_dir}/.server.log" 2>&1 &
disown || true
exit 0
