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
model: haiku
---

# obsidian-daily-append

## Model Enforcement

This skill must run on Haiku. If the active session model is not Haiku, dispatch the entire workflow to a Haiku subagent via the Agent tool (set `model: "haiku"`) and pass the owner's original input as the prompt. Do not execute any of the steps below on a larger model.

Append a task item to today's Obsidian daily note. Supports three item types:
GitHub PR (fetched via `gh` CLI), Jira ticket, and free-text. The file is
never created if missing; the owner's existing content is never modified beyond
the insertion point.

## Daily Note Location

```
/Users/wilsonfaustino/Library/Mobile Documents/iCloud~md~obsidian/Documents/dot/Daily Tasks/YYYY-MM-DD.md
```

Resolve today's date with: `date +%Y-%m-%d`

## Verification Plan

To verify this skill works:
1. Have a PR URL like `https://github.com/syngenta-digital/api-python-protector.../pull/1149`
2. Run the skill trigger phrase
3. Check the file: new line `  - [ ] Code review <name> backend [1149](...)` appears as the last child under the Syngenta section
4. Test a non-Syngenta PR: skill asks which section before writing
5. Test with the file absent: skill fails with a clear message and stops
6. Test with a Jira ticket key: skill asks for missing fields if Jira context is absent from the session
7. Test free-text with flag: "add to daily --Syngenta follow up with Marco on the deployment" -- skill announces Syngenta section, writes `\t- [ ] follow up with Marco on the deployment` (tab-indented), no confirmation prompt
8. Test with a tab-indented file (like the real daily note): skill detects the tab as indent unit and inserts `\t- [ ] <task>`, not `  - [ ] <task>`

---

## Step 1 -- Identify Today's File

```bash
TODAY=$(date +%Y-%m-%d)
DAILY_NOTE="/Users/wilsonfaustino/Library/Mobile Documents/iCloud~md~obsidian/Documents/dot/Daily Tasks/${TODAY}.md"
```

If the file does not exist, stop immediately and tell the owner:

> "No daily note found for today (YYYY-MM-DD). Expected path: <path>. Create the file first and try again."

Do not create the file. Do not fall back to yesterday's note.

---

## Step 2 -- Detect Item Type

First, check for a `--Section` flag in the input (see Step 4 for how to handle it). Strip the flag before classifying the remaining text.

Inspect the (flag-stripped) input:

- Contains `github.com/` -> **PR mode** (go to Step 3a)
- Looks like a Jira key (`[A-Z]+-[0-9]+`, e.g. `PROJ-123`) -> **Ticket mode** (go to Step 3b)
- Neither of the above -> **Free-text mode** (go to Step 3c)
- Genuinely ambiguous between PR/ticket/free-text -> ask the owner which type before continuing

---

## Step 3a -- Fetch PR Metadata (PR mode)

Run:

```bash
gh pr view <PR_URL> --json author,number,headRepository,url
```

Fields needed:
- `author.login` -- GitHub login
- `number` -- PR number
- `headRepository.name` -- repo name
- `url` -- canonical PR URL

Then resolve the display name:

```bash
gh api /users/<author_login>
```

Use `.name` if non-null; otherwise fall back to `author.login`.

Determine project type:
- Repo name contains `api` -> `backend`
- Otherwise -> `frontend`

Format the task line (where `<indent>` is the indent unit detected in Step 5):

```
<indent>- [ ] Code review <display_name> <project> [<number>](<url>)
```

Example (tab-indented file):

```
	- [ ] Code review Mateus backend [1149](https://github.com/syngenta-digital/api-python-protector-observations-analytics-configuration/pull/1149)
```

---

## Step 3b -- Gather Ticket Metadata (Ticket mode)

Check session context (prior `/rca` or jira-assistant calls) for the ticket. Fields needed:

- Ticket key (e.g. `PROJ-123`)
- Canonical ticket URL
- Severity (e.g. `P1`, `High`, `Critical` -- whatever the ticket shows)
- Short description (summary line from Jira)

If any field is missing, prompt the owner for it. Do not guess or leave a placeholder.

Format the task line (where `<indent>` is the indent unit detected in Step 5):

```
<indent>- [ ] [<TICKET-KEY>](<url>) <severity> <short_desc>
```

Example (tab-indented file):

```
	- [ ] [OBS-4821](https://syngenta.atlassian.net/browse/OBS-4821) P2 Analytics config endpoint returns 500 on empty payload
```

---

## Step 3c -- Format Free-Text Item (Free-text mode)

Use the flag-stripped input verbatim as the task text. No metadata fetching needed.

Format the task line (where `<indent>` is the indent unit detected in Step 5):

```
<indent>- [ ] <text>
```

Example -- input "follow up with Marco on the deployment" (tab-indented file):

```
	- [ ] follow up with Marco on the deployment
```

Do not add labels, links, or any decoration. Preserve the owner's casing and punctuation exactly.

---

## Step 4 -- Route to the Correct Section

### `--Section` flag (highest precedence)

If the owner's input contains a flag matching `--<word>` where `<word>` maps to a known section (case-insensitive), use that section directly. Strip the flag from the input before Step 3.

Valid flag values and their section labels:

| Flag (case-insensitive) | Section label |
|---|---|
| `--Syngenta` | `🌿 Syngenta` |
| `--Jaya` | `🦎 Jaya` |
| `--Home` | `🏠 Home` |
| `--Side-Projects` or `--SideProjects` | `Side Projects` |

When a valid flag is present, announce the choice and proceed directly -- no confirmation needed:

> "Routing to <section label>. Writing now."

If the flag value does not match any entry in the table above, stop and tell the owner:

> "Unknown section '--<value>'. Valid options: --Syngenta, --Jaya, --Home, --Side-Projects."

### Heuristic (used when no flag is present)

For a **PR**, check the GitHub org:
- Org is `syngenta-digital` -> target section: `🌿 Syngenta`
- Otherwise -> apply keyword heuristics (see below) and ask the owner to confirm

For a **Jira ticket**, apply keyword heuristics and ask the owner to confirm.

For **free-text**, skip the heuristic entirely and ask the owner which section to use.

### Keyword heuristics for best-guess section

| Keyword pattern in repo/ticket/description | Suggested section |
|---|---|
| `syngenta` | `🌿 Syngenta` |
| `jaya` | `🦎 Jaya` |
| `home`, `house`, `personal` | `🏠 Home` |
| other / side project | `Side Projects` |

The `--Section` flag overrides these heuristics when present.

### Confirm before writing

When the section is not definitively known (no flag, and not `syngenta-digital` org for a PR):

> "I'd put this under **<suggested section>**. Is that right, or should I use a different section?"

Wait for the owner's confirmation or correction before proceeding to Step 5.

When the section IS `syngenta-digital` org (and no flag was given), announce and proceed:

> "Routing to Syngenta section. Writing now."

---

## Step 5 -- Insert the Line

Read the daily note file. Locate the target section by finding a top-level list line that contains the section label, for example:

```
- [ ] 🌿 Syngenta
```

The section ends when:
- Another top-level list item appears (a line starting with `- ` at column 0 with a different label), OR
- End of file

### Detect the indent unit

Before inserting, scan the entire file for the first line matching the pattern `^(\t+|  +)- ` (one or more tabs, or two or more spaces, followed by `- `). The leading whitespace of that first match is the file's indent unit.

If no such line exists anywhere in the file, default to one tab (`\t`). Tab is the Obsidian default for daily notes -- do not fall back to spaces.

### Walk the section

Walk forward from the section heading line. A line "belongs to this section" if it starts with the detected indent unit followed by `- `, or if it starts with two or more copies of the indent unit (a deeper descendant). Keep walking until you reach a line with zero indentation (a top-level list item) or EOF -- that boundary is the end of the section.

Insert the new task line immediately after the last section-belonging line.

If the section has no children yet, insert the new line immediately after the section heading line.

If the target section heading is not found in the file, stop and tell the owner:

> "Could not find section '<label>' in today's note. Check the file manually."

Do not create a new section.

### Preservation rule

Only the single insertion changes the file. Every other line, including blank lines and formatting, stays exactly as is.

### Checkbox syntax

Always use Obsidian standard: `- [ ]` (hyphen, space, open bracket, space, close bracket). Never use `- [x]` or any other variant for new items.

---

## Step 6 -- Confirm to the Owner

After writing, report back in one line:

> "Added to <section name>: `<the line you inserted>`"

Do not print a diff or the full file.

---

## Edge Cases

- **File missing**: fail in Step 1 with a clear message. Stop.
- **Section not found**: fail in Step 5 with a clear message. Stop.
- **`gh` CLI unavailable**: tell the owner `gh` is required and stop.
- **Jira fields missing from context**: prompt the owner for each missing field before writing. Never leave a placeholder like `<severity>` in the file.
- **Mixed indentation (tabs and spaces in the same file)**: use the first detected style from the scan. Do not normalize or convert existing lines.
- **Multiple PRs in one message**: handle each one in sequence, routing individually.
- **Author `.name` is null**: fall back to login silently, no warning needed.
- **Unknown `--Section` value**: stop immediately in Step 4 with the list of valid flag values. Do not guess or fall back to heuristics.
