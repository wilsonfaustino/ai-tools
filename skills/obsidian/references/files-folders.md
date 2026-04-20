# Files, Folders & Vault Archetypes Reference

## Supported File Formats

| Type | Extensions |
|---|---|
| Notes | `.md` |
| Database | `.base` |
| Canvas | `.canvas` |
| PDF | `.pdf` |
| Images | `.png` `.jpg` `.jpeg` `.gif` `.svg` `.webp` `.bmp` |
| Audio | `.mp3` `.wav` `.ogg` `.m4a` `.flac` |
| Video | `.mp4` `.webm` `.ogv` `.mov` `.mkv` |

## The `.obsidian/` Config Folder

Located at the vault root. Contents:

```
.obsidian/
├── app.json          # Core settings (editor, files, appearance)
├── appearance.json   # Theme, font, accent color
├── hotkeys.json      # Custom keybindings
├── workspace.json    # Saved workspace layout
├── plugins/          # Installed community plugins (each in own subfolder)
├── snippets/         # CSS snippet files (.css)
└── themes/           # Downloaded themes
```

## Core Concepts

- Every note is a plain `.md` file, readable without Obsidian.
- The vault is just a folder. Move it anywhere, back it up with any tool.
- No lock-in: markdown is an open standard.
- Symlinks inside the vault are supported.

---

## Vault Archetypes

### 1. Personal PKM (Personal Knowledge Management)

**Tree:**

```
vault/
├── Inbox/
├── Notes/
│   ├── Concepts/
│   ├── People/
│   └── Places/
├── Resources/
├── Journal/
│   └── 2025/
│       └── 2025-03-15.md
├── Maps/
└── Templates/
```

**Bash:**

```bash
mkdir -p vault/{Inbox,Notes/{Concepts,People,Places},Resources,Journal/2025,Maps,Templates}
```

---

### 2. Zettelkasten

**Tree:**

```
vault/
├── Fleeting/
├── Literature/
├── Permanent/
├── Index/
└── Templates/
```

**Bash:**

```bash
mkdir -p vault/{Fleeting,Literature,Permanent,Index,Templates}
```

Notes in `Permanent/` use atomic IDs (e.g., `202503150901.md`). `Index/` holds MOC notes that connect permanent notes by theme.

---

### 3. Second Brain (PARA)

PARA = Projects, Areas, Resources, Archives.

**Tree:**

```
vault/
├── Projects/
│   └── Launch Website/
├── Areas/
│   ├── Health/
│   ├── Finance/
│   └── Career/
├── Resources/
│   ├── Books/
│   ├── Articles/
│   └── Courses/
├── Archives/
│   └── 2024/
├── Inbox/
└── Templates/
```

**Bash:**

```bash
mkdir -p vault/{Projects/"Launch Website",Areas/{Health,Finance,Career},Resources/{Books,Articles,Courses},Archives/2024,Inbox,Templates}
```

---

### 4. Work / Team Vault

**Tree:**

```
vault/
├── Meetings/
│   └── 2025/
├── Projects/
├── Decisions/
├── Processes/
├── People/
├── Inbox/
└── Templates/
```

**Bash:**

```bash
mkdir -p vault/{Meetings/2025,Projects,Decisions,Processes,People,Inbox,Templates}
```

---

### 5. Content Creation

**Tree:**

```
vault/
├── Ideas/
├── Research/
├── Drafts/
├── Published/
├── Editorial Calendar/
├── Assets/
└── Templates/
```

**Bash:**

```bash
mkdir -p vault/{Ideas,Research,Drafts,Published,"Editorial Calendar",Assets,Templates}
```

---

### 6. Research Vault

**Tree:**

```
vault/
├── Literature/
│   ├── Papers/
│   └── Books/
├── Notes/
│   ├── Concepts/
│   └── Experiments/
├── MOC/
├── Data/
├── Writing/
│   ├── Drafts/
│   └── Submissions/
└── Templates/
```

**Bash:**

```bash
mkdir -p vault/{Literature/{Papers,Books},Notes/{Concepts,Experiments},MOC,Data,Writing/{Drafts,Submissions},Templates}
```
