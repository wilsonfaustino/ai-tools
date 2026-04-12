# Claude PR Review — Setup Checklist

The `claude-pr-review-setup` skill installed these files in your repo:

- `.github/workflows/claude-pr-review.yml`
- `.claude/skills/pr-review/SKILL.md`
- `PR_REVIEW_SETUP.md` (this file, delete when done)

## Before your first /review

1. **Add secret `ANTHROPIC_API_KEY`** in GitHub repo Settings > Secrets and variables > Actions.
2. **Review defaults** in `.github/workflows/claude-pr-review.yml`:
   - Model: `claude-opus-4-6`
   - `BLOCKING_REVIEW: "true"` (review fails the workflow when Critical or Security findings are posted)
   - Change either if you want to.
3. **Optional: wire repo-specific docs.** Open `.claude/skills/pr-review/SKILL.md` and search for `<!-- EXAMPLE:`. Each EXAMPLE block shows how to point a subagent at your repo documentation. Safe to leave as-is, subagents are diff-first by default.

## Commit and test

4. Commit the three new files (`.github/workflows/claude-pr-review.yml`, `.claude/skills/pr-review/SKILL.md`, `PR_REVIEW_SETUP.md`).
5. Open a test PR.
6. Comment `/review` on the PR.
7. Watch the Actions tab: Claude installs, runs 3 subagents (Security, Regression, Performance), posts inline comments with `<!-- claude-review:* -->` markers, posts a consolidated summary.

## Roadmap

The MVP has 3 subagents. Architecture, Requirements, and E2E subagents, Jira integration, and `/fix` are on the skill roadmap. See the skill repo for status.

## Clean up

Delete `PR_REVIEW_SETUP.md` when setup is complete.
