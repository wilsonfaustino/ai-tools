#!/usr/bin/env bash
# Install review-harness db scripts to the stable runtime location the skills call.
# Symlinks <repo>/review-harness/db -> ~/.claude/review-harness/db so the scripts
# (and their sibling dbcommon.py / schema.sql) resolve, and the DB lives one level
# up at ~/.claude/review-harness/reviews.db.
set -euo pipefail

repo_db_dir="$(cd "$(dirname "$0")/db" && pwd)"
target_dir="$HOME/.claude/review-harness"

mkdir -p "$target_dir"
ln -sfn "$repo_db_dir" "$target_dir/db"
echo "Linked $target_dir/db -> $repo_db_dir"
