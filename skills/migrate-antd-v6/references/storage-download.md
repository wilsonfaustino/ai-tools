# Auth for localhost (token-download, with SSO fallback)

Goal: a Playwright `storageState` for the running localhost app, without any
token ever pasted into chat. The owner downloads it from their own logged-in tab.

## Primary path: download storageState from the logged-in tab

1. Find the running dev server with `detectDevServers` (playwright-skill) and
   confirm the base URL with the owner. Do not guess the port.
2. Ask the owner to open devtools on their already-logged-in app tab and run this
   in the console. It serializes `localStorage` into a Playwright-shaped
   `storageState` and downloads it to `~/Downloads`:
   ```js
   const origins = [{ origin: location.origin, localStorage: Object.entries(localStorage).map(([name, value]) => ({ name, value })) }];
   const blob = new Blob([JSON.stringify({ cookies: [], origins })], { type: 'application/json' });
   const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'antd-migration-storage.json'; a.click();
   ```
3. The capture script loads it as `storageState`:
   ```js
   const STATE_PATH = process.env.STATE_PATH; // ~/Downloads/antd-migration-storage.json
   const context = await browser.newContext({ storageState: STATE_PATH, viewport: { width: 1440, height: 900 } });
   ```

This works when the app authenticates from a token held in `localStorage`. It
**cannot** carry httpOnly cookies (the snippet has no access to them).

## Fallback: headed SSO click-through

If the route bounces to the login host after loading `storageState`, the app uses
session cookies the snippet could not read. Capture them by hand instead:

The agent runs this non-interactively (no TTY), so it **polls** for a live
session instead of waiting on a keypress. Signal: back on the app host (a bounce
to the login host then return) or a token-ish `localStorage` key appears.

```js
// auth-capture.js  -- run: "$NODE_BIN" auth-capture.js
const { chromium } = require('playwright');
const BASE_URL = process.env.BASE_URL;
const STATE_PATH = process.env.STATE_PATH;
const TOKEN_PATTERN = /token|auth|jwt|bearer/i;
const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;                 // give the human time to log in

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE_URL);
  console.log('Log in manually in the opened window. Polling for a session...');

  const baseHost = new URL(BASE_URL).host;
  const deadline = Date.now() + TIMEOUT_MS;
  let live = false;
  let sawLoginHost = false;
  while (Date.now() < deadline) {
    const onAppHost = page.url().includes(baseHost);
    if (!onAppHost) sawLoginHost = true;
    const hasToken = await page.evaluate((src) => {
      const re = new RegExp(src, 'i');
      return Object.keys(localStorage).some(
        (k) => re.test(k) && (localStorage.getItem(k) || '').length > 20);
    }, TOKEN_PATTERN.source).catch(() => false);
    // Logged in when a token is present, or we bounced to login then returned.
    if (onAppHost && (hasToken || sawLoginHost)) { live = true; break; }
    await page.waitForTimeout(POLL_MS);
  }

  if (!live) {
    console.error('No live session detected before timeout.');
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: STATE_PATH });
  console.log('Saved storageState to', STATE_PATH);
  await browser.close();
})();
```

```bash
BASE_URL="http://localhost:3000" STATE_PATH="$WORK/storageState.json" \
  "$NODE_BIN" "$WORK/auth-capture.js"
```

The headed login is also why the capture scripts run headed by default: a mid-run
session expiry can be re-authenticated without rewriting the harness.

## Handling the token file

- The downloaded `~/Downloads/antd-migration-storage.json` holds **live tokens**.
- Never commit it. Never auto-delete it.
- At the end of the run, flag it to the owner and offer to `rm` it, only with
  explicit approval.
