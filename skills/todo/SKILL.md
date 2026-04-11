---
name: todo
description: >-
  Quick-capture and manage project todos during work sessions. Subcommands:
  add, list, done, remove, help. Todos are stored as markdown files in .todos/
  at the project root. Use when the user says "add todo", "show todos", "mark
  done", "remove todo", "todo help", or invokes /todo:add, /todo:list,
  /todo:done, /todo:remove, /todo:help.
---

# Todo

Quick-capture and manage project todos without breaking flow.

## Shared Rules

- Never auto-commit. The user controls git.
- Keep output minimal. One confirmation line per action.
- If `.todos/` doesn't exist on `list`, `done`, or `remove`, print "No pending todos." and stop. Do not create the directory.
- Destructive actions (`remove`) require explicit user confirmation before deleting files.
- Todo files are the source of truth. Do not store state anywhere else.
- `.todos/done/` should be tracked in git. Done history is valuable for retrospectives.
- If Basic Memory MCP or any optional integration is unavailable, skip silently. Never error on missing optional dependencies.

---

## Scan and Display Procedure

Used by `list`, `done`, and `remove`.

### 1. Scan .todos/

Read all `.md` files in `.todos/` (exclude the `done/` subdirectory). If `.todos/` doesn't exist or is empty, print:

> No pending todos.

Then stop.

### 2. Parse and sort

Parse YAML frontmatter from each file. Sort by priority: high first, then medium, then low. Within same priority, sort by creation date (oldest first).

### 3. Display

Print a numbered table:

```
## Pending Todos

| # | Priority | Title | Created | Branch |
|---|----------|-------|---------|--------|
| 1 | high     | ...   | ...     | ...    |
| 2 | medium   | ...   | ...     | ...    |
| 3 | low      | ...   | ...     | ...    |
```

After the table, print total count:

> N pending todos (H high, M medium, L low)

---

## /todo:add

Capture a todo without breaking flow. Stores in `.todos/` at project root.

### 1. Parse input

Parse arguments after `add`:

- First word is a priority (`high`, `medium`, `low`)? Use it, rest is title.
- No priority keyword? Default to `medium`.
- No text at all? Ask user for title. Priority stays `medium` unless they specify.

Examples:
- `/todo:add fix auth redirect` -> title: "fix auth redirect", priority: medium
- `/todo:add high fix auth redirect` -> title: "fix auth redirect", priority: high
- `/todo:add` -> ask for title

### 2. Gather context

Collect automatically (do NOT ask the user):

- **Branch:** `git rev-parse --abbrev-ref HEAD 2>/dev/null` (or "no git")
- **Recent files:** `git diff --name-only HEAD 2>/dev/null | head -5`. Fallback: `git diff --name-only HEAD~1 2>/dev/null | head -5`. Still empty: "none".
- **Working directory:** basename of `$PWD`
- **Memory link:** Check if auto-memory MEMORY.md exists for this project. Path or "none".
- **Basic Memory:** If available, `search_notes` with title as query. Top permalink or "none". If unavailable, skip silently.

### 3. Generate filename

Format: `YYYY-MM-DD-<slug>-<4-hex>.md`

- Slug: lowercase, spaces to hyphens, strip non-alphanumeric (keep hyphens), max 50 chars.
- 4-char hex: random (e.g. `a3f2`) to avoid collisions.

### 4. Write the file

Create `.todos/` if it doesn't exist.

Write to `.todos/<filename>`:

```markdown
---
title: <title>
priority: <high|medium|low>
created: <YYYY-MM-DD>
status: pending
branch: <current branch>
---

## Context

<1-2 sentence summary of what the user was working on, inferred from recent files and branch>

## References

- Recent files: <comma-separated list or "none">
- Memory: <path to MEMORY.md or "none">
- Related notes: <Basic Memory permalink or "none">
```

### 5. Confirm

Print one line:

> Added: `<title>` [<priority>] -> .todos/<filename>

---

## /todo:list

Display pending todos sorted by priority.

Follow the Scan and Display Procedure above. That is the entire operation.

---

## /todo:done

Mark todos as complete and archive them.

### 1. Show list

Follow the Scan and Display Procedure to show the numbered table. If no pending todos, stop here.

### 2. Ask which ones

> Which todos are done? (enter numbers, e.g. 1 3 5)

Accept a single number or multiple space-separated numbers.

### 3. Move to done

For each selected todo:

- Create `.todos/done/` if it doesn't exist
- Update frontmatter: set `status: done`, add `completed: <YYYY-MM-DD>`
- Move file from `.todos/` to `.todos/done/`

### 4. Confirm

Print one line per completed todo:

> Done: `<title>` -> .todos/done/<filename>

---

## /todo:remove

Permanently delete todos that are no longer relevant.

### 1. Show list

Follow the Scan and Display Procedure to show the numbered table. If no pending todos, stop here.

### 2. Ask which ones

> Which todos to remove? (enter numbers, e.g. 1 3 5)

Accept a single number or multiple space-separated numbers.

### 3. Confirm destruction

List the selected titles and ask:

> Remove these permanently? (y/n)

Only proceed on explicit "y" or "yes".

### 4. Delete files

Delete each selected `.md` file from `.todos/`. Do NOT move to `done/` -- these are discarded, not completed.

### 5. Confirm

Print one line per removed todo:

> Removed: `<title>`

---

## /todo:help

Print the following reference and stop:

```
## Todo Commands

| Command        | Usage                              | Description                          |
|----------------|------------------------------------|--------------------------------------|
| /todo:add      | /todo:add [high|medium|low] <text> | Capture a new todo (default: medium) |
| /todo:list     | /todo:list                         | Show pending todos sorted by priority|
| /todo:done     | /todo:done                         | Mark todo(s) as complete             |
| /todo:remove   | /todo:remove                       | Delete todo(s) permanently           |
| /todo:help     | /todo:help                         | Show this reference                  |

Todos are stored as markdown files in .todos/ at the project root.
Completed todos move to .todos/done/. Removed todos are deleted permanently.
```
