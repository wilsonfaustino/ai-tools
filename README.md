# ai-tools

Personal Claude Code skills. Developed here, installed locally via `npx skills add <skill_folder>`.

## Skills

| Skill | Description |
|---|---|
| [ship](skills/ship/) | Push branch and create/update a GitHub PR with intent-driven descriptions |
| [staff-review](skills/staff-review/) | Staff-engineer-level PR review that audits automated and human reviewer comments |
| [claude-pr-review-setup](skills/claude-pr-review-setup/) | Scaffold a `/review` workflow with 3 subagents (Security, Regression, Performance) |
| [pr-review-local](skills/pr-review-local/) | Local 3-subagent PR review against branch diff vs resolved base, before pushing |
| [post-review](skills/post-review/) | Interactive triage and posting of PR review comments as a pending GitHub review |
| [post-merged](skills/post-merged/) | Post-merge cleanup: verify PR merged, switch to default branch, prompt safe local delete |
| [gh-reply-comments](skills/gh-reply-comments/) | Reply to GitHub PR review threads after addressing feedback |
| [wrap-up](skills/wrap-up/) | End-of-session command that updates memory and writes Obsidian session notes |
| [todo](skills/todo/) | Quick-capture project todos with priority during work sessions |
| [init-team](skills/init-team/) | Scaffold agent team infrastructure (Helen + Jess, SQLite state, inbox/outbox) |

## Commands

Slash commands live in `commands/` and install to `~/.claude/commands/`.

| Command | Description |
|---|---|
| [loosen-prompts](commands/loosen-prompts.md) | Merge a curated allow/deny preset of non-destructive commands into `.claude/settings.local.json` |
| [wt-review](commands/wt-review.md) | Create or reuse an isolated worktree for reviewing a PR |
| [wt-clean](commands/wt-clean.md) | Remove a review worktree |

## Usage

```bash
npx skills add <skill_name>
```

Skills are installed to `~/.claude/skills/` and available globally across projects.
