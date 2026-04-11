---
name: post-review
description: >-
  Interactive triage and posting of PR review comments as a pending GitHub review.
  Iterates findings one by one with send/edit/skip actions, posts as pending review
  via gh api. Use when the user says "post review", "post comments", invokes
  /post-review, or after completing any PR review when there are comments to post.
---

# Post Review

Triage review findings from conversation context and post approved comments as a
pending GitHub review.

## Pre-flight

Run in parallel:

```bash
gh auth status
gh pr view --json number,url,headRefOid,headRepositoryOwner,headRepository \
  --jq '{number,url,sha: .headRefOid, owner: .headRepositoryOwner.login, repo: .headRepository.name}'
```

Then fetch the PR diff:

```bash
gh pr diff --name-only
gh pr diff
```

### Context-mode optimization

If context-mode MCP tools are available, use `ctx_batch_execute` to run the diff
commands in the sandbox:

```
ctx_batch_execute(
  commands: [
    "gh pr diff --name-only",
    "gh pr diff"
  ],
  queries: [
    "list all files changed in this PR",
    "for each file, what line ranges are added or modified in the diff"
  ]
)
```

### Hard blocks (refuse to proceed)

- `gh auth status` fails
- No open PR for current branch

## Parse Context

Scan the conversation for structured findings. Look for:
- Section 3 table from `staff-review` (preferred)
- Any markdown table or numbered list with severity, file:line, and issue description

Extract only items where `Addressed?` is `No` or not specified.

If multiple sets of findings exist in context (e.g., staff-review was run more than once), use the most recent set. If ambiguous, ask the user which set to use.

If no structured findings are found, prompt:

> No review findings found in our conversation. Either run `/staff-review` first or
> paste a list of issues with format: `severity -- issue description (file:line)`

## Diff Validation

Build a map of valid comment positions from the PR diff (file path + line numbers
within added/modified hunks).

For each candidate comment, check if its `file:line` falls within the diff map:
- In diff: valid, proceed normally
- Out of diff: tag with `[OUT-OF-DIFF]`

## Interactive Loop

Present one comment at a time.

### Standard comment

```
[1/8] critical -- SQL injection in query builder
  src/db.ts:88
  Suggested: "This query interpolates user input directly.
  Consider using parameterized queries to prevent injection."

  (s)end / (e)dit / s(k)ip / (a)ccept-remaining / (q)uit
```

### Out-of-diff comment

```
[3/8] [OUT-OF-DIFF] nit -- Unused import
  src/utils.ts:3
  This line is outside the PR diff. Cannot post as inline review comment.

  (p)ost as general comment / s(k)ip / (q)uit
```

### Actions

| Key | Action | Effect |
|-----|--------|--------|
| s | send | Queue comment as-is into pending review |
| e | edit | User provides revised text, re-prompt same options |
| k | skip | Discard, move to next |
| a | accept-remaining | Queue all remaining comments without prompts |
| q | quit | Discard remaining, proceed to post queued |
| p | post as general | (out-of-diff only) Queue as top-level PR comment |

When `(a)ccept-remaining` is used, out-of-diff items in the remaining set are skipped
(not auto-posted as general comments). Only in-diff items are auto-queued.

## Post Pending Review

### Step 1: Create pending review with inline comments

Use a single API call to create the review with all queued inline comments:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews \
  --method POST \
  --input comments.json
```

Build the payload as `/tmp/pr-review-comments.json` from the queued comments. Delete the file after the API call completes:

```json
{
  "commit_id": "{sha}",
  "comments": [
    {
      "path": "src/db.ts",
      "line": 88,
      "side": "RIGHT",
      "body": "This query interpolates user input directly. Consider using parameterized queries to prevent injection."
    }
  ]
}
```

- Do NOT include `"event"` in the payload. Omitting it creates a pending review. `PENDING` is a review state, not a valid event value. Valid events (`APPROVE`, `REQUEST_CHANGES`, `COMMENT`) submit the review immediately, which is not what we want.
- `commit_id`: use the `sha` from pre-flight (`headRefOid`). Required for inline comments to land on the correct commit.
- `side`: use `RIGHT` for comments on added/modified lines (the common case).

Always use the JSON file approach. Do not attempt inline array syntax with `-f` flags
as it is fragile and error-prone with nested arrays.

### Step 2: Post general comments

For out-of-diff items the user chose to post as general comments:

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments \
  --method POST \
  -f body="Comment text here"
```

### Step 3: Report

> Posted N inline comments as pending review. M general comments posted separately.

## Summary

Generate a friendly, concise summary for the user to copy when submitting their
review verdict in the GitHub UI.

Tone: helpful teammate, not formal report. One to two sentences max. Point to the
key concern. No bullet lists, no severity counts, no jargon, no em-dashes.

Example:

> Hey! Left a few comments, mostly around security and error handling.
> The main one is the query in db.ts, worth a look. Rest are minor.

Present the summary but do NOT post it.

## Error Handling

### API failures

- Review creation fails: show error, do not retry automatically
- General comment fails: show error, ask retry or skip

### Rate limiting

If `gh api` returns 403 or 429: pause and inform user. Do not retry automatically.

### Edge cases

- PR closed/merged since pre-flight: hard stop, inform user
- Zero candidates after filtering: inform user, exit gracefully
- User quits with zero queued comments: exit without creating a review
- Review posted but general comment fails: report partial success (N inline comments posted, M general comments failed), show retry command for failed comments

## Never do

- Submit a review verdict (approve/request changes). User does this manually.
- Post the summary comment. User copies it.
- Use `--force` or any destructive git/gh command
- Use em-dashes in generated text
- Modify any code or files
