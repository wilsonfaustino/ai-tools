---
description: Remove a review worktree via worktrunk. Infers branch from cwd when run inside one.
argument-hint: [branch] [--force]
---

Remove a worktree previously created by `/wt-review`, using worktrunk (`wt remove`). Do NOT delete the local tracking branch; leave it for the user to clean later.

Parse `$ARGUMENTS`:
- Optional positional: branch name. If omitted, infer from current worktree.
- Flag: `--force` passes through to `wt remove --force`.

## Pre-flight (hard blocks)

1. `wt` is installed: `command -v wt`. Abort if missing: "worktrunk (`wt`) not installed."
2. In a git repo (`git rev-parse --git-dir`).

## Resolve target

If an argument is given: target branch is `$ARGUMENTS` (first positional).

If no argument:
- Detect current worktree: `git rev-parse --git-common-dir` and `git rev-parse --git-dir` differ, AND current path starts with `<repo-root>/.claude/worktrees/`.
- If not inside a `/wt-review` worktree: abort with "No branch specified and not inside a `.claude/worktrees/` worktree."
- Infer branch from path: last segment of the worktree path.

## Scope guard (hard block)

Resolve the worktree path for `<branch>` from `git worktree list --porcelain`.

- If no worktree is checked out on `<branch>`: abort with "No worktree found for branch `<branch>`."
- If the path does not start with `<repo-root>/.claude/worktrees/` (absolute via `git rev-parse --show-toplevel`): abort with "Branch `<branch>` worktree is not under `.claude/worktrees/`; `/wt-clean` only removes review worktrees."

## Exit if inside

If the current session is inside the worktree being removed:
- Call `ExitWorktree` with `action: "keep"` (the session was not created via `EnterWorktree`'s create mode; `remove` is not valid for path-entered worktrees).
- After exiting, continue to removal.

If not inside: skip this step.

## Remove

Run `wt remove <branch> --no-delete-branch`. `--no-delete-branch` keeps the local branch; removal runs in the background and is squash/rebase-merge aware.

If it fails because the worktree is dirty (uncommitted or untracked files):
- If `--force` was passed: rerun as `wt remove <branch> --no-delete-branch --force`.
- Else: abort and print the `wt` error; suggest re-running with `--force`.

If it fails because a project hook needs approval in a non-interactive shell: abort and tell the user to run `wt config approvals add`. Do NOT pass `--yes` on their behalf.

## Report

Print:

```
Removed worktree for `<branch>` (worktrunk).
Local branch `<branch>` preserved. Delete with: git branch -D <branch>
```

## Rules

- Never delete the local tracking branch (always pass `--no-delete-branch`).
- Never run `git branch -D`, `wt remove -D`, or any branch-destructive command.
- Never remove a worktree outside `.claude/worktrees/`.
- Never pass `--yes` to bypass hook approvals; escalate to the user.
