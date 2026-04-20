# Linking Notes & Files Reference

## Internal Links (Wikilinks)

```markdown
[[Note Title]]
[[Note Title#Heading]]
[[Note Title^block-id]]
[[Note Title|Display Text]]
[[Note Title#Heading|Display Text]]
[[Note Title^block-id|Display Text]]
```

- Links resolve by note name across the entire vault, regardless of folder.
- Heading links use the exact heading text after `#`.
- Block links use the block ID after `^`. Create a block ID by typing `^my-id` at the end of a paragraph.

## Aliases

### Inline alias (one-off)

```markdown
[[Real Note Name|What I want to display]]
```

### Frontmatter aliases (reusable)

```yaml
---
aliases:
  - Short Name
  - Alternative Phrasing
---
```

Once set, `[[Short Name]]` resolves to this note automatically.

## Embeds

```markdown
![[Note Title]]
![[Note Title#Heading]]
![[Note Title^block-id]]
![[image.png|500]]
![[audio.mp3]]
![[video.mp4]]
![[document.pdf]]
```

Embeds render the content of the linked note or file inline. The `|500` sets display width for images.

## External Links

```markdown
[Link text](https://example.com)
[Link text](https://example.com "Tooltip text")
```

## Backlinks

Obsidian automatically tracks every note that links to the current note. View them in the Backlinks panel (core plugin). Unlinked mentions are also surfaced there.

## Creating Block IDs

To create a linkable block, add a unique ID at the end of a paragraph:

```markdown
This is the paragraph I want to link to. ^my-unique-id
```

Then reference it from another note:

```markdown
[[Source Note^my-unique-id]]
![[Source Note^my-unique-id]]
```

## Graph View Notes

- **Local Graph**: shows only notes directly linked to the current note (right sidebar or Cmd+Shift+G).
- **Global Graph**: full vault link map (Ctrl/Cmd+G).
- Filter by tag, folder, or path in the graph search box.
