---
name: validate-bug-fix
description: >-
  Prove a merged bug fix holds by driving a real browser against a stage
  environment with Playwright, capturing video and network evidence, then
  posting a verification comment to the Jira ticket. Use when the owner asks
  to validate or verify a bug fix on stage, reproduce a bug scenario in a real
  browser and prove the fix works, produce video or network evidence that a
  fix holds, or confirm a stage build resolved a ticket before sign-off.
  Trigger phrases include "validate this bug fix", "verify the fix on stage",
  "prove the fix holds", "reproduce and verify on stage", "browser evidence
  the fix works", "drive Playwright to confirm the fix". Parameterized by
  ticket, stage URL, target data, and assertion, so it works for any bug, not
  just one flow. Not for unit tests, local-only checks, or fixes that are not
  yet on a stage build.
---

# validate-bug-fix

Drive a real browser (Playwright) against a stage environment to reproduce a
Jira bug scenario and produce video plus network evidence that a merged fix
holds, then post a verification comment to the ticket.

The workflow is parameterized by four inputs: the **ticket**, the **stage
URL**, the **target data** to act on, and the **assertion** (expected network
behavior plus any UI invariant). Everything else is procedure. This generalizes
a manual run done for P40-60592 (phenomenon-create double-submit), but works for
any bug.

All generated scripts and artifacts live in `/tmp`, never the repo. The scripts
carry live bearer tokens and target data; treat them as sensitive.

## Prerequisites

- **Node 18+.** The default system Node may be too old for Playwright. Resolve
  an explicit modern binary before running anything:
  ```bash
  NODE_BIN="$(fnm exec --using 18 which node 2>/dev/null || nvm which 18 2>/dev/null || command -v node)"
  "$NODE_BIN" --version   # confirm v18+ before proceeding
  ```
  Invoke every script with `"$NODE_BIN" script.js`, not bare `node`.
- **Playwright + Chromium.** `npx playwright install chromium` if needed.
- **ffmpeg** on PATH for the webm to mp4 conversion.
- **Atlassian MCP** connected (for the final Jira comment). See the
  jira-assistant skill if not configured.

Pick one working directory under `/tmp`, for example
`WORK=/tmp/validate-<TICKET>`; keep auth state, scripts, video, and artifacts
there.

---

## Step 1 - Collect inputs (ask if missing)

Confirm every item before touching the browser. Do not guess; ask.

1. **Ticket + scenario.** Jira key and the bug scenario / repro steps in plain
   language.
2. **Stage base URL.**
3. **Fix is on the build.** Confirm the stage build actually contains the fix,
   and note which PR(s). If unconfirmed, stop and surface it. Verifying a build
   without the fix proves nothing.
4. **Target data.** The specific org / entity / record to act on. Confirm it is
   safe / disposable. Plan cleanup of anything created during the run.
5. **Assertion.** The expected network behavior (for example exactly 1 POST to
   `<endpoint>`, no 5xx) plus any UI invariant (for example a single entry
   appears, the submit button goes disabled).

State the four parameters back to the owner before continuing.

---

## Step 2 - Auth (never script SSO credentials)

Never type or store SSO credentials in a script. Instead capture a session by
hand once, then reuse it:

1. Launch a **headed** Chromium at the stage URL.
2. Let the owner log in manually through SSO.
3. Poll `localStorage` for a token-ish key and save `storageState` to `$WORK`.

The token key **varies per app**. P40-60592's app used `striderToken`, not
`access_token`. Scan keys matching `/token|auth|jwt|bearer/i`, show the owner
the candidates, and confirm which one signals a live session.

Full capture script and polling loop: `references/auth-capture.md`.

The saved `storageState.json` holds **live bearer tokens**. Keep it in `/tmp`,
never commit it, and delete it when done.

---

## Step 3 - Recon (never guess selectors)

Before writing the driven test, learn the actual UI. Navigate the flow
incrementally using the saved `storageState`, taking screenshots and DOM dumps
at each step:

- Confirm the **route path** the flow lives at.
- Capture the real **selectors**. This is an antd app in the reference case;
  antd class names and `data-*` hooks are not guessable. Dump the relevant DOM
  subtree and read it.
- Note where the trigger control is and how the success / error UI renders
  (notifications, inline validation).

Do not write the assertion run until selectors and route are confirmed from
real DOM, not assumption.

---

## Step 4 - Drive + assert

Write the driven run to `$WORK` and execute it with `"$NODE_BIN"`. It must:

1. Load the saved `storageState`.
2. **Record video** (`recordVideo` on the context).
3. Attach `page.on('request', ...)` and `page.on('response', ...)` counters
   **filtered to the target endpoint**. Count requests and collect statuses.
4. Navigate to the route. **Verify the page did not bounce to the SSO host**
   before asserting; if it did, the session expired, so recapture (Step 2).
5. Fire the **trigger** with a real Playwright interaction.
6. Wait for the network to settle, then assert the counts and statuses against
   the agreed assertion.
7. **Dump validation errors and notifications** so a silent block is visible in
   the output, not swallowed.

Full driver template with placeholders for route, selectors, endpoint, trigger,
and expected counts: `references/driver-script.md`.

### Critical gotchas (bake these in)

- **Programmatic clicks do not fire React handlers.** `el.click()` inside
  `page.evaluate` is an untrusted event and fires **0 requests** on a React
  control. Use real Playwright clicks (`locator.click()` /
  `locator.dblclick()`) for trusted events.
- **Reproducing a fast double-submit:** a real `locator.dblclick()` fires two
  trusted clicks. If the fix disables the button in-flight, the second click is
  a no-op, so the assertion is **exactly 1 request**. That single count is the
  proof the fix holds.
- **Session bounce.** Always check you are still on the stage host (not
  redirected to SSO) before asserting. A bounce means expiry, not a passing
  test.
- **Node version.** Use the resolved `$NODE_BIN`, not bare `node`.

---

## Step 5 - Evidence

Collect everything into `$WORK` as one folder:

- Convert the Playwright `.webm` to `.mp4` (Jira and most viewers prefer mp4).
  The driver prints `VIDEO <path>` on exit; use that path as the input:
  ```bash
  ffmpeg -y -i "$WORK/video/<recording>.webm" "$WORK/evidence.mp4"
  ```
- Keep the recon screenshots, the network counter output, and the driver script
  alongside it.

---

## Step 6 - Report

Draft a verification comment and post it to the ticket via the Atlassian MCP
(`jira-assistant` skill or the MCP tools directly). Structure the comment as:

- **Build / PRs verified:** which fix, which stage build.
- **Scenario:** the repro steps exercised.
- **Result:** the assertion outcome (for example "double-submit fired 2 trusted
  clicks; observed exactly 1 POST to `<endpoint>`, no 5xx; single entry
  created; button disabled in-flight").
- **Evidence:** name the mp4 and artifacts.

Show the draft to the owner before posting.

> **Atlassian MCP cannot upload binaries.** Post the text comment via MCP, then
> tell the owner to attach `evidence.mp4` to the ticket manually. State this
> explicitly so the evidence is not assumed uploaded.

Clean up: delete created target data (Step 1), and remove `storageState.json`
and any token-bearing files from `/tmp`.

---

## Concrete example

The owner's memory note `reference_stage_phenomenon_create_flow` holds a fully
mapped flow (route, selectors, endpoint) from the P40-60592 phenomenon-create
run: a fast double-submit where the fix disables the create button in-flight.
The assertion there was exactly 1 POST to the create endpoint, no 5xx, and a
single phenomenon entry. Read it as a worked example of Steps 3 and 4.
