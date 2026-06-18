---
description: Run the full PR review pipeline -- staff-review, browser triage, then post as pending review.
argument-hint: "[--no-board] [--no-judge]"
---

Orchestrate the three-stage PR review pipeline end to end:
`/staff-review` -> `/review-board` -> `/post-review --from`. Each stage keeps
its own human gate; this command just chains them and carries the JSON path
between board and post.

Parse `$ARGUMENTS` (whitespace-split). Recognized flags:

- `--no-board`: skip the browser triage. After staff-review, run `/post-review`
  interactively (linear send/edit/skip loop) instead.
- `--no-judge`: forwarded to `/staff-review`.
- any other token: abort with `Unrecognized argument: <token>`.

## Stage 1 -- Gather (staff-review)

Invoke the `staff-review` skill, forwarding `--no-judge` if present. It is
read-only: it fans out, judges, and prints findings by severity. It posts
nothing.

If staff-review aborts (no PR, auth fail, toolkit missing), stop here and
surface its error. Do not continue the pipeline.

If staff-review reports zero actionable findings (every item `Addressed?` =
Yes, or no findings at all), stop and print
`No actionable findings. Nothing to triage.` Exit 0.

## Stage 2 -- Triage

### Default route (browser)

Invoke the `review-board` skill with output path `/tmp/review-triage.json`. It
reads the staff-review Section 3 table from this conversation, renders the HTML
page, and waits for the user to submit in the browser.

- Board submits: it writes `/tmp/review-triage.json`. Proceed to Stage 3.
- Board times out or the user cancels: stop. Print
  `Triage not submitted. Re-run /review-board when ready, then /post-review
  --from /tmp/review-triage.json.` Exit 0. (Findings are still in the
  conversation; nothing is lost.)

### `--no-board` route

Skip review-board. Go straight to Stage 3 in interactive mode.

## Stage 3 -- Post (post-review)

- Default route: invoke `post-review` with `--from /tmp/review-triage.json`.
  It posts the queued comments as a single PENDING review (out-of-diff items
  as general comments) without an interactive loop.
- `--no-board` route: invoke `post-review` with no `--from`. It runs its
  one-at-a-time triage loop, then posts the queued comments as pending.

post-review never submits a verdict.

## Stage 4 -- Handoff

After post-review finishes, remind the user:

> Pending review posted. Comments are not yet visible to others. Open the PR
> and submit your verdict (Approve / Request changes / Comment) in the GitHub
> UI when ready.

## Hard rules

- Never submit a review verdict. The user does this manually in GitHub.
- staff-review and review-board are read-only; only post-review writes, and
  only as pending.
- If any stage aborts, stop the pipeline and surface the error. Do not paper
  over a failed stage by proceeding to the next.
- Do not reimplement any stage's logic here. Invoke each skill and let it run.
