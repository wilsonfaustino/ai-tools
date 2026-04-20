# Core Plugins Reference

All core plugins ship with Obsidian and are toggled in Settings > Core plugins.

## Audio Recorder

Record audio directly into the vault. Creates a `.webm` file linked into the
current note. Hotkey: set in Settings > Hotkeys.

## Backlinks

Shows all notes that link to the current note. Toggle in right sidebar. Also
surfaces unlinked mentions (text that matches the note name but is not a link).

## Bookmarks

Save notes, headings, searches, and graph states as bookmarks. Access from the
left ribbon or via command palette.

## Canvas

Creates `.canvas` files for visual thinking. See `references/canvas.md` for
the full schema and examples.

## Command Palette

Open with `Cmd/Ctrl+P`. Fuzzy-search all available commands. Can be used to
trigger any plugin action without knowing the hotkey.

## Daily Notes

Creates a new note each day from a template. Configure:

- **Date format**: `YYYY-MM-DD` (uses Moment.js format)
- **New file location**: folder for daily notes
- **Template file**: path to a template note

Open today's note via the ribbon or command palette.

## File Explorer

Left sidebar file tree. Drag to reorder, right-click for context menu (rename,
move, delete, reveal in Finder/Explorer).

## File Recovery

Snapshots notes periodically. Recover previous versions via
Settings > File Recovery > View snapshots.

## Format Converter

Converts other markdown formats (e.g., `[[link]]` to `[link](link.md)`) to
Obsidian's format. One-time migration tool.

## Graph View

**Local graph** (`Cmd+Shift+G` or right sidebar): links of current note.
**Global graph** (`Cmd+G`): entire vault.

Controls:
- Filter by path, tag, or property
- Adjust node size by number of connections
- Color-code by group
- Enable arrows for link direction

## Note Composer

Merge notes together or extract a selection to a new note. Right-click selection
or use command palette: "Extract current selection" / "Merge entire file with..."

## Outgoing Links

Right sidebar panel showing all links from the current note, including unresolved
links (broken links shown in red).

## Outline

Right sidebar panel showing the heading hierarchy of the current note. Click any
heading to jump to it.

## Page Preview

Hover over an internal link while holding `Ctrl/Cmd` to see a preview of the
linked note without opening it.

## Properties View

Shows all properties (frontmatter) in a structured UI above the note body (in
Live Preview). Also adds a global properties search in the left sidebar.

## Quick Switcher

`Cmd/Ctrl+O`: fuzzy search to open any note by name. Type `#tag` to filter
by tag, or `[[` to filter by link.

## Random Note

Opens a random note from the vault. Useful for review and serendipity.

## Search

`Cmd/Ctrl+Shift+F`: full-text search with operators:

| Operator | Example | Matches |
|---|---|---|
| `path:` | `path:Projects` | Notes in a path |
| `tag:` | `tag:#project` | Notes with tag |
| `file:` | `file:meeting` | Notes by filename |
| `line:` | `line:(todo done)` | Line contains both words |
| `block:` | `block:idea` | Block contains word |
| `section:` | `section:summary` | Section contains word |
| `content:` | `content:budget` | Note body (excludes filename) |
| `/regex/` | `/\d{4}-\d{2}/` | Regular expression |

Combine with `AND`, `OR`, `-` (NOT). Wrap phrases in quotes.

```
tag:#project AND status:active
path:Projects -tag:#archived
file:weekly /2025-\d{2}/
```

## Slash Commands

Type `/` in a note to trigger a command menu for inserting elements
(callouts, templates, code blocks, etc.). Enable in Settings > Core plugins.

## Slides

Present any note as a slideshow. Separate slides with `---`. Open via command
palette: "Start presentation".

## Tags View

Left sidebar panel listing all tags in the vault with note counts. Click a tag
to search for it.

## Templates

Insert template snippets into the current note.

Configure in Settings > Templates:
- **Template folder location**: folder containing template notes

**Available tokens:**

| Token | Replaced with |
|---|---|
| `{{title}}` | Current note title |
| `{{date}}` | Current date (format set in settings) |
| `{{time}}` | Current time (format set in settings) |

Example template:

```markdown
---
date: {{date}}
created: {{date}} {{time}}
tags: []
---

# {{title}}

## Summary

## Notes
```

## Unique Note Creator

Creates a note with a timestamp-based unique ID as the filename
(e.g., `202503150901.md`). Configure prefix and template. Good for Zettelkasten.

## Web Viewer

Browse URLs inside Obsidian. Open via command palette: "Open URL in Web Viewer".
Supports bookmarks and history within the viewer.

## Word Count

Status bar shows word and character count for the current note.
Command palette: "Show statistics" for document-level breakdown.

## Workspaces

Save and restore the entire window layout (open notes, sidebar state, panel
positions). Save via command palette: "Manage workspaces". Useful for switching
between contexts (writing mode, research mode).
