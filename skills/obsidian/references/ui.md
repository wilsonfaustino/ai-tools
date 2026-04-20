# User Interface Reference

## Appearance

### Themes

Settings > Appearance > Themes > Browse themes.

Community themes replace the default CSS entirely. After installing, select the
theme from the dropdown. Active theme is stored in `.obsidian/appearance.json`.

### Fonts

Settings > Appearance:
- **Interface font**: UI controls, sidebar
- **Text font**: note body
- **Monospace font**: code blocks and inline code

Enter any font installed on the system. Leave blank to use the theme default.

### Accent Color

Settings > Appearance > Accent color. Affects checkboxes, links, highlights, and
interactive elements across the UI.

### CSS Snippets

Small CSS files dropped into `.obsidian/snippets/`. Toggle per-snippet in
Settings > Appearance > CSS snippets.

Common use cases:

```css
/* Wider readable line width */
.markdown-preview-view,
.markdown-source-view.mod-cm6 .cm-contentContainer {
  max-width: 900px;
  margin: 0 auto;
}
```

```css
/* Custom callout color */
.callout[data-callout="custom"] {
  --callout-color: 120, 80, 200;
  --callout-icon: lucide-star;
}
```

```css
/* Hide frontmatter in reading view */
.markdown-preview-view .metadata-container {
  display: none;
}
```

```css
/* Make headers colorful */
.markdown-preview-view h1 { color: var(--color-red); }
.markdown-preview-view h2 { color: var(--color-orange); }
.markdown-preview-view h3 { color: var(--color-yellow); }
```

Place each snippet as its own `.css` file in `.obsidian/snippets/`. Example:

```
.obsidian/snippets/
├── wide-view.css
├── custom-callouts.css
└── colored-headers.css
```

## Drag and Drop

- Drag a file from the File Explorer into a note to create an embed or link.
- Hold `Ctrl/Cmd` while dropping to insert a link instead of an embed.
- Drag tabs to reorder or move to a different split.

## Hotkeys

Settings > Hotkeys. Search by command name. Click the `+` to add a binding.
Custom bindings are stored in `.obsidian/hotkeys.json`.

## Language Settings

Settings > General > Language. Requires restart. Affects UI labels, not note
content.

## Pop-out Windows

Right-click a tab > "Open in new window". Each pop-out is an independent window
with its own editor. Useful for side-by-side editing on multiple monitors.

## Ribbon

Left vertical icon bar. Toggle icons in Settings > Appearance > Ribbon commands.
Drag icons to reorder. Some plugins add their own icons.

## Settings Navigation

`Cmd/Ctrl+,` opens Settings. Navigate sections in the left panel:
- Editor, Files & links, Appearance, Hotkeys, Core plugins, Community plugins,
  then installed plugin settings below.

## Sidebar

- **Left sidebar**: File Explorer, Search, Bookmarks, Tags View (when enabled).
- **Right sidebar**: Backlinks, Outgoing Links, Outline, Properties (when enabled).

Toggle sidebars:
- Left: `Cmd/Ctrl+[`
- Right: `Cmd/Ctrl+]`

Click the `>` chevron icons at the top of each sidebar to expand/collapse.

## Status Bar

Bottom of the window. Shows:
- Word / character count (Word Count plugin)
- Sync status (Obsidian Sync)
- Vim mode indicator (if Vim mode enabled)
- Plugin-specific info

## Tabs

- Open new tab: `Cmd/Ctrl+T`
- Close tab: `Cmd/Ctrl+W`
- Cycle tabs: `Ctrl+Tab` / `Ctrl+Shift+Tab`
- Split right: command palette "Split right"
- Split down: command palette "Split down"
- Pin tab: right-click tab > Pin
- Stacked tabs: View menu > Toggle stacked tabs (tabs stack like cards, slide left/right)

## Workspace Save / Restore

Command palette:
- "Save current workspace layout as..." (saves with a name)
- "Load workspace layout..." (restores a saved layout)
- "Manage workspaces" (list, rename, delete saved workspaces)

Good for switching between reading mode (note + outline) and writing mode
(editor + graph).
