---
description: Fetch open Sonar issues for the current PR and print a grouped severity table.
argument-hint: [--severity LEVEL] [--all] [--project KEY] [PR-number]
---

Fetch open Sonar issues for the current PR via `sonar list issues --pull-request` and render a grouped severity table. Defaults to OPEN issues only. Pass `--all` to include closed/fixed.

Parse `$ARGUMENTS`:
- positional `<PR-number>`: override PR detection (must match `^[0-9]+$`)
- `--severity <LEVEL>`: pass through to `sonar list issues --severity` (BLOCKER, CRITICAL, MAJOR, MINOR, INFO)
- `--all`: include closed/fixed issues
- `--project <KEY>`: override project key detection

## Pre-flight (hard blocks)

Run all checks. Abort with a clear message if any fail.

1. `sonar` on PATH (`command -v sonar`). Else abort: "sonar CLI not installed. See https://docs.sonarsource.com/sonarqube-cli."
2. `jq` on PATH (`command -v jq`). Else abort: "This command requires jq."
3. Renderer present at `~/.claude/commands/sonar-pr/render.sh` (`test -x`). Else abort: "Renderer script not installed. Re-copy `commands/sonar-pr/` to `~/.claude/commands/`."
4. Auth valid: `sonar api get /api/authentication/validate`. Parse the response JSON for `valid: true`. If not valid, abort: "Run `sonar auth login` first."
5. Project key resolution:
   - if `--project <key>` given, use it
   - else read `sonar.projectKey=` from `sonar-project.properties` at repo root: `grep -E '^sonar.projectKey=' sonar-project.properties | cut -d= -f2 | tr -d '[:space:]'`
   - else abort: "Project key not found. Pass --project <key> or add sonar-project.properties at repo root."
6. PR number resolution:
   - if positional arg given and matches `^[0-9]+$`, use it
   - else `gh pr view --json number -q .number` (current branch)
   - else abort: "No PR found for current branch. Push the branch and open a PR, or pass <PR-number>."

## Fetch

Build and run:

```
sonar list issues \
  --pull-request <PR> \
  --project <KEY> \
  --format json \
  --page-size 500 \
  [--severity <LEVEL>]
```

Save raw output to `/tmp/sonar-pr-<PR>.json`.

If `paging.total > 500` in the response, print a warning: `Warning: PR has <total> issues, only first 500 rendered. Pagination not yet supported.` Continue rendering with the first page. Pagination is YAGNI until someone hits it.

## Render

Pipe the saved JSON through the bundled renderer:

```bash
cat /tmp/sonar-pr-<PR>.json | ~/.claude/commands/sonar-pr/render.sh \
  --pr <PR> \
  --project <KEY> \
  [--all]
```

Print stdout directly. After the render, append: `Raw JSON: /tmp/sonar-pr-<PR>.json`.

## Error handling

| Condition | Action |
|---|---|
| `sonar` exits non-zero | print stderr verbatim, exit |
| Network/API error in JSON (`errors` field present) | print errors, exit |
| Empty `issues[]` after filter | renderer handles via "No open Sonar issues" message |

## Notes

- This command only fetches; it does not run any local scan. CI is authoritative.
- Renderer logic, including OPEN-only filtering and severity grouping, lives in `~/.claude/commands/sonar-pr/render.sh`. Do not reimplement here.
