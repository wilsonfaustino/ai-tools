# ai-tools

Personal Claude Code skills. Developed here, installed locally via `npx skills add <skill_folder>`.

## Skills

| Skill | Description |
|---|---|
| [ship](skills/ship/) | Push branch and create/update a GitHub PR with intent-driven descriptions |
| [staff-review](skills/staff-review/) | Staff-engineer-level PR review that audits automated and human reviewer comments |
| [post-review](skills/post-review/) | Interactive triage and posting of PR review comments as a pending GitHub review |
| [gh-reply-comments](skills/gh-reply-comments/) | Reply to GitHub PR review threads after addressing feedback |
| [wrap-up](skills/wrap-up/) | End-of-session command that updates memory and writes Obsidian session notes |
| [todo](skills/todo/) | Quick-capture project todos with priority during work sessions |
| [init-team](skills/init-team/) | Scaffold agent team infrastructure (Helen + Jess, SQLite state, inbox/outbox) |

## Usage

```bash
npx skills add <skill_name>
```

Skills are installed to `~/.claude/skills/` and available globally across projects.
