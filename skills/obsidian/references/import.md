# Importing Notes Reference

Use the **Importer** community plugin (by Obsidian) to migrate from other apps.
Install via Settings > Community plugins > Browse > search "Importer".

## Apple Notes

- **Plugin**: Importer
- **Method**: Export from Apple Notes as `.enex` (via Files app or script), then import.
- **Preserves**: note content, creation/modification dates, folder structure
- **Limitations**: Checklist items become plain lists. Handwriting/drawings not imported. Shared notes lose collaboration metadata.

## Bear

- **Plugin**: Importer
- **Method**: Export from Bear as Bear Note format (`.bearnote`) or Markdown, then import.
- **Preserves**: tags, links, images, creation dates
- **Limitations**: Bear's hashtag-as-folder structure maps to Obsidian tags but not folders automatically.

## Craft

- **Plugin**: Importer
- **Method**: Export from Craft as Markdown zip, then import.
- **Preserves**: text, links, images
- **Limitations**: Block-based formatting (columns, callouts) may not translate cleanly.

## Evernote

- **Plugin**: Importer
- **Method**: Export from Evernote as `.enex`, then import.
- **Preserves**: notes, notebooks (as folders), tags, attachments, creation dates
- **Limitations**: Web clips may have messy HTML. Encrypted notes cannot be imported. Some Rich Text formatting is lost.

## Google Keep

- **Plugin**: Importer
- **Method**: Use Google Takeout to export Keep as `.json`, then import.
- **Preserves**: note content, labels, colors (as tags), timestamps
- **Limitations**: Archived/trashed notes included in export. Colors become tags, not visual colors.

## OneNote

- **Plugin**: Importer
- **Method**: Export OneNote notebooks to `.docx` via OneNote desktop, convert to Markdown (use Pandoc or the Importer plugin), then import.
- **Preserves**: text, images, headings
- **Limitations**: Tables may not convert cleanly. Audio/video not imported. Page structure is flattened to Markdown headings.

## Notion

- **Plugin**: Importer
- **Method**: Export Notion workspace as Markdown & CSV (Settings > Export), then import.
- **Preserves**: pages, subpages (as folders), text content, basic formatting
- **Limitations**: Databases import as CSV or simple tables. Relations and rollups are not preserved. Comments are lost. Notion formulas do not transfer.

## Roam Research

- **Plugin**: Importer
- **Method**: Export from Roam as Markdown, then import.
- **Preserves**: pages, blocks, tags, daily notes
- **Limitations**: `[[Page Name]]` links convert to Obsidian wikilinks. Block references (`((block-id))`) do not resolve. Nested bullet structure is preserved.

## CSV

- **Plugin**: Importer
- **Method**: Import CSV as a single note with a table, or process with a script to generate one note per row.
- **Preserves**: structured data
- **Limitations**: No automatic note-per-row support in the Importer; use a script or the Bases plugin to work with CSV data.

## HTML

- **Plugin**: Importer (or Pandoc)
- **Method**: Convert HTML to Markdown. Importer handles single HTML files. For bulk, use Pandoc: `pandoc -f html -t markdown input.html -o output.md`
- **Preserves**: headings, paragraphs, links, images
- **Limitations**: Complex layouts (multi-column, floats) collapse. JavaScript-rendered content not captured.

## Markdown (from other apps)

- **Method**: Copy `.md` files directly into the vault folder. Obsidian will detect them immediately.
- **Preserves**: everything that is valid Obsidian Markdown
- **Limitations**: App-specific syntax (e.g., Notion's `/` commands, Roam's block references) may appear as literal text.

## Textbundle

- **Plugin**: Importer
- **Method**: Import `.textbundle` or `.textpack` archives directly.
- **Preserves**: note text and attachments in a self-contained bundle

## Zettelkasten Notes

- **Method**: Copy `.md` files to the vault. Numeric IDs in filenames are preserved as-is.
- **Tip**: Use the Unique Note Creator core plugin for future notes.
- **Preserves**: everything valid in Markdown

## Apple Journal

- **Method**: Export via Apple Journal's export feature (`.pdf` or JSON via Shortcuts), then process.
- **Limitations**: No direct Importer support as of 2025. Use a custom Shortcut or script to extract entries to Markdown.

---

## Post-Import Checklist

1. Check for unresolved links in Outgoing Links panel.
2. Review imported tags in Tags View.
3. Use Search to find any `((block-ref))` or `${formula}` syntax that did not convert.
4. Consolidate duplicate notes if the source app had duplicates.
5. Set up Daily Notes template if migrating daily journals.
