---
description: Toggle the claude-mem plugin on or off. Pass on/off to force a state.
argument-hint: [on|off]
allowed-tools: Bash(claude plugin enable:*), Bash(claude plugin disable:*), Bash(grep:*)
---

Toggle the `claude-mem` plugin using the native plugin CLI. Argument: `$ARGUMENTS` (empty = flip current state, `on` = enable, `off` = disable).

## Steps

1. Read the current state:

   ```bash
   grep -o '"claude-mem@[^"]*": *\(true\|false\)' ~/.claude/settings.json
   ```

   The match gives both the plugin id (for example `claude-mem@thedotmack`) and the state: `true` = on, `false` = off. A missing entry means off. Use that exact id in step 3.

2. Decide the target state:
   - Argument `on` -> enable. Argument `off` -> disable.
   - No argument -> the opposite of the current state.
   - Already in the target state -> report it and stop. Do not run the CLI.

3. Apply it:

   ```bash
   claude plugin enable <id>    # or
   claude plugin disable <id>
   ```

4. Report in one line: old state -> new state, plus the note that the change applies on the next session start (hooks and MCP servers load at startup).

## Notes

- If step 1 finds no claude-mem entry, say the plugin is not installed and stop. Do not install it.
- Never edit `~/.claude/settings.json` by hand. The CLI owns `enabledPlugins`.
