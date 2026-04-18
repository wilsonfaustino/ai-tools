---
description: Load a handoff slot written by /handoff, resolve references, brief the session, and wait for go-ahead.
argument-hint: [slug]
---

Resume a session previously frozen by `/handoff`. Read the slot, refresh external references, seed TodoWrite from pending items, brief the user with what matters, then wait. Do NOT start executing the next action automatically. The user gives the go-ahead.

Parse `$ARGUMENTS`:
- First positional: `<slug>` (optional). If omitted, list available slots and exit.

## Pre-flight

Abort with a clear message if any fail:

1. Current directory is a git repo (`git rev-parse --git-dir`) OR has a `.claude/` directory. Else abort: "No project context."
2. `.claude/handoff/` exists under the repo root (or cwd if not a git repo). Else abort: "No handoff directory. Run `/handoff <slug>` first."

## List mode (no slug)

If `<slug>` is empty:

1. Resolve `<repo-root>` to an absolute path (`git rev-parse --show-toplevel`, or `pwd` if not a git repo).
2. Enumerate `*.md` under `<repo-root>/.claude/handoff/` using absolute paths. Do NOT `cd`. Use `shopt -s nullglob` so zero matches collapses to an empty array. Reference shape:
   ```bash
   handoff_dir="<repo-root>/.claude/handoff"
   shopt -s nullglob
   files=("$handoff_dir"/*.md)
   [ ${#files[@]} -eq 0 ] && { echo "No handoff slots found."; exit 0; }
   for f in "${files[@]}"; do
     # derive slug, mtime, Intent line from "$f"
     :
   done
   ```
3. For each file, print one line:
   ```
   <slug>  <ISO mtime>  <Intent first line>
   ```
   Sort by mtime descending (most recent first). Truncate the Intent line to 80 chars.
4. Exit 0. Do NOT prompt.

## Load mode (slug given)

Target path: `<repo-root>/.claude/handoff/<slug>.md`.

If the file does not exist, abort: "No slot named `<slug>`. Run `/pickup` with no args to list available slots."

### Step 1: Read and parse

Read the file. Parse frontmatter (`slug`, `created`, `branch`, `cwd`) and body sections.

### Step 2: Environment check

Compare frontmatter `branch` against current `git rev-parse --abbrev-ref HEAD` and frontmatter `cwd` against the current working directory.

- If both match: note "Environment matches handoff."
- If either differs: warn before briefing. Example:
  ```
  Warning: handoff was created on branch `review/proj-1234` in `/path/to/worktree-a`.
  You are currently on branch `main` in `/path/to/worktree-b`.
  Continuing anyway. Run in the original location if references depend on it.
  ```

Do NOT abort on mismatch. Just warn.

### Step 3: Resolve references

For each entry in `# References`, refresh state inline. Cap output per entry to a reasonable summary. Skip silently if a tool is unavailable.

- PR URL (`https://github.com/owner/repo/pull/N`): `gh pr view N --json state,title,reviewDecision,statusCheckRollup,updatedAt,comments`. Summarize state + last update + any new comment count since `created`.
- Plan or markdown file path: check the file exists. If it exists and is under 200 lines, read it. If larger, just confirm existence.
- Branch name: `git log -1 --format='%h %s (%ar)' <branch>` to show last commit on that branch.
- Ticket ID / issue URL: no automatic lookup. Pass through as-is.
- Anything else: pass through as-is.

### Step 4: Seed TodoWrite from Pending

If `# Pending` exists and has checkbox items:

- For each unchecked item (`- [ ] ...`): create a TodoWrite entry with `content` set to the item text, `status: pending`, and an `activeForm` derived from the content (present participle form).
- For each checked item (`- [x] ...`): skip. Do not create completed todos for items already done.
- If the section has no unchecked items, skip.

### Step 5: Brief the user

Print a single compact briefing. Keep it short. Example shape:

```
Picked up: <slug>  (created <ISO>, <branch>)

Intent: <intent text>

Next action: <next action>

References resolved:
  <ref-1>: <short refreshed state>
  <ref-2>: <short refreshed state>

Decisions (N):
  <bullet-1>
  ...

Do not:
  <bullet-1>
  ...

Pending: seeded <M> todos.
```

Omit any section that was empty in the file or resolved to nothing. Do NOT paste the raw file content.

### Step 6: Wait

Ask: "Ready to continue with: `<next action>`? (y/N)"

- `y` or `Y`: proceed to execute the next action.
- Anything else: stop and wait for the user's direction. Do NOT exit, do NOT execute.

## Rules

- Never modify or delete the handoff file on pickup. Leave it for repeated pickup.
- Never auto-execute the next action. Always wait for explicit go-ahead.
- Never paste the raw handoff into the briefing. Summarize.
- Never fail on reference-resolution errors. Warn and continue.
- Never `cd`. Always use absolute paths in Bash commands. `cd` persists across tool calls and corrupts later operations.
