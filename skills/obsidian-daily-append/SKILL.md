---
name: obsidian-daily-append
description: >-
  Append a task item to today's Obsidian daily note from a PR URL or Jira
  ticket. Activate when the owner asks to append, add, log, or track an item
  in their daily tasks -- especially when they drop a GitHub PR URL or a Jira
  ticket key (like PROJ-123) with intent to track it, or to log any free-text
  task. Trigger phrases include "append this PR to my daily tasks", "add to
  daily", "log this PR for review", "track this ticket", "add this to my
  tasks", "add a task to my daily note", "log this to today". Do not trigger
  for general PR review requests that have no tracking intent.
---

# obsidian-daily-append

Append a task item to today's Obsidian daily note. Supports three item types:
GitHub PR (fetched via `gh` CLI), Jira ticket, and free-text.

The deterministic file work (gh fetch, indent detection, section walk,
insertion) is handled by `scripts/append_task.py`. The skill body owns
classification, section routing, and Jira metadata gathering -- the parts
that need judgment or owner confirmation. Keeping the model out of the
mechanical edit makes invocations cheap and predictable.

## Daily Note Location

```
/Users/wilsonfaustino/Library/Mobile Documents/iCloud~md~obsidian/Documents/dot/Daily Tasks/YYYY-MM-DD.md
```

Resolve today's date with: `date +%Y-%m-%d`

The script never creates the file and never modifies anything beyond the
single insertion line.

---

## Step 1 -- Classify the Item

First, check for a `--Section` flag in the input (see Step 3 for handling).
Strip the flag before classifying the remaining text.

Inspect the (flag-stripped) input:

- Contains `github.com/` -> **PR mode**
- Looks like a Jira key (`[A-Z]+-[0-9]+`, e.g. `PROJ-123`) -> **Ticket mode**
- Neither -> **Free-text mode**
- Genuinely ambiguous -> ask the owner which type before continuing

For ticket mode only, gather the missing metadata before invoking the
script. Check session context (prior `/rca` or jira-assistant calls) for:

- Ticket key (e.g. `PROJ-123`)
- Canonical ticket URL
- Severity (e.g. `P1`, `High`, `Critical` -- whatever the ticket shows)
- Short description (summary line from Jira)

If any field is missing, prompt the owner for it. Do not guess or leave a
placeholder like `<severity>` in the file -- the script will faithfully
write whatever you pass it.

PR mode and free-text mode need no model-side metadata work; the script
fetches PR data itself and passes free-text through verbatim.

---

## Step 2 -- Resolve the Section

### `--Section` flag (highest precedence)

If the input contains `--<word>` matching the table below (case-insensitive),
use that section directly. Strip the flag from the input before Step 1's
classification step.

| Flag (case-insensitive) | Section label |
|---|---|
| `--Syngenta` | `🌿 Syngenta` |
| `--Jaya` | `🦎 Jaya` |
| `--Home` | `🏠 Home` |
| `--Side-Projects` or `--SideProjects` | `Side Projects` |

When a valid flag is present, announce and proceed -- no confirmation needed:

> "Routing to <section label>. Writing now."

If the flag value does not match the table, stop and tell the owner:

> "Unknown section '--<value>'. Valid options: --Syngenta, --Jaya, --Home, --Side-Projects."

### Heuristic (no flag)

For a **PR**, check the GitHub org:
- Org is `syngenta-digital` -> `🌿 Syngenta` (announce and proceed, no confirmation)
- Otherwise -> apply keyword heuristics below and ask the owner to confirm

For a **Jira ticket**, apply keyword heuristics and ask the owner to confirm.

For **free-text**, skip heuristics and ask the owner which section to use.

| Keyword pattern in repo/ticket/description | Suggested section |
|---|---|
| `syngenta` | `🌿 Syngenta` |
| `jaya` | `🦎 Jaya` |
| `home`, `house`, `personal` | `🏠 Home` |
| other / side project | `Side Projects` |

When confirming:

> "I'd put this under **<suggested section>**. Is that right, or should I use a different section?"

Wait for confirmation before invoking the script.

---

## Step 3 -- Invoke the Script

The script lives at `scripts/append_task.py` relative to this SKILL.md.
Resolve today's note path first:

```bash
TODAY=$(date +%Y-%m-%d)
DAILY_NOTE="/Users/wilsonfaustino/Library/Mobile Documents/iCloud~md~obsidian/Documents/dot/Daily Tasks/${TODAY}.md"
```

Then call the script with the resolved type and section. Examples:

**PR mode:**
```bash
python3 <skill-dir>/scripts/append_task.py \
  --file "$DAILY_NOTE" \
  --section "🌿 Syngenta" \
  --type pr \
  --pr-url "https://github.com/syngenta-digital/api-python-protector-.../pull/1149"
```

**Ticket mode:**
```bash
python3 <skill-dir>/scripts/append_task.py \
  --file "$DAILY_NOTE" \
  --section "🌿 Syngenta" \
  --type ticket \
  --ticket-key "OBS-4821" \
  --ticket-url "https://syngenta.atlassian.net/browse/OBS-4821" \
  --severity "P2" \
  --short-desc "Analytics config endpoint returns 500 on empty payload"
```

**Free-text mode:**
```bash
python3 <skill-dir>/scripts/append_task.py \
  --file "$DAILY_NOTE" \
  --section "🌿 Syngenta" \
  --type free \
  --text "follow up with Marco on the deployment"
```

The script handles file-exists check, indent detection, section walk, and
insertion. On success it prints a one-line confirmation. On failure
(missing file, missing section, gh failure) it exits 1 with a clear
message -- relay that message to the owner verbatim.

### Dry-run

Pass `--dry-run` to print the proposed change without writing. Useful when
you want to confirm the resolved indent and insertion point before mutating
the file.

---

## Verification

To verify this skill works end-to-end:

1. **PR mode, Syngenta org**: pass a `syngenta-digital` PR URL with no flag. Skill announces Syngenta routing and the script appends `\t- [ ] Code review <name> backend [<num>](<url>)` as the last child of the Syngenta section.
2. **Non-Syngenta PR**: skill applies heuristic and asks for confirmation before invoking the script.
3. **Free-text with flag**: input `add to daily --Syngenta follow up with Marco on the deployment`. Skill announces Syngenta, script writes `\t- [ ] follow up with Marco on the deployment` with no decoration.
4. **Missing file**: script exits 1 with a clear message; skill relays it.
5. **Missing section**: script exits 1; skill relays.
6. **Tab-indented file** (the real daily note): script auto-detects tab indent unit.
7. **Dry-run**: `--dry-run` prints insertion point and proposed line, file unchanged.

---

## Edge Cases

- **`gh` CLI unavailable**: script exits 1 with "gh CLI not found". Relay to owner.
- **Jira fields missing from context**: gather them in Step 1 before calling the script. Never invoke the script with placeholders.
- **Mixed indentation**: script uses the first detected style. Do not try to normalize.
- **Multiple PRs in one message**: handle each in sequence -- one script invocation per PR.
- **Author `.name` is null**: script falls back to login silently.
- **Unknown `--Section` value**: stop in Step 2 before invoking the script.
