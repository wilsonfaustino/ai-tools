---
description: Find the commit that introduced a bug, given its fix, and print the GitHub commit URL.
argument-hint: "<ticket|PR#|SHA|branch> [file-scope]"
---

Locate the commit that introduced a bug from its fix, then print the remote
GitHub commit URL. Read-only: never modify code, stage, commit, push, or run
`git bisect`.

GitHub only.

## Constants

Org-specific Jira field for the optional posting step ("Post to Jira" below).
The `customId` is per-org; rediscover it by fetching field metadata
(`getJiraIssueTypeMetaWithFields`) and grepping for `"Bug Introduction Commit"`.

- `JIRA_SITE` = `digitial-product-engineering.atlassian.net` (hostname, used
  directly as `cloudId`; preserved verbatim, including the spelling, since it is
  the real host)
- `BUG_INTRO_FIELD` = `customfield_12040` ("Bug Introduction Commit",
  `textfield`, plain single-line **string**, no ADF envelope)

## Arguments

Parse `$ARGUMENTS` (whitespace-split).

- **1st token (required)** = fix identifier. Auto-detect type by shape:
  - all digits -> PR number
  - 7-40 hex chars -> commit SHA
  - matches `^[A-Z][A-Z0-9]+-\d+$` -> ticket ID
  - else -> branch name
  - shape genuinely ambiguous -> ask which type before proceeding
- **2nd token (optional)** = file-scope path. Narrows blame to that path. In a
  monorepo, always blame within fix-touched files only, never the whole repo.

No identifier -> abort: `Usage: /bic <ticket|PR#|SHA|branch> [file-scope]`.

## Preflight

Minimal. Stop and report if a required check fails; never degrade silently.

- Always: confirm inside a git repo (`git rev-parse --is-inside-work-tree`).
- PR-number path only: `gh auth status`. If it fails, ask the user to run
  `gh auth login` themselves. Ticket/SHA/branch paths skip the `gh` check
  (remote URL comes from `git remote get-url`, not `gh`).

## Flow

### 1. Resolve the fix commit

By identifier type:

```bash
# Ticket
git log --all --grep="<TICKET>" --oneline

# PR
gh pr view <N> --json mergeCommit,files

# Branch
git log --oneline <branch> -5
```

- Single match -> auto-pick, proceed silently.
- More than one match -> list candidates (sha + subject + date) and ask which
  is the fix before any blame work.
- Fix SHA is a merge commit -> walk to the underlying feature commit
  (`git log <merge>^2 --oneline -5`). Never blame against the merge itself.

Capture the fix SHA and the files it touched.

### 2. Extract the buggy lines

```bash
git show <fix-sha> --stat            # files changed
git show <fix-sha> -- <file>         # per-file diff
```

The lines the fix **removed or modified** are the buggy code; note their line
numbers in the parent revision.

**Add-only diff** (the fix removes nothing, only adds a guard / null-check /
branch / case): this is an omission bug. Switch strategy:

```bash
git log -S '<symbol-or-literal>' --oneline -- <file>   # when the path was introduced
git log -G '<regex>' --oneline -- <file>               # if -S too coarse
```

Blame the surrounding context the new code was inserted into. Omission origin
is inherently fuzzier -> cap confidence at **low** (see rubric).

### 3. Blame the buggy lines

```bash
git blame <fix-sha>^ -L <start>,<end> -- <file>
```

`<fix-sha>^` is the state just before the fix; restrict with `-L` to the lines
from step 2. If blame lands on a refactor/move rather than the logic origin,
walk further:

```bash
git log --follow --oneline -- <file>
git blame <older-sha>^ -L <start>,<end> -- <file>
```

Candidates = commits before the fix touching the same symbol/function.

### 4. Validate the candidate (static only)

```bash
git show <candidate> --stat
git show <candidate> -- <file>
```

Confirm the candidate's diff **added** the exact construct the fix corrected
(same symbol, same condition, same file region). The diff must show the buggy
behavior being introduced, not merely the line existing. Never check out,
build, or reproduce; confidence comes from diff evidence alone.

### 5. Elect one source

Always emit exactly **one** elected commit. When multiple candidates survive,
tie-break deterministically, in order:

1. subject references the same ticket/feature as the fix
2. touches the buggy symbol most directly
3. most recent commit before the fix

The genuine multi-cause case (the bug only exists from a combination of
commits, no single one is sufficient) is the sole exception: list the
contributing commits, flagged as a combination. Treat this as a last resort,
not a fallback for "blame was hard."

### 6. Build the URL

```bash
git remote get-url origin
git rev-parse <candidate>          # full 40-char SHA
```

Normalize and append the **full** SHA (never short):

```
git@github.com:owner/repo.git  ->  https://github.com/owner/repo/commit/<full-sha>
https://github.com/owner/repo  ->  https://github.com/owner/repo/commit/<full-sha>
```

## Confidence rubric

Qualitative. Always pair with the one-line reason.

- **high** = fix directly reverts the construct the candidate added, same lines.
- **medium** = same symbol/function, different region, or blame walked through
  one refactor.
- **low** = add-only/omission found via `git log -S`, or multi-hop blame.

## Output

Print this block. Git stays read-only throughout; the only optional side effect
is the Jira post below, and only on an explicit `y`.

```
Bug intro: <short-sha> "<commit subject>"
Confidence: <high|medium|low> - <one-line reason>
URL: https://github.com/<owner>/<repo>/commit/<full-sha>
```

Combination case (last resort):

```
Bug intro: combination of <N> commits
Confidence: <level> - <why no single commit suffices>
- <short-sha> "<subject>" -> https://github.com/<owner>/<repo>/commit/<full-sha>
- <short-sha> "<subject>" -> https://github.com/<owner>/<repo>/commit/<full-sha>
```

## Post to Jira (optional)

After printing the output block, optionally write the URL to the ticket's
`BUG_INTRO_FIELD`. This step never touches git and is entirely skippable.

### Gate

Only offer to post when a **ticket key** is known:

- the fix identifier was itself a ticket key (matched `^[A-Z][A-Z0-9]+-\d+$`), or
- a ticket key surfaced while resolving the fix (e.g. the fix commit subject or
  PR title contains a `^[A-Z][A-Z0-9]+-\d+$` token).

If no ticket key is known (a PR/SHA/branch run with no ticket anywhere), stop
here: print-only, no prompt.

### Pre-flight (posting only)

Load the Atlassian MCP tool schemas (deferred):

```
ToolSearch select:mcp__claude_ai_Atlassian__getJiraIssue,mcp__claude_ai_Atlassian__editJiraIssue
```

If the tools are not present after `ToolSearch`, skip posting gracefully and say
so: `Atlassian MCP not connected; skipping Jira post.` The core command output
above is already complete and unaffected.

### Prompt

Always require an explicit `y`. Single URL:

```
Post URL to <KEY> Bug Introduction Commit field? (y/n)
```

Combination case (field is single-line): the value is every full-SHA URL joined
by a single space. Say so before posting:

```
Field is single-line; will post <N> URLs space-joined.
Post to <KEY> Bug Introduction Commit field? (y/n)
```

Any answer other than `y` -> done, no post.

### Overwrite guard

On `y`, resolve `cloudId` = `JIRA_SITE` (pass the hostname directly). Only if a
call fails with that value, fall back to `getAccessibleAtlassianResources` and
use the first result's `id`.

Read the current value: `getJiraIssue` with `cloudId`, `issueIdOrKey: <KEY>`,
`fields: ["customfield_12040"]`.

- empty/missing -> post (the `y` above suffices, no extra prompt).
- non-empty, **same** value as what we would post -> report
  `Already set on <KEY>.` and stop. No write.
- non-empty, **different** value -> show the existing value and prompt
  `replace / abort`. `abort` exits with no write.

### Post

Always post the **full** 40-char SHA URL(s), never short. Plain string, no ADF:

```
editJiraIssue
  cloudId: <JIRA_SITE or fallback id>
  issueIdOrKey: <KEY>
  fields: {"customfield_12040": "<url>"}     # combination: "<url> <url> ..."
```

On success: `Posted bug-intro URL to <KEY>.`

### On failure

No auto-retry. Print the field key and URL(s) so they can be pasted manually:

```
Jira post failed: <error summary>
Paste into <KEY> field customfield_12040 ("Bug Introduction Commit"):
<url>            # combination: <url> <url> ...
```

## Never do

- Modify code, stage, commit, push.
- Run `git bisect` (out of scope for this command).
- Emit a short SHA in a URL.
- Present multiple URLs except in the genuine combination case.
- Guess past the deterministic tiebreak without lowering confidence.
- Post to Jira without an explicit `y`, or when no ticket key is known.
- Edit any Jira field other than `customfield_12040`.
- Transition the ticket, change its status, or add a comment/worklog.
- Overwrite a non-empty `customfield_12040` without an explicit `replace`.
