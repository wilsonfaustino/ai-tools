---
name: investigate-with-jira
description: >-
  Fetch a Jira bug ticket, derive suspected root causes, fan out parallel
  read-only agents across the codebase, then synthesize a ranked root-cause
  report. Use when the owner pastes a Jira key or browse URL and asks to
  investigate a bug's root cause, send agents to investigate a ticket-linked
  bug, find where a bug originates in code, or trace a reported defect to its
  source layers. Trigger phrases include "investigate-with-jira", "investigate
  this ticket", "send agents to investigate", "find the root cause of this bug",
  "where does this bug come from". Investigation only, never edits code and
  never posts back to Jira. Takes a required ticket (key or URL), optional
  free-text context or hypothesis, and an optional repo path that defaults to
  the current directory. Not for fixing bugs, validating fixes on stage, or
  tickets with no code-investigation angle.
---

# investigate-with-jira

Fetch a Jira bug ticket, derive suspected root-cause angles, fan out parallel
read-only agents to investigate the codebase, then synthesize a ranked
root-cause report. This skill investigates. It never edits code and never writes
to Jira.

## Inputs

- **ticket** (required): Jira key (e.g. `P40-60664`) or full browse URL. Parse
  the key from a URL with `[A-Z][A-Z0-9_]+-[0-9]+`.
- **context** (optional): free-text hypothesis or definitions the owner gives
  (e.g. "a workspace methodology has workspace_id but company_id == null").
  Weave this into every agent prompt verbatim.
- **repo** (optional): absolute repo path to investigate. Default to the current
  working directory. The bug code lives in the owner's work repo, so never
  hardcode a path.

If `ticket` is missing or unparseable, ask for it before doing anything else.

## Pre-flight

Load the Atlassian MCP tool schemas (they are deferred):

```
ToolSearch select:mcp__claude_ai_Atlassian__getAccessibleAtlassianResources,mcp__claude_ai_Atlassian__getJiraIssue
```

If the tools are absent after `ToolSearch`, do not abort the whole run. Report
"Atlassian MCP not connected" and proceed with owner-supplied `context` only,
skipping Step 1.

Resolve the site: call `getAccessibleAtlassianResources` and use the first
result's `id` as `cloudId`. If the owner has more than one site, ask which one.
(`cloudId` is a UUID, not the URL host.)

## Step 1 - Fetch the ticket

Call `getJiraIssue` with:
- `cloudId`: from pre-flight.
- `issueIdOrKey`: the parsed key.
- `fields`: `["summary","description","status","issuetype","priority","components","reporter","comment"]`.
- `responseContentFormat`: `markdown` (request markdown if the schema supports it).

If the MCP rejects an unknown parameter or field, retry with the minimal set
(`fields: ["summary","description","comment"]`, no `responseContentFormat`)
rather than aborting.

Surface a terse header, one line per field:

```
<KEY> - <summary>
type <issuetype> | priority <priority> | component <components> | status <status>
reporter <reporter> | comments <count>
```

Note explicitly if the description is image-only or sparse (the real signal may
live in comments or the owner's `context`). If the fetch fails, report the error
and continue from owner-supplied `context` rather than inventing ticket details.

## Step 2 - Derive investigation angles

Default to 3 orthogonal read-only angles for a code bug:

1. **Data model + fetch/API layer** - the shapes and queries that load the data
   (types, DTOs, API client calls, query params, response mappers).
2. **Filter/predicate/selector logic** - the root-cause hunt. Where data is
   filtered, matched, included/excluded, or derived (predicates, selectors,
   reducers, comparators).
3. **UI consumer chain** - component to hook/selector to local filter. How the
   screen consumes the data and any client-side filtering before render.

Adapt or swap angles when the ticket is clearly not a filtering bug (e.g. a
race, an auth gate, a formatting defect). Keep angles orthogonal so agents do
not overlap. Briefly state the chosen angles before fanning out.

## Step 3 - Fan out (parallel, read-only, Sonnet)

Launch one agent per angle, all in a SINGLE message so they run concurrently.
For each: `subagent_type: Explore`, `model: sonnet`.

Each agent prompt must contain:
- The absolute **repo path**.
- The **bug statement** plus the owner's `context`/definitions verbatim.
- An instruction to **prefer serena symbol search** over raw grep, falling back
  to grep only when symbols do not resolve.
- **Concrete search terms** for that angle (symbol names, endpoints, field
  names, component names drawn from the ticket and context).
- A strict **output contract**: `file:line` references plus a 1-2 line
  conclusion per finding. No full-file dumps, no transcripts.

Prompt template per agent:

```
Repo: <ABS_REPO_PATH>

Bug under investigation:
<ticket summary + repro>
Owner's definitions (use verbatim): <context>

Your angle: <angle name + one-line scope>

Search method: prefer serena symbol tools over grep for speed and token cost.
Serena tools are deferred; if they are not loaded, load them first:
  ToolSearch select:mcp__plugin_serena_serena__activate_project,mcp__plugin_serena_serena__get_symbols_overview,mcp__plugin_serena_serena__find_symbol,mcp__plugin_serena_serena__find_referencing_symbols,mcp__plugin_serena_serena__search_for_pattern
If serena has no project active for this repo, activate it on <ABS_REPO_PATH>
or fall back to grep. Use these tools as needed:
  - get_symbols_overview(<file>) to map a file
  - find_symbol(<name_path>) to locate a definition
  - find_referencing_symbols(<name_path>, <file>) to trace callers
  - search_for_pattern only when a symbol name is unknown
Start search terms: <concrete terms>

Output contract (strict):
  - Report findings as `file:line` + a 1-2 line conclusion each.
  - Quote at most one offending line per finding.
  - Do NOT paste whole files or long excerpts. Conclusions only.
  - If your angle is not the cause, say so in one line and list what you ruled out.
```

## Step 4 - Synthesize (on this Opus session, not delegated)

After all agents return, do the synthesis yourself. Do not delegate it to a
cheap agent. Relay conclusions only, never agent transcripts. Produce:

1. **Ranked root-cause layers** - ordered most to least likely. Each line:
   `file:line` plus the exact offending snippet (one line) plus why it is
   suspect.
2. **Not the cause** - an explicit list of ruled-out leads with one-line reasons,
   so false trails die.
3. **Unresolved fork** - the single open question whose answer changes the fix
   size (e.g. front-end-only vs cross-team backend change), and the exact
   evidence that would settle it (a real API response, a staging repro, a schema
   check).

## Step 5 - Offer next step (do not auto-fix)

Stop at the report. Offer, do not perform:
- Capture a real API/staging response to settle the fork, or
- Draft the fix under a stated assumption, once the owner picks a fork branch.

Only edit code if the owner explicitly asks after seeing the report.

## Rules

- Investigation only. Never edit or fix unless the owner explicitly asks
  afterward.
- Agents are read-only (`Explore`). No writes anywhere.
- Read-only toward Jira too. Never post findings back as a comment.
- Fan-out agents run on Sonnet; synthesis stays on this session.
- Prefer serena symbol search over grep in agent prompts.
- Respect the target repo's CLAUDE.md style: no emojis, no em-dashes, concise.
- Never dump agent transcripts; relay conclusions only.
- Never invent ticket details. If the fetch fails, say so and proceed from
  owner-supplied context.
