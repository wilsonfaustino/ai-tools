---
description: Run npx ccusage and render output as a standalone HTML report.
argument-hint: "[--monthly | --last-week | --last-N-days N]"
---

Render Claude Code token usage as a self-contained HTML report (dark theme, summary cards, sortable table). Defaults to daily, all-time.

Parse `$ARGUMENTS` (whitespace-split into tokens). Recognize at most one of these mutually exclusive flags:

- `--monthly`: zero-arg flag
- `--last-week`: zero-arg flag
- `--last-N-days <N>`: two tokens. The next token after the flag is `N`; it must match `^[0-9]+$` and be `> 0`.

Resolve to a `ccusage` invocation:

| Match | Command |
|---|---|
| (none) | `npx --yes ccusage daily --json` |
| `--monthly` | `npx --yes ccusage monthly --json` |
| `--last-week` | `npx --yes ccusage daily --since $(date -v-7d +%Y%m%d) --json` |
| `--last-N-days <N>` | `npx --yes ccusage daily --since $(date -v-${N}d +%Y%m%d) --json` |

If two or more of `--monthly`, `--last-week`, `--last-N-days` appear in `$ARGUMENTS`, abort: `Flags are mutually exclusive: pick one of --monthly, --last-week, --last-N-days.`

If `--last-N-days` is given but the next token is missing or fails validation, abort: `--last-N-days requires a positive integer.`

Any other unrecognized token: abort with `Unrecognized argument: <token>`.

## Pre-flight (hard blocks)

Run in order. Abort with a clear message on any failure.

1. `command -v npx` else abort: "npx not installed. Install Node.js."
2. `command -v python3` else abort: "python3 not installed."
3. `test -f ~/.claude/commands/ccusage-html/render.py` else abort: "Renderer not installed. Re-copy `commands/ccusage-html/` to `~/.claude/commands/`."
4. `test -f ~/.claude/commands/ccusage-html/template.html` else abort with the same hint.
5. If `--last-N-days <N>` given, validate `N`.

## Fetch

Resolve mode: `monthly` if `--monthly`, else `daily`. Output JSON path: `/tmp/ccusage-<mode>.json`.

Build and run (substitute the resolved subcommand and optional `--since`):

```
npx --yes ccusage <subcommand> --json [--since YYYYMMDD] > /tmp/ccusage-<mode>.json 2> /tmp/ccusage-<mode>.err
```

On non-zero exit: `cat /tmp/ccusage-<mode>.err` and abort.

## Render

```
python3 ~/.claude/commands/ccusage-html/render.py \
  --mode <daily|monthly> \
  --source-cmd "<verbatim command string>" \
  < /tmp/ccusage-<mode>.json \
  > /tmp/ccusage-report.html \
  2> /tmp/ccusage-render.err
```

The renderer writes one stderr line on success: `rows=<N> bytes=<B>`. On non-zero exit, print the captured stderr verbatim and abort.

## Open and report

1. `open /tmp/ccusage-report.html`
2. Print: `Wrote /tmp/ccusage-report.html (<bytes> bytes, <rows> rows). Source: /tmp/ccusage-<mode>.json`
   where `<bytes>` and `<rows>` come from the renderer's stderr line.

## Error handling

| Condition | Action |
|---|---|
| `npx ccusage` exits non-zero | print captured stderr, abort |
| Renderer exits non-zero | print stderr, abort |
| Empty `.daily[]` / `.monthly[]` | renderer emits placeholder row; still write file |

## Notes

- Renderer logic lives in `~/.claude/commands/ccusage-html/render.py`. Template in `template.html`. Do not reimplement here.
- Output path is fixed (`/tmp/ccusage-report.html`). Each run overwrites.
- Auto-open uses macOS `open`. Linux not supported.
