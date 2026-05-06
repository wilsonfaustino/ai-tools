---
name: staff-review
description: >-
  Staff-engineer-level PR review that fans out to pr-review-toolkit and
  pr-review-local in parallel, audits automated and human reviewer comments,
  runs a judge layer to filter false positives, and presents structured
  findings by severity. Use when the user says "staff review", invokes
  /staff-review, or wants a thorough review that also validates existing
  reviewer comments. Pass --no-judge to skip the judge layer. Do not use for
  simple code reviews or when the user explicitly asks for pr-review-toolkit
  directly.
---

# Staff Review

**READ-ONLY OPERATION. Do NOT post, submit, or publish any comments to the PR
under any circumstances. All findings must be presented to the user in chat
only. Stop and wait for explicit user instruction before taking any action on
the PR.**

## Flag Parsing

Before doing anything else, check the invocation for `--no-judge`.

- If `--no-judge` is present: set `JUDGE_ENABLED=false`
- Otherwise: set `JUDGE_ENABLED=true`

Announce: `Mode: staff-review (judge: <enabled|disabled>). Proceed? [y/n]`

Wait for confirmation before continuing.

## Pre-flight

Run all four checks in parallel:

```bash
gh auth status
gh pr view --json number,url,author,baseRefName \
  --jq '{number, url, author: .author.login, base: .baseRefName}'
# Check toolkit installed
ls ~/.claude/plugins/*/pr-review-toolkit/commands/review-pr.md 2>/dev/null \
  || ls ~/.claude/skills/pr-review-toolkit/commands/review-pr.md 2>/dev/null
# Check pr-review-local installed
ls ~/.claude/skills/pr-review-local/SKILL.md 2>/dev/null
```

### Diff size gate

After pre-flight, measure diff size to decide fan-out scope:

```bash
gh pr diff --name-only | wc -l   # FILES_CHANGED
gh pr diff | wc -l               # DIFF_LINES
gh pr diff --name-only           # CHANGED_FILES
```

Apply tiers:

- **Doc/config-only**: every entry in `CHANGED_FILES` matches `*.md`, `*.mdx`,
  `*.txt`, `*.yml`, `*.yaml`, `*.json`, `*.toml`. Set `LIGHT_MODE=true`,
  `LOCAL_ENABLED=false`. Toolkit task runs with a reduced agent allowlist
  (code-reviewer only). Note `NOTE: Doc/config-only diff; light review.` in
  output header.
- **Large diff**: `DIFF_LINES > 2000` or `FILES_CHANGED > 30`. Set
  `LOCAL_ENABLED=false` regardless of install state. Note
  `NOTE: Large diff (<DIFF_LINES> lines / <FILES_CHANGED> files); local
  subagents skipped to control cost.` in output header.
- **Default**: proceed with full fan-out.

### Hard blocks (refuse to proceed)

- `gh auth status` fails
- No open PR for the current branch
- `pr-review-toolkit` is not installed (core dependency; the skill cannot
  function without it)

### Soft warnings

- `pr-review-local` is not installed: set `LOCAL_ENABLED=false` and note
  `NOTE: pr-review-local not installed; local subagents skipped.` in output
  header. Continue.
- Otherwise: set `LOCAL_ENABLED=true`

## Parallel Fan-out

Send **one message** with **three Task tool calls** launched simultaneously.

### Task 1: pr-review-toolkit

Use the Skill tool with `skill: 'pr-review-toolkit:review-pr'` and include
this context in the task:

> IMPORTANT: Do NOT post, submit, or publish any comments to the PR. This
> review is read-only. All findings must be presented in chat only. Do not
> call any API or tool that writes to the PR.
>
> IMPORTANT: This review targets the PR diff, not the uncommitted working
> tree. Run `gh pr checkout <PR_NUMBER>` first if the current branch does not
> already match the PR branch, so that `git diff` reflects the PR changes
> against the base. If `gh pr checkout` fails or the branch is already
> checked out, fall back to `git diff origin/<BASE_BRANCH>...HEAD`.
>
> Act as a staff engineer reviewing this PR. For each finding:
> - Categorize by severity: critical, warning, nit, suggestion
> - Point to the exact file and line
> - Suggest a friendly, constructive fix (no em-dashes, concise)
>
> Limit yourself to these agents:
> `code-reviewer`, `silent-failure-hunter`, `pr-test-analyzer`. Do not invoke
> `comment-analyzer`, `type-design-analyzer`, or `code-simplifier`. If
> `LIGHT_MODE=true`, run only `code-reviewer`.
>
> Return structured markdown with severity sections: ## Critical, ## Warning,
> ## Nit, ## Suggestion. Each finding must include the source agent name in
> brackets (e.g., [code-reviewer], [silent-failure-hunter]).

Capture all output as `TOOLKIT_OUTPUT`.

If this task fails or times out, abort the entire skill run and show the
error. (Toolkit is a hard dependency.)

### Task 2: pr-review-local (conditional)

Only launch if `LOCAL_ENABLED=true`.

Use the Skill tool with `skill: 'pr-review-local'`.

Capture output as `LOCAL_OUTPUT`.

If pr-review-local aborts due to its own size gate (message contains "diff
too large"), capture the abort reason as `LOCAL_SKIP_REASON` and set
`LOCAL_ENABLED=false`. Continue with remaining tasks.

If pr-review-local fails for any other reason, note the failure in the output
header and continue.

### Task 3: External Review Comments

Fetch existing PR review comments via `gh api`. Run both calls:

```bash
# Top-level review comments (automated tools and human reviewers)
gh api repos/{owner}/{repo}/pulls/<PR_NUMBER>/reviews \
  --jq '[.[] | {id, body, state, user_login: .user.login, submitted_at}]'

# Inline thread comments
gh api repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments \
  --jq '[.[] | {id, path, line, body, user_login: .user.login, created_at}]'
```

Capture as `REVIEW_COMMENTS` (top-level) and `INLINE_COMMENTS` (thread).

If this fetch fails, set `EXTERNAL_FETCH_FAILED=true`, note
`NOTE: External comment fetch failed; Sections 1 and 2 will be empty.` in
the output header. Continue.

## Collect and Parse Findings

After all three tasks complete, parse each source into its bucket.

### Bucket: toolkit

Parse `TOOLKIT_OUTPUT` by heading level. Each finding under `## Critical`,
`## Warning`, `## Nit`, `## Suggestion` is one entry with:
- `source`: `toolkit:<agent-name>` (extract from bracketed agent tag, e.g.
  `[code-reviewer]` -> `toolkit:code-reviewer`; if no tag, use `toolkit:unknown`)
- `severity`: heading name lowercased
- `issue`: finding description
- `file_line`: extracted `file:line` reference if present

### Bucket: local

Parse `LOCAL_OUTPUT` by heading. The pr-review-local format uses headings
`### Security`, `### Critical`, `### Performance`, `### Warnings`,
`### Suggestions`, `### Highlights`.

For each finding bullet, apply this regex to the header line:

```
^- `([^`]+)` \[(.+)\]$
```

- Group 1: `file_line` (e.g., `path/file.ts:L42`)
- Group 2: `issue_title`
- Indented lines following the header line: finding body

Map headings to severity:
- `### Security` -> `security`
- `### Critical` -> `critical`
- `### Performance` -> `performance`
- `### Warnings` -> `warning`
- `### Suggestions` -> `suggestion`

Set `source` to `local:<heading-slug>` (e.g., `local:security`,
`local:performance`).

### Bucket: automated-external

From `REVIEW_COMMENTS` and `INLINE_COMMENTS`, extract entries where
`user_login` matches known bot patterns: `copilot`, `coderabbit`,
`github-actions`, `sonarcloud`, or any handle ending in `[bot]`.

Each entry: `{source, comment_body, file_path (if inline), line (if inline),
submitted_at}`.

### Bucket: human-external

From the same JSON, extract entries where `user_login` does NOT match bot
patterns and is not the PR author.

Each entry: `{source: "@<user_login>", comment_body, file_path, line,
submitted_at}`.

## Judge Step

Skip this entire section if `JUDGE_ENABLED=false`.

### Gating

Skip the judge (treat as `JUDGE_ENABLED=false` for this run only) when any of:

- Total findings across all buckets `< 8`
- All findings have severity in `{nit, suggestion}`

Note `NOTE: Judge skipped (low finding count or all low-severity).` in the
output header when gated.

### Diff slicing

Build a minimal diff for the judge instead of the full `gh pr diff`:

1. Collect the unique set of file paths from all findings' `file_line` fields.
2. If the set is non-empty, run `gh pr diff -- <path1> <path2> ...` and pass
   that as `JUDGE_DIFF`.
3. If the set is empty (no file refs), fall back to `gh pr diff` whole.

Spawn a single subagent with fresh context (no prior conversation). Pass:
1. `JUDGE_DIFF` (sliced PR diff per above)
2. All findings from all four buckets, formatted as a numbered list with
   `source`, `severity`, `file_line`, and `issue` fields

Subagent instructions:

> You are an auditor reviewing a list of PR findings for false positives.
> For each finding, return exactly one of:
>
> - `keep` -- the finding is valid and worth the author's attention
> - `downgrade <new_severity>` -- valid but less severe than labeled
> - `drop` -- clearly wrong, already addressed in the diff, or not actionable
>
> Also provide a 1-line reason for each decision.
>
> Default threshold: drop only if clearly wrong or already addressed; keep
> anything ambiguous.
>
> Return a JSON array. Each element:
> {
>   "finding_index": <number>,
>   "decision": "keep" | "drop" | "downgrade <new_severity>",
>   "reason": "<one-line explanation>"
> }

Capture output as `JUDGE_OUTPUT`. Parse the JSON array.

If the subagent fails or returns malformed JSON: fall back to
`JUDGE_ENABLED=false` behavior. Prepend
`NOTE: Judge step failed; judge column omitted.` to output header.

Apply judge decisions to each finding before rendering:
- `keep`: render with judge value `kept`
- `downgrade <X>`: update `severity` to `<X>`, judge value `downgraded from
  <old> to <X>: <reason>`
- `drop`: remove from main sections; collect in `DROPPED_FINDINGS` list with
  `{source, issue_title, reason}`

## Output Format

Assemble the final report. If any pre-flight notes accumulated (local skipped,
fetch failed, judge failed), print them as a header block first:

```
NOTE: <reason>
```

---

### Section 1 -- Automated Reviewers

One table per tool. If `EXTERNAL_FETCH_FAILED=true` or no automated comments
found, state "No automated review comments found."

Without judge (`JUDGE_ENABLED=false`):

| # | Comment | Valid? | Why | Addressed? |
|---|---------|--------|-----|------------|

With judge (`JUDGE_ENABLED=true`):

| # | Comment | Valid? | Why | Judge | Addressed? |
|---|---------|--------|-----|-------|------------|

`Judge` column: `kept` / `dropped: <reason>` / `downgraded from <X> to <Y>:
<reason>`.

"Addressed?" = `Yes` if the author already fixed it per the diff, `No`
otherwise.

---

### Section 2 -- Human Reviewers

Same table format, one table per reviewer handle. If `EXTERNAL_FETCH_FAILED`
or no human comments found, state "No human review comments found."

---

### Section 3 -- Own Findings

Findings from `toolkit` and `local` buckets that were not dropped by the
judge. One unified table ordered by severity (critical first, then security,
performance, warning, suggestion, nit).

Without judge:

| # | Severity | Issue | File:Line | Source | Addressed? |
|---|----------|-------|-----------|--------|------------|

With judge:

| # | Severity | Issue | File:Line | Source | Judge | Addressed? |
|---|----------|-------|-----------|--------|-------|------------|

`Source` values: `toolkit:code-reviewer`, `toolkit:silent-failure-hunter`,
`toolkit:type-design-analyzer`, `toolkit:pr-test-analyzer`,
`toolkit:comment-analyzer`, `toolkit:code-simplifier`, `local:security`,
`local:regression`, `local:performance`, `New` (if the finding originated
from inline analysis rather than a named subagent).

"Addressed?" = `Yes` if the PR diff already resolves the finding.

---

### Section 4 -- Dropped by Judge

Only render if `JUDGE_ENABLED=true` and `DROPPED_FINDINGS` is non-empty.

```html
<details>
<summary>Dropped by judge (N)</summary>

| Finding | Source | Reason |
|---------|--------|--------|
| <issue_title> | <source> | <reason> |

</details>
```

If `JUDGE_ENABLED=false`, omit Section 4 entirely.

---

### Handoff

After presenting all sections, stop. Do not post anything to the PR. Prompt:

> Ready to iterate over comments? Invoke `/post-review` to start.

Wait for the user to respond before taking any further action.

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Pre-flight fails (auth, no PR) | Show error, stop |
| Toolkit missing | Show error, stop (hard block) |
| Toolkit task fails | Show error, stop (hard dependency) |
| pr-review-local not installed | Note in header, `LOCAL_ENABLED=false`, continue |
| pr-review-local size gate abort | Note skip reason in header, continue |
| pr-review-local task fails | Note failure in header, continue |
| External comment fetch fails | Note in header, Sections 1+2 show empty state |
| Judge subagent fails or bad JSON | Note in header, fall back to --no-judge behavior |
| PR has no diff | Inform user and exit |

---

## Hard Rules

**Never post, submit, or publish any comments to the PR.** This skill is
read-only. No tool call, API request, or sub-skill invocation that writes to
the PR is permitted under any circumstances.

- Never modify code or files
- Never use em-dashes in generated text
- Never use emojis in generated text
- Never skip the pre-flight checks
- Never skip the mode announcement and confirmation gate
- Never take any action on the PR without explicit user instruction
