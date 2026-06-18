# Capture script (before/after, force loading, behavior check)

One script, run twice: `PHASE=before` against the unmigrated file, `PHASE=after`
against the migrated file. Same URL, same `storageState`, same states. Filenames
carry the phase so the pairs line up for the Step 7 diff.

Fill the `<<...>>` placeholders from Step 1 (components in scope) and recon (real
selectors and the API endpoint to delay). Write to `$WORK/capture.js`, run with
`"$NODE_BIN"`. Headed by default, desktop 1440x900.

```js
// capture.js  -- run: PHASE=before "$NODE_BIN" capture.js
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL;                 // detectDevServers result
const STATE_PATH = process.env.STATE_PATH;             // downloaded storageState
const PHASE = process.env.PHASE || 'before';           // before | after
const NAME = process.env.NAME || 'component';
const OUT = process.env.OUT || '/tmp';

// --- Parameters (fill from Step 1 + recon) ---
const ROUTE = '<<ROUTE_PATH>>';                        // e.g. '/company/42/edit-methodology'
const API_TO_DELAY = '<<API_GLOB>>';                   // e.g. '**/api/methodology/**' (forces Spin)
const DELAY_MS = 4000;                                 // hold the loading state on screen
const SEARCH_INPUT = '<<SEARCH_SELECTOR>>';            // e.g. 'input[type=search]'
const SEARCH_TERM = '<<SEARCH_TERM>>';                 // a term that filters the list
const ITEM_SELECTOR = '<<ITEM_SELECTOR>>';             // e.g. '.ant-list-item' (count target)
// ----------------------------------------------

const COMPONENT = process.env.COMPONENT || '';         // optional: scope shots to the component
const shot = (page, state) => {
  const path = `${OUT}/${NAME}-${PHASE}-${state}.png`;
  return COMPONENT
    ? page.locator(COMPONENT).screenshot({ path })       // tight diff on the component
    : page.screenshot({ path, fullPage: true });         // whole route, below-fold included
};

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: STATE_PATH,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // 1) LOADING: delay the relevant API so the Spin state is reliably visible.
  let release;
  const gate = new Promise((r) => (release = r));
  await page.route(API_TO_DELAY, async (route) => {
    await gate;                                         // hold until we have the shot
    await route.continue();
  });
  page.goto(BASE_URL + ROUTE).catch(() => {});         // do not await; we shoot mid-load
  await page.waitForTimeout(DELAY_MS);
  const spinners = await page.locator('.ant-spin').count();
  await shot(page, 'loading');
  release();                                           // let the API resume
  await page.unroute(API_TO_DELAY);

  // Session guard: a bounce to a login host means the storageState is dead.
  if (!page.url().includes(new URL(BASE_URL).host)) {
    console.error('BOUNCED to', page.url(), '- recapture auth (storage-download.md).');
    await browser.close();
    process.exit(2);
  }

  // 2) COMPONENT: loaded state.
  await page.waitForLoadState('networkidle');
  await shot(page, 'loaded');
  const itemsBefore = await page.locator(ITEM_SELECTOR).count();

  // 3) BEHAVIOR: real interaction that exercises the target. Search+count is one
  // instance; leave SEARCH_INPUT empty for a presentational component (visual only).
  let itemsAfter = null;
  if (SEARCH_INPUT) {
    await page.locator(SEARCH_INPUT).fill(SEARCH_TERM);
    await page.waitForTimeout(800);                    // debounce
    await shot(page, 'search');
    itemsAfter = await page.locator(ITEM_SELECTOR).count();
  }

  console.log(JSON.stringify({
    phase: PHASE,
    spinners,                                          // Spin count during loading
    itemsLoaded: itemsBefore,
    itemsAfterSearch: itemsAfter,                      // null if no behavior check
  }, null, 2));

  await browser.close();
})();
```

Run both phases:

```bash
BASE_URL="http://localhost:3000" STATE_PATH="$HOME/Downloads/antd-migration-storage.json" \
  NAME="edit-methodology" OUT="$WORK" PHASE=before "$NODE_BIN" "$WORK/capture.js"
# ... apply migration, tsc, tests ...
BASE_URL="http://localhost:3000" STATE_PATH="$HOME/Downloads/antd-migration-storage.json" \
  NAME="edit-methodology" OUT="$WORK" PHASE=after  "$NODE_BIN" "$WORK/capture.js"
```

## Notes

- **Forcing the spinner.** `page.route` holds the API response behind a gate so
  the `Spin` state cannot flash past before the screenshot. Release it after the
  shot and `unroute` so the rest of the run is normal. Tune `DELAY_MS` if the app
  is slow to mount.
- **Element counts** are the cheap regression signal: `.ant-spin` count during
  loading, item count loaded, item count after the search filter. Print them both
  phases and compare in Step 7 alongside the pixels.
- **Real interactions only.** `locator.fill` / `locator.click`, never
  `page.evaluate(el.value = ...)`; programmatic mutations skip React handlers and
  the behavior check proves nothing.
- **Behavior check is per-component.** Search+count fits a list. For another
  component, drive the interaction that exercises it; for a purely presentational
  component, leave `SEARCH_INPUT` empty and rely on the visual diff.
- **Screenshot scope.** Default is `fullPage` so a below-fold component is not
  cut. Set `COMPONENT` to a locator to shoot only the migrated component for the
  tightest diff, dropping unrelated-route noise from the comparison.
- **Unreachable states.** If the data has items, the `Empty` state never renders;
  the count prints `> 0` and you flag empty as covered only by the import swap.
  Do not fabricate an empty fixture unless the owner asks.
- **Selectors are antd-specific and not guessable.** Recon the real DOM first
  (`.ant-spin`, `.ant-list-item`, the actual search input) and fill the
  placeholders from what you see, not assumption.
