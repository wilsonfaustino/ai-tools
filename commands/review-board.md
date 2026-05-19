---
description: Triage PR review findings in a browser page; output JSON for /post-review --from.
argument-hint: "[output-json-path]"
---

Render the current conversation's PR review findings as a severity-grouped HTML page. The user selects, edits, or skips each comment in the browser, then submits. A JSON file is written and `/post-review` can post it with `--from <path>`.

Parse `$ARGUMENTS` (whitespace-split). At most one positional token:

- absent: output path is `/tmp/review-triage.json`
- one token: output path is that token (must be an absolute path)
- two or more tokens: abort with `Unrecognized argument: <token>`

## Pre-flight (hard blocks)

Run in order. Abort with a clear message on any failure.

1. `command -v python3` else abort: "python3 not installed."
2. `command -v gh` else abort: "gh CLI not installed."
3. `gh auth status` else abort: "gh not authenticated. Run `gh auth login`."
4. Required files exist:
   - `test -f ~/.claude/commands/review-board/render.py`
   - `test -f ~/.claude/commands/review-board/template.html`
   - `test -f ~/.claude/commands/review-board/server.py`
   If any missing, abort: "Renderer not installed. Re-copy `commands/review-board/` to `~/.claude/commands/`."
5. PR exists for current branch:
   ```bash
   gh pr view --json number,url,headRefOid,headRepositoryOwner,headRepository \
     --jq '{number,url,sha: .headRefOid, owner: .headRepositoryOwner.login, repo: .headRepository.name}'
   ```
   Abort on failure: "No open PR for current branch."

## Build findings JSON

Scan the conversation backward from the most recent message, stop at the first match. Look for:

- A markdown table or numbered list whose rows carry severity, `file:line`, and a description (the staff-review Section 3 table is the preferred source if present).
- Take only items where an `Addressed?` column is `No` or absent.

For each finding, capture severity (lowercase: critical, major, minor, nit), path, line, and body. Body must start with `**[severity]**`; if missing, prepend it. Then walk `DIFF_POSITIONS` (built in pre-flight from `gh api repos/{owner}/{repo}/pulls/{number}/files`): if the line falls inside a hunk for that path, set `in_diff: true`, else `in_diff: false`.

Pre-flight assembles `DIFF_POSITIONS` as `{path: [[start_line, end_line], ...]}` by parsing `@@ -<old>,<n> +<new>,<m> @@` hunk headers and keeping only added/modified RIGHT-side lines. Discard patch bodies after extracting the ranges.

Produce an in-memory object:

```json
{
  "pr": {"number": N, "owner": "...", "repo": "...", "sha": "..."},
  "findings": [
    {"severity": "critical|major|minor|nit",
     "path": "...", "line": N, "in_diff": true|false, "body": "**[severity]** ..."}
  ]
}
```

If zero findings after filtering, abort with the same recovery prompt as `/post-review`'s Parse Context: `No review findings found in our conversation.`

Write to a temp path: `/tmp/review-board-findings.json`.

## Launch server and open browser

```bash
python3 ~/.claude/commands/review-board/server.py --port 0 --out <output-path> \
  < /tmp/review-board-findings.json &
SERVER_PID=$!
```

Read the first stdout line from the server, which is `http://127.0.0.1:<port>`. Capture it as `URL`.

Open the browser:

```bash
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
else echo "Open this URL: $URL"
fi
```

## Wait for submit

Poll for the output JSON file every 1 second, up to 600 seconds.

- File appears: print `Done. Run /post-review --from <output-path>` and exit 0. The server exits on its own after the successful submit.
- Timeout: `kill $SERVER_PID 2>/dev/null` and abort with `Timed out waiting for submit. Server stopped.`
- User Ctrl-C: trap and `kill $SERVER_PID` before exiting.

## Notes

- Server binds 127.0.0.1 only.
- Output path defaults to `/tmp/review-triage.json`. Each run overwrites.
- Renderer and server logic live in `~/.claude/commands/review-board/`. Do not reimplement here.
