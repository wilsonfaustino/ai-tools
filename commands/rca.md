---
description: Draft a Root Cause Analysis from conversation context and post it to customfield_10249 on a Jira ticket as ADF.
argument-hint: "[TICKET-KEY]"
---

Draft an RCA for a Jira ticket and post it as ADF to `customfield_10249`. Source material comes from the current conversation; fetch the ticket only when the conversation lacks a needed fact. Never post without showing a readable preview and getting explicit approval.

Parse `$ARGUMENTS`:
- Optional positional: `<TICKET-KEY>` (e.g. `ABC-123`). If absent, auto-detect from conversation.

## Pre-flight

Load the Atlassian MCP tool schemas (they are deferred):

```
ToolSearch select:mcp__claude_ai_Atlassian__getAccessibleAtlassianResources,mcp__claude_ai_Atlassian__getJiraIssue,mcp__claude_ai_Atlassian__editJiraIssue,mcp__claude_ai_Atlassian__atlassianUserInfo
```

If the tools are not present after `ToolSearch`, abort: "Atlassian MCP not connected. Connect the Atlassian MCP server and retry."

## Resolve ticket key

If `$ARGUMENTS` matches `^[A-Z][A-Z0-9_]+-[0-9]+$`, use it as the target and skip to the next section.

Otherwise scan the conversation for all matches of `[A-Z][A-Z0-9_]+-[0-9]+`:
- Zero matches: ask "Which ticket? (e.g. ABC-123)".
- One unique match: prompt "Target ticket: `<KEY>`. Proceed? (y/N)". Abort on any non-`y` answer.
- Two or more unique matches: list them and ask the user to pick one.

## Gather facts from conversation

The RCA has three sections. Extract each from the conversation:

1. Root Cause: one or two sentences, high level and functional.
2. Impact: who was affected and how customers experienced it.
3. Corrective Action: what was changed to resolve it, in functional terms.

For any section with zero signal in the conversation, ask one targeted question:
- Root cause missing: "What was the root cause, in functional terms?"
- Impact missing: "Who was impacted and how did customers experience this?"
- Corrective action missing: "What was the corrective action?"

If the user replies "just draft it" or skips, draft from best inference and flag the weak section in the preview. Do not ask when signal is weak but present; let the preview surface issues.

If the conversation is still insufficient after the questions above, fetch the ticket with `getJiraIssue` (`fields: ["summary","description","comment"]`) and re-extract.

## Tone rules for drafting

- High level. No code snippets, function names, class names, stack traces, file paths, or internal service names.
- Functional language. Describe what users experienced and what behavior changed, not the implementation.
- Concise. Root Cause is one or two sentences, not a paragraph.
- No em-dashes, no double dashes, no emojis.

## Preview and revise loop

Print the draft as markdown in the shape it will render in Jira:

```
Root Cause:
  - <text>

Impact:
  - <text>

Corrective Action:
  - <text>
```

Prompt: `approve / revise <instructions> / abort`.

- `approve`: proceed to the overwrite guard.
- `revise <instructions>`: apply the feedback, re-draft, show the preview again. After 5 iterations, ask the user whether to continue or abort.
- `abort`: exit with no side effects.

## Overwrite guard

Resolve the Atlassian site once: call `getAccessibleAtlassianResources` and use the first result's `id` as `cloudId`. If the user has more than one site, ask which one.

Fetch the ticket: `getJiraIssue` with `cloudId`, `issueIdOrKey: <KEY>`, `fields: ["customfield_10249"]`.

If `customfield_10249` is non-empty, render its existing ADF back to markdown and prompt: `replace / append / abort`.

- `replace`: the new ADF doc becomes the field value.
- `append`: concatenate the existing doc's `content` array with the new doc's `content` array. Preserve order: existing first, new second, separated by an empty paragraph.
- `abort`: exit.

If the field is empty or missing, proceed without prompting.

## Build the ADF value

Build the ADF document for `customfield_10249`. Use this exact structure, substituting the drafted text:

```json
{
  "version": 1,
  "type": "doc",
  "content": [
    {"type": "paragraph", "content": [{"type": "text", "text": "Root Cause:"}]},
    {"type": "bulletList", "content": [
      {"type": "listItem", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "<root cause>"}]}
      ]}
    ]},
    {"type": "paragraph", "content": [{"type": "text", "text": "Impact:"}]},
    {"type": "bulletList", "content": [
      {"type": "listItem", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "<impact>"}]}
      ]}
    ]},
    {"type": "paragraph", "content": [{"type": "text", "text": "Corrective Action:"}]},
    {"type": "bulletList", "content": [
      {"type": "listItem", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "<corrective action>"}]}
      ]}
    ]}
  ]
}
```

If a section needs multiple points, add more `listItem` entries to that section's `bulletList`. If the `editJiraIssue` schema expects a different envelope, adapt to the schema but keep the document body identical.

## Post

Call `editJiraIssue` with:
- `cloudId`: from the pre-flight site resolution.
- `issueIdOrKey`: the ticket key.
- `fields`: `{"customfield_10249": <ADF doc>}`.

On success, print a single line: `Posted RCA to <KEY>.`

## On failure

If `editJiraIssue` returns an error, do not retry automatically. Print:

```
MCP post failed: <error summary>

--- Markdown (paste into Jira) ---
<markdown preview>

--- ADF JSON (for REST API) ---
<raw JSON>
```

## Rules

- Never post without an explicit `approve` from the user.
- Never overwrite a non-empty `customfield_10249` without an explicit `replace` or `append`.
- Never include code snippets, function names, class names, stack traces, file paths, or internal service names in the drafted RCA.
- Never use em-dashes, double dashes, or emojis.
- Never edit fields other than `customfield_10249`.
- Never transition the ticket, add comments, or touch worklog.
- Never proceed silently on ambiguity. If the ticket key is unclear or a section is empty, ask.
