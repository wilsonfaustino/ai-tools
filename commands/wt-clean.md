---
description: Remove a review worktree. Infers branch from cwd when run inside one.
argument-hint: [branch] [--force]
---

Remove a worktree previously created by `/wt-review`. Do NOT delete the local tracking branch; leave it for the user to clean later.

Parse `$ARGUMENTS`:
- Optional positional: branch name. If omitted, infer from current worktree.
- Flag: `--force` passes through to `git worktree remove --force`.

## Resolve target

If an argument is given: target branch is `$ARGUMENTS` (first positional).

If no argument:
- Detect current worktree: `git rev-parse --git-common-dir` and `git rev-parse --git-dir` differ, AND current path starts with `<repo-root>/.claude/worktrees/`.
- If not inside a `/wt-review` worktree: abort with "No branch specified and not inside a `.claude/worktrees/` worktree."
- Infer branch from path: last segment of the worktree path.

## Pre-flight

- In a git repo (`git rev-parse --git-dir`).
- Worktree path exists: `.claude/worktrees/<branch>` (absolute via `git rev-parse --show-toplevel`). If missing, abort: "No worktree found at `<path>`."

## Exit if inside

If the current session is inside the worktree being removed:
- Call `ExitWorktree` with `action: "keep"` (the session was not created via `EnterWorktree`'s create mode; `remove` is not valid for path-entered worktrees).
- After exiting, continue to `git worktree remove`.

If not inside: skip this step.

## Remove

Run `git worktree remove <path>`. If it fails because of local changes or untracked files:
- If `--force` was passed: rerun with `--force`.
- Else: abort and print the git error; suggest the user review the worktree contents or re-run with `--force`.

## Report

Print:

```
Removed worktree: <path>
Local branch `<branch>` preserved. Delete with: git branch -D <branch>
```

## Rules

- Never delete the local tracking branch.
- Never run `git branch -D` or any branch-destructive command.
- Never remove a worktree outside `.claude/worktrees/`.
