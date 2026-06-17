# Auth capture (manual login, save storageState)

Never script SSO credentials. Launch a headed browser, let the owner log in by
hand, poll `localStorage` for a token-ish key, then persist `storageState` for
the driven run to reuse.

The token key **varies per app**: P40-60592's app used `striderToken`, not
`access_token`. Do not hardcode it. Scan candidate keys and confirm with the
owner.

Write this to `$WORK/auth-capture.js` and run with `"$NODE_BIN"`.

```js
// auth-capture.js  -- run: "$NODE_BIN" auth-capture.js
const { chromium } = require('playwright');

const STAGE_URL = process.env.STAGE_URL;          // stage base URL
const STATE_PATH = process.env.STATE_PATH || '/tmp/storageState.json';
const TOKEN_PATTERN = /token|auth|jwt|bearer/i;   // candidate key matcher
const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;                 // give the human time to log in

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(STAGE_URL);

  console.log('Log in manually in the opened window. Polling localStorage...');

  const deadline = Date.now() + TIMEOUT_MS;
  let tokenKey = null;
  while (Date.now() < deadline) {
    const candidates = await page.evaluate((src) => {
      const re = new RegExp(src, 'i');
      return Object.keys(localStorage)
        .filter((k) => re.test(k))
        .map((k) => ({ key: k, len: (localStorage.getItem(k) || '').length }));
    }, TOKEN_PATTERN.source);

    // Treat a non-trivial value as a live session signal.
    const live = candidates.find((candidate) => candidate.len > 20);
    if (live) {
      tokenKey = live.key;
      console.log('Found token-ish key:', JSON.stringify(candidates));
      break;
    }
    await page.waitForTimeout(POLL_MS);
  }

  if (!tokenKey) {
    console.error('No token-ish localStorage key found before timeout.');
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: STATE_PATH });
  console.log('Saved storageState to', STATE_PATH, 'token key:', tokenKey);
  await browser.close();
})();
```

Run:

```bash
STAGE_URL="https://stage.example.com" STATE_PATH="$WORK/storageState.json" \
  "$NODE_BIN" "$WORK/auth-capture.js"
```

Notes:

- Show the owner the printed candidate keys and confirm which one is the real
  session token before trusting the saved state.
- `storageState.json` contains **live bearer tokens**. Keep it in `/tmp`, never
  commit it, delete it when done.
- If the driven run later bounces to the SSO host, the session expired: rerun
  this capture.
