---
name: migrate-antd-v6
description: >-
  Migrate one file or route from the deprecated antdV3 import (npm alias
  antd@3.x) to antd v6, proving no visual or behavior regression with
  before/after Playwright screenshots of the real route before committing. Use
  when a Sonar no-restricted-imports MAJOR flags an antdV3 import, or the owner
  asks to migrate a component to antd v6. Trigger phrases include "migrate
  antdV3", "antd v6 migration", "migrate this component to antd v6", "kill the
  antdV3 import". Reusable across projects, parameterized by target file, repo
  path, route, and storageState filename. Captures the loading spinner, the
  migrated components, and a behavior check, then stops at a ready-to-commit
  signed-commit command for the owner to run. Scoped to one target only, never
  a repo-wide sweep. Not for non-antd refactors, dependency bumps of antd
  itself, or migrations with no rendered route to screenshot.
---

# migrate-antd-v6

Migrate one file or route off the deprecated `antdV3` import (npm alias for
`antd@3.x`) to `antd` v6, and prove the swap is regression-free with before/after
Playwright screenshots of the real route. The screenshots are the gate: nothing
commits until the owner accepts the visual and behavior diff.

This skill is reusable across projects. It discovers the target repo's own v6
conventions rather than hardcoding them, so it works in any `antd` v3-to-v6
codebase.

## Inputs (args)

- **target** (required): file path or component to migrate.
- **repo** (optional): repo root. Defaults to the current directory.
- **route** (optional): app route to screenshot, e.g.
  `/company/:id/edit-methodology`. If absent, ask, or infer from where the
  component renders.
- **route params** (optional): concrete values (e.g. `companyId`) to build a
  real URL from a parameterized route.
- **storageState filename** (optional): the downloaded auth file name. Defaults
  to `antd-migration-storage.json` in `~/Downloads`.

## Prerequisites

- **Node 18+.** System Node may be too old for Playwright. Resolve a modern
  binary and invoke every script with it, not bare `node`:
  ```bash
  NODE_BIN="$(fnm exec --using 18 which node 2>/dev/null || nvm which 18 2>/dev/null || command -v node)"
  "$NODE_BIN" --version   # confirm v18+
  ```
- **Playwright + Chromium.** `npx playwright install chromium` if needed.
- **playwright-skill** for `detectDevServers` (Step 3). Invoke it to find the
  running localhost dev server rather than guessing the port.

Pick one `/tmp` work dir, e.g. `WORK=/tmp/migrate-antd-<name>`. All scripts and
screenshots live there, never in the repo. Default viewport is desktop
**1440x900**.

---

## Step 1 - Scope the migration

Map exactly what changes before editing anything.

1. Grep the target's `antdV3` import and **every** usage of the imported
   symbols:
   ```bash
   grep -n "antdV3" "$TARGET"
   ```
2. For each imported component, decide its v6 fate. Most map 1:1 by swapping the
   import source from `'antdV3'` to `'antd'` (`Empty`, `Input`, `Spin`, etc.).
   The sharp edge is `Icon`, **removed in antd v4+**: replace
   `<Icon type='loading' spin />` with `<LoadingOutlined />` from
   `@ant-design/icons`. Full mapping and the removed/renamed list:
   `references/v6-migration-map.md`.
3. **Discover the repo's own v6 convention.** Grep an already-migrated sibling
   and match it exactly, including any repo TS workaround:
   ```bash
   grep -rn "LoadingOutlined" "$REPO/src" | head
   grep -rn "onPointerEnterCapture" "$REPO/src" | head   # repo TS workaround?
   ```
   If siblings spell `<Spin tip>` a certain way, or pass
   `onPointerEnterCapture={undefined} onPointerLeaveCapture={undefined}` to
   satisfy the repo's icon typings, copy that pattern verbatim. Do not invent a
   style the repo does not already use.

Write down the per-component plan before touching the file.

---

## Step 2 - Flag v6 behavior gotchas (before editing)

List every prop or behavior that changes between v3 and v6 for the components in
play, so the owner knows what to watch for in the diff. The headline one:

- **Standalone `<Spin tip="..." />` does not render `tip` in v5/v6.** `tip` only
  shows when `Spin` wraps content (nested mode) or in fullscreen mode. A bare
  spinner with a tip silently loses its label after migration.

Pull the rest of the gotcha list for the components in scope from
`references/v6-migration-map.md` and state them up front. These are the states
the screenshots must exercise.

---

## Step 3 - Auth for localhost (token-download, no paste)

Tokens never get pasted into chat. The owner downloads a Playwright-ready
`storageState` from their already-logged-in tab.

1. Run `detectDevServers` (playwright-skill) to find the running localhost dev
   server and confirm the base URL with the owner.
2. Ask the owner to run this snippet in the devtools console of their logged-in
   app tab. It downloads `antd-migration-storage.json` to `~/Downloads`:
   ```js
   const origins = [{ origin: location.origin, localStorage: Object.entries(localStorage).map(([name, value]) => ({ name, value })) }];
   const blob = new Blob([JSON.stringify({ cookies: [], origins })], { type: 'application/json' });
   const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'antd-migration-storage.json'; a.click();
   ```
3. Load `~/Downloads/<storageState filename>` as the context `storageState` in
   the capture script.

If the route bounces to login (the app uses httpOnly cookies the snippet cannot
read), fall back to a **headed SSO click-through**: launch headed Chromium, let
the owner log in by hand, then `context.storageState({ path })`. Full setup and
fallback: `references/storage-download.md`.

The downloaded file holds **live tokens**. Keep its path noted for the cleanup
step. Never commit it. Never auto-delete it (see Constraints).

---

## Step 4 - Capture BEFORE (current antdV3)

Write the headed capture script to `$WORK` and run it with `"$NODE_BIN"` against
the still-unmigrated file. Template with placeholders:
`references/screenshot-script.md`.

The script must capture the states that exercise the migrated components:

1. **Loading spinner.** Force it reliably by `page.route`-delaying the relevant
   API call so the `Spin` state stays on screen long enough to shoot. Do not
   race the network.
2. **The component(s)** in their loaded state.
3. **A behavior check.** Drive a real interaction that exercises behavior, e.g.
   type into the search `Input` and assert the rendered item count. Use real
   Playwright actions (`locator.fill` / `click`), never `page.evaluate(el...)`.

Save to `/tmp/<name>-before-*.png`. Print **element counts** per state. Flag any
state **not reachable** for this data (e.g. the `Empty` state will not render if
the entity has items): note it is covered only by the mechanical import swap, not
by a screenshot.

Run headed (default) so the SSO fallback stays possible.

---

## Step 5 - Apply the migration

Edit only the target. Imports plus the JSX changes from Step 1's plan, matching
the repo convention from the sibling grep. Then verify, preferring the repo's own
scripts over bare tools (check `package.json` for the real names):

```bash
# Type-check: repo script first, fall back to tsc with the repo tsconfig.
npm run typecheck 2>/dev/null || npx tsc --noEmit -p "$REPO/tsconfig.json"

# Affected unit tests: the file's own spec plus anything importing it.
npx jest --findRelatedTests "$TARGET"          # jest
# or: npx vitest related "$TARGET" --run        # vitest
```

Both must be green before screenshotting AFTER.

Do not touch any other `antdV3` holdout. Flag the rest (Constraints), do not
migrate them.

---

## Step 6 - Capture AFTER

Keep the **same dev server running** across both phases. The capture launches a
fresh browser and navigates anew, so it serves whatever the dev server currently
compiles. Wait for the server to finish recompiling the Step 5 edit (HMR or
rebuild) before capturing; if it has no HMR or did not rebuild, AFTER silently
shows the old code, so hard-reload or restart the server first.

Rerun the **identical** capture script with `PHASE=after`, reusing the **same**
`storageState`. Same URL, same route, same states, same behavior check. Save to
`/tmp/<name>-after-*.png`. Only the source under test changed; the harness is
held constant so the diff is meaningful.

---

## Step 7 - Diff visually

Read each before/after pair and report per state: **identical** or **changed**,
with what differs.

For any real difference, classify it:

- **Defect** introduced by the migration: fix it, recapture.
- **Accepted v6 behavior** already present elsewhere in the repo (e.g. the
  `Spin tip` rendering change): this is a UX decision, not a silent swap.

Present every genuine visual or behavior change to the owner as a decision:
accept the repo-consistent v6 behavior, or preserve the old behavior with extra
markup (e.g. wrap `Spin` to keep the `tip` visible). **Never silently change
UX.** States unreachable for this data (Step 4) are called out as unverified,
covered only by the mechanical swap.

---

## Step 8 - Ready to commit (stop here)

Only after the owner accepts the diff. This skill **does not commit for you.**
Stage the target selectively and print the exact signed-commit command for the
owner to run:

```bash
git add "$TARGET"
# then run:
git commit -S -m "migrate <name> from antdV3 to antd v6"
```

Never `git add .` or `git add -A`. Never amend. Hand the command to the owner and
stop.

---

## Constraints

- **Token file.** Never auto-delete the downloaded `storageState`. At the end,
  flag that `~/Downloads/<storageState filename>` holds **live tokens** and offer
  to `rm` it, only with the owner's approval.
- **Artifacts in `/tmp`.** Every script and screenshot lives under `$WORK`, never
  the repo.
- **One target only.** Do not sweep the repo. List any other `antdV3` holdouts
  you noticed so the owner can schedule them, but do not touch them.
- **Headed by default** so the SSO fallback is reachable.
- **Repo style.** No emojis, no em-dashes. Match the file's existing import
  ordering, quote style, and component patterns.
- **Stop at ready-to-commit.** The owner runs the commit, not the skill.
