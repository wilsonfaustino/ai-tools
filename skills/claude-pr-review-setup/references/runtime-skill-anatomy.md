# Runtime pr-review SKILL.md — Anatomy

Reference for maintainers of the `claude-pr-review-setup` skill. Not read by the runtime workflow.

## What the runtime SKILL.md does

`assets/skill/SKILL.md` is copied verbatim to `<target>/.claude/skills/pr-review/SKILL.md`. The GH Actions workflow invokes `claude -p` and instructs Claude to read that file and follow it. Claude then spawns 3 parallel Task subagents and a consolidation subagent.

## Structure

1. **Frontmatter** (`name: pr-review`, generic description, version).
2. **Step 1: Initialize** (fetch PR number, diff, existing comments, PR intent). No Jira check in MVP.
3. **Step 2: Launch subagents** (one message, three Task tool calls).
4. **Severity Labels** (emoji table used by all subagents).
5. **Universal Rules** (8 rules: comment allowlist, duplicate skip, RESOLVED replies, confidence threshold, positive highlight, tone, no approve/request-changes, marker prefix).
6. **Subagents** (Security, Regression, Performance). Each has marker, prompt body, second-pass verification, comment format.
7. **Step 3: Consolidation** (fourth Task subagent groups by severity, dedupes, detects gap files, posts via `gh pr comment`).

## Marker contract

Every inline comment starts with `<!-- claude-review:{type} -->` where type is one of `security`, `regression`, `performance`. The consolidation step parses these markers to group findings. Blocking check reads the summary comment, not inline comments.

## Blocking-check contract

Consolidation summary must print section counts as `(N)`, e.g. `### 🔒 Security (3)`. Workflow regex `(Critical|Security) \([1-9][0-9]*\)` matches only non-zero counts. Changing the summary format requires updating the workflow regex in lockstep.

## Two-pass discipline

Every subagent runs a second pass: list every file or hunk not yet commented on, run the same checks again, only skip with an explicit reason. This is not optional. Without it, subagents miss roughly 30% of findings (observed in Cursor deployments).

## What to not change casually

- Marker prefix `claude-review:`. Breaks consolidation if changed.
- Section heading count format `({N})`. Breaks blocking check.
- `gh pr comment` vs `gh pr review --comment`. The workflow and consolidation step are aligned on `gh pr comment`.
- Subagent count in the summary table. Update `of 3` to match the number of enabled subagents.

## Adding a subagent (roadmap work)

1. Add a new section following the Security / Regression / Performance template.
2. Update Step 2 ("three Task tool calls" becomes "four").
3. Update Step 3 summary table row `Subagents invoked | {N} of 3 ...`.
4. Update grep counts in the Task 2 verification block of the implementation plan.
