---
name: claude-pr-review-setup
description: Scaffolds a Claude Code /review GitHub Actions workflow into the current repo. Use when the user says "set up Claude PR review", "install PR review workflow", "add /review to this repo", "scaffold PR review", or invokes /claude-pr-review-setup. Supports flags `--upgrade-runtime` (overwrite only the runtime skill) and `--force` (overwrite all three installed files). Always use this skill when the user wants automated PR review via GitHub Actions in a new repo. Do not trigger automatically.
license: CC-BY-4.0
metadata:
  author: Claude Code Skills
  version: 0.1.0
---

# claude-pr-review-setup - Scaffolder

Install a `/review` GitHub Actions workflow + runtime pr-review SKILL.md into the current repo.

## What gets installed

Three files, copied from this skill's `assets/` directory into the target repo:

| Source (within this skill) | Target (cwd) |
|---|---|
| `assets/workflows/claude-pr-review.yml` | `.github/workflows/claude-pr-review.yml` |
| `assets/skill/SKILL.md` | `.claude/skills/pr-review/SKILL.md` |
| `assets/setup/PR_REVIEW_SETUP.md` | `PR_REVIEW_SETUP.md` |

MVP ships 3 subagents (Security, Regression, Performance), `BLOCKING_REVIEW=true`, `model=claude-opus-4-6`. No `/fix`, no Jira.

## Modes

- **Default:** install all three. If any target already exists, report "already installed" and skip. User must re-run with `--upgrade-runtime` or `--force` to overwrite.
- **`--upgrade-runtime`:** overwrite only `.claude/skills/pr-review/SKILL.md` (keeps user customizations in the workflow file). Print a summary of what changed.
- **`--force`:** overwrite all three. Warn loudly first and ask for explicit confirmation.

## Procedure

1. **Locate this skill's install path.** Your own SKILL.md lives at a path like `~/.claude/skills/claude-pr-review-setup/SKILL.md`. The assets you need to copy live at `<skill_root>/assets/*`. Resolve `<skill_root>` from your invocation path.

2. **Pre-flight:**
   - Confirm cwd is a git repo: `git rev-parse --is-inside-work-tree`. If not, stop and tell the user.
   - Check each target path. Build a list of `already_exists`.

3. **Mode selection:**
   - If no mode flag and `already_exists` is non-empty: print the list and tell the user to re-run with `--upgrade-runtime` (runtime skill only) or `--force` (all). Stop.
   - If `--upgrade-runtime`: only touch `.claude/skills/pr-review/SKILL.md`. Show a diff summary before writing.
   - If `--force`: print a warning listing what will be overwritten, ask the user to confirm, then proceed.
   - Default with no conflicts: proceed.

4. **Copy files** using the Read + Write tools (read from `<skill_root>/assets/<...>`, write to `<cwd>/<target>`). Create parent directories as needed.

5. **Print post-install checklist to the user** (mirror the contents of `PR_REVIEW_SETUP.md`). Specifically:
   - Add `ANTHROPIC_API_KEY` secret in repo settings.
   - Defaults: `BLOCKING_REVIEW=true`, `model=claude-opus-4-6`. Confirm or change.
   - Optional: open `.claude/skills/pr-review/SKILL.md`, search `<!-- EXAMPLE:` to wire repo-specific docs into subagents.
   - Commit all three files.
   - Open a test PR, comment `/review`.
   - Delete `PR_REVIEW_SETUP.md` when done.

6. **Never run git commands.** Do not `git add`, `git commit`, or `git push`. The user owns the commit.

7. **Never modify files outside the target repo.** Do not touch files under the skill's own install path during a scaffolder run.

## Behavior rules

- Report each file written with its full path.
- If any copy fails, print the error and stop. Do not partial-install silently.
- After success, the last output line must be: `Scaffold complete. See PR_REVIEW_SETUP.md or re-read the checklist above to finish setup.`

## Deeper reference

See `references/runtime-skill-anatomy.md` for the anatomy of the runtime SKILL.md (subagents, markers, two-pass discipline). You only need that reference if you are maintaining the skill itself, not running it.
