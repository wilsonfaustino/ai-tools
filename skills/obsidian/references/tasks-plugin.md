# Tasks Plugin Reference

> This is a COMMUNITY plugin (third-party, not built into Obsidian).
> Install via Settings > Community plugins > Browse > search "Tasks".
> Developed by the Obsidian Tasks Group. GitHub: obsidian-tasks-group/obsidian-tasks

## Task Syntax

Tasks are standard Obsidian checkboxes extended with emoji-based metadata.

```markdown
- [ ] Write weekly review 📅 2025-03-15 🔁 every week ⏫
- [ ] Submit expense report 📅 2025-03-20 🔼
- [x] Deploy to staging ✅ 2025-03-14
```

## Emoji Fields

| Emoji | Field | Example |
|---|---|---|
| `📅` | Due date | `📅 2025-03-15` |
| `⏳` | Scheduled date | `⏳ 2025-03-10` |
| `🛫` | Start date | `🛫 2025-03-01` |
| `🔁` | Recurrence | `🔁 every week` |
| `⏫` | Highest priority | |
| `🔼` | High priority | |
| `🔽` | Low priority | |
| `➕` | Created date | `➕ 2025-03-01` |
| `✅` | Done date | `✅ 2025-03-14` |
| `❌` | Cancelled | |

## Recurrence Patterns

```markdown
🔁 every day
🔁 every 3 days
🔁 every week
🔁 every 2 weeks
🔁 every month
🔁 every month on the 1st
🔁 every year
🔁 every weekday
🔁 every Monday
🔁 every Monday and Thursday
```

## Query Blocks

Insert a tasks query block to filter and display tasks from across the vault:

````markdown
```tasks
not done
due before 2025-04-01
```
````

## Filter Operators

```tasks
not done
done
done before 2025-03-15
due on 2025-03-15
due before next week
due after 2025-01-01
no due date
has due date
scheduled before today
starts after 2025-01-01
is recurring
is not recurring
priority is high
priority is not low
tags include #project
tags do not include #archive
description includes write
path includes Projects/
filename includes weekly
heading includes Review
```

## Sorting

```tasks
not done
sort by due
sort by priority
sort by created
sort by done
sort by description
```

## Grouping

```tasks
not done
group by due
group by priority
group by tags
group by path
group by heading
group by filename
```

## Display Options

```tasks
not done
limit 10
show urgency
hide due date
hide recurrence
hide edit button
short mode
```

## Example: Weekly Review Query

````markdown
```tasks
not done
due before next week
sort by due
sort by priority
group by path
```
````

## Example: All High-Priority Tasks

````markdown
```tasks
not done
priority is high
sort by due
```
````

## Example: Tasks Due Today

````markdown
```tasks
not done
due on today
sort by priority
```
````

## Example: Overdue Tasks

````markdown
```tasks
not done
due before today
sort by due
group by path
```
````

## Example: Scheduled for This Week

````markdown
```tasks
not done
scheduled after last week
scheduled before next week
sort by scheduled
```
````

## Example: Project-Tagged Tasks Not Done

````markdown
```tasks
not done
tags include #project
sort by due
sort by priority
group by tags
```
````

## Task Status Symbols

Beyond `[ ]` (todo) and `[x]` (done), the Tasks plugin supports custom statuses
configured in Settings > Tasks > Task Statuses:

| Symbol | Meaning |
|---|---|
| `[ ]` | Todo |
| `[x]` | Done |
| `[/]` | In Progress |
| `[-]` | Cancelled |
| `[>]` | Deferred |

Custom symbols must be configured in the plugin settings to be recognized.

## Completing Tasks

Click a checkbox in Live Preview or Reading view. The plugin automatically:
- Marks the task done with `[x]`
- Appends the done date (`✅ YYYY-MM-DD`)
- For recurring tasks, creates the next occurrence immediately below

## Global Query Filter

In Settings > Tasks > Global filter, set a tag (e.g., `#task`) to track only
explicitly tagged tasks rather than every checkbox in the vault.
