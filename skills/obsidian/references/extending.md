# Extending Obsidian Reference

## Community Plugins

Community plugins are third-party extensions distributed through the Obsidian
community plugin registry.

### Enable Community Plugins

Settings > Community plugins > Turn off Restricted mode.

> Restricted mode (safe mode) blocks all community plugins. Disable it to
> install third-party plugins. Review any plugin before installing.

### Install a Plugin

1. Settings > Community plugins > Browse.
2. Search by name.
3. Click the plugin > Install > Enable.

### Update Plugins

Settings > Community plugins > Check for updates. Update individually or click
"Update all".

### Plugin Security

Community plugins run arbitrary JavaScript with full access to the vault and
file system. Only install plugins that are:
- Open source (audit the code on GitHub if concerned)
- Actively maintained
- Listed in the official community registry

Avoid plugins asking for external API keys unless you understand what they send.

---

## Themes

Settings > Appearance > Themes > Browse themes.

Themes modify the CSS for the entire UI. After installing, select from the
dropdown. The selected theme is stored in `.obsidian/appearance.json`.

### Installing a Theme Manually

1. Download the `theme.css` file from the theme's GitHub repo.
2. Place it in `.obsidian/themes/<ThemeName>/theme.css`.
3. Select the theme in Settings > Appearance.

---

## CSS Snippets

Small CSS files in `.obsidian/snippets/`. Each file is toggled independently in
Settings > Appearance > CSS snippets.

### Common Snippet Patterns

```css
/* Wide readable line length */
.markdown-preview-view,
.markdown-source-view.mod-cm6 .cm-contentContainer {
  max-width: 900px;
  margin: 0 auto;
}
```

```css
/* Custom callout with a specific color */
.callout[data-callout="custom-type"] {
  --callout-color: 80, 160, 255;
  --callout-icon: lucide-info;
}
```

```css
/* Styled checkbox states */
.markdown-preview-view input[type="checkbox"]:checked + span {
  text-decoration: line-through;
  opacity: 0.6;
}
```

```css
/* Colorize heading levels */
.markdown-preview-view h1 { color: var(--color-red); }
.markdown-preview-view h2 { color: var(--color-orange); }
.markdown-preview-view h3 { color: var(--color-yellow); }
```

---

## Obsidian URI Protocol

Open, create, and search notes from external apps or scripts using the
`obsidian://` URI scheme.

### Open a Note

```
obsidian://open?vault=My%20Vault&file=Notes%2FMy%20Note
```

Parameters:
- `vault`: vault name (URL-encoded)
- `file`: vault-relative path without `.md`, URL-encoded

### Create or Overwrite a Note

```
obsidian://new?vault=My%20Vault&file=Inbox%2FNew%20Note&content=Hello%20world
```

Parameters:
- `file`: path for the new note
- `content`: URL-encoded note body
- `append=true`: append to existing note instead of overwriting

### Search the Vault

```
obsidian://search?vault=My%20Vault&query=tag%3Aproject
```

### Hook Integration (hook-get-address)

```
obsidian://hook-get-address
```

Returns the URI of the currently open note. Used by the Hook productivity app.

---

## Obsidian CLI

The Obsidian CLI (`obsidian-cli`) is a third-party open-source tool for
interacting with vaults from the terminal.

### Install

```bash
npm install -g obsidian-cli
```

### Common Commands

```bash
# List all notes in a vault
obsidian-cli list --vault ~/Documents/MyVault

# Search notes
obsidian-cli search "project review" --vault ~/Documents/MyVault

# Create a note
obsidian-cli create "New Note" --vault ~/Documents/MyVault --content "# New Note"

# Open a note in Obsidian
obsidian-cli open "Daily Notes/2025-03-15" --vault ~/Documents/MyVault
```

Note: the CLI uses the Obsidian Local REST API plugin (community plugin) as its
backend. Install and enable that plugin before using the CLI.

---

## Obsidian Headless

Obsidian Headless is an unofficial approach to running Obsidian without a GUI,
primarily used for automated testing or script-driven note generation.

As of 2025, Obsidian does not have an official headless mode. Common approaches:
- Use the Local REST API community plugin for HTTP-based note CRUD.
- Use direct file system operations (`.md` files are plain text).
- Use the Obsidian URI scheme invoked from scripts.

For production automation, direct file system operations are the most reliable
approach since they do not require a running Obsidian instance.
