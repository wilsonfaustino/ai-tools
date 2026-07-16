---
description: Start a PR review end to end -- log the PR to today's daily note, set up an isolated review worktree, then run staff-review.
argument-hint: <pr-number|url> [--no-judge] [--section <name>]
---

Chain the three review-setup steps into one: obsidian-daily-append ->
`/wt-review` -> `staff-review`. This is the *input* side of the review
pipeline; `/review-flow` is the *output* side (triage + post). Do not
reimplement any step here -- invoke each and let it run.

Parse `$ARGUMENTS` (whitespace-split):

- First positional: PR number or full GitHub PR URL (required). Abort with
  `Missing PR number or URL.` if absent.
- `--no-judge`: forwarded to `staff-review`.
- `--section <name>`: forwarded to obsidian-daily-append as `--<name>`.
- any other token: abort with `Unrecognized argument: <token>`.

## Resolve the PR

Need both the number (for `/wt-review`) and the URL (for daily-append):

- Arg is all digits -> number. Fetch URL:
  `gh pr view <number> --json url --jq .url`.
- Arg is a URL -> extract the trailing number; use the URL as-is.

If `gh` fails, abort and surface its error.

## Stage 1 -- Log to daily note (best-effort)

Invoke the `obsidian-daily-append` skill with the PR URL (and the resolved
`--<section>` flag if `--section` was passed). Let the skill own section
routing and any confirmation it needs.

This stage is non-blocking: if it fails (missing daily note, gh error),
print the skill's error as a one-line warning and continue to Stage 2. The
review is the point; logging is secondary.

## Stage 2 -- Worktree (wt-review)

Invoke `/wt-review <number>`. Run its full pre-flight + setup (worktree
create/reuse, copy local config, `EnterWorktree`).

Override its final Handoff section: do NOT stop to ask "What should I focus
on" and do NOT wait for direction. Continue straight to Stage 3.

If `/wt-review` aborts (fork PR, dirty worktree, branch missing, auth fail),
stop the pipeline and surface its error.

## Stage 3 -- Review (staff-review)

Now inside the worktree on the PR branch, so `gh pr view` resolves the right
PR automatically. Invoke the `staff-review` skill, forwarding `--no-judge`
if present.

Auto-confirm its `Proceed? [y/n]` gate (treat as `y`) -- this command is the
confirmation. staff-review fans out, judges, prints findings by severity, and
persists them to the review-harness DB. It is read-only against the PR.

## Handoff

After staff-review prints findings, remind the user:

> Findings persisted to the review-harness DB. To triage and post them, open
> the app or run `/post-review --from-db`. Cleanup the worktree with
> `/wt-clean` when done.

## Hard rules

- Never push, reset, force-push, or modify the main checkout.
- staff-review is read-only against the PR; this command posts nothing.
- If Stage 2 or 3 aborts, stop and surface the error. Stage 1 is best-effort.
