# Web Clipper Reference

Obsidian Web Clipper is a browser extension for clipping web pages into the vault.
Available for Chrome, Firefox, Safari, and Edge.
Install from the browser's extension store, then configure in the extension popup.

## Clipping Modes

| Mode | Description |
|---|---|
| Clip page | Save the full page content as Markdown |
| Highlight | Select text on the page to clip just that selection |
| Interpret | Use AI to extract structured data from the page |

## Template Variables

Use these in the note template to pull data from the clipped page:

| Variable | Value |
|---|---|
| `{{title}}` | Page title |
| `{{url}}` | Full URL of the page |
| `{{date}}` | Clip date (format set in settings) |
| `{{content}}` | Full page body as Markdown |
| `{{author}}` | Author name (from meta tags) |
| `{{description}}` | Meta description |
| `{{image}}` | OG image URL |
| `{{published}}` | Publication date (from meta tags) |
| `{{domain}}` | Domain name only (e.g., `example.com`) |
| `{{highlights}}` | All highlighted text, each as a blockquote |
| `{{excerpt}}` | Selected text if using highlight mode |

## Filters

Apply filters to variables with the pipe syntax: `{{variable|filter}}`.

| Filter | Example | Result |
|---|---|---|
| `replace("a","b")` | `{{title\|replace(":","-")}}` | Replace colons with hyphens |
| `trim` | `{{description\|trim}}` | Strip leading/trailing whitespace |
| `upper` | `{{domain\|upper}}` | EXAMPLE.COM |
| `lower` | `{{title\|lower}}` | lowercased title |
| `slice(0,50)` | `{{description\|slice(0,50)}}` | First 50 characters |
| `date("YYYY-MM-DD")` | `{{published\|date("YYYY-MM-DD")}}` | Format a date |

Chain filters: `{{title|lower|replace(" ","-")}}` produces a slug.

## Logic: Conditionals and Loops

```
{% if author %}
author: {{author}}
{% endif %}
```

```
{% for highlight in highlights %}
> {{highlight}}
{% endfor %}
```

### Default Fallbacks

```
{{author | default("Unknown")}}
```

## Example Templates

### Article Clip

```markdown
---
title: "{{title}}"
url: {{url}}
date: {{date}}
author: "{{author | default("Unknown")}}"
description: "{{description | trim | slice(0,150)}}"
tags:
  - clip
  - reading
---

# {{title}}

> Source: [{{domain}}]({{url}})
{% if author %} | Author: {{author}}{% endif %}
{% if published %} | Published: {{published | date("YYYY-MM-DD")}}{% endif %}

---

{{content}}
```

### Research Highlight Clip

```markdown
---
title: "{{title}}"
url: {{url}}
date: {{date}}
tags:
  - research
  - highlight
---

# {{title}}

Source: {{url}}

## Highlights

{% for highlight in highlights %}
> {{highlight}}

{% endfor %}
```

### Minimal Bookmark

```markdown
---
title: "{{title}}"
url: {{url}}
date: {{date}}
tags:
  - bookmark
---

[{{title}}]({{url}})

{{description}}
```

## Interpret Mode (AI Extraction)

In Interpret mode, the extension uses a connected AI model to extract structured
data. Configure the AI provider (OpenAI, Anthropic, or local model) in the
extension settings.

Use a template like:

```markdown
---
title: "{{title}}"
url: {{url}}
date: {{date}}
---

{{content}}
```

Then describe to the AI what to extract (e.g., "Extract the key claims, author
affiliation, and publication date"). The result populates `{{content}}`.

## Settings

- **Vault**: which Obsidian vault to save to
- **Note location**: folder for clipped notes
- **Note name**: template for the filename (e.g., `{{date}} {{title|slice(0,50)}}`)
- **AI provider**: for Interpret mode
- **Date format**: Moment.js format string (e.g., `YYYY-MM-DD`)
