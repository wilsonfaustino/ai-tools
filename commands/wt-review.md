---
description: Create/reuse an isolated worktree for reviewing a PR, enter it, then wait for review direction.
argument-hint: <pr-number|branch> [--install] [--fresh]
---

Set up an isolated worktree for reviewing a PR. Do NOT start the review automatically. After setup, wait for the user to run `/staff-review` or give other direction.

Parse `$ARGUMENTS`:
- First positional: PR number or branch name (required).
- Flags: `--install` (run dependency install), `--fresh` (force recreate if worktree exists).

## Pre-flight (hard blocks, all must pass)

Run in parallel. Abort with a clear message if any fail:

1. `gh auth status` succeeds.
2. Current directory is a git repo (`git rev-parse --git-dir`).
3. Not already in a worktree. Detect with `git rev-parse --git-common-dir` vs `git rev-parse --git-dir` — if they differ, abort: "Already inside a worktree. Exit it first."
4. `origin` remote exists (`git remote get-url origin`).

## Resolve branch

- If argument is all digits: `gh pr view <n> --json number,headRefName,title,body,author,headRepositoryOwner,headRepository`. If `headRepositoryOwner.login` differs from the base repo owner, abort: "Fork PRs are out of scope for `/wt-review`. Use `gh pr checkout <n>` manually." Otherwise capture `headRefName` as `<branch>`.
- Else: treat argument as `<branch>`. Run `gh pr list --head <branch> --state open --json number,title,body,author` to fetch PR context. If no PR found, continue anyway (reviewing a branch without an open PR is valid).

Verify the branch exists on origin: `git ls-remote --exit-code --heads origin <branch>`. Abort if missing: "Branch `<branch>` does not exist on origin."

## Fetch

`git fetch origin <branch>`

## Create or reuse worktree

Path: `.claude/worktrees/<branch>` (relative to repo root; use `git rev-parse --show-toplevel` to anchor).

If path exists:
- `--fresh` passed: `git worktree remove --force <path>` then proceed to create.
- Else:
  - Check clean: `git -C <path> status --porcelain` must be empty.
  - Check not diverged: `git -C <path> rev-list --count HEAD..origin/<branch>` returns a number (ff-able), and `git -C <path> rev-list --count origin/<branch>..HEAD` returns 0.
  - If both OK: `git -C <path> merge --ff-only origin/<branch>`.
  - If any check fails: abort with the specific reason and suggest `/wt-clean <branch>` or `--fresh`.

If path does not exist: `git worktree add <path> origin/<branch>`.

## Copy local config

Copy gitignored personal config from the main checkout into the worktree. Source is the repo root (pre-flight guarantees the command runs outside any worktree). For each path below, if it exists at source, copy to the same relative path in the worktree, creating parent directories as needed. Skip silently if missing. Do not overwrite existing files in the worktree.

- `CLAUDE.local.md`
- `.claude/settings.local.json`

## Optional install

Only if `--install` is present. Run inside the worktree. Detect and run one of:

- `bun.lock` → `bun install`
- `pnpm-lock.yaml` → `pnpm install`
- `yarn.lock` → `yarn install`
- `package-lock.json` or bare `package.json` → `npm install`
- `Cargo.toml` → `cargo build`
- `requirements.txt` → `pip install -r requirements.txt`
- `go.mod` → `go mod download`
- None matched: print "No install target detected, skipping."

## Enter worktree

Call `EnterWorktree` with `path` set to the absolute path of the worktree.

## Report

Print:

```
Worktree ready: <absolute-path>
Branch: <branch>
PR: #<num> -- <title> (by @<author>)

<body truncated to 20 lines>

Cleanup when done: /wt-clean
```

If no PR was found, omit the PR line.

## Handoff

Ask: "What should I focus on in this review?" Do not invoke `/staff-review` or any review skill automatically. Wait for explicit user direction.

## Rules

- Never push, force-push, reset, or modify files in the main checkout.
- Never delete the worktree or branch in this command.
- Never skip pre-flight checks.
