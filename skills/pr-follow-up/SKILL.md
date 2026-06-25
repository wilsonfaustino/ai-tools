---
name: pr-follow-up
description: >-
  Reviewer-side PR follow-up: after the PR author pushes fixes and replies,
  validate whether each thread you started was addressed (or reasonably
  justified), then reply and resolve the good threads in a single batch.
  Use when the user says "validate the fixes", "did they address my review",
  "check if fixes addressed my review", or invokes /pr-follow-up.
---

# pr-follow-up

You reviewed a PR. The author pushed fixes and replied. This skill validates each thread you raised, assigns a verdict, presents a batch summary for a single confirm, then posts replies and resolves the addressed/justified threads.

This skill is reviewer-only. It never edits code. For author-side replies, use `gh-reply-comments`.

## Pre-flight

Run in parallel:

```bash
gh auth status
gh pr view --json number,url,headRefName,headRefOid,headRepositoryOwner,headRepository,author,state \
  --jq '{number, url, headRef: .headRefName, headSha: .headRefOid, owner: .headRepositoryOwner.login, repo: .headRepository.name, author: .author.login, state}'
gh api user --jq '.login'
```

### Hard stops

- `gh auth status` fails
- No open PR for current branch
- `state` is not `OPEN`

## Fetch threads

REST does not expose thread resolution status. Use GraphQL. Also capture the viewer's latest review `submittedAt` to anchor the diff window:

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

Filter to `isResolved: false`. Keep only threads where `comments.nodes[0].author.login == viewer.login` (threads you started). Discard threads started by others.

Store `viewerLastReviewAt` as the most recent `submittedAt` across the viewer's reviews (null if none).

If zero matching threads remain, inform the user and exit.

## Load harness baseline

Before validating, try to load the stored review baseline:

```bash
python3 ~/.claude/review-harness/db/get_review.py <<JSON
{"owner": "{owner}", "repo": "{repo}", "pr_number": {number}}
JSON
```

If `review` is non-null: use `posted_findings` (matched by `path` and `line`) as the authoritative set of comments you posted, and `review.head_sha` as the diff anchor SHA (`anchorSha`).

On any failure: print one-line warning, fall back to the live-PR derivation (`anchorSha` derived from `viewerLastReviewAt`). Never block on DB failures.

## Validate each thread

For each thread, gather three evidence sources in parallel:

1. **Diff** since `anchorSha`:
   ```bash
   git fetch origin {headRef} >/dev/null
   git diff {anchorSha}..origin/{headRef} -- {path}
   ```

2. **Author reply text** -- comments in the thread after your root comment.

3. **File content at HEAD** for the flagged line range (for ambiguous diffs).

Assign one verdict per thread:

| Verdict | Meaning |
|---|---|
| `addressed` | The change fixes the concern raised |
| `justified` | No relevant change, but the author gave a sound reason why no change is needed |
| `not-addressed` | The flagged line is untouched or the change does not fix the concern |
| `unclear` | The range was touched but it cannot be determined whether the concern is resolved |

Draft a short reply for each thread:

- `addressed`: "Verified, looks good in {sha}." (or a brief confirmation tailored to the fix)
- `justified`: Acknowledge the author's reasoning. "Fair point, leaving as-is."
- `not-addressed`: A nudge pointing at the specific unfixed concern. Opt-in, default off.
- `unclear`: A clarifying question. Opt-in, default off.

Keep drafts short and factual. No em-dashes. No overclaiming.

## Batch present + single confirm gate

Show a table of all threads before taking any action:

```
PR #123 -- https://github.com/owner/repo/pull/123

Threads you started (unresolved): 4

  [1] src/auth.ts:42     addressed   Will reply + resolve
      Draft: "Verified, looks good in abc1234."

  [2] src/auth.ts:87     justified   Will reply + resolve
      Draft: "Fair point, leaving as-is given the error is already caught upstream."

  [3] src/util.ts:15     not-addressed  [opt-in nudge, OFF]
      Draft: "The null check is still missing at line 15. Can you take another look?"

  [4] src/util.ts:31     unclear     [opt-in clarifying reply, OFF]
      Draft: "The range was updated but I'm not sure this addresses the concern. Can you clarify?"

Actions before proceeding:
  Toggle nudge on for [3]: type "on 3"
  Toggle clarifying reply on for [4]: type "on 4"

Proceed? (y/n/details)
```

- `y`: execute the plan
- `n`: abort, nothing is posted
- `details`: expand each thread (root comment, author reply, diff hunk) then re-ask
- `on N`: toggle opt-in reply for thread N, then re-display

Do not post anything before `y`. If the user enters anything other than `y`, stop and wait.

## Act (only after `y`)

Process threads in order. For each `addressed` or `justified` thread:

1. Post reply:
   ```bash
   gh api repos/{owner}/{repo}/pulls/{number}/comments \
     -f body="{reply_text}" \
     -F in_reply_to={rootDatabaseId}
   ```
   `rootDatabaseId` is `comments.nodes[0].databaseId`.

2. Resolve the thread via GraphQL:
   ```bash
   gh api graphql -f query='
     mutation($threadId: ID!) {
       resolveReviewThread(input: {threadId: $threadId}) {
         thread { isResolved }
       }
     }
   ' -F threadId='{thread.id}'
   ```

For `not-addressed` or `unclear` threads: post the opt-in nudge/clarifying reply only if the user toggled it on. Always leave these threads open (never resolve them).

On partial failure: report N done, M failed, list failures with retry guidance. Do not hard-stop.

If a thread was resolved or the PR closed/merged between fetch and act: skip that thread and inform the user. If the PR closed/merged, hard-stop all remaining work.

## DB writeback

After acting, persist the addressed state (best-effort, never blocks):

```bash
python3 ~/.claude/review-harness/db/mark_addressed.py <<JSON
{"review_id": <review.id from get_review.py>,
 "addressed": [
   {"finding_id": <id>, "addressed_status": "addressed", "addressed_commit_sha": "<sha>"},
   {"finding_id": <id>, "addressed_status": "open"}
 ]}
JSON
```

Report the returned `review_status` to the user (for example, `Review now: addressed.`). On failure, print one-line warning and continue.

## Guardrails

- Never edit the author's code. This is a reviewer-side validation flow only.
- Never resolve a thread before `y` is confirmed.
- DB calls are always best-effort and never block the flow.
- No em-dashes in any generated reply text.
- No `--force` or destructive git/gh commands.
- On 403/429: pause and inform the user. Do not auto-retry.
- `not-addressed` and `unclear` nudge replies are opt-in, default off. The user must explicitly toggle them on before approving.
