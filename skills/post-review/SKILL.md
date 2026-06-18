---
name: post-review
description: >-
  Interactive triage and posting of PR review comments as a pending GitHub review.
  Iterates findings one by one with send/edit/skip actions, posts as pending review
  via gh api. Also accepts a pre-triaged JSON via --from <path> from /review-board,
  or decided findings from the review-harness DB via --from-db, both skipping the
  interactive loop. Use when the user says "post review", "post comments", invokes
  /post-review, or after completing any PR review when there are comments to post.
---

# Post Review

Triage review findings from conversation context and post approved comments as a
pending GitHub review.

## From JSON input

If the user invokes `/post-review --from <path>` (or includes `--from <path>` in the trigger message), skip Parse Context, Noise Threshold, Diff Validation, and Interactive Loop. Use the JSON as the queued comment set directly.

Steps:

1. Validate `<path>` exists and parses as JSON. On failure, abort with the path and the first parse error.
2. Validate required keys: `pr.number`, `pr.owner`, `pr.repo`, `pr.sha`, `comments` (array), `general_comments` (array). On missing keys, abort with the list of missing fields.
3. Run `gh auth status`. If it fails, refuse.
4. Do NOT run `gh pr view`. The JSON already carries the PR identity captured at triage time.
5. Re-prepend the `**[severity]**` tag if any comment body has had it stripped. Severity is inferred from the tag if still present; otherwise keep the body as-is.
6. If both `comments` and `general_comments` are empty, abort with `Nothing to post`. If only `comments` is non-empty, run Post Pending Review Step 1 using `comments` and `pr.sha` for `commit_id`, then skip Step 2. If only `general_comments` is non-empty, skip Step 1 entirely and run Step 2 for each entry. Otherwise run both. When Step 1 ran (inline comments were posted), after it succeeds run Step 1b using `pr.owner`, `pr.repo`, and `pr.number` from the JSON. If Step 1 was skipped (only general comments posted), skip Step 1b.
7. Step 2 is the per-entry general-comment POST for each item in `general_comments`.
8. Run Step 3 Report. The Summary and Verdict sections run unchanged.

The `bundle` key is reserved for future noise-threshold support. Ignore it when null.

The standard invocation (`/post-review` with no `--from`) is unchanged. The three paths (default, `--from`, `--from-db`) share Post Pending Review, Error Handling, and Summary.

## From DB input (--from-db)

If the user invokes `/post-review --from-db` (the review was triaged in the
review-harness app), read the decided findings from the DB instead of the
conversation. Skip Parse Context, Noise Threshold, and the Interactive Loop.

Steps:

1. Run pre-flight (`gh auth status`, `gh pr view` for `number,url,headRefOid,owner,repo`). Refuse if auth fails or there is no open PR.
2. Resolve decided findings:

```bash
python3 ~/.claude/review-harness/db/get_decided.py <<JSON
{"owner": "{owner}", "repo": "{repo}", "pr_number": {number}}
JSON
```

   (`{number}` is the integer PR number.) If `review` is null or `decided` is
   empty, abort with `Nothing decided in the app for this PR. Triage it in the
   review-harness app first.`
3. Map each decided finding: `decision == "inline"` becomes an inline comment
   (`path`, `line`, `side: RIGHT`, `body`); `decision == "general"` becomes a
   general comment (body prefixed with `` `path:line` ``). Re-prepend the
   `**[severity]**` tag if missing.
4. Run Post Pending Review Step 1 (inline) and Step 2 (general) exactly as the
   standard path does, using `headRefOid` for `commit_id`.
5. After Step 1 succeeds, record posted state (best-effort, non-fatal):

```bash
python3 ~/.claude/review-harness/db/mark_posted.py <<JSON
{"review_id": <review.id>, "posted": [{"finding_id": <id1>}, {"finding_id": <id2>}]}
JSON
```

6. Run Step 3 Report, then Summary and Verdict unchanged.

The standard invocation and `--from <path>` are unchanged. `--from-db` shares
Post Pending Review, Error Handling, Summary, and Verdict.

## Pre-flight

Run in parallel:

```bash
gh auth status
gh pr view --json number,url,headRefOid,headRepositoryOwner,headRepository \
  --jq '{number,url,sha: .headRefOid, owner: .headRepositoryOwner.login, repo: .headRepository.name}'
```

Then fetch the changed-file positions. Do NOT load `gh pr diff` whole into
conversation context. We only need the line-range map for diff validation.

### Context-mode (default when available)

When context-mode MCP tools are available, this is the required path. The full
patch bodies stay in the sandbox; only the position map returns to context.

```
ctx_batch_execute(
  commands: [
    "gh api repos/{owner}/{repo}/pulls/{number}/files --paginate --jq '[.[] | {path: .filename, patch: .patch}]'"
  ],
  queries: [
    "for each file, parse the @@ hunk headers and return a JSON map of {path: [[start_line, end_line], ...]} covering only added or modified lines on the RIGHT side; discard patch bodies"
  ]
)
```

Capture the returned map as `DIFF_POSITIONS`.

### Fallback (no context-mode)

```bash
gh api repos/{owner}/{repo}/pulls/{number}/files --paginate \
  --jq '[.[] | {path: .filename, patch: .patch}]'
```

Parse `@@ -<old>,<n> +<new>,<m> @@` hunks per file, build `DIFF_POSITIONS` as
`{path: [[start_line, end_line], ...]}`, then drop the patch bodies before
proceeding.

### Hard blocks (refuse to proceed)

- `gh auth status` fails
- No open PR for current branch

## Parse Context

Scan the conversation for structured findings, walking backward from the most
recent message. Stop at the first match. Do not re-tokenize older runs.

Look for:
- Section 3 table from `staff-review` (preferred)
- Any markdown table or numbered list with severity, file:line, and issue description

Extract only items where `Addressed?` is `No` or not specified.

If the first match is ambiguous (e.g., overlapping tables in the same message),
ask the user which set to use.

If no structured findings are found, prompt:

> No review findings found in our conversation. Either run `/staff-review` first or
> paste a list of issues with format: `severity -- issue description (file:line)`

## Comment Format

Every comment body MUST start with a bold severity tag, then space, then text:

```
**[critical]** Query interpolates user input. Use parameterized queries.
**[major]** Missing null check on user.profile.
**[minor]** Prefer const over let here.
**[nit]** Unused import.
```

Severity vocabulary (lowercase): `critical`, `major`, `minor`, `nit`. Map any other
labels from source findings to nearest match.

When user picks `(e)dit`, preserve the tag. If their rewrite drops it, re-prepend
before queuing.

## Noise Threshold

After Parse Context, count total findings.

If total > 8: prompt user before entering loop.

```
12 findings total (2 critical, 3 major, 4 minor, 3 nit).
Group 7 minor/nit into one PR-level summary comment to reduce noise? (y/n)
```

On `y`:
- minor + nit items skip interactive loop, bundle into single general comment
- critical + major still triaged one-by-one
- Bundle posted via `issues/{number}/comments` after main review (Step 2 path)
- In-diff minor/nit lose inline line context when bundled. Accepted tradeoff for noise reduction.

Bundle body format:

```
**Minor suggestions and nits** (7)

- `src/utils.ts:3` **[nit]** Unused import
- `src/db.ts:42` **[minor]** Prefer const over let
...
```

On `n`: normal flow, every item triaged.

If total <= 8: skip prompt, normal flow.

## Diff Validation

Use `DIFF_POSITIONS` from pre-flight. Validation is lazy: only check files
actually referenced by findings. Do not parse hunks for files no finding
touches.

For each candidate comment, check if its `file:line` falls within
`DIFF_POSITIONS[path]` ranges:
- In diff: valid, proceed normally
- Out of diff: tag with `[OUT-OF-DIFF]`
- Path absent from `DIFF_POSITIONS`: tag with `[OUT-OF-DIFF]`

## Interactive Loop

Present one comment at a time.

### Standard comment

```
[1/8] critical -- SQL injection in query builder
  src/db.ts:88
  Suggested: "**[critical]** This query interpolates user input directly.
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

If noise-threshold bundle is active, the loop only contains critical + major items.
`(a)ccept-remaining` queues those normally. Bundle posts independently after Step 1.

## Post Pending Review

### Step 1: Create pending review with inline comments

Use a single API call to create the review with all queued inline comments:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews \
  --method POST \
  --input comments.json \
  --jq '.id'
```

Capture the returned review id as `REVIEW_ID`. It is required by the Verdict step.

Build the payload as `/tmp/pr-review-comments.json` from the queued comments. Delete the file after the API call completes:

```json
{
  "commit_id": "{sha}",
  "comments": [
    {
      "path": "src/db.ts",
      "line": 88,
      "side": "RIGHT",
      "body": "**[critical]** This query interpolates user input directly. Consider using parameterized queries to prevent injection."
    }
  ]
}
```

- Do NOT include `"event"` in the payload. Omitting it creates a pending review. `PENDING` is a review state, not a valid event value. Valid events (`APPROVE`, `REQUEST_CHANGES`, `COMMENT`) submit the review immediately, which is not what we want.
- `commit_id`: use the `sha` from pre-flight (`headRefOid`). Required for inline comments to land on the correct commit.
- `side`: use `RIGHT` for comments on added/modified lines (the common case).

Always use the JSON file approach. Do not attempt inline array syntax with `-f` flags
as it is fragile and error-prone with nested arrays.

### Step 1b: Record posted findings in review-harness

Best-effort. If it fails, print a one-line warning and continue (the GitHub
review is already posted; DB tracking is secondary).

1. Resolve the review id and finding ids from the DB (where `{number}` is the integer PR number, resolved from the JSON):

```bash
python3 ~/.claude/review-harness/db/get_review.py <<JSON
{"owner": "{owner}", "repo": "{repo}", "pr_number": {number}}
JSON
```

   If `review` is null (staff-review did not persist this PR), skip Step 1b.

2. For each queued inline comment, find the stored finding whose `path` and
   `line` match, collecting its `id`. Then mark them posted:

```bash
python3 ~/.claude/review-harness/db/mark_posted.py <<JSON
{"review_id": <review_id>,
 "posted": [{"finding_id": <id1>}, {"finding_id": <id2>}]}
JSON
```

3. Optionally record the chosen decisions:

```bash
python3 ~/.claude/review-harness/db/set_decisions.py <<JSON
{"decisions": [{"finding_id": <id1>, "decision": "inline"},
               {"finding_id": <id3>, "decision": "skip"}]}
JSON
```

### Step 2: Post general comments

For out-of-diff items the user chose to post as general comments:

```bash
gh api repos/{owner}/{repo}/issues/{number}/comments \
  --method POST \
  -f body="Comment text here"
```

### Step 3: Report

> Posted N inline comments as pending review. M general comments posted separately.
> K minor/nit items bundled in PR-level summary (when noise threshold triggered).

## Summary

Generate a friendly, concise summary for the user to copy when submitting their
review verdict in the GitHub UI.

Tone: helpful teammate, not formal report. One to two sentences max. Point to the
key concern. No bullet lists, no severity counts, no jargon, no em-dashes.

Example:

> Hey! Left a few comments, mostly around security and error handling.
> The main one is the query in db.ts, worth a look. Rest are minor.

Present the summary, then run the Verdict step. Do not post the summary outside
of a user-selected verdict submission.

## Verdict

After presenting the summary, ask the user how to finish via the AskUserQuestion
tool with exactly these options:

1. Post summary and submit review as COMMENT
2. Post summary and submit review as APPROVE
3. Post summary and submit review as REQUEST CHANGES
4. User will deal in GitHub UI (leave review pending, do not post summary)

Map options 1-3 to the GitHub event values `COMMENT`, `APPROVE`, `REQUEST_CHANGES`
and submit the pending review with the summary as body:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews/{REVIEW_ID}/events \
  --method POST \
  -f event=COMMENT \
  -f body="<summary text>"
```

- `REVIEW_ID` comes from Step 1. If Step 1 was skipped (only general comments
  posted, no pending review exists), create and submit in one call instead:
  `gh api repos/{owner}/{repo}/pulls/{number}/reviews --method POST -f event=<EVENT> -f body="<summary text>"`
- On option 4: report the pending review URL and exit. The summary stays
  unposted for the user to copy.
- GitHub rejects `APPROVE` and `REQUEST_CHANGES` on your own PR (HTTP 422).
  On that error, inform the user and fall back to option 4 behavior. Do not
  retry with a different event without asking.

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

- Submit a review verdict without the user explicitly selecting it in the Verdict step.
- Post the summary other than as the body of a user-selected verdict submission.
- Use `--force` or any destructive git/gh command
- Use em-dashes in generated text
- Modify any code or files under review (writing to `~/.claude/review-harness/` for DB tracking is allowed)
