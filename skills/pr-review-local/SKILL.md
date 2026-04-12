---
name: pr-review-local
description: Run the 3-subagent PR review (Security, Regression, Performance) against your current branch diff vs the resolved base branch, locally, before pushing. Use when the user says "review my branch", "local PR review", "review before push", "pre-ship review", or invokes /pr-review-local. Does not post to any PR. Output is stdout markdown only.
license: CC-BY-4.0
metadata:
  author: Claude Code Skills
  version: 0.1.0
---

# pr-review-local - Local Branch Review

Runs the 3-subagent PR review against the current branch diff vs the resolved base branch locally. Outputs a markdown summary to stdout. No PR, no GH Actions, no comment posting.

## Step 1: Initialize

Follow each sub-step in order. Abort with the stated message on any failure; do not continue.

### 1.1 Verify cwd is a git repo

Run: `git rev-parse --is-inside-work-tree`
If non-zero exit: abort with `not a git repo (cwd: $(pwd))`.

### 1.2 Resolve base branch (ladder)

Try each in order; stop at the first that exists as a ref:

1. `git rev-parse --verify origin/main`
2. `git rev-parse --verify origin/master`
3. `git rev-parse --verify origin/develop`
4. `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` and then `git rev-parse --verify origin/$DEFAULT_BRANCH`
5. User-provided arg (not supported in MVP; accept as future hint only)

If none resolve, abort with `no base branch detected (tried origin/main, origin/master, origin/develop, gh repo view); ensure the repo has an origin remote with one of these branches`.

Record `RESOLVED_BASE` (e.g. `origin/main`) and `BASE_SHA=$(git rev-parse $RESOLVED_BASE)` and `BASE_DATE=$(git log -1 --format=%cI $RESOLVED_BASE)`.

### 1.3 Compute merge base

Run: `MERGE_BASE=$(git merge-base HEAD $RESOLVED_BASE)`.

### 1.4 HEAD-equals-base check

If `$(git rev-parse HEAD)` equals `$MERGE_BASE`: abort with `nothing to review vs $RESOLVED_BASE; make a commit first`.

### 1.5 Compute excluded diff and file list

Exclude pathspecs (hardcoded):
```
':(exclude)package-lock.json'
':(exclude)yarn.lock'
':(exclude)pnpm-lock.yaml'
':(exclude)poetry.lock'
':(exclude)Gemfile.lock'
':(exclude)Cargo.lock'
':(exclude)go.sum'
':(exclude)*.min.js'
':(exclude)*.min.css'
':(exclude)node_modules/**'
':(exclude)vendor/**'
':(exclude)dist/**'
':(exclude)build/**'
':(exclude).next/**'
```

Run:
- `CHANGED_FILES=$(git diff --name-only $MERGE_BASE..HEAD -- . <excludes>)`
- `DIFF=$(git diff $MERGE_BASE..HEAD -- . <excludes>)`
- `TOTAL_FILES_PRE=$(git diff --name-only $MERGE_BASE..HEAD | wc -l | tr -d ' ')`
- `TOTAL_FILES_POST=$(echo "$CHANGED_FILES" | grep -c .)`
- `EXCLUDED_COUNT=$((TOTAL_FILES_PRE - TOTAL_FILES_POST))`

If `$CHANGED_FILES` is empty after exclusions: abort with `nothing to review vs $RESOLVED_BASE after exclusions; only ignored files changed (lockfiles, generated, etc)`.

### 1.6 Size gate

- `DIFF_LINES=$(echo "$DIFF" | wc -l | tr -d ' ')`
- `DIFF_FILES=$TOTAL_FILES_POST`

If `DIFF_LINES > 3000` OR `DIFF_FILES > 40`: abort with `diff too large for reliable review ($DIFF_LINES lines, $DIFF_FILES files; limits 3000 / 40); consider splitting the branch`.

### 1.7 Pre-annotate the diff

Transform `$DIFF` by walking each hunk and prefixing every `+` line (excluding `+++` file headers) with `[L<n>]` where `<n>` is the absolute line number of that added line in the post-image of the file.

Algorithm:
- Parse `@@ -a,b +c,d @@` headers; extract `c` as the starting new-file line number for the hunk.
- Initialize a counter `line = c`.
- For each line in the hunk:
  - If it starts with `+` (and not `+++`): replace `+` with `+[L<line>] ` (preserving the rest). Increment `line`.
  - If it starts with ` ` (context): increment `line`.
  - If it starts with `-`: do not increment.

Record the annotated diff as `$ANNOTATED_DIFF`. Verify it is non-empty. Subagents receive `$ANNOTATED_DIFF`, not `$DIFF`.
