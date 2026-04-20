# Obsidian Publish Reference

Obsidian Publish is a paid hosting service for sharing vaults as websites.
Manage via Settings > Obsidian Publish (requires active subscription).

## Setup

1. Settings > Obsidian Publish > Create new site.
2. Choose a site ID (appears in URL: `publish.obsidian.md/your-site-id`).
3. Select which notes to publish from the publish dialog.
4. Click "Publish changes".

## Managing the Site

- **Publish dialog**: Cmd/Ctrl+Shift+P > "Publish changes". Shows a diff of new,
  changed, and deleted notes.
- **Unpublish**: select notes in the publish dialog and click "Unpublish".
- **Site settings**: Settings > Obsidian Publish > Manage sites (navigation, logo,
  favicon, theme, password).

## Customizing Appearance

### publish.css

Create a `publish.css` file at the vault root. It is applied to the published
site only (not the local editor).

```css
/* Example: custom body font */
body {
  font-family: "Georgia", serif;
}

/* Example: wider content */
.page-content {
  max-width: 900px;
}
```

### Navigation

In site settings, toggle options:
- Show navigation (left sidebar with vault structure)
- Show backlinks
- Show graph
- Show table of contents

### Logo and Favicon

Upload a `publish.png` (logo) and `publish-favicon.png` (favicon) to the vault
root. They are automatically used by the published site.

## Collaboration

Multiple Obsidian accounts can contribute to the same Publish site. Share access
via Settings > Obsidian Publish > Manage sites > Collaborators. Collaborators
can publish but not change site settings.

## Social Media Link Previews

Control Open Graph metadata for social sharing via frontmatter:

```yaml
---
title: My Article Title
description: A 150-character max description for search engines and social previews.
image: "https://publish.obsidian.md/your-site/attachments/og-image.png"
---
```

- `description`: used as OG description and meta description. Keep under 150 characters.
- `image`: full URL of the preview image. Must be publicly accessible.

## Media Files

Attach images and other files in the vault and reference them normally with
`![[image.png]]`. When published, attachments are uploaded automatically if they
are embedded in at least one published note.

## Analytics

Add analytics by creating a `publish.js` file at the vault root:

### Google Analytics

```js
(function() {
  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX';
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
})();
```

### Plausible Analytics

```js
(function() {
  var script = document.createElement('script');
  script.defer = true;
  script.dataset.domain = 'yourdomain.com';
  script.src = 'https://plausible.io/js/script.js';
  document.head.appendChild(script);
})();
```

## Custom Domains

1. Purchase a domain and set a CNAME record pointing to `publish-main.obsidian.md`.
2. In site settings > Custom domain, enter your domain.
3. Obsidian handles SSL automatically.

## Permalinks

Override the URL slug for a note via frontmatter:

```yaml
---
permalink: my-custom-slug
---
```

URL becomes `your-site.com/my-custom-slug`.

## SEO

```yaml
---
title: Full Article Title for SEO
description: Under 150 characters. Concise, accurate summary of page content.
---
```

- `title`: used as `<title>` and OG title.
- `description`: used as `<meta name="description">` and OG description.
- Canonical URLs are set automatically to the publish URL.
- Use `permalink` to create clean, readable URLs.

## Security and Privacy

### Password Protection

Set a password in site settings > Security. All visitors must enter the password
to view any page on the site.

### Private Notes

Notes not selected in the publish dialog are never uploaded, even if linked by
published notes (broken links appear as plain text).

To unpublish a note that was previously published: open the publish dialog,
select the note, click "Unpublish".

## Limitations

- No server-side search (search is client-side JS).
- No comments system (use a third-party embed like Giscus).
- No form handling.
- Community plugins do not run on the published site (core rendering only).
- Maximum file size for attachments: 100 MB per file.
- No database (`.base`) or canvas rendering on published sites as of 2025.
