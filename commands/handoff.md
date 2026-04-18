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

Repo root is `git rev-parse --show-toplevel` when in a git repo, otherwise `pwd`.

- Ensure `<repo-root>/.claude/handoff/` exists (`mkdir -p`).
- If in a git repo, ensure `.claude/handoff/` is listed in `<repo-root>/.git/info/exclude`. Create the file if missing. Append only if the exact line is not already present. Do NOT touch `.gitignore`.

## Draft the handoff

Compose the file content from the current session. Do NOT ask the user for input at this step. Fill fields from context only.

Frontmatter (YAML):

```yaml
---
slug: <slug>
created: <ISO-8601 UTC, e.g. 2026-04-18T14:32:00Z>
branch: <git rev-parse --abbrev-ref HEAD, or "none" if not in a git repo>
cwd: <absolute current working directory>
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

Target path: `<repo-root>/.claude/handoff/<slug>.md`.

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
Handoff written: <relative-path-from-repo-root>
Slug: <slug>
Resume with: /pickup <slug>
```

## Rules

- Never clear the session, never run `/clear`, never exit.
- Never write outside `<repo-root>/.claude/handoff/`.
- Never add `.claude/handoff/` to `.gitignore`. Use `.git/info/exclude` only.
- Never paste PR bodies, diffs, plan bodies, or review content into the handoff. Pointers only.
- Never prompt the user for content. Draft from session context.
- Never `cd`. Always use absolute paths in Bash commands. `cd` persists across tool calls and corrupts later operations.
