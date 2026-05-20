---
name: staff-review
description: >-
  Staff-engineer-level PR review that fans out to pr-review-toolkit and
  pr-review-local in parallel, audits automated and human reviewer comments,
  runs a judge layer that filters false positives, dedups overlapping
  findings, and scores confidence, then presents structured findings by
  severity. Use when the user says "staff review", invokes
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

Fetch existing PR reviews and threads in one GraphQL call. This gives
`isResolved` per thread for free so "Addressed?" can use real data instead of
diff-guessing.

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviews(first: 50) {
          nodes {
            databaseId
            body
            state
            submittedAt
            author { login }
          }
        }
        reviewThreads(first: 100) {
          nodes {
            isResolved
            isOutdated
            path
            line
            comments(first: 20) {
              nodes {
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
' -F owner='{owner}' -F repo='{repo}' -F number=<PR_NUMBER>
```

Map response into two arrays:

- `REVIEW_COMMENTS` from `reviews.nodes` (top-level review summaries). Filter
  out entries where `body` is empty (state-only reviews like APPROVE with no
  body). Each entry: `{id: databaseId, body, state, user_login: author.login,
  submitted_at: submittedAt}`.
- `INLINE_COMMENTS` from `reviewThreads.nodes`. Each entry uses the thread's
  first comment as the canonical anchor: `{id: comments.nodes[0].databaseId,
  path, line, body: comments.nodes[0].body, user_login:
  comments.nodes[0].author.login, created_at: comments.nodes[0].createdAt,
  is_resolved: isResolved, is_outdated: isOutdated}`.

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
submitted_at, is_resolved (inline only), is_outdated (inline only)}`.

### Bucket: human-external

From the same JSON, extract entries where `user_login` does NOT match bot
patterns and is not the PR author.

Each entry: `{source: "@<user_login>", comment_body, file_path, line,
submitted_at, is_resolved (inline only), is_outdated (inline only)}`.

### Assign stable IDs and source_count

After all four buckets are parsed, flatten into one finding list and assign a
**stable id** by bucket prefix and ordinal: toolkit -> `t1, t2, ...`; local
-> `l1, l2, ...`; automated-external -> `a1, ...`; human-external -> `h1, ...`.
The id is the judge's handle (replaces positional index, which breaks if the
judge renumbers or skips).

Then compute `source_count` (pre-dedup hint): normalize `file_line` to
`path:line` (strip `L`, drop column), group on that key; `source_count` =
distinct sources in the group. No `file_line` -> `1`. Cheap same-line
heuristic; the judge refines it via merges.

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

### Spawn

Spawn one subagent with fresh context. The judge **has Read access** and
may open any referenced file to verify a claim; the sliced diff shows only
changed hunks, but the full file often holds the context that confirms or
refutes a finding (helper elsewhere, existing test, upstream guard). Pass:

1. `JUDGE_DIFF` (sliced PR diff per above)
2. All findings from all four buckets, formatted as a list. Each line:
   `<id> | source=<source> | severity=<sev> | source_count=<n> |
   file_line=<file:line> | issue=<text>`

Subagent instructions:

> You are an auditor reviewing PR findings for false positives and duplicates.
>
> You MAY use Read to open any referenced file; verify against the full file
> before judging "wrong" or "already addressed".
>
> Each finding has a stable `id` (e.g. `t3`, `l1`). Findings from different
> sources sometimes describe the SAME issue; group those.
>
> `source_count` = independent sources that raised it. Higher = stronger
> signal; raise the bar before dropping a high-count finding.
>
> Reason BEFORE you decide: write `reason` first, then let it drive
> `decision`. Do not rationalize a verdict after the fact.
>
> For each finding decide one of:
> - `keep` -- valid and worth the author's attention
> - `downgrade <new_severity>` -- valid but less severe than labeled
> - `drop` -- clearly wrong, already addressed, or not actionable
>
> `confidence` is your certainty in the decision, 0.0 to 1.0. Drop only if
> clearly wrong or already addressed; keep anything ambiguous but mark it with
> low confidence.
>
> Return a single JSON object (reason key first in each decision):
> {
>   "decisions": [
>     {"id": "t3", "reason": "<one line>", "decision": "keep",
>      "confidence": 0.9}
>   ],
>   "merges": [["t3", "l1", "a2"]]
> }
>
> `merges`: arrays of ids describing the same issue; `[]` if none. Not every id
> need appear.

Capture output as `JUDGE_OUTPUT`. Parse the JSON object.

**Per-element salvage.** Parse `decisions` element by element. A malformed
element does not abort the judge: treat its id as `keep`, `confidence: null`.
Fall back to full `JUDGE_ENABLED=false` only if the response is not valid JSON
or `decisions` is empty; then prepend
`NOTE: Judge step failed; judge column omitted.` to output header.

**Apply merges first.** For each group in `merges`:
1. Canonical = highest severity in group (ties: lowest id). Apply its decision
   normally.
2. Combine all members' `source` into the canonical's `Source` cell (e.g.
   `toolkit:code-reviewer, local:security, @alice`); set `source_count` to
   group size.
3. Remove non-canonical members from all sections (folded in, not dropped); do
   not list them under Section 4.

**Apply decisions** to each surviving finding:
- `keep`: judge value `kept`
- `downgrade <X>`: set `severity` to `<X>`, judge value `downgraded from <old>
  to <X>: <reason>`
- `drop`: remove from main sections; add to `DROPPED_FINDINGS`

**Confidence rendering.** `confidence < 0.5` appends ` (low confidence)` to
the Judge cell; `null` confidence (salvaged) appends ` (unscored)`.

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
<reason>`, with ` (low confidence)` or ` (unscored)` appended per the
confidence rule. A merged finding shows all contributing sources in its
`Source`/tool cell.

"Addressed?" derivation for inline thread comments:
- `is_resolved == true` -> `Yes (resolved)`
- `is_outdated == true` -> `Yes (outdated)`
- otherwise fall back to diff check: `Yes` if author already fixed per the
  diff, `No` otherwise

For top-level review comments (no thread): always use diff fallback. Show
`Yes` if the diff resolves the concern, `No` otherwise.

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
from inline analysis rather than a named subagent). A merged finding lists all
contributing sources comma-separated.

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
| Judge: one malformed decision element | Salvage rest; treat that id as `keep` (unscored) |
| Judge: non-JSON response or empty decisions | Note in header, fall back to --no-judge behavior |
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
