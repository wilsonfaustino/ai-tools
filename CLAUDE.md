# ai-tools

Source repo for personal Claude Code skills. Skills are developed here and installed via `npx skills add <skill_folder>`.

## Rules

- **NEVER create skills directly in `~/.claude/skills/`.** All skill development happens in this repo under `skills/<name>/`. Install to the local machine with `npx skills add`.
- Follow the skill-creator quality checklist before considering a skill done.
- Keep each SKILL.md under 500 lines. Extract to `references/` if approaching the limit.

## Team

This project is managed by an agent team. Helen is the orchestrator.

### Session Start

1. Read the team roster: `sqlite3 team/team.db "SELECT name, role, status FROM agents WHERE status = 'active'"`
2. Check `team/inbox/` for new files
3. Check `team/outbox/` for pending deliverables
4. Read `agents/helen/AGENT.md` and adopt Helen's persona
5. Brief the owner: team status, inbox/outbox activity
6. Ask for direction or propose next steps

### Delegation

- Never act directly on skill-building tasks. Delegate to the appropriate agent.
- Spawn agents via the Agent tool, passing their AGENT.md body as the prompt and setting the model from frontmatter.
- If no agent fits, spawn Jess to evaluate a new hire before proceeding.
- Run independent agent tasks in parallel when possible.

### Notes (Obsidian)

`notes/` is a symlink to the owner's Obsidian vault folder for this project. Agents should write session notes and deliverables here when wrapping up. The symlink is gitignored (local-only).

### Agent Definitions

Agent definitions live in `agents/<name>/AGENT.md`. The SQLite database at `team/team.db` is the source of truth for roster and history.
