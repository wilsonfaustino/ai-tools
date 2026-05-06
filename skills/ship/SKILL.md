---
name: ship
description: Push current branch and create or update a GitHub PR with an intent-driven description. Use when the user says "ship", "ship it", "create PR", "push and PR", or wants to push their branch and open a pull request. Runs pre-flight safety checks, pushes to remote, and generates PR title/body from branch name and commit history. Detects stacked PRs via gh-stack or base-chain walk and offers to include a Stack section in the body. Supports --draft and --ready flags to skip the draft/ready prompt, and --base to override the target branch.
---

# Ship

Push current branch to remote and create/update a GitHub PR with intent-driven descriptions.

## Flags

| Flag | Effect |
|---|---|
| `--draft` | Create PR as draft, no prompt |
| `--ready` | Create PR as ready, no prompt |
| `--base <branch>` | Override detected base branch |

If neither `--draft` nor `--ready` is passed, ask the user: "Open as draft or ready?"

## Pre-flight Checks

Run these in parallel:

```bash
gh auth status
git rev-parse --abbrev-ref HEAD
git status --porcelain
gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'
```

Resolve base branch: if `--base` flag provided, use that value. Otherwise use the result of `gh repo view`.

Then run (now that base is known):

```bash
git log <base>..HEAD --oneline
```

### Hard blocks (refuse to proceed)

- Branch IS the base branch (e.g., `main`, `master`, `develop`)
- No commits ahead of `<base>`
- Detached HEAD
- `gh auth status` fails

### Soft blocks (ask user)

- **Uncommitted changes**: offer commit, stash, or abort
- **No upstream**: push with `-u` after confirmation
- **PR already merged/closed**: warn and ask

### Never do

- `git push --force` or `--force-with-lease`
- `git reset`, `git clean`, `git checkout .`
- `gh pr close`, `gh pr merge`
- Delete any branch
- Use em-dashes in generated text

## Push

```bash
# First push (no upstream)
git push -u origin <branch>
# Subsequent
git push
```

## Detect Existing PR

```bash
gh pr list --head <branch> --state open --json number,url
```

If a PR exists, proceed to the Update Existing PR section after gathering context.

## PR Title

Derive from branch name:

```
feat/phase-c2-user-migration  ->  feat(phase-c2): user migration
fix/jwt-expiration-edge-case  ->  fix(jwt-expiration): edge case
docs/update-readme            ->  docs(update): readme
chore/cleanup-deps            ->  chore(cleanup): deps
```

Rules:
1. Split on first `/` to get `type` and `slug`
2. Split slug on first hyphen that follows a word boundary after a logical scope: scope is the leading identifier (may contain hyphens if multi-part like `phase-c2`), rest = description (hyphens to spaces). Use the examples above as reference.
3. No `/` prefix: use full branch name as title
4. Cap at 70 characters
5. Single-word result: ask the user

## PR Body

### Gather context

Run in parallel:

```bash
git log <base>..HEAD --pretty=format:"%s%n%b"
git diff <base>...HEAD --stat
gh label list --json name --jq '.[].name'
for f in .github/PULL_REQUEST_TEMPLATE.md .github/pull_request_template.md PULL_REQUEST_TEMPLATE.md .github/PULL_REQUEST_TEMPLATE/default.md; do [ -f "$f" ] && echo "$f" && break; done
gh extension list 2>/dev/null | grep -q gh-stack && gh stack view --json 2>/dev/null || true
```

The label list is used in the Label Validation step below. If the template check finds a file, use it as the body structure and fill each section. The last command probes stack membership (see Stack Detection).

### Default format (no template)

```markdown
## Summary
<2-4 sentences: WHY these changes exist, not WHAT files changed>

## Changes
<bulleted list from commits, grouped by area>

## Notes
<breaking changes, migration steps, env vars -- omit section if empty>
```

**Intent-first principle**: synthesize the PURPOSE from commits and diff.
- Bad: "Updated auth.routes.ts, added migration script, modified user schema"
- Good: "Migrates user data from CloudFlow to GRACE, syncing existing users with their entitlements so ADA can authenticate against the new backend"

## Stack Detection

**Only run on new PR creation. Skip entirely on Update Existing PR flow.**

Detect stacked PR membership in this order. First hit wins:

1. **gh-stack extension**: if `gh stack view --json` returned data in Gather context, parse it for the chain containing the current branch.
2. **Base chain**: if `<base>` is NOT the repo default branch, query open PRs targeting it and check if `<base>` is itself the head of another open PR:

   ```bash
   gh pr list --head <base> --state open --json number,title,headRefName,baseRefName
   ```

   If a match exists, walk the chain upward (repeat with each parent's base) and downward (`gh pr list --base <current-head>`) until both ends terminate.

If neither method yields a chain, skip the Stack section.

### Stack prompt

If a chain of 2+ PRs is detected, prompt:

> Stacked PR detected (N PRs in chain). Append Stack section to PR body? (y/n)

If no, skip. If yes, build the section.

### Stack section format

```markdown
## Stack

This is part of a N-PR stack:

- **#<num> (this PR)** -- <pr title>
- #<num> -- <pr title>
- #<num> -- <pr title>
```

**Placement**: if the PR template already contains a `## Stack` heading, fill it in place. Otherwise append to the very bottom of the body (after all template-rendered sections, after Notes, after everything).

**Ordering**: use the base-chain walk result, ordered from oldest ancestor (closest to default branch) to newest tip. For gh-stack JSON, follow the same root-to-tip order it returns.

**Current PR marker**: bold the current PR's line with `(this PR)`.

**Two-step create+edit** (current PR number does not exist at creation time):

1. Create PR without Stack section.
2. Capture returned PR number.
3. Build Stack section with real number.
4. `gh pr edit <new-number> --body "<body + Stack section>"`.

## Label Mapping

| Branch prefix | Label |
|---|---|
| `feat/` | `enhancement` |
| `fix/` | `bug` |
| `docs/` | `documentation` |
| `refactor/` | `refactor` |
| `chore/` | `chore` |

## Label Validation

After deriving the label from branch prefix, check it against the prefetched label list from the Gather context step.

- **Label exists in repo**: use it in `gh pr create` / `gh pr edit`
- **Label missing**: prompt the user:

> Label `enhancement` doesn't exist in this repo. Create it? (y/n)

If yes:

```bash
gh label create "<label>" --description "" --color "ededed"
```

Then use the label normally. If no, skip the label silently.

## Create PR

Determine draft status:
- `--draft` flag: pass `--draft`
- `--ready` flag: no `--draft`
- No flag: ask "Open as draft or ready?" and use the answer

```bash
# Ready PR
gh pr create --title "<title>" --body "<body>" --base "<base>" --assignee @me --label "<labels>"

# Draft PR
gh pr create --title "<title>" --body "<body>" --base "<base>" --assignee @me --label "<labels>" --draft
```

## Update Existing PR

When an open PR is detected, fetch the current body:

```bash
gh pr view <number> --json body --jq '.body'
```

### Detect new commits

Compare the push result: if `git push` reported "Everything up-to-date", there are no new commits. Otherwise, new commits were pushed.

### If new commits were pushed

Show a body update prompt:

> PR #<number> exists. Body update options:
> 1. **Overwrite** -- regenerate body from all commits
> 2. **Append** -- add a "Latest changes" section with new commit summaries
> 3. **Skip** -- leave body as-is

| Choice | Body action | Title/Labels action |
|---|---|---|
| Overwrite | Full regeneration, same format as new PR | Update if derived values differ |
| Append | Append section below to existing body | Update if derived values differ |
| Skip | No change | Update if derived values differ |

Append format:

```markdown
## Latest changes (YYYY-MM-DD)
- <new commit summaries only>
```

### If no new commits

Skip body prompt. Only update title/labels if derived values differ from current.

### Draft behavior on updates

- Existing draft PR + `/ship` (no flag): do NOT convert to ready. That requires explicit `gh pr ready`.
- Existing non-draft PR + `/ship --draft`: ignore flag. Cannot un-ready via edit.
- `--draft` only applies on creation.

### Edit command

```bash
# Title/labels only
gh pr edit <number> --title "<title>" --add-label "<labels>"

# With body overwrite
gh pr edit <number> --title "<title>" --add-label "<labels>" --body "<body>"

# With body append
gh pr edit <number> --title "<title>" --add-label "<labels>" --body "<existing body + appended section>"
```

## Flow Summary

1. Pre-flight checks in parallel (auth + branch + clean state + base branch detection)
2. Resolve base branch (`--base` flag or detected default)
3. Check commits ahead of `<base>` (hard block if none)
4. Handle soft blocks (single decision point)
5. Push
6. Detect existing PR
7. Gather context in parallel (commits + diff stat + prefetch labels + template check + stack probe)
8. Generate title + body + labels
9. Validate labels, offer creation if missing
10. If existing PR with new commits: prompt overwrite/append/skip
11. If new PR and no `--draft`/`--ready` flag: ask "Open as draft or ready?"
12. Single `gh pr create` (with or without `--draft`) or `gh pr edit`
13. If new PR and stack detected: prompt for Stack section, then `gh pr edit` to append with real PR number

Target: 7-9 tool calls for a clean branch (10-12 with stack detected).
