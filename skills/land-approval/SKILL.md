---
name: land-approval
description: >-
  Final gate before approving a reviewed PR. Validates it is safe to approve
  (not your own PR, no merge conflicts, no unresolved review threads), then
  approves via gh with either a brief friendly summary or no comment. Runs at
  the end of the review flow, after pr-follow-up has validated the author's
  fixes. Use when the user says "approve the PR", "land the approval", "is it
  safe to approve", "approve this", or invokes /land-approval. Not for posting
  review comments (use post-review) or validating fixes (use pr-follow-up).
---

# land-approval

Last step of the review flow. You reviewed the PR, `pr-follow-up` validated the fixes, and now you want to approve. This skill runs a safety gate first, then approves via `gh pr review --approve` with an optional summary.

It only approves. It never edits code, never posts inline comments, never requests changes.

## Pre-flight

Run in parallel:

```bash
gh auth status
gh pr view --json number,url,headRefName,mergeable,author,state \
  --jq '{number,url,headRef:.headRefName,mergeable,author:.author.login,state}'
gh api user --jq '.login'
```

Parse `{owner}` and `{repo}` from `url` (`https://github.com/{owner}/{repo}/pull/{number}`). This is always the base repo, correct even for fork PRs. Do not derive owner/repo from `headRepository*` fields: on a fork PR those point at the fork, where the review threads do not live.

### Hard stops (refuse, do not approve)

- `gh auth status` fails
- No open PR for the current branch
- `state` is not `OPEN`

## Safety gate

Three checks. Own-PR and merge conflicts hard-block. Unresolved threads warn and let the user override.

### Check 1: not your own PR (hard block)

If `author == viewer login`, stop. GitHub rejects `APPROVE` on your own PR (HTTP 422), and self-approval is not meaningful. Report it and exit without approving.

### Check 2: no merge conflicts (hard block)

- `mergeable == "CONFLICTING"`: stop. Tell the user to resolve conflicts or rebase first, then re-run. Do not approve.
- `mergeable == "UNKNOWN"`: GitHub is still computing mergeability. Warn, but do not hard-block on this alone (it is not a confirmed conflict). Note it in the gate summary.
- `mergeable == "MERGEABLE"`: pass.

### Check 3: no unresolved review threads (warn + override)

REST does not expose thread resolution. Use GraphQL:

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes { isResolved path line }
        }
      }
    }
  }
' -F owner='{owner}' -F repo='{repo}' -F number={number}
```

Use the `{owner}`/`{repo}` parsed from `url` in pre-flight.

Count nodes where `isResolved == false`. If any remain, warn with the count and the `path:line` of each, then require explicit confirmation before proceeding. If zero, pass silently.

`reviewThreads(first: 100)` is not paginated. A PR with more than 100 threads truncates; note that to the user rather than treating the count as exhaustive.

## Gate summary + mode choice

Show the gate result before doing anything:

```
PR #123 -- https://github.com/owner/repo/pull/123

Safety gate:
  Own PR            pass  (author bob, you are alice)
  Merge conflicts   pass  (MERGEABLE)
  Unresolved threads  WARN  2 open
      - src/auth.ts:42
      - src/util.ts:15
```

If a hard-block check failed, stop here and report the reason. Do not continue to the mode choice.

If only warnings remain (or all pass), ask how to finish via the AskUserQuestion tool with exactly these options:

1. Approve with a brief friendly summary
2. Approve without comment
3. Cancel

If Check 3 warned, the user selecting option 1 or 2 IS the override. No separate confirm needed.

## Summary drafting (option 1 only)

Draft a short, friendly approval note.

- One to two sentences, teammate tone, not a formal report.
- Point to what stood out if anything (a clean fix, a nice refactor). Otherwise a simple thumbs-up in words.
- NEVER use "LGTM" or equivalent stock acronyms.
- No bullet lists, no severity counts, no em-dashes.

Examples:

> Nice work on this, the error handling in auth.ts reads much cleaner now. Approving.

> Thanks for the quick turnaround on the review notes. This is good to go.

Show the drafted summary to the user before posting. Let them edit it.

## Approve

Only after the user picks option 1 or 2. Option 3: exit without approving.

### Pending review guard

GitHub allows one pending review per user per PR. If you already have a pending review (for example, `post-review` left one via its "deal in GitHub UI" option), `gh pr review --approve` fails with HTTP 422. Check first:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews \
  --jq "[.[] | select(.user.login==\"{viewer}\" and .state==\"PENDING\")][0].id"
```

If it returns an id, do not run `gh pr review`. Submit the existing pending review as the approval instead:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews/{reviewId}/events \
  --method POST -f event=APPROVE -f body="{summary or empty}"
```

If it returns nothing, use the standard path below.

### Standard approve

Write the summary to a temp file first so backticks or quotes in the text cannot break the shell:

```bash
# Option 1 (with summary)
printf '%s' "{summary}" > /tmp/land-approval-body.txt
gh pr review {number} --approve --body-file /tmp/land-approval-body.txt
rm -f /tmp/land-approval-body.txt

# Option 2 (no comment)
gh pr review {number} --approve
```

Report the result with the PR URL. On success: `Approved PR #123.`

## Guardrails

- Only ever submits an `APPROVE`. Never `REQUEST_CHANGES`, never `COMMENT`, never inline comments.
- Never edit any code or files under review.
- Never approve when a hard-block check fails (own PR, confirmed conflict).
- Never post the summary except as the body of the approval.
- Never use "LGTM" or em-dashes in the summary.
- On 403/429: pause and inform the user. Do not auto-retry.
- No `--force` or destructive git/gh commands.
- If the PR closed/merged between pre-flight and approve: stop and inform the user.
