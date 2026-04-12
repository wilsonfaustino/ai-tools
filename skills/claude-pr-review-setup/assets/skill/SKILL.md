---
name: pr-review
description: Multi-agent PR reviewer. Use ONLY when explicitly asked to review a pull request: "review PR #N", "review this PR", "code review". Do NOT trigger automatically during coding or general questions.
license: CC-BY-4.0
metadata:
  author: Claude Code Skills
  version: 0.1.0
---

# PR Review - Orchestration Protocol

Coordinates 3 specialized subagents (via the Task tool) then consolidates findings into a unified summary. Each subagent loads the relevant existing project docs - this skill does not duplicate them.

## Step 1: Initialize

1. Get PR number from context or ask the user.
2. Identify repo: `gh repo view --json nameWithOwner -q .nameWithOwner`
3. Fetch diff: `gh pr diff {PR_NUMBER}`
4. Load existing inline comments: `gh api repos/{REPO}/pulls/{PR_NUMBER}/comments` - build a set of `{path, line}` pairs to avoid reposting.
5. Read PR intent: `gh pr view {PR_NUMBER} --json title,body,headRefName`

## Step 2: Launch Subagents in Parallel

Send **one message** with **three Task tool calls** - all launched simultaneously. Pass REPO, PR_NUMBER, the diff, existing comment locations, and PR intent to each subagent prompt. After all complete, run Step 3.

---

## Severity Labels (all subagents use these)

- 🚨 Critical - bugs or logic errors that will cause failures
- 🔒 Security - security vulnerabilities or data exposure
- ⚡ Performance - significant performance concerns
- ⚠️ Warning - code smells or maintainability issues
- 💡 Suggestion - optional improvements

---

## Universal Rules (every subagent must follow)

1. **Comment allowlist:** Only post inline comments on lines in the diff starting with `+` (excluding `+++`).
2. **Skip duplicates:** If `{path, line}` within ±3 lines already has a comment, skip.
3. **Mark resolved:** Reply `[RESOLVED] This appears resolved by the recent changes.` on existing comments where the issue is fixed.
4. **False positive guard:** Only report findings with ≥80% confidence. Skip when uncertain.
5. **Positive highlight:** Include at least one well-done aspect of the change before listing issues.
6. **Tone:** Specific, actionable, collegial. Explain WHY something is a problem.
7. **Never** approve, request-changes, or modify files. Use `--comment` only.
8. **Marker:** Start every inline comment body with `<!-- claude-review:{type} -->` (invisible in rendered view, used by the consolidation subagent).

---

## Subagent 1: Security

**Marker:** `<!-- claude-review:security -->`

Focus on the PR diff for Security concerns listed below. <!-- EXAMPLE: if your repo has security documentation, also load it here, e.g. "Load docs/security-patterns.md and extract rules marked with ❌" -->

Review the PR diff for any violations of those security patterns: hardcoded secrets, missing auth guards, PII in logs, missing webhook signature validation, overly permissive CORS, clients exported across module boundaries, sensitive fields in response DTOs, and raw query concatenation.

**Second pass:** Re-read the full diff from top to bottom. List every file or hunk you did not comment on. For each uncovered file, ask: "Does this file violate any security rule in my scope?" Only skip a file when you can explicitly state why it is clean.

**Comment format:**
```
🔒 Security - [Short title]
[What the issue is and why it matters]
**Recommendation:** [Specific fix]
```

---

## Subagent 2: Regression & Hallucination Detection

**Marker:** `<!-- claude-review:regression -->`

Review the PR diff for code changes that are unrelated to the PR's stated purpose, or that show signs of AI-generated artifacts. Look for: deleted code unrelated to the change (🚨 Critical), phantom imports referencing non-existent symbols (🚨 Critical), method calls with wrong signatures (🚨 Critical), `TODO` left in production code, type assertions hiding compiler errors, duplicate logic that already exists in the module, weakened error handling or validation, silently swallowed queue job errors, weakened test assertions, and dead code that is never called.

**Second pass:** Re-read the full diff from top to bottom. List every file or hunk you did not comment on. For each uncovered file, ask: "Does this file contain any unrelated deletions, phantom imports, duplicate logic, or weakened assertions?" Only skip a file when you can explicitly state why none of those categories apply.

**Comment format:**
```
[🚨/⚠️/💡] - [Short title]
Type: [unrelated-deletion | phantom-import | hallucination | duplicate | regression | dead-code]
[Specific description with quoted evidence from the diff]
**Recommendation:** [Exact fix]
```

---

## Subagent 3: Performance

**Marker:** `<!-- claude-review:performance -->`

Focus on the PR diff for Performance concerns listed below. <!-- EXAMPLE: if your repo has performance or repository pattern docs, also load them here, e.g. "Load docs/coding-patterns.md (Repository Pattern section)" -->

Only flag issues **clearly visible in the diff** - no speculation. Look for: N+1 query patterns (repository lookup inside a loop), unbounded `find()` with no pagination, missing `relations` causing lazy-load N+1, sequential `await` for independent operations that could use `Promise.all`, and multiple `repository.save()` calls without `@Transactional`.

**Second pass:** Re-read the full diff from top to bottom. List every service method, repository call, and loop you did not comment on. For each uncovered block, ask: "Does this contain a clearly visible performance issue?" Only skip a block when you can explicitly state why none of the patterns above apply.

**Comment format:**
```
⚡ Performance - [Short title]
[Description with estimated impact, e.g. "O(N) queries per request"]
**Recommendation:** [Fix with short code sketch if < 6 lines]
```

---

## Step 3: Consolidation

After all 3 subagents complete, spawn one more subagent via Task tool to consolidate:

1. `gh api repos/{REPO}/pulls/{PR_NUMBER}/comments` - fetch all inline comments.
2. Filter to those starting with `<!-- claude-review: -->` and parse the type from the marker.
3. Group by severity: 🔒 Security → 🚨 Critical → ⚡ Performance → ⚠️ Warning → 💡 Suggestion.
4. Deduplicate findings at the same `{path, line}` (±3 lines) - note both agents in the entry.
5. Collect one positive highlight per agent.
6. **Gap detection:** Run `gh pr diff {PR_NUMBER} --name-only` to get the full list of changed files. Cross-reference against all collected inline comment paths. For any file with zero inline comments from any subagent, add it to a `### 🔍 Files With No Inline Comments` section in the summary. Omit a file from this section only if it is a config/lock file (e.g. `*.json`, `*.yaml`, `*.lock`) or a pure type declaration file with no logic.
7. Post: `gh pr comment {PR_NUMBER} --body '...'`

**Summary format:**
```markdown
## 🤖 Claude AI Review Summary

| | |
|---|---|
| **Subagents invoked** | {N} of 3 (Security · Regression · Performance) |
| **Skills loaded** | `.claude/skills/pr-review/SKILL.md` |
| **Docs loaded** | (none by default - subagents are diff-first; see EXAMPLE blocks in each subagent to wire up repo docs) |
| **Findings** | {N} across {M} files |

---

### 🔒 Security ({N})
- [`path/file.ts:L42`] Finding title

### 🚨 Critical ({N})
### ⚡ Performance ({N})
### ⚠️ Warnings ({N})
### 💡 Suggestions ({N})

---
### 🔍 Files With No Inline Comments
- `path/to/file.ts` - no findings from any subagent (verify manually or re-run targeted review)

_(Omit this section if all logic files received at least one comment.)_

---
### ✅ Highlights
- [One positive highlight per agent]

---
> See inline comments for details and recommendations.
```

If no findings across all agents: post `✅ No issues found across all review dimensions.` but still include the metadata table.
