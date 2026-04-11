---
name: wrap-up
description: >-
  End-of-session command that updates auto-memory, optionally writes session
  knowledge to Basic Memory, and creates an Obsidian session note via a .notes/
  symlink. Use when the user says "wrap up", "end session", "finish up", "done
  for the day", invokes /wrap-up, or is clearly finishing a work session. Also
  use after completing a major task when the user wants to capture what happened.
  If in doubt, offer to run it.
---

# Wrap Up Session

Three steps in sequence to close out the current session. One pause for folder selection, then no further confirmation needed.

## Step 0: Discover Vault and Select Folder

### Resolve vault root

Check if `.notes/` exists in the current working directory (symlink or real directory).

- If `.notes/` exists: resolve its target as the vault root. Proceed to folder scan.
- If `.notes/` does not exist: run the bootstrap flow (see below).

### Bootstrap (first run only)

Ask the user:

> No `.notes/` folder found. Where is your Obsidian vault? Paste the absolute path.

After receiving the path:

1. Verify the path exists and is a directory. If not, inform the user and ask
   again. Do not proceed until a valid path is provided.
2. Create the symlink: `ln -s {user_path} .notes`
3. If this is a git repo, add `.notes/` to `.git/info/exclude` (create the file
   if needed). This avoids polluting the shared `.gitignore` with a user-specific
   entry. If not a git repo, skip this step.
4. Proceed to folder scan

### Scan folder structure

Run via context-mode if available, otherwise Bash. Context-mode keeps the
directory tree out of the main context window, which matters for large vaults:

```bash
tree -d -L 2 .notes/
```

### Predict and present folder options

Read `.notes/.wrap-up.yml` if it exists. Use saved hints to rank folders. If no
config exists, rely on session context alone (cwd, file paths, ticket IDs, work
type, conversation topics) combined with the live tree scan.

Predict 3 best-match **leaf-level** folders from the tree. Present exactly 4
options with a short reason (under 10 words) for each prediction:

```
Where should I save this session note?

1. {predicted-folder-1} -- {reason}
2. {predicted-folder-2} -- {reason}
3. {predicted-folder-3} -- {reason}
4. Custom path (type folder path relative to vault root)
```

Wait for user input. For option 4, the user types a relative path (e.g.,
`Side Projects/solar-wheel`). If the path does not exist, ask whether to create
it.

### Resolve Basic Memory target

Check if `mcp__basic-memory__write_note` is available in the current tool list.

- Not available: set `bm_available = false`. Skip all BM operations in Step 2.
- Available: read `bm_project` and `bm_directory` from the matching hint in
  `.notes/.wrap-up.yml`. If no match or fields missing, ask the user:

> What Basic Memory project should this go under? (e.g., "main", "work")
> What directory? (e.g., "projects/my-project")

### Save mapping to config

If the selected folder does not already have a matching entry in
`.notes/.wrap-up.yml`, offer:

> Save this mapping for next time? (y/n)

If yes, create or update `.notes/.wrap-up.yml`. When the file already exists,
append the new entry under the existing `hints` list (do not create a duplicate
`hints` key, which would produce invalid YAML). When creating the file for the
first time, write the full structure:

```yaml
hints:
  - signal: "react, components, frontend"
    folder: "WebApp/Frontend"
    bm_project: "main"
    bm_directory: "projects/webapp"
  - signal: "api, endpoints, auth"
    folder: "WebApp/Backend"
```

Fields:
- `signal`: comma-separated keywords extracted from the session that led to the
  folder match (file paths, project names, ticket prefixes, work type). These
  enable pattern matching on future sessions to rank predictions.
- `folder`: the selected vault subfolder.
- `bm_project` / `bm_directory`: Basic Memory target. Only present if BM is
  available. Omit entirely otherwise.

If the folder already has a matching hint entry, skip the save prompt.

### Git metadata

Use what is already in session context. If something specific is missing (e.g., PR URL not discussed), grab it inline with a single tool call. If the session had no git activity, omit git fields from the Obsidian note.

## Step 1: Update Auto-Memory

1. Read the current memory index at the auto-memory path (`MEMORY.md`)
2. Review what happened this session: decisions, phase progress, new patterns
3. Update or create relevant memory files:
   - **project** memory: update phase/milestone status, record key decisions
   - **feedback** memory: save any new user corrections or preferences
   - **user** memory: update if new info about the user's role/preferences emerged
4. Update `MEMORY.md` index if new files were added or descriptions changed

Only update memories that actually changed. Do not create duplicates.

## Step 2: Write Detailed Knowledge to Basic Memory

Skip this step entirely if `bm_available = false` (BM tools not detected in
Step 0).

Skip this step if the session had no meaningful findings (no decisions, no
technical findings, no problems solved).

Use `bm_project` and `bm_directory` from the config hint matched in Step 0.
If Step 0 asked the user for these values, they were saved to config already.

### Compose the note

Use `mcp__basic-memory__write_note` with:
- `title`: `Session YYYY-MM-DD - {brief-description}`
- `project`: value of `bm_project`
- `directory`: value of `bm_directory`
- `tags`: `["session", "{project-tag}", "{work-type}"]`

Content sections (omit empty ones): **Summary** (1-3 sentences), **Decisions** (each with Why + Alternatives rejected), **Technical Findings** (specific field names, edge cases, error messages, actual values), **Problems and Solutions** (each with Root cause + Fix), **Context for Next Session** (unfinished work, next steps, blockers).

Focus on reasoning, discoveries, and specifics. Do NOT include file lists, diff stats, or obvious info from git history.

### Check for duplicates

Before writing, search Basic Memory with `mcp__basic-memory__search_notes` for notes with today's date and similar topic in the same directory. If a match exists, append a new section with `mcp__basic-memory__edit_note` instead of creating a duplicate.

## Step 3: Create Obsidian Session Note

### Choose file name

| Session type | Pattern | Example |
|---|---|---|
| Ticket work | `{TICKET-ID} brief-description.md` | `PROJ-1234 fix-auth-redirect.md` |
| Refactor/feature | `{type}-{description}.md` (kebab) | `refactor-config-loader.md` |
| Investigation | `Investigation {TICKET-ID}.md` | `Investigation PROJ-5678.md` |
| General | `YYYY-MM-DD Session {description}.md` | `2026-03-22 Session auth-flow-cleanup.md` |

### Check for existing note

Search the target folder (use the tree scan from Step 0) for a file matching the
same ticket ID or topic. If found, **append** a new session section (with a
horizontal rule separator and date header) instead of creating a new file.

### Compose the note

**Omit any section that would be empty.** No emojis. English only.

Frontmatter:

```yaml
---
date: YYYY-MM-DD
tags: [session-note, {project-tag}, {work-type}]
---
```

- `{project-tag}`: lowercase project name (e.g., `webapp`, `api-gateway`, `design-system`)
- `{work-type}`: one of `refactor`, `bugfix`, `feature`, `investigation`, `config`, `docs`

Header: `# {Title}` followed by **Date**, **Branch**, **PR**, **Commit** (git fields only when present in session context).

Body sections: **What Was Done** (2-5 bullets), **Files Modified** (path + what changed), **Key Decisions** (decision + rationale), **Open Items** (checkbox tasks), **Key Notes** (gotchas, surprising findings).

### Write the note

Write directly using the Write tool to `.notes/{vault_folder}/{filename}`. When
appending to an existing note, read the file first, then write the full content
with the new section appended (prefixed with `\n---\n\n` as separator).

Do NOT use the `obsidian` CLI. It creates empty ghost notes due to installer version issues.

## Rules

- Execute all three steps in order. Pause only for folder selection in Step 0.
- Be concise in auto-memory updates. Be detailed in Basic Memory notes.
- **Trivial session flow:** Step 1 always runs (report "nothing to update" if
  trivial). Step 2 runs only if BM is available AND session had meaningful
  findings. Step 3 always runs (requires `.notes/`).
