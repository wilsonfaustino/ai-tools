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
| [validate-bug-fix](skills/validate-bug-fix/) | Drive Playwright against a stage env to prove a bug fix holds, capturing video/network evidence and posting a Jira verification comment |
| [investigate-with-jira](skills/investigate-with-jira/) | Fetch a Jira bug ticket, fan out parallel read-only Sonnet agents (serena symbol search) across the codebase, and synthesize a ranked root-cause report. Investigation only |
| [migrate-antd-v6](skills/migrate-antd-v6/) | Migrate one file/route off the deprecated antdV3 import to antd v6, proving no regression with before/after Playwright screenshots of the real route before committing. Reusable, stops at ready-to-commit |
| [pr-follow-up](skills/pr-follow-up/) | Reviewer-side follow-up: validate whether author fixes address each review thread, then reply and resolve the good ones in a batch |
| [obsidian](skills/obsidian/) | Obsidian knowledge architect: notes with frontmatter, canvas JSON, bases, folder structures, CSS snippets, Tasks queries |
| [obsidian-daily-append](skills/obsidian-daily-append/) | Append a task item to today's Obsidian daily note from a PR URL, Jira ticket, or free text |

## Commands

Slash commands live in `commands/`.

| Command | Description |
|---|---|
| [audit-skill](commands/audit-skill.md) | Statically audit an untrusted skill/plugin repo for supply-chain payloads before install; clones into an empty folder, never executes, withholds the install command on any finding |
| [bic](commands/bic.md) | Find the commit that introduced a bug, given its fix, and print the GitHub commit URL |
| [ccusage-html](commands/ccusage-html.md) | Run `npx ccusage` and render output as a standalone HTML report |
| [handoff](commands/handoff.md) | Dump current session state to a named slot under `.claude/handoff/` for later `/pickup` |
| [loosen-prompts](commands/loosen-prompts.md) | Merge a curated allow/deny preset of non-destructive commands into `.claude/settings.local.json` |
| [pickup](commands/pickup.md) | Load a handoff slot, resolve references, brief the session, and wait for go-ahead |
| [review-board](commands/review-board.md) | Triage PR review findings in a browser, output JSON for `/post-review --from` |
| [review-flow](commands/review-flow.md) | Run the full PR review pipeline: staff-review, triage in the review-harness app, then post as pending review |
| [review-start](commands/review-start.md) | Start a PR review end to end: log the PR to today's daily note, set up an isolated review worktree, then run staff-review |
| [rca](commands/rca.md) | Draft a Root Cause Analysis from conversation context and post it to a Jira ticket field |
| [sonar-pr](commands/sonar-pr.md) | Fetch open Sonar issues for the current PR and print a grouped severity table |
| [wt-review](commands/wt-review.md) | Create or reuse an isolated worktree for reviewing a PR |
| [wt-clean](commands/wt-clean.md) | Remove a review worktree |

## Install

Skills install via `npx`:

```bash
npx skills add <skill_name>
```

Installed to `~/.claude/skills/` and available globally across projects.

Slash commands install by manual copy:

```bash
cp commands/<name>.md ~/.claude/commands/
```

If a command bundles helper scripts (e.g. `commands/sonar-pr/`), copy the directory too:

```bash
cp -r commands/<name> ~/.claude/commands/
```

Installed to `~/.claude/commands/` and invoked as `/<name>`.
