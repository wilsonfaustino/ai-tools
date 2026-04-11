---
name: staff-review
description: >-
  Staff-engineer-level PR review that audits automated and human reviewer comments,
  cross-checks Copilot/CodeRabbit validity, then presents structured findings by
  severity. Use when the user says "staff review", invokes /staff-review, or wants
  a thorough review that also validates existing reviewer comments. Do not use for
  simple code reviews or when the user explicitly asks for pr-review-toolkit directly.
---

# Staff Review

**READ-ONLY OPERATION. Do NOT post, submit, or publish any comments to the PR under any circumstances. All findings must be presented to the user in chat only. Stop and wait for explicit user instruction before taking any action on the PR.**

Invoke `pr-review-toolkit:review-pr` with a staff engineer persona, audit existing reviewer
comments, and present structured findings.

## Pre-flight

Run in parallel:

```bash
gh auth status
gh pr view --json number,url,author --jq '{number,url,author: .author.login}'
```

### Hard blocks (refuse to proceed)

- `gh auth status` fails
- No open PR for current branch

## Review

Use the Skill tool with `skill: 'pr-review-toolkit:review-pr'`. State the instructions below as the task description before invoking the skill, so they become part of the conversation context when the skill triggers:

> IMPORTANT: Do NOT post, submit, or publish any comments to the PR. This review is read-only. All findings must be presented to the user in chat only. Do not call any API or tool that writes to the PR.
>
> Act as a staff engineer reviewing this PR. For each finding:
> - Categorize by severity: `critical`, `warning`, `nit`, `suggestion`
> - Point to the exact file and line
> - Suggest a friendly, constructive comment (no em-dashes, concise)
>
> Additionally:
> - Fetch all existing reviewer comments (automated tools like Copilot/CodeRabbit and human reviewers)
> - For each existing comment, assess: is it valid? why? was it addressed?
> - Cross-reference your own findings with existing comments to avoid duplicates

## Output Format

Present results in three ordered sections.

### Section 1 -- Automated Reviewers

One table per tool (Copilot, CodeRabbit, etc). If none found, state
"No automated review comments found."

| # | Comment | Valid? | Why | Addressed? |
|---|---------|--------|-----|------------|

### Section 2 -- Human Reviewers

Same table format, one table per reviewer handle. If none found, state
"No human review comments found."

If both Section 1 and Section 2 are empty, proceed directly to Section 3. The review's value is in the original findings regardless of whether other reviewers have commented.

| # | Comment | Valid? | Why | Addressed? |
|---|---------|--------|-----|------------|

### Section 3 -- Own Findings

| # | Severity | Issue | File:Line | Spotted by | Addressed? |
|---|----------|-------|-----------|------------|------------|

Severity levels: `critical`, `warning`, `nit`, `suggestion`.

"Spotted by" = `@copilot`, `@reviewer-handle`, or `New` if original finding.

"Addressed?" = `Yes` if the author already fixed it, `No` otherwise.

If an existing reviewer comment already covers an issue fully, omit it from Section 3 and mark it Valid in the relevant Section 1 or 2 table. Only include it in Section 3 if the finding adds new context beyond what was already raised.

### Handoff

After presenting all three sections, stop. Do not post anything to the PR. Prompt:

> Ready to iterate over comments? Invoke `/post-review` to start.

Wait for the user to respond before taking any further action. If `/post-review` is not installed, list the findings summary and suggest the user post comments manually.

## Error Handling

- Pre-flight fails: show the error and stop
- `pr-review-toolkit:review-pr` invocation fails or is unavailable: inform user, suggest running the review manually
- PR has no diff (empty PR): inform user and exit

## Hard rules

**Never post, submit, or publish any comments to the PR.** This skill is read-only. No tool call, API request, or sub-skill invocation that writes to the PR is permitted under any circumstances.

- Never modify code or files
- Never use em-dashes in generated text
- Never skip the pre-flight checks
- Never take any action on the PR without explicit user instruction
