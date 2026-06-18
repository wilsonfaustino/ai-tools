#!/usr/bin/env bash
# Install review-harness scripts to the stable runtime location the skills and
# hook call. Symlinks the db and hooks dirs into ~/.claude/review-harness, and
# reminds the owner to build the app and merge the hook snippet.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")" && pwd)"
target_dir="$HOME/.claude/review-harness"

mkdir -p "$target_dir"
ln -sfn "$repo_root/db" "$target_dir/db"
ln -sfn "$repo_root/hooks" "$target_dir/hooks"
echo "Linked $target_dir/db -> $repo_root/db"
echo "Linked $target_dir/hooks -> $repo_root/hooks"
echo
echo "Next:"
echo "  1. npm install --prefix $repo_root/app"
echo "  2. npm run build --prefix $repo_root/app"
echo "  3. Merge $repo_root/hooks/settings-snippet.json into ~/.claude/settings.json"
