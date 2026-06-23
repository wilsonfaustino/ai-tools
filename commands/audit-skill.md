---
description: Statically audit an untrusted skill/plugin repo for supply-chain payloads before you install it. Clones into the current empty folder, never executes, withholds the install command on any finding.
argument-hint: <git-url|local-path> [folder]
---

Audit an untrusted skill/plugin source for install-time attack payloads BEFORE installing it. Read-only static analysis. Withhold the install command unless the source is clean.

**The one inviolable rule: never execute the source.** No `npx skills add`, no `npm install`, no running any bundled script, no install lifecycle. `git clone` and reading files run nothing; that is the only acquisition allowed. Everything downstream is read + grep + reason.

Parse `$ARGUMENTS`:
- First positional `<git-url|local-path>` (required): the source to audit.
- Second positional `[folder]` (optional): the specific skill/plugin folder you intend to install. If omitted, audit every skill folder found.

## Pre-flight (hard blocks, all must pass)

Abort with a clear message if any fail:

1. `git` and `rg` (ripgrep) on PATH (`command -v git`, `command -v rg`). Else abort naming the missing tool.
2. Source argument present. Else abort: "Pass a git URL or local path to audit."
3. **Classify the source:**
   - Looks like a URL (`^https?://` or `git@` or ends `.git`) → **clone mode**.
   - Else treat as **local path**; it must exist (`test -e`). Else abort: "Local path not found: <path>."
4. **Clone-mode guardrails only** (skip for local path):
   - CWD must NOT be inside a git repo: `git rev-parse --is-inside-work-tree` must fail. Else abort: "You are inside a git repo. cd to an empty throwaway folder first -- untrusted source must never be cloned into a real project."
   - CWD must be empty: `find . -maxdepth 1 -mindepth 1 | head -1` must be empty. Else abort: "Current folder is not empty. cd to an empty throwaway folder first."

## Acquire

- **Clone mode:** `git clone --depth 1 <url> .` (into CWD). Set `SRC=.`.
- **Local path:** set `SRC=<path>`. Do not copy, do not clone, audit in place.

Never run anything from `$SRC` after acquisition.

## Scope

Audit two regions, always:

- **Repo-root install-time surface** (the auto-executing stuff hides here): `$SRC/settings.json`, `$SRC/.claude/settings.json`, `$SRC/.mcp.json`, `$SRC/package.json`, `$SRC/hooks/`, `$SRC/.claude/hooks/`, `$SRC/.claude/`.
- **Target folder:** `$SRC/<folder>` if named, else every directory containing a `SKILL.md` or a plugin manifest (`plugin.json`, `.claude-plugin/`).

## Triage (deterministic sweep)

Run these and collect the flagged files. `--no-ignore` defeats `.gitignore`; `--hidden` is mandatory because the worst Tier-1 payloads live in `.claude/` (a hidden dir rg skips without it).

**Manifest + Tier 1 (auto-executing):**
```bash
find "$SRC" -type d -name .git -prune -o -type f -print
find "$SRC" -type d -name hooks
find "$SRC" -name '.mcp.json'
rg -n --no-ignore --hidden -g '*.json' '"hooks"|SessionStart|PreToolUse|PostToolUse|UserPromptSubmit|"Stop"|mcpServers|"command"\s*:' "$SRC"
```

**Tier 2 (code that runs only if invoked):**
```bash
find "$SRC" -type f \( -name '*.sh' -o -name '*.py' -o -name '*.js' -o -name '*.mjs' -o -name '*.ts' -o -name '*.rb' -o -name '*.pl' \)
rg -n --no-ignore --hidden -g 'package.json' '"(pre|post)?install"|"prepare"|"prepublish"' "$SRC"
```

**Tier 3 (payload patterns in any file):**
```bash
rg -n --no-ignore --hidden -S "$SRC" \
  -e 'id_rsa|\.ssh/|\.aws/|\.npmrc|\.git-credentials|security find-generic-password|keychain' \
  -e 'process\.env|AWS_SECRET|AWS_ACCESS|GITHUB_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|\.env\b' \
  -e 'curl|wget|\bnc\b|/dev/tcp|fetch\(|urllib|requests\.(get|post)|http\.request' \
  -e 'rm -rf|chmod 777|chmod \+x|git push (-f|--force)|mkfs|dd if=|:\(\)\s*\{' \
  -e 'base64 -d|base64 --decode|atob\(|eval\(|exec\(|Function\(|\\x[0-9a-fA-F]{2}'
```

## Deep read

Read **in full** every file flagged by the triage. Do not skim. For each, determine what it actually does and whether the behavior is install-time auto-executing (Tier 1), invoked-code (Tier 2), or instruction/payload (Tier 3).

## Verdict (paranoid posture)

**Every triage hit becomes a surfaced finding. Never suppress one.** Annotate likely intent, but a plausible-benign explanation does NOT remove the finding -- it only sets the severity.

Severity:
- **Critical** -- auto-executing on its own (hook entries, MCP server config, `*install` lifecycle), OR exfil/destruction with no plausible benign reason (reads a secret then sends it out; `curl … | sh`; `rm -rf` of paths outside the repo).
- **High** -- invoked code (bundled scripts), outbound network calls, obfuscation (base64/hex/`eval`) whatever the stated purpose.
- **Info** -- pattern hits that are plausibly benign in context (a documented `gh`/API call, a legit `.env` read) but surfaced anyway.

Print a markdown table: `Severity | File:line | What it does | Why it is dangerous | Intent note`. Order Critical → High → Info.

## Gate (withhold on any finding)

- **Zero findings** → print `VERDICT: CLEAN`, then:
  - skill folder(s) detected → print the ready-to-run command per folder: `npx skills add <folder>`.
  - no skill folders (plugin or other) → print "Safe to install. Run your install command for this source."
- **Any finding** (Critical/High/Info) → print `VERDICT: FINDINGS` and the table. **Do NOT print any install command.** Then ask for an explicit override via the confirmation prompt: "Install anyway despite the findings above?" Only if the user explicitly confirms, print the install command. Default is to withhold.

## Output

stdout markdown only. No report file (the clone folder is a throwaway). Do not delete the clone -- the user inspects and removes it themselves.

## Rules

- Never execute the source, its scripts, or its install lifecycle. Static read only.
- Never delete or modify anything in `$SRC` or the user's filesystem.
- Never print the install command when findings exist, unless the user explicitly overrides.
- Never skip pre-flight or the triage sweep.
- Local-path mode skips only the empty-CWD/git-repo guardrails -- all scanning still runs.
