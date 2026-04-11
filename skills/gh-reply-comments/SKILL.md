---
name: gh-reply-comments
description: Reply to GitHub PR review threads after addressing feedback, or post pending review comments when reviewing. Auto-detects mode from PR authorship. Use when the user says "reply to comments", "respond to review", "address review comments", or invokes /gh-reply-comments.
---

# gh-reply-comments

Reply to PR review threads with the correct `gh api` calls. Two modes based on PR authorship.

| Mode | When | Behavior |
|---|---|---|
| Reply | You authored the PR | Immediate replies, no thread resolution |
| Review | You're reviewing | Pending batch, submit with verdict |

## Pre-flight

Run in parallel:

```bash
gh auth status
gh pr view --json number,url,headRefOid,headRepositoryOwner,headRepository,author \
  --jq '{number,url,sha: .headRefOid, owner: .headRepositoryOwner.login, repo: .headRepository.name, author: .author.login}'
gh api user --jq '.login'
```

### Hard blocks (refuse to proceed)

- `gh auth status` fails
- No open PR for current branch

### Mode detection

Compare PR `.author.login` against `gh api user` `.login`.
- Same: **Reply mode**
- Different: **Review mode**

## Fetch Unresolved Threads

REST does not expose thread resolution status. Use this GraphQL query:

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            path
            line
            comments(first: 100) {
              nodes { id databaseId body author { login } }
            }
          }
        }
      }
    }
  }
' -F owner='{owner}' -F repo='{repo}' -F number={number}
```

Filter to `isResolved: false` only. If zero unresolved threads, inform user and exit.


## Auto-detection (Reply mode only)

Skip this section entirely in Review mode.

Gather recent changes:

```bash
git diff HEAD~3..HEAD --name-only
git diff HEAD~3..HEAD
```

For each unresolved thread, check if the thread's `path` and `line` range was touched in the diff. If the file and approximate line range match, pre-mark as "likely addressed" and draft a reply referencing the commit SHA that touched that area.

Use `git log --oneline -10` to find the relevant commit SHAs for draft replies.

## Presentation

List all unresolved threads:

```
[1] path/to/file.ts:42 (likely addressed)
    @reviewer: "Use const instead of let here"
    Draft: "Good catch, switched to const in abc1234."

[2] path/to/file.ts:87
    @reviewer: "This should handle the null case"
    Draft: (no auto-match -- you write it)
```

In Reply mode, "likely addressed" threads have auto-generated drafts. Unmatched threads show no draft.

In Review mode, no auto-detection runs. All threads are listed without drafts.

## User Triage (Reply mode only)

**CRITICAL: Do NOT fix code or make any changes until the user explicitly approves.**

After presenting all threads, ask the user to decide what to do with each one:

> Which threads should I fix? Enter numbers (e.g. 1,3), "all", or "none" to skip fixes and go straight to replies.

Possible outcomes per thread:
- **Fix**: User wants the code changed to address the feedback
- **Reply only**: Feedback is already addressed or user disagrees with it; just reply
- **Skip**: Ignore the thread entirely

Wait for the user's response. Only after explicit approval, fix the selected threads one at a time, showing the proposed change before applying it. After each fix, move to the per-thread reply flow for that thread.

Threads marked "reply only" go directly to the per-thread reply flow with no code changes. Skipped threads are not processed at all.

## Per-thread Flow

Process threads one at a time. For each thread, show:

> **[1] path/to/file.ts:42** -- @reviewer: "Use const instead of let here"
> Draft reply: "Good catch, switched to const in abc1234."
>
> (s)end / (e)dit / s(k)ip / (a)ccept-remaining / (q)uit

Actions:
- **send**: Post immediately (Reply mode) or queue as pending (Review mode)
- **edit**: User provides new text, re-prompt with send/edit/skip
- **skip**: Move to next thread
- **accept-remaining**: Send all remaining threads with their current draft text
- **quit**: Stop processing remaining threads

When `(a)ccept-remaining` is used, only threads with a draft reply are auto-sent.
Threads with no draft are skipped (user never approved text for them).

Reply mode does not resolve threads. The reviewer who left the comment should mark it resolved.

## Reply Tone

Conversational but brief. No em-dashes. Examples:
- "Good catch, fixed in abc1234. Switched to `const` as suggested."
- "Done, extracted to `parseToken()` in def5678."
- "Agreed, updated the null check in abc1234."

## Posting: Reply Mode

### Post a reply

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments \
  -f body="{reply_text}" \
  -F in_reply_to={comment_database_id}
```

`comment_database_id` is the `databaseId` of the **first comment** in the thread (root comment: `reviewThreads.nodes[].comments.nodes[0].databaseId`).

## Posting: Review Mode

### Step 1: Create a pending review

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews \
  --method POST
```

Do NOT include `event` in the payload. Omitting it creates a pending review. `PENDING`
is a review state, not a valid event value. Valid events (`APPROVE`, `REQUEST_CHANGES`,
`COMMENT`) submit the review immediately, which is not what we want.

Store the returned `id` as `review_id`. Create this once before processing any threads.

### Step 2: Queue each reply

For each reply the user approves:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}/comments \
  -f body="{reply_text}" \
  -F in_reply_to={comment_database_id}
```

### Step 3: Submit the review

After all threads are processed (or user quits), prompt:

> Submit review as:
> (a)pprove / (r)equest changes / (c)omment

If approve or request changes, ask:

> Add a review summary? (leave blank to skip)

Submit:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}/events \
  -f event="APPROVE" \
  -f body="{summary_or_empty}"
```

Replace `APPROVE` with `REQUEST_CHANGES` or `COMMENT` based on user choice.

## Error Handling

### Never do

- Fix code or make changes based on review feedback without explicit user approval
- Post a reply without user approval
- Submit a review without explicit verdict selection
- Use `--force` or any destructive git/gh command
- Use em-dashes in generated reply text

### API failures

- Single reply POST fails: show the error, ask retry or skip
- Pending review creation fails: abort, show error
- Review submission fails: inform user the pending review still exists on GitHub, show retry command:
  ```bash
  gh api repos/{owner}/{repo}/pulls/{number}/reviews/{review_id}/events \
    -f event="<VERDICT>" -f body=""
  ```

### Rate limiting

If `gh api` returns 403 or 429: pause and inform user. Do not retry automatically.

### Edge cases

- Thread resolved since fetch: skip, inform user
- PR closed/merged since fetch: hard stop, inform user
- No unresolved threads: inform user, exit gracefully
- User quits mid-flow in Review mode with queued replies: prompt to submit or discard the pending review
- Some replies posted, others fail (Reply mode): report partial success (N posted, M failed), list failed threads with retry info
