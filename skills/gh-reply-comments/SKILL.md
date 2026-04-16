---
name: gh-reply-comments
description: >-
  Reply to GitHub PR review threads. Handles both author-reply (someone reviewed your PR) and reviewer-follow-up (you reviewed someone and they pushed fixes). Classifies each thread, confirms the plan, then posts replies immediately. Does not create pending reviews. Use when the user says "reply to comments", "respond to review", "check if fixes addressed my review", or invokes /gh-reply-comments. For initial pending reviews, use post-review instead.
---

# gh-reply-comments

Reply to PR review threads with immediate `gh api` calls. Every reply posts right away. This skill never creates a pending review. If the user wants to batch comments on a fresh review, send them to `post-review`.

## Modes (per-thread)

Each unresolved thread is classified independently based on who started it:

| Mode | Thread root author is... | Meaning |
|---|---|---|
| `author-reply` | Someone else | You own the PR, they reviewed you, you reply |
| `reviewer-follow-up` | You (`gh api user`) | You reviewed them, they pushed fixes, you verify and reply |

A single run can mix both modes across threads.

## Pre-flight

Run in parallel:

```bash
gh auth status
gh pr view --json number,url,headRefOid,baseRefOid,headRepositoryOwner,headRepository,author,state \
  --jq '{number,url,headSha: .headRefOid, baseSha: .baseRefOid, owner: .headRepositoryOwner.login, repo: .headRepository.name, author: .author.login, state}'
gh api user --jq '.login'
```

### Hard blocks (refuse to proceed)

- `gh auth status` fails
- No open PR for current branch
- `state` is not `OPEN`

## Fetch Unresolved Threads

REST does not expose thread resolution status. Use GraphQL, and also pull the viewer's latest review timestamp (needed for the diff window in reviewer-follow-up mode):

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    viewer { login }
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviews(last: 50, author: "@me") {
          nodes { submittedAt state }
        }
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            comments(first: 100) {
              nodes {
                id
                databaseId
                body
                createdAt
                author { login }
              }
            }
          }
        }
      }
    }
  }
' -F owner='{owner}' -F repo='{repo}' -F number={number}
```

Filter to `isResolved: false`. If zero unresolved threads, inform user and exit.

Store `viewerLastReviewAt` as the most recent `submittedAt` across the viewer's reviews (null if none). This anchors the reviewer-follow-up diff window.

## Classify Threads

For each unresolved thread:

- `rootAuthor = comments.nodes[0].author.login`
- If `rootAuthor == viewer.login`: mode = `reviewer-follow-up`
- Else: mode = `author-reply`

## Mode Confirmation (mandatory)

**Before any drafts, edits, or posts**, show this summary and wait for confirmation:

```
PR #123  (https://github.com/owner/repo/pull/123)

Unresolved threads: 5
  - author-reply:        2  (you'll respond to reviewer feedback on your PR)
  - reviewer-follow-up:  3  (you'll verify author fixes addressed your review)

Diff windows:
  - author-reply:        HEAD since last push you made
  - reviewer-follow-up:  commits since 2026-04-10T14:22:00Z (your last review)

Proceed? (y/n/details)
```

Actions:
- `y`: continue to auto-detection
- `n`: abort
- `details`: list each thread with path, line, mode, root comment snippet; then re-ask

Do not skip this step even when there is only one thread. If the user enters anything other than `y`, stop and wait.

## Auto-detection

Runs after confirmation. Different diff windows per mode.

### author-reply threads

Diff window: commits you (viewer) pushed since the thread's root comment was created.

```bash
git log --author="$(gh api user --jq '.login')" --since="{thread.comments.nodes[0].createdAt}" --oneline
git diff {rootComment.createdAt-anchored SHA}..HEAD -- {thread.path}
```

If the file and line range match a diff hunk, mark "likely addressed" and draft a reply referencing the SHA.

### reviewer-follow-up threads

Diff window: commits pushed since `viewerLastReviewAt`.

```bash
git fetch origin {headRef} >/dev/null
git log --since="{viewerLastReviewAt}" --oneline origin/{headRef}
git diff {sha-at-viewerLastReviewAt}..origin/{headRef} -- {thread.path}
```

For each thread, inspect whether the flagged line range was touched:
- Line touched and hunk appears to address the concern: draft "Verified, looks good in abc1234."
- Line touched but change seems unrelated: draft "This change doesn't look like it addresses the concern. Can you clarify?"
- Line untouched: draft (empty, flag as "not addressed yet")

Fetching the actual file content at HEAD for the flagged range is helpful for the second case. Keep drafts short and factual, do not overclaim.

## Presentation

List all unresolved threads with mode tag:

```
[1] (author-reply)        path/to/file.ts:42 (likely addressed)
    @reviewer: "Use const instead of let here"
    Draft: "Good catch, switched to const in abc1234."

[2] (reviewer-follow-up)  path/to/file.ts:87 (line touched)
    You wrote: "This should handle the null case"
    Latest author reply: "Done, added check"
    Draft: "Verified, looks good in def5678."

[3] (reviewer-follow-up)  path/to/file.ts:103 (not addressed)
    You wrote: "Extract this to a helper"
    Draft: (empty, no change detected at this range)
```

## User Triage

**CRITICAL: Do NOT fix code until the user explicitly approves.**

Only author-reply threads are candidates for code fixes. Reviewer-follow-up threads are verification only; never edit code in that mode.

Prompt:

> Which author-reply threads should I fix? Enter numbers (e.g. 1,3), "all", or "none" to skip fixes and go straight to replies.

Wait for response. Fix approved threads one at a time, showing proposed change before applying. After each fix, move to per-thread reply flow.

## Per-thread Flow

Process threads one at a time:

> **[1] (author-reply) path/to/file.ts:42** -- @reviewer: "Use const instead of let here"
> Draft reply: "Good catch, switched to const in abc1234."
>
> (s)end / (e)dit / s(k)ip / (a)ccept-remaining / (q)uit

Actions:
- `send`: post immediately
- `edit`: user provides new text, re-prompt
- `skip`: next thread
- `accept-remaining`: send all remaining threads that have a draft
- `quit`: stop

Threads without a draft are never auto-sent.

## Reply Tone

Conversational but brief. No em-dashes. Examples:
- "Good catch, fixed in abc1234. Switched to `const` as suggested."
- "Done, extracted to `parseToken()` in def5678."
- "Verified, looks good in abc1234."
- "This doesn't look addressed yet, the null check is still missing at line 87."

## Posting

Same call for both modes. No pending review, no review_id, immediate.

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments \
  -f body="{reply_text}" \
  -F in_reply_to={comment_database_id}
```

`comment_database_id` is the `databaseId` of the **first comment** in the thread (`reviewThreads.nodes[].comments.nodes[0].databaseId`).

This skill does not resolve threads. Resolution is the thread starter's call.

## Error Handling

### Never do

- Fix code based on review feedback without explicit user approval
- Post a reply without user approval
- Edit code in reviewer-follow-up mode
- Create a pending review (send the user to `post-review` instead)
- Use `--force` or any destructive git/gh command
- Use em-dashes in generated reply text

### API failures

- Reply POST fails: show the error, ask retry or skip
- Classification ambiguous (root comment author is a bot like `coderabbit[bot]`): treat as `author-reply`, flag to user in the mode confirmation summary

### Rate limiting

If `gh api` returns 403 or 429: pause and inform user. Do not retry automatically.

### Edge cases

- Thread resolved since fetch: skip, inform user
- PR closed/merged since fetch: hard stop, inform user
- No unresolved threads: inform user, exit gracefully
- Viewer has never reviewed (no `viewerLastReviewAt`) but has reviewer-follow-up threads: impossible by construction, but if it happens, fall back to `HEAD~10..HEAD` and warn
- Some replies posted, others fail: report partial success (N posted, M failed), list failed threads with retry info
