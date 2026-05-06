---
description: Dump current session state to a named slot under .claude/handoff/ for later /pickup.
argument-hint: <slug> [--force]
---

Freeze the current session as a handoff file so a future session can resume without losing key decisions. Do NOT clear context or exit after writing. The user decides when to `/clear`.

Parse `$ARGUMENTS`:
- First positional: `<slug>` (required). Lowercase alphanumeric and `-` only. No slashes, no spaces.
- Flag: `--force` skips the overwrite confirmation when the slot already exists.

## Pre-flight

Abort with a clear message if any fail:

1. Slug is present and matches `^[a-z0-9][a-z0-9-]*$`. Else abort: "Invalid slug. Use lowercase alphanum and dashes only."
2. Current directory is a git repo (`git rev-parse --git-dir`) OR already has a `.claude/` directory. Else abort: "No project context. Run inside a git repo or a directory with `.claude/`."

## First-run setup

Resolve paths:

- `cwd` = `pwd` (absolute current working directory; this is what gets recorded in frontmatter, even when running inside a worktree).
- If in a git repo: `main-root` = `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`. This resolves to the main working tree even when the command runs inside a linked worktree, because `--git-common-dir` always points at the main `.git` directory.
- If NOT in a git repo: `main-root` = `pwd`.
- `git-common-dir` = `git rev-parse --path-format=absolute --git-common-dir` (only when in a git repo).
- `in-worktree` = true when in a git repo AND `git rev-parse --show-toplevel` differs from `main-root`.

Setup steps:

- Ensure `<main-root>/.claude/handoff/` exists (`mkdir -p`). Handoffs always land in the main repo so the slot survives `/wt-clean`.
- If in a git repo, ensure `.claude/handoff/` is listed in `<git-common-dir>/info/exclude`. Create the file if missing. Append only if the exact line is not already present. Do NOT touch `.gitignore`. Use `--git-common-dir` rather than `<main-root>/.git/info/exclude` so this works inside a linked worktree (where `.git` is a file, not a directory).

## Draft the handoff

Compose the file content from the current session. Do NOT ask the user for input at this step. Fill fields from context only.

Frontmatter (YAML):

```yaml
---
slug: <slug>
created: <ISO-8601 UTC, e.g. 2026-04-18T14:32:00Z>
branch: <git rev-parse --abbrev-ref HEAD, or "none" if not in a git repo>
cwd: <absolute current working directory>
worktree: <absolute path to current worktree, only when in-worktree is true; omit otherwise>
---
```

Body sections, in this exact order. Required sections always appear. Optional sections appear only when they have real content (no "N/A", no placeholders, no padding):

- `# Intent` (required, 1-3 sentences): what this session was doing and why.
- `# Next action` (required, 1 line): the single concrete first step the picked-up session should take.
- `# References` (optional): bullet list of pointers. PR URLs, plan file paths, ticket IDs, branch names, issue URLs. Pointers only, never copied content.
- `# Decisions` (optional): bullet list. Each bullet is a decision plus its reason.
- `# Do not` (optional): bullet list of approaches already tried or ruled out, with a brief why.
- `# Pending` (optional): markdown checkbox list (`- [ ] ...`). These seed TodoWrite entries on `/pickup`.

Rules for drafting:
- Pointers not copies. Link to PRs, plans, tickets. Do not paste review text, diff output, or plan bodies.
- Omit any optional section with no real content. Do not write empty headers.
- Keep total length under 150 lines. If you need more, you are copying instead of pointing.

## Handle existing slot

Target path: `<main-root>/.claude/handoff/<slug>.md`.

If the file exists and `--force` is NOT set:

1. Read the existing file.
2. Print a diff preview: for each section, print `= unchanged`, `~ changed`, `+ new`, or `- removed`. No full diff text, just section-level summary.
3. Prompt: `overwrite? (y/N): `. Read one line. Accept only `y` or `Y`. Any other response: print `aborted, file untouched` and exit 0.

If the file exists and `--force` IS set: skip the prompt.

## Write

Write the composed content to the target path using the Write tool. Do NOT edit in place. Do NOT append.

## Report

Print:

```
Handoff written: <path-relative-to-main-root>
Slug: <slug>
Resume with: /pickup <slug>
```

When `in-worktree` is true, also print a second line under the path: `Source worktree: <cwd>` so the user knows the slot was saved into the main repo from a linked worktree.

## Rules

- Never clear the session, never run `/clear`, never exit.
- Never write outside `<main-root>/.claude/handoff/`. Worktrees always write into the main repo's slot directory.
- Never add `.claude/handoff/` to `.gitignore`. Use the common `info/exclude` (resolved via `git rev-parse --git-common-dir`) only.
- Never paste PR bodies, diffs, plan bodies, or review content into the handoff. Pointers only.
- Never prompt the user for content. Draft from session context.
- Never `cd`. Always use absolute paths in Bash commands. `cd` persists across tool calls and corrupts later operations.
