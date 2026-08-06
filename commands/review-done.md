---
description: Wait for a reviewed PR to merge, then tear down the review worktree and delete the local branch.
argument-hint: [pr-number|url] [--force]
---

Close the review loop opened by `/review-start`. Watch the PR until it merges,
then invoke `/wt-clean` and offer to delete the local branch. Abort instead of
cleaning up if new work lands or CI stops being green -- either means the
review is stale and the user must look again.

Parse `$ARGUMENTS` (whitespace-split):

- First positional: PR number or full GitHub PR URL (optional). If absent,
  resolve the PR from the current branch.
- `--force`: forwarded to `/wt-clean` for a dirty worktree.
- any other token: abort with `Unrecognized argument: <token>`.

## Resolve the PR

- Arg is all digits -> that number.
- Arg is a URL -> trailing number.
- No arg -> `gh pr view --json number --jq .number` from the current branch.
  Abort with `No PR found for the current branch.` if it fails.

Then resolve the branch: `gh pr view <number> --json headRefName --jq .headRefName`.
This is the branch `/wt-clean` and the delete step act on.

Abort if `gh pr view --json isCrossRepository --jq .isCrossRepository` is
`true`: `Fork PR -- no local branch to clean up.`

## Baseline

Snapshot once, before watching:

```
gh pr view <number> --json state,headRefOid,statusCheckRollup
```

- `state` must be `OPEN`. Already `MERGED` -> skip straight to Cleanup.
  `CLOSED` -> abort with `PR #<n> is closed, not merged.`
- Store `headRefOid` as `baselineSha`.
- Store the rollup verdict: green when every entry is `SUCCESS`, `SKIPPED`, or
  `NEUTRAL`. Not green at baseline -> abort with `Checks are not green yet.`
  and print the failing check names. Nothing to wait for otherwise.

## Watch

Use the `Monitor` tool with a 60s interval, re-running the same
`gh pr view --json state,headRefOid,statusCheckRollup` each tick. Evaluate the
tick in this order and stop at the first match:

1. **`state` is `MERGED`** -> proceed to Cleanup. This wins over everything
   else: a PR that merged cleanly never trips the checks below.
2. **`state` is `CLOSED`** -> abort: `PR #<n> was closed without merging.`
3. **`headRefOid` != `baselineSha`** -> classify what landed:
   ```
   gh api repos/{owner}/{repo}/compare/<baselineSha>...<newSha> \
     --jq '.commits[] | select((.parents|length) < 2) | .sha'
   ```
   - Non-empty -> abort: `New commits pushed after your approval -- re-review before cleanup.`
     List the short SHAs and subjects.
   - Empty (merge commits only, e.g. base sync or the Update branch button)
     -> set `baselineSha` to `<newSha>` and keep watching.

   <!-- ponytail: parent-count heuristic. A merge of another feature branch
        also has 2 parents and would be skipped here. Compare merge parents
        against the base ref if that ever bites. -->
4. **rollup left green** -> abort: `Checks are no longer green.` and print the
   failing or pending check names. Do not wait it out; the user decides.

Print a one-line reason on every abort and stop. Never clean up after an abort.

## Cleanup

Only reachable with `state == MERGED`.

1. Invoke `/wt-clean <branch>` (forward `--force` if passed). It removes the
   worktree and deliberately leaves the local branch. If it aborts (no
   worktree under `.claude/worktrees/`, dirty tree), surface its error and
   still continue to step 2 -- the branch delete is independent.
2. Ask the user to confirm deleting the local branch:

   > Delete local branch `<branch>`? It is merged into `<base>` on the remote.

   On confirm, try the safe delete first from the main checkout:
   `git branch -d <branch>`. If it succeeds, done.

   If it fails with `not fully merged`, the merge was a squash or rebase, so
   git cannot see the ancestry. Fall back to `git branch -D <branch>`. The
   `MERGED` state from `gh` is the proof `-d` is missing. Say which one ran.

   Any other `-d` failure (branch checked out somewhere, no such branch) ->
   surface the error and do NOT escalate to `-D`.

   On decline, print the command and leave the branch alone.

If the current session is inside the worktree, `/wt-clean` exits it first;
run the branch delete after that, from the main checkout.

## Report

```
PR #<n> merged. Worktree removed. Branch `<branch>` deleted.
```

Adjust the trailing clauses to what actually happened.

## Hard rules

- Never delete the branch without an explicit confirmation from the user.
- Never delete the branch unless `gh` reports the PR as `MERGED`.
- Never push, force-push, reset, or clean.
- Never clean up after an abort, even a soft one.
