# Driver script (record video, count network, assert)

The driven run loads the saved `storageState`, records video, counts requests
and responses **filtered to the target endpoint**, fires the trigger with a
**real** Playwright interaction, then asserts the counts and statuses and dumps
any validation errors or notifications.

Fill the placeholders marked `<<...>>` from Step 1 (assertion) and Step 3
(recon). Write to `$WORK/driver.js` and run with `"$NODE_BIN"`.

```js
// driver.js  -- run: "$NODE_BIN" driver.js
const { chromium } = require('playwright');

const STAGE_URL = process.env.STAGE_URL;
const STATE_PATH = process.env.STATE_PATH || '/tmp/storageState.json';
const VIDEO_DIR = process.env.VIDEO_DIR || '/tmp/video';

// --- Parameters (fill from Step 1 + Step 3) ---
const ROUTE = '<<ROUTE_PATH>>';                 // e.g. '/org/123/phenomena/new'
const ENDPOINT = /<<ENDPOINT_REGEX>>/;          // e.g. /\/api\/phenomena$/  (POST target)
const EXPECTED_REQUESTS = 1;                    // the assertion (e.g. 1 POST)
const TRIGGER = '<<TRIGGER_SELECTOR>>';         // e.g. 'button[type=submit]'
// ----------------------------------------------

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: STATE_PATH,
    recordVideo: { dir: VIDEO_DIR },
  });
  const page = await context.newPage();

  // Counters filtered to the target endpoint only.
  const requests = [];
  const responses = [];
  page.on('request', (req) => {
    if (ENDPOINT.test(req.url())) requests.push({ method: req.method(), url: req.url() });
  });
  page.on('response', (res) => {
    if (ENDPOINT.test(res.url())) responses.push({ status: res.status(), url: res.url() });
  });

  await page.goto(STAGE_URL + ROUTE, { waitUntil: 'networkidle' });

  // Session-expiry guard: bail if bounced to the SSO host before asserting.
  if (!page.url().includes(new URL(STAGE_URL).host)) {
    console.error('BOUNCED to', page.url(), '- session expired. Recapture auth.');
    await context.close();
    await browser.close();
    process.exit(2);
  }

  // --- Fire the trigger with a REAL (trusted) interaction ---
  // Programmatic el.click() in page.evaluate does NOT fire React handlers.
  // For a fast double-submit, dblclick fires two trusted clicks; a fix that
  // disables the button in-flight makes the second a no-op => 1 request.
  await page.locator(TRIGGER).dblclick();

  // Let the network settle, then assert.
  await page.waitForTimeout(3000);

  // Surface silent blocks: dump inline validation + antd notifications.
  const errors = await page.evaluate(() => {
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map((n) => n.textContent.trim());
    return {
      formErrors: pick('.ant-form-item-explain-error'),
      notifications: pick('.ant-notification-notice-message, .ant-message-notice-content'),
    };
  });

  console.log('REQUESTS', JSON.stringify(requests, null, 2));
  console.log('RESPONSES', JSON.stringify(responses, null, 2));
  console.log('UI_ERRORS', JSON.stringify(errors, null, 2));

  const ok =
    requests.length === EXPECTED_REQUESTS &&
    responses.every((r) => r.status < 500);
  console.log(ok ? 'PASS' : 'FAIL',
    `expected ${EXPECTED_REQUESTS} request(s), got ${requests.length}`);

  const video = page.video();
  await context.close(); // finalizes the video file
  if (video) console.log('VIDEO', await video.path()); // path for Step 5 ffmpeg
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
```

Run:

```bash
STAGE_URL="https://stage.example.com" STATE_PATH="$WORK/storageState.json" \
  VIDEO_DIR="$WORK/video" "$NODE_BIN" "$WORK/driver.js"
```

Adapt per bug:

- **Trigger.** `dblclick()` reproduces a fast double-submit. For other bugs use
  the interaction that exercises the scenario (`click`, `fill` + `click`, key
  presses). Always a real Playwright action, never `page.evaluate(el.click())`.
- **Assertion.** `EXPECTED_REQUESTS` and the status check encode the UI
  invariant indirectly; add explicit DOM assertions (single entry present,
  button `disabled`) when the invariant is visual.
- **Endpoint filter.** Make `ENDPOINT` tight enough to exclude unrelated
  traffic, or the count is meaningless.
- **Error dump selectors** (`.ant-form-item-explain-error`, `.ant-notification-*`)
  are antd-specific; replace with the recon-confirmed selectors for the app.
