---
description: Merge a curated allow/deny preset of non-destructive commands into .claude/settings.local.json.
argument-hint: [--dry-run]
---

Merge a curated allow/deny preset of non-destructive commands into `.claude/settings.local.json`. Shows a preview, asks to confirm, writes atomically. Never removes existing entries.

Caveat: the deny list is best-effort. Flag-level narrowing in Claude's permission matcher is not fully documented and has known edge cases with quoted args or the `-C` flag. Verify your destructive commands still prompt you after running this.

Parse `$ARGUMENTS`:
- `--dry-run`: show the preview and exit without writing.

## Pre-flight (hard blocks)

Run all checks. Abort with a clear message if any fail:

1. Current directory is a git repo (`git rev-parse --git-dir`) OR has a `.claude/` directory. Else abort: "No project context. Run inside a git repo or a directory with `.claude/`."
2. `jq` is on `PATH` (`command -v jq`). Else abort: "This command requires `jq`."

## Curated preset

The preset lives inline below. Do not fetch from anywhere else.

**Bash allow (read-only, 29 entries):**

```
Bash(git status:*)
Bash(git log:*)
Bash(git diff:*)
Bash(git show:*)
Bash(git blame:*)
Bash(git branch --list:*)
Bash(git branch -v:*)
Bash(git fetch:*)
Bash(git stash list:*)
Bash(git remote -v:*)
Bash(git rev-parse:*)
Bash(git config --get:*)
Bash(gh pr view:*)
Bash(gh pr list:*)
Bash(gh pr diff:*)
Bash(gh pr checks:*)
Bash(gh issue view:*)
Bash(gh issue list:*)
Bash(gh run view:*)
Bash(gh run list:*)
Bash(gh api -X GET:*)
Bash(ls:*)
Bash(pwd:*)
Bash(find:*)
Bash(tree:*)
Bash(file:*)
Bash(stat:*)
Bash(wc:*)
Bash(rg:*)
```

**MCP allow (read-only, explicit names, 23 entries):**

```
mcp__basic-memory__read_note
mcp__basic-memory__search_notes
mcp__basic-memory__list_directory
mcp__basic-memory__list_memory_projects
mcp__basic-memory__list_workspaces
mcp__basic-memory__view_note
mcp__basic-memory__recent_activity
mcp__plugin_context-mode_context-mode__ctx_search
mcp__plugin_context-mode_context-mode__ctx_stats
mcp__plugin_context-mode_context-mode__ctx_doctor
mcp__context7__query-docs
mcp__context7__resolve-library-id
mcp__plugin_context7_context7__query-docs
mcp__plugin_context7_context7__resolve-library-id
mcp__plugin_serena_serena__find_symbol
mcp__plugin_serena_serena__find_file
mcp__plugin_serena_serena__find_referencing_symbols
mcp__plugin_serena_serena__list_dir
mcp__plugin_serena_serena__list_memories
mcp__plugin_serena_serena__read_file
mcp__plugin_serena_serena__read_memory
mcp__plugin_serena_serena__search_for_pattern
mcp__plugin_serena_serena__get_symbols_overview
```

**Bash deny (destructive, 8 entries):**

```
Bash(git push --force:*)
Bash(git push -f:*)
Bash(git reset --hard:*)
Bash(git clean -f:*)
Bash(git clean -fd:*)
Bash(rm -rf:*)
Bash(sudo:*)
Bash(chmod 777:*)
```

## Execution

### Step 4.1: Read and normalize

```bash
settings_path=".claude/settings.local.json"
mkdir -p .claude
if [ ! -f "$settings_path" ]; then
  echo '{"permissions":{"allow":[],"deny":[]}}' > "$settings_path"
fi
if ! jq empty "$settings_path" 2>/dev/null; then
  echo "error: $settings_path is not valid JSON. Aborting, file untouched."
  exit 1
fi
# ensure permissions.allow and permissions.deny exist as arrays
jq '.permissions = (.permissions // {}) | .permissions.allow = (.permissions.allow // []) | .permissions.deny = (.permissions.deny // [])' "$settings_path" > "$settings_path.tmp" && mv "$settings_path.tmp" "$settings_path"
```

### Step 4.2: Diff

Subsumption rule for Bash entries: a user entry `Bash(X:*)` subsumes a curated entry `Bash(Y...)` iff the inner body of Y (between parens, stripped of any trailing `:*`) either equals X's inner body, OR starts with X's inner body followed by a space. The same rule detects allow-vs-deny conflicts.

MCP entries use exact-match only. No subsumption logic applies to MCP.

Reference helper:

```bash
# returns 0 if user_entry subsumes curated_entry, else 1
subsumes() {
  local user="$1" curated="$2"
  case "$user" in Bash\(*\)) ;; *) return 1 ;; esac
  case "$curated" in Bash\(*\)) ;; *) return 1 ;; esac
  case "$user" in *:\*\)) ;; *) return 1 ;; esac
  local user_inner="${user#Bash(}"; user_inner="${user_inner%:\*)}"
  local curated_inner="${curated#Bash(}"
  curated_inner="${curated_inner%:\*)}"
  curated_inner="${curated_inner%)}"
  [ "$curated_inner" = "$user_inner" ] && return 0
  case "$curated_inner" in
    "$user_inner "*) return 0 ;;
  esac
  return 1
}
```

Build four buckets plus a counter:

- `add_allow`: curated allow entries not present verbatim in the existing allow list and not subsumed by any existing user allow entry.
- `add_deny`: curated deny entries not present verbatim in the existing deny list and not contradicted by any existing user allow entry (test with `subsumes allow_entry curated_deny_entry`).
- `redundant`: curated entries already subsumed by an existing user entry. Record which user entry subsumes each.
- `conflict`: curated deny entries contradicted by an existing user allow entry. Record which allow entry contradicts.
- `unchanged`: count of curated entries that match existing entries verbatim.

### Step 4.3: Preview

Print sections in this exact order, omitting any that are empty:

```
+ add (allow):
    Bash(git status:*)
    ...
+ add (deny):
    Bash(rm -rf:*)
    ...
~ redundant (already covered by existing rules):
    Bash(git status:*)  <-  Bash(git:*)
    ...
! conflict (curated deny contradicted by existing allow, not added, resolve manually):
    Bash(git push --force:*)  <->  Bash(git push:*)
    ...
= unchanged: N
```

Use the arrow glyphs `<-` and `<->` as shown (ASCII). Close with a summary line:

```
summary: +<total_additions> additions, ~<redundant> redundant, !<conflicts> conflicts.
```

### Step 4.4: Confirm and write

If `--dry-run` is set: print `(dry-run, no changes)` and exit 0.

Otherwise prompt `apply? (y/N): ` and read a single line. If the response is anything other than `y` or `Y`: print `aborted, file untouched` and exit 0.

On `y` or `Y`, write atomically:

```bash
tmp=$(mktemp "${settings_path}.XXXX")
jq --argjson add_allow "$add_allow_json" --argjson add_deny "$add_deny_json" '
  .permissions.allow = ((.permissions.allow // []) + $add_allow)
  | .permissions.deny = ((.permissions.deny // []) + $add_deny)
' "$settings_path" > "$tmp" && mv "$tmp" "$settings_path"
echo "wrote $settings_path"
```

`jq`'s `+` on arrays appends, so existing order is preserved and new entries land at the end.

## Rules

- Never remove or reorder existing entries.
- Never write if the file is invalid JSON.
- Never write in `--dry-run` mode.
- Always show the preview before prompting.
- Always write atomically via a temp file plus `mv`.
