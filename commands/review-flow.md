---
description: Run the full PR review pipeline -- staff-review, triage in the review-harness app, then post as pending review.
argument-hint: "[--no-app] [--no-judge]"
---

Orchestrate the three-stage PR review pipeline end to end:
`/staff-review` -> review-harness app -> `/post-review --from-db`. Each stage
keeps its own human gate; this command just chains them. The review-harness
SQLite DB is the bridge between stages: staff-review persists findings, the app
records decisions, post-review reads them back.

Parse `$ARGUMENTS` (whitespace-split). Recognized flags:

- `--no-app`: skip the browser triage. After staff-review, run `/post-review`
  interactively (linear send/edit/skip loop) instead.
- `--no-judge`: forwarded to `/staff-review`.
- any other token: abort with `Unrecognized argument: <token>`.

## Stage 1 -- Gather (staff-review)

Invoke the `staff-review` skill, forwarding `--no-judge` if present. It is
read-only against the PR: it fans out, judges, prints findings by severity, and
persists them to the review-harness DB (status `triaging`). It posts nothing to
GitHub.

If staff-review aborts (no PR, auth fail, toolkit missing), stop here and
surface its error. Do not continue the pipeline.

If staff-review reports zero actionable findings (every item `Addressed?` =
Yes, or no findings at all), stop and print
`No actionable findings. Nothing to triage.` Exit 0.

## Stage 2 -- Triage

### Default route (review-harness app)

The persisted findings are now triaged in the review-harness app, not in this
conversation. The app serves `http://127.0.0.1:7777` and writes each decision
(inline / general / skip) plus any edited comment body back to the same DB.

- The `ensure-up` PreToolUse hook auto-starts the app when a skill runs. If
  `127.0.0.1:7777` is unreachable, start it manually:
  `fnm exec --using=24 -- node ~/.claude/review-harness/app/server.js`
  (the app is pinned to Node 24 for the `better-sqlite3` ABI).
- Tell the user: open `http://127.0.0.1:7777`, open this PR's review, set a
  decision for each finding, edit bodies as needed, then click `Save triage`.
- Wait for the user to confirm they saved. Then proceed to Stage 3.
- If the user cancels or does not triage: stop. Print
  `Triage not saved. Triage in the app when ready, then run /post-review
  --from-db.` Exit 0. (Findings remain in the DB; nothing is lost.)

### `--no-app` route

Skip the app. Go straight to Stage 3 in interactive mode.

## Stage 3 -- Post (post-review)

- Default route: invoke `post-review` with `--from-db`. It reads the
  decided-but-unposted findings from the DB and posts them as a single PENDING
  review (out-of-diff items as general comments) without an interactive loop.
- `--no-app` route: invoke `post-review` with no `--from-db`. It runs its
  one-at-a-time triage loop, then posts the queued comments as pending.

post-review never submits a verdict.

## Stage 4 -- Handoff

After post-review finishes, remind the user:

> Pending review posted. Comments are not yet visible to others. Open the PR
> and submit your verdict (Approve / Request changes / Comment) in the GitHub
> UI when ready.

## Hard rules

- Never submit a review verdict. The user does this manually in GitHub.
- staff-review is read-only against the PR; the app writes only to the local
  DB; only post-review writes to GitHub, and only as pending.
- If any stage aborts, stop the pipeline and surface the error. Do not paper
  over a failed stage by proceeding to the next.
- Do not reimplement any stage's logic here. Invoke each skill and let it run.
