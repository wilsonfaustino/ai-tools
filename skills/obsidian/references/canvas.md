# Canvas Reference

Canvas files use the `.canvas` extension and contain JSON. They are always complete,
valid JSON. Never a description or skeleton.

## File Structure

```json
{
  "nodes": [],
  "edges": []
}
```

## Node Schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique within the file, e.g. `"node1"` |
| `type` | string | yes | `"text"`, `"file"`, `"link"`, `"group"` |
| `x` | number | yes | X position in canvas coordinate space |
| `y` | number | yes | Y position |
| `width` | number | yes | Width in pixels |
| `height` | number | yes | Height in pixels |
| `color` | string | no | `"1"` through `"6"` (Obsidian palette) |
| `text` | string | text nodes | Markdown content |
| `file` | string | file nodes | Vault-relative path, e.g. `"Notes/My Note.md"` |
| `url` | string | link nodes | Full URL |
| `label` | string | group nodes | Group label |

## Edge Schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique within the file |
| `fromNode` | string | yes | Node ID |
| `toNode` | string | yes | Node ID |
| `fromSide` | string | no | `"top"`, `"right"`, `"bottom"`, `"left"` |
| `toSide` | string | no | Same options |
| `label` | string | no | Edge label |
| `color` | string | no | `"1"` through `"6"` |

## Color Palette

| Value | Color |
|---|---|
| `"1"` | Red |
| `"2"` | Orange |
| `"3"` | Yellow |
| `"4"` | Green |
| `"5"` | Cyan |
| `"6"` | Purple |

## Layout Strategies

- **Swim lane**: nodes in horizontal rows by stage, edges flow left-to-right
- **Topic cluster**: central node, satellite nodes radiate outward
- **Pipeline**: linear sequence, each step feeds the next
- **Hierarchical**: root at top, branches downward

## Example: Content Creation Pipeline

```canvas
{
  "nodes": [
    {
      "id": "idea",
      "type": "text",
      "x": 0,
      "y": 0,
      "width": 200,
      "height": 80,
      "color": "3",
      "text": "## Idea\nCapture raw concept"
    },
    {
      "id": "research",
      "type": "text",
      "x": 280,
      "y": 0,
      "width": 200,
      "height": 80,
      "color": "5",
      "text": "## Research\nGather sources"
    },
    {
      "id": "outline",
      "type": "text",
      "x": 560,
      "y": 0,
      "width": 200,
      "height": 80,
      "color": "5",
      "text": "## Outline\nStructure the piece"
    },
    {
      "id": "draft",
      "type": "text",
      "x": 840,
      "y": 0,
      "width": 200,
      "height": 80,
      "color": "4",
      "text": "## Draft\nWrite first version"
    },
    {
      "id": "review",
      "type": "text",
      "x": 1120,
      "y": 0,
      "width": 200,
      "height": 80,
      "color": "2",
      "text": "## Review\nEdit and refine"
    },
    {
      "id": "publish",
      "type": "text",
      "x": 1400,
      "y": 0,
      "width": 200,
      "height": 80,
      "color": "4",
      "text": "## Publish\nRelease to audience"
    }
  ],
  "edges": [
    {
      "id": "e1",
      "fromNode": "idea",
      "toNode": "research",
      "fromSide": "right",
      "toSide": "left"
    },
    {
      "id": "e2",
      "fromNode": "research",
      "toNode": "outline",
      "fromSide": "right",
      "toSide": "left"
    },
    {
      "id": "e3",
      "fromNode": "outline",
      "toNode": "draft",
      "fromSide": "right",
      "toSide": "left"
    },
    {
      "id": "e4",
      "fromNode": "draft",
      "toNode": "review",
      "fromSide": "right",
      "toSide": "left"
    },
    {
      "id": "e5",
      "fromNode": "review",
      "toNode": "publish",
      "fromSide": "right",
      "toSide": "left"
    }
  ]
}
```

## Example: Topic Cluster

```canvas
{
  "nodes": [
    {
      "id": "center",
      "type": "text",
      "x": 400,
      "y": 300,
      "width": 200,
      "height": 80,
      "color": "6",
      "text": "## Main Topic"
    },
    {
      "id": "n1",
      "type": "text",
      "x": 0,
      "y": 100,
      "width": 180,
      "height": 60,
      "text": "Subtopic A"
    },
    {
      "id": "n2",
      "type": "text",
      "x": 0,
      "y": 500,
      "width": 180,
      "height": 60,
      "text": "Subtopic B"
    },
    {
      "id": "n3",
      "type": "text",
      "x": 820,
      "y": 100,
      "width": 180,
      "height": 60,
      "text": "Subtopic C"
    },
    {
      "id": "n4",
      "type": "text",
      "x": 820,
      "y": 500,
      "width": 180,
      "height": 60,
      "text": "Subtopic D"
    }
  ],
  "edges": [
    { "id": "e1", "fromNode": "center", "toNode": "n1" },
    { "id": "e2", "fromNode": "center", "toNode": "n2" },
    { "id": "e3", "fromNode": "center", "toNode": "n3" },
    { "id": "e4", "fromNode": "center", "toNode": "n4" }
  ]
}
```

## Linking to Vault Notes in Canvas

Use `"type": "file"` with the vault-relative path:

```json
{
  "id": "note1",
  "type": "file",
  "x": 0,
  "y": 0,
  "width": 400,
  "height": 300,
  "file": "Projects/Website Launch.md"
}
```
