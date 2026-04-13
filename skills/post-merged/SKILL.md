---
name: post-merged
description: >-
  Post-merge cleanup after a PR ships. Verifies the branch's PR is merged on
  remote, switches to the default branch, pulls, and prompts for safe local
  branch deletion. Use whenever the user says "PR merged", "merged", "merged
  it", "done", "post-merge cleanup", or invokes /post-merged right after
  shipping a PR, even if they don't explicitly ask for cleanup. Trust `gh pr
  view` state=MERGED as authoritative (handles squash/rebase merges
  correctly). Guardrails - never force-delete, never push/reset/clean,
  aborts on dirty tree.
---

# Post Merged

Post-merge cleanup for the current branch. Terse status-line output only.

## Flow

### 1. Pre-flight

Run in parallel:

```bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
gh auth status
gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'
```

Capture the default branch name from the last command. Use it everywhere below instead of hardcoding `main`.

Hard blocks (abort, report, stop):
- Current branch equals the default branch: `on <default>, nothing to clean`
- Working tree dirty: `dirty tree, aborting`
- `gh auth status` fails: ask user to run `gh auth login` themselves

Why: switching branches with a dirty tree silently carries uncommitted work across; detecting the default avoids breaking repos that use `master`, `develop`, `trunk`, etc.

### 2. Verify PR merged

```bash
gh pr view --json state,number,mergedAt,mergeCommit,headRefName
```

- `state != MERGED`: report `PR #<n> state=<OPEN|CLOSED>, aborting` and stop
- No PR found: report `no PR for <branch>, aborting` and stop

Capture: PR number, merge commit SHA, branch name.

Why: `gh pr view` is the source of truth. Squash and rebase merges don't leave the feature branch's commits in the default branch's history, so local ancestry checks (`git branch --merged`) produce false negatives. Trust the remote state.

### 3. Switch and pull

```bash
git switch <default>
git pull --ff-only
```

If `--ff-only` fails, abort and report. Do not force.

Why: `--ff-only` refuses if the local default has diverged from origin. That usually means the user has local work on the default branch that would be clobbered by a non-ff pull. Stop and let the user resolve it.

### 4. Prompt deletion

Ask the user explicitly:

> Delete local branch `<branch>`? (y/n)

- `y`: run `git branch -d <branch>` (never `-D`)
- If `-d` refuses, report git's message verbatim and stop. Do not escalate to `-D` unless the user insists after seeing the warning.
- `n`: skip

Why: `git branch -d` is the safety net. It refuses to delete branches with unmerged commits that aren't reachable from any upstream, which is exactly the case where you'd lose work. That covers squash/rebase cases too, because the branch is marked as merged via its upstream tracking.

### 5. Report

Terse status lines:

```
PR:     #<number>
merge:  <sha>
branch: <name> (deleted|kept)
gone:   <list of [gone] branches or "none">
```

Detect `[gone]` branches:

```bash
git branch -vv
```

Filter lines containing `: gone]`. List branch names only. Do not delete them automatically; just surface them so the user can clean up separately (see the `clean_gone` skill if installed).

## Never do

- `git push`, `git reset`, `git clean`, `git checkout .`
- `git branch -D` (unless user insists after a `-d` refusal)
- Amend or rewrite history
- Delete remote branches
- Switch branches with a dirty tree
