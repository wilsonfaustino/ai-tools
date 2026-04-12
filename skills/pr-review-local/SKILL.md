---
name: pr-review-local
description: Run the 3-subagent PR review (Security, Regression, Performance) against your current branch diff vs the resolved base branch, locally, before pushing. Use when the user says "review my branch", "local PR review", "review before push", "pre-ship review", or invokes /pr-review-local. Does not post to any PR. Output is stdout markdown only.
license: CC-BY-4.0
metadata:
  author: Claude Code Skills
  version: 0.1.0
---

# pr-review-local - Local Branch Review

Runs the 3-subagent PR review against the current branch diff vs the resolved base branch locally. Outputs a markdown summary to stdout. No PR, no GH Actions, no comment posting.

## Step 1: Initialize

Follow each sub-step in order. Abort with the stated message on any failure; do not continue.

### 1.1 Verify cwd is a git repo

Run: `git rev-parse --is-inside-work-tree`
If non-zero exit: abort with `not a git repo (cwd: $(pwd))`.

### 1.2 Resolve base branch (ladder)

Try each in order; stop at the first that exists as a ref:

1. `git rev-parse --verify origin/main`
2. `git rev-parse --verify origin/master`
3. `git rev-parse --verify origin/develop`
4. `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` and then `git rev-parse --verify origin/$DEFAULT_BRANCH`
5. User-provided arg (not supported in MVP; accept as future hint only)

If none resolve, abort with `no base branch detected (tried origin/main, origin/master, origin/develop, gh repo view); ensure the repo has an origin remote with one of these branches`.

Record `RESOLVED_BASE` (e.g. `origin/main`) and `BASE_SHA=$(git rev-parse $RESOLVED_BASE)` and `BASE_DATE=$(git log -1 --format=%cI $RESOLVED_BASE)`.

### 1.3 Compute merge base

Run: `MERGE_BASE=$(git merge-base HEAD $RESOLVED_BASE)`.

### 1.4 HEAD-equals-base check

If `$(git rev-parse HEAD)` equals `$MERGE_BASE`: abort with `nothing to review vs $RESOLVED_BASE; make a commit first`.

### 1.5 Compute excluded diff and file list

Exclude pathspecs (hardcoded):
```
':(exclude)package-lock.json'
':(exclude)yarn.lock'
':(exclude)pnpm-lock.yaml'
':(exclude)poetry.lock'
':(exclude)Gemfile.lock'
':(exclude)Cargo.lock'
':(exclude)go.sum'
':(exclude)*.min.js'
':(exclude)*.min.css'
':(exclude)node_modules/**'
':(exclude)vendor/**'
':(exclude)dist/**'
':(exclude)build/**'
':(exclude).next/**'
```

Run:
- `CHANGED_FILES=$(git diff --name-only $MERGE_BASE..HEAD -- . <excludes>)`
- `DIFF=$(git diff $MERGE_BASE..HEAD -- . <excludes>)`
- `TOTAL_FILES_PRE=$(git diff --name-only $MERGE_BASE..HEAD | wc -l | tr -d ' ')`
- `TOTAL_FILES_POST=$(echo "$CHANGED_FILES" | grep -c .)`
- `EXCLUDED_COUNT=$((TOTAL_FILES_PRE - TOTAL_FILES_POST))`

If `$CHANGED_FILES` is empty after exclusions: abort with `nothing to review vs $RESOLVED_BASE after exclusions; only ignored files changed (lockfiles, generated, etc)`.

### 1.6 Size gate

- `DIFF_LINES=$(echo "$DIFF" | wc -l | tr -d ' ')`
- `DIFF_FILES=$TOTAL_FILES_POST`

If `DIFF_LINES > 3000` OR `DIFF_FILES > 40`: abort with `diff too large for reliable review ($DIFF_LINES lines, $DIFF_FILES files; limits 3000 / 40); consider splitting the branch`.

### 1.7 Pre-annotate the diff

Transform `$DIFF` by walking each hunk and prefixing every `+` line (excluding `+++` file headers) with `[L<n>]` where `<n>` is the absolute line number of that added line in the post-image of the file.

Algorithm:
- Parse `@@ -a,b +c,d @@` headers; extract `c` as the starting new-file line number for the hunk.
- Initialize a counter `line = c`.
- For each line in the hunk:
  - If it starts with `+` (and not `+++`): replace `+` with `+[L<line>] ` (preserving the rest). Increment `line`.
  - If it starts with ` ` (context): increment `line`.
  - If it starts with `-`: do not increment.

Record the annotated diff as `$ANNOTATED_DIFF`. Verify it is non-empty. Subagents receive `$ANNOTATED_DIFF`, not `$DIFF`.

## Step 2: Launch Subagents in Parallel

Send **one message** with **three Task tool calls** all launched simultaneously. Pass to each subagent:
- `RESOLVED_BASE`, `MERGE_BASE` (sha), `HEAD` (sha)
- `CHANGED_FILES` (newline-separated list)
- `ANNOTATED_DIFF` (the pre-annotated diff from Step 1.7)

Subagents return free-form markdown with findings citing line references as `path/file.ts:L<n>`, using the `[L<n>]` annotations in the diff as the source of truth.

If any subagent errors (Task tool failure, timeout, context overflow), capture the error message. Do not retry. Continue to Step 3 with whichever subagents succeeded.

---

## Severity Labels (all subagents use these)

- Critical: bugs or logic errors that will cause failures
- Security: security vulnerabilities or data exposure
- Performance: significant performance concerns
- Warning: code smells or maintainability issues
- Suggestion: optional improvements

---

## Universal Rules (every subagent must follow)

1. **Line reference allowlist:** Only cite lines that carry a `[L<n>]` annotation in the annotated diff (these are the `+` lines). Do not cite unchanged or removed lines.
2. **Duplicate skip:** N/A in local mode (each run is fresh; no prior comments exist).
3. **Mark resolved:** N/A in local mode (no prior comments to mark).
4. **False positive guard:** Only report findings with >=80% confidence. Skip when uncertain.
5. **Positive highlight:** Include at least one well-done aspect of the change in your returned markdown under a `### Highlights` heading.
6. **Tone:** Specific, actionable, collegial. Explain WHY something is a problem.
7. **Never** modify files, never call `gh api`, never post comments. Return findings as markdown text only.

---

## Subagent 1: Security

Focus on the annotated PR diff for Security concerns listed below. <!-- EXAMPLE: if your repo has security documentation, also load it here, e.g. "Load docs/security-patterns.md and extract rules marked with the failure mark" -->

Review the PR diff for any violations of those security patterns: hardcoded secrets, missing auth guards, PII in logs, missing webhook signature validation, overly permissive CORS, clients exported across module boundaries, sensitive fields in response DTOs, and raw query concatenation.

**Second pass:** Re-read the full diff from top to bottom. List every file or hunk you did not comment on. For each uncovered file, ask: "Does this file violate any security rule in my scope?" Only skip a file when you can explicitly state why it is clean.

**Return format:** One markdown block per finding, cited with the `[L<n>]` annotation from the diff:

```
- `path/file.ts:L42` [Short title]
  [What the issue is and why it matters]
  Recommendation: [Specific fix]
```

Group your findings under a `### Security` heading. Include at least one positive highlight under `### Highlights` before your findings. If no findings, print `### Security` + `- No findings.` and still include a `### Highlights` line.

---

## Subagent 2: Regression and Hallucination Detection

Review the annotated PR diff for code changes that are unrelated to the branch's stated purpose, or that show signs of AI-generated artifacts. Look for: deleted code unrelated to the change (Critical), phantom imports referencing non-existent symbols (Critical), method calls with wrong signatures (Critical), `TODO` left in production code, type assertions hiding compiler errors, duplicate logic that already exists in the module, weakened error handling or validation, silently swallowed queue job errors, weakened test assertions, and dead code that is never called.

**Second pass:** Re-read the full diff from top to bottom. List every file or hunk you did not comment on. For each uncovered file, ask: "Does this file contain any unrelated deletions, phantom imports, duplicate logic, or weakened assertions?" Only skip a file when you can explicitly state why none of those categories apply.

**Return format:**

```
- `path/file.ts:L42` [Short title]
  Type: [unrelated-deletion | phantom-import | hallucination | duplicate | regression | dead-code]
  [Specific description with quoted evidence from the diff]
  Recommendation: [Exact fix]
```

Group your findings under a `### Regression` heading (use Critical / Warning / Suggestion severity labels inside each finding's title). Include at least one positive highlight under `### Highlights`. If no findings, print `### Regression` + `- No findings.` and still include a `### Highlights` line.

---

## Subagent 3: Performance

Focus on the annotated PR diff for Performance concerns listed below. <!-- EXAMPLE: if your repo has performance or repository pattern docs, also load them here, e.g. "Load docs/coding-patterns.md (Repository Pattern section)" -->

Only flag issues **clearly visible in the diff**, no speculation. Look for: N+1 query patterns (repository lookup inside a loop), unbounded `find()` with no pagination, missing `relations` causing lazy-load N+1, sequential `await` for independent operations that could use `Promise.all`, and multiple `repository.save()` calls without `@Transactional`.

**Second pass:** Re-read the full diff from top to bottom. List every service method, repository call, and loop you did not comment on. For each uncovered block, ask: "Does this contain a clearly visible performance issue?" Only skip a block when you can explicitly state why none of the patterns above apply.

**Return format:**

```
- `path/file.ts:L42` [Short title]
  [Description with estimated impact, e.g. "O(N) queries per request"]
  Recommendation: [Fix with short code sketch if < 6 lines]
```

Group your findings under a `### Performance` heading. Include at least one positive highlight under `### Highlights`. If no findings, print `### Performance` + `- No findings.` and still include a `### Highlights` line.

---

## Step 3: Consolidation and Output

After all 3 subagents complete (or error out), assemble the final report in stdout.

### 3.1 Aggregate return values

Collect each subagent's returned markdown. For each, note whether it succeeded or errored. Build a `SUCCEEDED_COUNT` (0..3) and an `ERRORS` list of `{subagent_name, error_message}` tuples.

### 3.2 Gap detection

From `$CHANGED_FILES`, identify files that received zero findings across all successful subagents. Exclude from the gap list any file matching `*.json`, `*.yaml`, `*.yml`, `*.lock`, `*.d.ts`, or pure type declaration files with no logic.

### 3.3 Assemble summary

Print the following to stdout. Fields in `<>` are placeholders you fill in.

```markdown
## Local PR Review - <branch> vs <RESOLVED_BASE>

| | |
|---|---|
| Base | <RESOLVED_BASE> @ <BASE_SHA_SHORT> (<BASE_DATE>) |
| Head | <HEAD_SHA_SHORT> |
| Files changed | <DIFF_FILES> (excluded: <EXCLUDED_COUNT> via ignore list) |
| Diff size | <DIFF_LINES> lines |
| Model | <active model name, e.g. from session context> |
| Subagents | <SUCCEEDED_COUNT> of 3 (Security, Regression, Performance) |
| Findings | <total_findings> across <files_with_findings> files |

---

### Security (<N>)
<findings from Security subagent, or "- No findings.">

### Critical (<N>)
<Regression findings with Critical severity label>

### Performance (<N>)
<findings from Performance subagent, or "- No findings.">

### Warnings (<N>)
<Regression findings with Warning severity label>

### Suggestions (<N>)
<Regression findings with Suggestion severity label>

---
### Files With No Findings
<list of files from gap detection, or omit the entire section if empty>

### Highlights
<one bullet per succeeded subagent, collated from each subagent's Highlights block>
```

### 3.4 Partial-run header (if any subagent errored)

If `SUCCEEDED_COUNT < 3`, prepend this block to the very top of the output, before the `## Local PR Review` heading:

```
WARNING: Partial review (<SUCCEEDED_COUNT> of 3 subagents succeeded)
```

And append an `### Errors` section at the end of the summary:

```
### Errors
- <subagent_name>: <error_message>
```

### 3.5 Empty-findings fallback

If all succeeded subagents reported zero findings, replace the severity sections with a single line:

```
No issues found across all review dimensions.
```

Keep the metadata table and the `### Highlights` section.

### 3.6 Final output rules

- No emojis anywhere in the output.
- Section counts always use `(N)` format even when N=0.
- Print the assembled markdown as the final response to the user. Do not write to any file.
