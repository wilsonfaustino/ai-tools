# Bases Reference

Base files use the `.base` extension and contain YAML. Always produce complete,
valid `.base` YAML. Never a skeleton.

## Views

| View | Key | Description |
|---|---|---|
| Table | `table` | Spreadsheet-style rows and columns |
| Cards | `cards` | Card grid, good for visual browsing |
| List | `list` | Simple list with optional fields |
| Map | `map` | Geographic map (requires coordinates) |

## File Structure

```yaml
filters:
  type: and
  conditions: []

formulas: {}

display:
  properties: []

views:
  - type: table
    name: All Notes
    columns: []
```

## Filters

### Logical Operators

```yaml
filters:
  type: and          # all conditions must match
  conditions:
    - type: or       # nested: any of these
      conditions:
        - ...
    - type: not      # negate
      condition:
        - ...
```

### File Functions

```yaml
# Notes in a specific folder
- function: inFolder
  value: "Projects"

# By extension
- function: ext
  value: "md"

# By file name (contains)
- function: name
  value: "weekly"

# By full path
- function: path
  value: "Projects/Active"

# Created/modified time (ISO 8601)
- function: ctime
  operator: ">"
  value: "2025-01-01"

- function: mtime
  operator: "<"
  value: "2025-06-01"
```

### Tag and Link Filters

```yaml
# Has tag
- function: taggedWith
  value: "project"

# Links to a specific note
- function: linksTo
  value: "MOC/Projects"
```

### Property Comparisons

```yaml
# Text property
- property: status
  operator: "="
  value: "active"

# Number property
- property: priority
  operator: ">="
  value: 2

# Boolean
- property: published
  operator: "="
  value: true

# Date
- property: due
  operator: "<"
  value: "2025-12-31"

# Operators: = != < > <= >= contains startsWith endsWith
```

## Formulas

Formulas run on each row and produce a computed property. Access them as `formula.name`.

### Arithmetic

```yaml
formulas:
  profit_margin: "(revenue - cost) / revenue * 100"
```

### String Functions

```yaml
formulas:
  full_label: "concat(upper(status), ' - ', title)"
  # Functions: concat, upper, lower, contains, startsWith, endsWith
```

### Date Functions

```yaml
formulas:
  days_until_due: "(date(due) - now()) / 86400000"
  formatted_date: "datetime.format(created, 'MMM D, YYYY')"
```

### Conditional

```yaml
formulas:
  priority_label: "if(priority >= 3, 'High', if(priority = 2, 'Medium', 'Low'))"
```

### List Functions

```yaml
formulas:
  tag_count: "length(tags)"
  first_tag: "tags[0]"
```

## Property Access

| Source | Syntax |
|---|---|
| Frontmatter property | `propertyName` |
| File name | `file.name` |
| File path | `file.path` |
| Created time | `file.ctime` |
| Modified time | `file.mtime` |
| File size | `file.size` |
| Formula property | `formula.myFormulaName` |

## Display Block

Controls which properties appear and in what order:

```yaml
display:
  properties:
    - name: title
      visible: true
    - name: status
      visible: true
    - name: due
      visible: true
    - name: formula.priority_label
      visible: true
```

## Example: Project Notes Base

```base
filters:
  type: and
  conditions:
    - function: taggedWith
      value: "project"
    - property: status
      operator: "!="
      value: "done"

formulas:
  days_since_modified: "(now() - file.mtime) / 86400000"

display:
  properties:
    - name: title
      visible: true
    - name: status
      visible: true
    - name: due
      visible: true
    - name: formula.days_since_modified
      visible: true
    - name: tags
      visible: true

views:
  - type: table
    name: Active Projects
    columns:
      - property: title
      - property: status
      - property: due
      - property: formula.days_since_modified
  - type: cards
    name: Card View
    properties:
      - title
      - status
      - due
```

## Example: Multi-View Dashboard

```base
filters:
  type: and
  conditions:
    - function: inFolder
      value: "Projects"

formulas:
  progress_pct: "if(total_tasks > 0, completed_tasks / total_tasks * 100, 0)"
  status_label: "if(formula.progress_pct >= 100, 'Complete', if(formula.progress_pct >= 50, 'In Progress', 'Just Started'))"

display:
  properties:
    - name: title
      visible: true
    - name: status
      visible: true
    - name: due
      visible: true
    - name: completed_tasks
      visible: true
    - name: total_tasks
      visible: true
    - name: formula.progress_pct
      visible: true
    - name: formula.status_label
      visible: true

views:
  - type: table
    name: All Projects
    columns:
      - property: title
      - property: status
      - property: due
      - property: formula.progress_pct
      - property: formula.status_label
  - type: cards
    name: Project Cards
    properties:
      - title
      - status
      - formula.status_label
  - type: list
    name: Quick List
    properties:
      - title
      - due
```
