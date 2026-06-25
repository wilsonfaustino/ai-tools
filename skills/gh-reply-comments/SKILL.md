---
name: gh-reply-comments
description: >-
  Reply to GitHub PR review threads as the PR author -- someone reviewed your
  PR and you want to respond (and optionally fix code). Classifies each
  thread, confirms the plan, then posts replies immediately. Does not create
  pending reviews. Use when the user says "reply to comments", "respond to
  review", or invokes /gh-reply-comments. For reviewer-side follow-up after
  the author pushes fixes, use pr-follow-up instead.
---

# gh-reply-comments

Reply to PR review threads as the PR author. Every reply posts right away via `gh api`. This skill never creates a pending review. If the user wants to batch comments on a fresh review, send them to `post-review`.

## Pre-flight

Run in parallel:

```bash
gh auth status
gh pr view --json number,url,headRefOid,baseRefOid,headRepositoryOwner,headRepository,author,state \
  --jq '{number, url, headSha: .headRefOid, baseSha: .baseRefOid, owner: .headRepositoryOwner.login, repo: .headRepository.name, author: .author.login, state}'
gh api user --jq '.login'
```

### Hard blocks (refuse to proceed)

- `gh auth status` fails
- No open PR for current branch
- `state` is not `OPEN`

## Fetch Unresolved Threads

REST does not expose thread resolution status. Use GraphQL:

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    viewer { login }
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
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

## Mode Confirmation (mandatory)

**Before any drafts, edits, or posts**, show this summary and wait for confirmation:

```
PR #123  (https://github.com/owner/repo/pull/123)

Unresolved threads: 3  (you'll respond to reviewer feedback on your PR)

Proceed? (y/n/details)
```

Actions:
- `y`: continue to auto-detection
- `n`: abort
- `details`: list each thread with path, line, root comment snippet; then re-ask

Do not skip this step even when there is only one thread. If the user enters anything other than `y`, stop and wait.

## Auto-detection

Diff window: commits you (viewer) pushed since the thread's root comment was created.

```bash
git log --author="$(gh api user --jq '.login')" --since="{thread.comments.nodes[0].createdAt}" --oneline
git diff {rootComment.createdAt-anchored SHA}..HEAD -- {thread.path}
```

If the file and line range match a diff hunk, mark "likely addressed" and draft a reply referencing the SHA.

## Presentation

List all unresolved threads:

```
[1] path/to/file.ts:42 (likely addressed)
    @reviewer: "Use const instead of let here"
    Draft: "Good catch, switched to const in abc1234."

[2] path/to/file.ts:87 (no matching diff)
    @reviewer: "This should handle the null case"
    Draft: (none)
```

## User Triage

**CRITICAL: Do NOT fix code until the user explicitly approves.**

Prompt:

> Which threads should I fix? Enter numbers (e.g. 1,3), "all", or "none" to skip fixes and go straight to replies.

Wait for response. Fix approved threads one at a time, showing proposed change before applying. After each fix, move to per-thread reply flow.

## Per-thread Flow

Process threads one at a time:

> **[1] path/to/file.ts:42** -- @reviewer: "Use const instead of let here"
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
- "Agreed, updated the null check at line 87."

## Posting

No pending review, no review_id, immediate:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments \
  -f body="{reply_text}" \
  -F in_reply_to={comment_database_id}
```

`comment_database_id` is the `databaseId` of the first comment in the thread (`reviewThreads.nodes[].comments.nodes[0].databaseId`).

This skill does not resolve threads. For reviewer-side resolution after the author fixes things, use `pr-follow-up`.

## Error Handling

### Never do

- Fix code without explicit user approval
- Post a reply without user approval
- Create a pending review (send the user to `post-review` instead)
- Use `--force` or any destructive git/gh command
- Use em-dashes in generated reply text

### API failures

- Reply POST fails: show the error, ask retry or skip
- Root comment author is a bot (e.g., `coderabbit[bot]`): treat as a normal reviewer comment, flag to user in the mode confirmation summary

### Rate limiting

If `gh api` returns 403 or 429: pause and inform user. Do not retry automatically.

### Edge cases

- Thread resolved since fetch: skip, inform user
- PR closed/merged since fetch: hard stop, inform user
- No unresolved threads: inform user, exit gracefully
- Some replies posted, others fail: report partial success (N posted, M failed), list failed threads with retry info
