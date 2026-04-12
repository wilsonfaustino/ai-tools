# claude-pr-review-setup — Roadmap

Post-MVP work, ordered by priority.

## Subagents (reintroduce in dedicated sprints)

1. **Architecture** — config-block at top of runtime SKILL.md declaring doc paths. Empty config falls back to diff-only. Rule-extraction pipeline reads whatever docs the user declares.
2. **Requirements (spec-only, Track B)** — rewrite Resolution Logic table for spec-files-only mode. Scans PR title/body/`.specs/` for linked specs.
3. **E2E** — inline generic heuristics for Playwright / Cypress / Vitest patterns. No external skill dependency.

## Workflows

4. **`/fix` companion workflow.** Needs `contents: write`. Gating: thumbs-up or Critical/Security markers. Replies `[RESOLVED]`.

## Jira track

5. Env vars (`JIRA_BASE_URL`, `JIRA_USER`, `JIRA_API_TOKEN`). Sticky Jira comment. Branch regex `[A-Z]+-[0-9]+`. Requirements Track A.

## Scaffolder UX

6. **Interactive mode.** Prompt for doc paths, branch regex, blocking toggle.
7. **CODEOWNERS gating** for `/review` trigger (lower priority without `/fix`).

## Local dev-loop

8. Invoke runtime pr-review from Claude Code directly, pre-push, no GH Actions. Wraps `assets/skill/SKILL.md` for local invocation.
