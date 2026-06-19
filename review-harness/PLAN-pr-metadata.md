# PR Metadata + Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface GitHub PR author, state, review decision, links, and richer finding signal in the review-harness Dashboard and Triage views, snapshot at ingest and refreshable on demand.

**Architecture:** Add columns to `reviews`, migrated idempotently in both the Node (`db.js`) and Python (`dbcommon.py`) connect paths. staff-review writes the new fields at ingest; a new `POST /api/reviews/:id/refresh` re-fetches state via `gh`. Pure helpers in `triage-model.js` derive the combined PR badge, relative age, and severity chips; the React views consume them.

**Tech Stack:** Node 24, better-sqlite3, React + Vite, Python 3 stdlib (`sqlite3`, `unittest`), `gh` CLI.

## Global Constraints

- Two badges: harness `reviews.status` (triage lifecycle) stays; the GitHub badge is separate.
- Combined PR badge precedence: `merged` > `closed` > `approved` > `changes` > `open`.
- Per-finding link = `https://github.com/{owner}/{repo}/blob/{head_sha}/{path}#L{line}`.
- Freshness = snapshot at ingest + manual Refresh (Triage header only). No background sync.
- New columns are additive and nullable. SQLite has no `ADD COLUMN IF NOT EXISTS`: migrate by reading `PRAGMA table_info(reviews)` and adding missing columns.
- New severities outside `critical/warning/suggestion/nit` are ignored in breakdowns (matches existing `counts`).
- App tests: `node --test` from `app/`. Python tests: `unittest` from `db/`.
- Descriptive names, no emojis in code/commits, comments only for non-obvious logic.

---

## File Structure

- `db/schema.sql` — add 5 columns to the `reviews` CREATE (fresh DBs).
- `db/dbcommon.py` — idempotent `_migrate` for existing DBs; called in `connect`.
- `db/insert_review.py` — store + upsert the new fields, stamp `pr_synced_at`.
- `db/tests/test_db.py` — migration + ingest tests.
- `app/db.js` — JS migration mirror, `updatePrMeta`, extended `listReviews`.
- `app/server.js` — refresh endpoint.
- `app/api.js` — `refreshReview` client.
- `app/src/triage-model.js` — `prBadge`, `relativeAge`, `severityChips` helpers + `PR_BADGE_META`.
- `app/test/triage-model.test.js`, `app/test/db.test.js`, `app/test/server.test.js` — unit tests.
- `app/src/App.jsx` — Dashboard row enrichment.
- `app/src/Triage.jsx` — header author/badge/link/refresh.
- `app/src/FindingCard.jsx` — per-finding blob link.
- `app/src/styles.css` — badge/chip/meta styles + `.finding` scroll-margin fix.
- `skills/staff-review/SKILL.md` — gh fetch + payload wiring.

---

## Task 1: reviews schema + Python migration

**Files:**
- Modify: `db/schema.sql`
- Modify: `db/dbcommon.py`
- Test: `db/tests/test_db.py`

**Interfaces:**
- Produces: `reviews` columns `author`, `url`, `pr_state`, `review_decision`, `pr_synced_at` (all `TEXT`, nullable). `dbcommon.connect()` migrates existing DBs.

- [ ] **Step 1: Write the failing test**

Add to `db/tests/test_db.py` inside `class TestFoundation`:

```python
    def test_reviews_has_pr_metadata_columns(self):
        conn = self._connect()
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(reviews)")}
        for col in ("author", "url", "pr_state", "review_decision", "pr_synced_at"):
            self.assertIn(col, cols)

    def test_migration_adds_columns_to_legacy_db(self):
        import sqlite3
        legacy = sqlite3.connect(self.db_path)
        legacy.executescript(
            "CREATE TABLE reviews (id INTEGER PRIMARY KEY, pr_number INTEGER NOT NULL,"
            " owner TEXT NOT NULL, repo TEXT NOT NULL, branch TEXT, title TEXT,"
            " head_sha TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'triaging',"
            " created_at TEXT NOT NULL, updated_at TEXT NOT NULL,"
            " UNIQUE(owner, repo, pr_number));"
        )
        legacy.close()
        conn = self._connect()
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(reviews)")}
        self.assertIn("pr_state", cols)
        self.assertIn("pr_synced_at", cols)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd review-harness/db && python3 -m unittest discover -s tests -p 'test_*.py' -v`
Expected: FAIL — `pr_state` / `pr_synced_at` not in columns.

- [ ] **Step 3: Add columns to schema.sql**

In `db/schema.sql`, replace the `reviews` CREATE with (new lines after `status`):

```sql
CREATE TABLE IF NOT EXISTS reviews (
  id              INTEGER PRIMARY KEY,
  pr_number       INTEGER NOT NULL,
  owner           TEXT NOT NULL,
  repo            TEXT NOT NULL,
  branch          TEXT,
  title           TEXT,
  head_sha        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'triaging',
  author          TEXT,
  url             TEXT,
  pr_state        TEXT,
  review_decision TEXT,
  pr_synced_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(owner, repo, pr_number)
);
```

- [ ] **Step 4: Add the migration to dbcommon.py**

In `db/dbcommon.py`, add after `SCHEMA_PATH`/`DEFAULT_DB`:

```python
REVIEW_COLUMNS = [
    ("author", "TEXT"),
    ("url", "TEXT"),
    ("pr_state", "TEXT"),
    ("review_decision", "TEXT"),
    ("pr_synced_at", "TEXT"),
]


def _migrate(conn):
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(reviews)")}
    for name, col_type in REVIEW_COLUMNS:
        if name not in existing:
            conn.execute(f"ALTER TABLE reviews ADD COLUMN {name} {col_type}")
```

Then in `connect()`, after `conn.executescript(SCHEMA_PATH.read_text())` and before the PRAGMA lines, add:

```python
    _migrate(conn)
    conn.commit()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd review-harness/db && python3 -m unittest discover -s tests -p 'test_*.py' -v`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add review-harness/db/schema.sql review-harness/db/dbcommon.py review-harness/db/tests/test_db.py
git commit -m "review-harness: add PR metadata columns with idempotent migration"
```

---

## Task 2: insert_review stores new fields + upsert

**Files:**
- Modify: `db/insert_review.py`
- Test: `db/tests/test_db.py`

**Interfaces:**
- Consumes: `reviews` columns from Task 1.
- Produces: ingest payload `pr` accepts `author`, `url`, `pr_state`, `review_decision`; stored on insert and refreshed on upsert; `pr_synced_at` stamped both paths.

- [ ] **Step 1: Write the failing test**

Add a new test class to `db/tests/test_db.py`:

```python
class TestPrMetadataIngest(DbTestCase):
    def _payload(self, **pr_overrides):
        pr = {
            "number": 5, "owner": "me", "repo": "r", "branch": "b",
            "title": "t", "head_sha": "sha1", "author": "alice",
            "url": "https://github.com/me/r/pull/5",
            "pr_state": "OPEN", "review_decision": "REVIEW_REQUIRED",
        }
        pr.update(pr_overrides)
        return {"pr": pr, "findings": []}

    def test_insert_stores_pr_metadata(self):
        run_script("insert_review.py", self._payload(), self.db_path)
        conn = self._connect()
        row = conn.execute(
            "SELECT author, url, pr_state, review_decision, pr_synced_at"
            " FROM reviews WHERE pr_number=5"
        ).fetchone()
        self.assertEqual(row["author"], "alice")
        self.assertEqual(row["url"], "https://github.com/me/r/pull/5")
        self.assertEqual(row["pr_state"], "OPEN")
        self.assertEqual(row["review_decision"], "REVIEW_REQUIRED")
        self.assertIsNotNone(row["pr_synced_at"])

    def test_upsert_refreshes_pr_state(self):
        run_script("insert_review.py", self._payload(), self.db_path)
        run_script(
            "insert_review.py",
            self._payload(pr_state="MERGED", review_decision="APPROVED",
                          head_sha="sha2"),
            self.db_path,
        )
        conn = self._connect()
        row = conn.execute(
            "SELECT pr_state, review_decision, head_sha FROM reviews WHERE pr_number=5"
        ).fetchone()
        self.assertEqual(row["pr_state"], "MERGED")
        self.assertEqual(row["review_decision"], "APPROVED")
        self.assertEqual(row["head_sha"], "sha2")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd review-harness/db && python3 -m unittest discover -s tests -p 'test_*.py' -v`
Expected: FAIL — inserted row has `author=None` / `pr_state=None`.

- [ ] **Step 3: Update insert_review.py**

In `db/insert_review.py`, replace the existing-review `UPDATE` block:

```python
            conn.execute(
                "UPDATE reviews SET head_sha=?, title=?, branch=?, author=?,"
                " url=?, pr_state=?, review_decision=?, updated_at=?, pr_synced_at=?"
                " WHERE id=?",
                (pr["head_sha"], pr.get("title"), pr.get("branch"),
                 pr.get("author"), pr.get("url"), pr.get("pr_state"),
                 pr.get("review_decision"), timestamp, timestamp, review_id),
            )
```

And replace the `INSERT` block:

```python
            cursor = conn.execute(
                "INSERT INTO reviews"
                " (pr_number, owner, repo, branch, title, head_sha, author, url,"
                "  pr_state, review_decision, status, created_at, updated_at,"
                "  pr_synced_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?, 'triaging', ?, ?, ?)",
                (pr["number"], pr["owner"], pr["repo"], pr.get("branch"),
                 pr.get("title"), pr["head_sha"], pr.get("author"), pr.get("url"),
                 pr.get("pr_state"), pr.get("review_decision"),
                 timestamp, timestamp, timestamp),
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd review-harness/db && python3 -m unittest discover -s tests -p 'test_*.py' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-harness/db/insert_review.py review-harness/db/tests/test_db.py
git commit -m "review-harness: ingest PR author, url, state, and review decision"
```

---

## Task 3: triage-model PR-badge, age, severity helpers

**Files:**
- Modify: `app/src/triage-model.js`
- Test: `app/test/triage-model.test.js`

**Interfaces:**
- Produces:
  - `PR_BADGE_META` — keyed by kind, each `{ kind, label, color }`.
  - `prBadge(prState, reviewDecision) -> { kind, label, color }`.
  - `relativeAge(iso, nowMs) -> string` (`''` when unparseable).
  - `severityChips(bySeverity) -> [{ severity, count, label, color }]` (zeros omitted, in `SEVERITY_ORDER`).

- [ ] **Step 1: Write the failing test**

Add to `app/test/triage-model.test.js` (extend the import from `../src/triage-model.js` with `prBadge, relativeAge, severityChips`):

```js
test('prBadge follows precedence merged > closed > approved > changes > open', () => {
  assert.equal(prBadge('MERGED', 'APPROVED').kind, 'merged')
  assert.equal(prBadge('CLOSED', 'CHANGES_REQUESTED').kind, 'closed')
  assert.equal(prBadge('OPEN', 'APPROVED').kind, 'approved')
  assert.equal(prBadge('OPEN', 'CHANGES_REQUESTED').kind, 'changes')
  assert.equal(prBadge('OPEN', 'REVIEW_REQUIRED').kind, 'open')
  assert.equal(prBadge(null, null).kind, 'open')
})

test('relativeAge formats common buckets and rejects bad input', () => {
  const now = Date.parse('2026-06-19T12:00:00Z')
  assert.equal(relativeAge('2026-06-19T11:59:30Z', now), 'just now')
  assert.equal(relativeAge('2026-06-19T11:30:00Z', now), '30m ago')
  assert.equal(relativeAge('2026-06-19T09:00:00Z', now), '3h ago')
  assert.equal(relativeAge('2026-06-17T12:00:00Z', now), '2d ago')
  assert.equal(relativeAge('', now), '')
  assert.equal(relativeAge('not-a-date', now), '')
})

test('severityChips omits zeros and keeps SEVERITY_ORDER', () => {
  const chips = severityChips({ critical: 2, warning: 0, suggestion: 1, nit: 0 })
  assert.deepEqual(chips.map((c) => c.severity), ['critical', 'suggestion'])
  assert.equal(chips[0].count, 2)
  assert.equal(chips[0].label, 'Critical')
  assert.deepEqual(severityChips(undefined), [])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd review-harness/app && npm test`
Expected: FAIL — `prBadge is not defined`.

- [ ] **Step 3: Implement the helpers**

Append to `app/src/triage-model.js`:

```js
export const PR_BADGE_META = {
  merged: { kind: 'merged', label: 'merged', color: '#A371F7' },
  closed: { kind: 'closed', label: 'closed', color: '#8892A0' },
  approved: { kind: 'approved', label: 'approved', color: '#2FA56B' },
  changes: { kind: 'changes', label: 'changes', color: '#F2545B' },
  open: { kind: 'open', label: 'open', color: '#5B8DEF' },
}

export function prBadge(prState, reviewDecision) {
  if (prState === 'MERGED') return PR_BADGE_META.merged
  if (prState === 'CLOSED') return PR_BADGE_META.closed
  if (reviewDecision === 'APPROVED') return PR_BADGE_META.approved
  if (reviewDecision === 'CHANGES_REQUESTED') return PR_BADGE_META.changes
  return PR_BADGE_META.open
}

export function relativeAge(iso, nowMs) {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.round((nowMs - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function severityChips(bySeverity) {
  return SEVERITY_ORDER
    .filter((severity) => (bySeverity?.[severity] || 0) > 0)
    .map((severity) => ({
      severity,
      count: bySeverity[severity],
      label: SEVERITY_META[severity].label,
      color: SEVERITY_META[severity].color,
    }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd review-harness/app && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-harness/app/src/triage-model.js review-harness/app/test/triage-model.test.js
git commit -m "review-harness: add prBadge, relativeAge, severityChips helpers"
```

---

## Task 4: db.js migration, updatePrMeta, extended listReviews

**Files:**
- Modify: `app/db.js`
- Test: `app/test/db.test.js`

**Interfaces:**
- Consumes: `reviews` columns (Task 1); `insert_review.py` payload (Task 2).
- Produces:
  - `openDb()` runs the same column migration as Python.
  - `listReviews()` rows add `author, url, title, pr_state, review_decision, pr_synced_at, updated_at, pending_count, posted_count, addressed_count, severity:{critical,warning,suggestion,nit}` (pending findings only). `open_count` is renamed to `pending_count`.
  - `updatePrMeta(id, { pr_state, review_decision, author, url, title }) -> number` (rows changed); stamps `pr_synced_at`.

- [ ] **Step 1: Update the failing test**

In `app/test/db.test.js`: (a) extend the `seed` payload `pr` object with metadata, (b) replace the `open_count` assertion, (c) add `updatePrMeta` coverage. Replace the file body's `pr` literal and the assertions block:

In `seed`, change the `pr` line to:

```js
      pr: {
        number: 7, owner: 'me', repo: 'r', branch: 'b', title: 't', head_sha: 's',
        author: 'alice', url: 'https://github.com/me/r/pull/7',
        pr_state: 'OPEN', review_decision: 'REVIEW_REQUIRED',
      },
```

Replace `assert.equal(reviews[0].open_count, 2)` with:

```js
  assert.equal(reviews[0].pending_count, 2)
  assert.equal(reviews[0].author, 'alice')
  assert.equal(reviews[0].pr_state, 'OPEN')
  assert.equal(reviews[0].severity.major === undefined, true)
  assert.equal(reviews[0].severity.nit, 1)
```

Add a second test at the end of the file:

```js
test('updatePrMeta refreshes state and stamps pr_synced_at', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rh-meta-'))
  const dbPath = join(dir, 'reviews.db')
  process.env.REVIEW_HARNESS_DB = dbPath
  seed(dbPath)
  const { listReviews, updatePrMeta } = await import('../db.js?' + Date.now())
  const id = listReviews()[0].id

  const changed = updatePrMeta(id, {
    pr_state: 'MERGED', review_decision: 'APPROVED',
    author: 'alice', url: 'u', title: 't2',
  })
  assert.equal(changed, 1)

  const row = listReviews()[0]
  assert.equal(row.pr_state, 'MERGED')
  assert.equal(row.review_decision, 'APPROVED')
  assert.equal(row.title, 't2')
  assert.ok(row.pr_synced_at)
  rmSync(dir, { recursive: true, force: true })
})
```

Note: the seed uses severity `major` (unknown) and `nit`; `severity.nit` must be 1 and `severity.major` absent, proving unknown severities are dropped from the breakdown.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd review-harness/app && npm test`
Expected: FAIL — `pending_count`/`severity`/`updatePrMeta` undefined.

- [ ] **Step 3: Add migration + updatePrMeta + extend listReviews**

In `app/db.js`, after the imports add:

```js
const REVIEW_COLUMNS = [
  ['author', 'TEXT'], ['url', 'TEXT'], ['pr_state', 'TEXT'],
  ['review_decision', 'TEXT'], ['pr_synced_at', 'TEXT'],
]

function applyMigrations(handle) {
  const existing = new Set(handle.prepare('PRAGMA table_info(reviews)').all().map((column) => column.name))
  for (const [name, type] of REVIEW_COLUMNS) {
    if (!existing.has(name)) handle.exec(`ALTER TABLE reviews ADD COLUMN ${name} ${type}`)
  }
}
```

In `openDb()`, after `handle.exec(readFileSync(schemaPath, 'utf8'))`, add:

```js
  applyMigrations(handle)
```

Replace `listReviews()` with:

```js
export function listReviews() {
  const handle = openDb()
  try {
    const rows = handle.prepare(
      `SELECT r.id, r.pr_number, r.owner, r.repo, r.title, r.author, r.url,
              r.status, r.pr_state, r.review_decision, r.pr_synced_at, r.updated_at,
              (SELECT COUNT(*) FROM findings f
                 WHERE f.review_id = r.id AND f.decision = 'pending') AS pending_count,
              (SELECT COUNT(*) FROM findings f
                 WHERE f.review_id = r.id AND f.posted_at IS NOT NULL) AS posted_count,
              (SELECT COUNT(*) FROM findings f
                 WHERE f.review_id = r.id AND f.addressed_status = 'addressed') AS addressed_count
         FROM reviews r ORDER BY r.updated_at DESC`,
    ).all()
    const severityRows = handle.prepare(
      `SELECT review_id, severity, COUNT(*) AS n
         FROM findings WHERE decision = 'pending'
        GROUP BY review_id, severity`,
    ).all()
    const severityByReview = {}
    for (const severityRow of severityRows) {
      (severityByReview[severityRow.review_id] ||= {})[severityRow.severity] = severityRow.n
    }
    return rows.map((row) => ({
      ...row,
      severity: {
        critical: severityByReview[row.id]?.critical || 0,
        warning: severityByReview[row.id]?.warning || 0,
        suggestion: severityByReview[row.id]?.suggestion || 0,
        nit: severityByReview[row.id]?.nit || 0,
      },
    }))
  } finally {
    handle.close()
  }
}
```

Add `updatePrMeta` after `saveTriage`:

```js
export function updatePrMeta(id, meta) {
  const handle = openDb()
  try {
    const stamp = new Date().toISOString()
    const info = handle.prepare(
      `UPDATE reviews SET pr_state = ?, review_decision = ?, author = ?, url = ?,
              title = ?, pr_synced_at = ? WHERE id = ?`,
    ).run(meta.pr_state ?? null, meta.review_decision ?? null, meta.author ?? null,
          meta.url ?? null, meta.title ?? null, stamp, id)
    return info.changes
  } finally {
    handle.close()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd review-harness/app && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-harness/app/db.js review-harness/app/test/db.test.js
git commit -m "review-harness: migrate db.js, add updatePrMeta and richer listReviews"
```

---

## Task 5: refresh endpoint + api client

**Files:**
- Modify: `app/server.js`
- Modify: `app/api.js`
- Test: `app/test/server.test.js`

**Interfaces:**
- Consumes: `getReview` (existing), `updatePrMeta` (Task 4).
- Produces: `POST /api/reviews/:id/refresh` — 404 unknown id, 502 on gh failure, 200 with `getReview(id)` shape on success. `refreshReview(id)` client.

- [ ] **Step 1: Write the failing test**

Add to `app/test/server.test.js`:

```js
test('refresh returns 404 for an unknown review', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rh-refresh-'))
  process.env.REVIEW_HARNESS_DB = join(dir, 'reviews.db')
  const { createServer } = await import('../server.js?' + Date.now())
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const res = await fetch(`http://127.0.0.1:${port}/api/reviews/999/refresh`, { method: 'POST' })
  assert.equal(res.status, 404)

  await new Promise((resolve) => server.close(resolve))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd review-harness/app && npm test`
Expected: FAIL — route not handled, returns 404 from the fallthrough only if matched; current code returns 404 generic but the test passes by accident only if the regex exists. Confirm it FAILS first by checking the route is absent (the generic `sendJson(res, 404)` path is reached for POST, so this may already return 404). If it already returns 404, still add the route in Step 3 so the success path exists; treat this test as a guard.

Note: because the generic handler already 404s unknown POSTs, this test guards the contract rather than driving it. The behavior the route adds (404 only after confirming the id is missing, 200/502 otherwise) is verified manually in Task 7's checklist.

- [ ] **Step 3: Add the endpoint and client**

In `app/server.js`, change the import:

```js
import { listReviews, getReview, saveTriage, updatePrMeta } from './db.js'
```

Add near the top (after the other imports):

```js
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
```

In the handler, add before `if (req.method === 'GET') return serveStatic(...)`:

```js
      const refresh = path.match(/^\/api\/reviews\/(\d+)\/refresh$/)
      if (refresh && req.method === 'POST') {
        const id = Number(refresh[1])
        const existing = getReview(id)
        if (!existing) return sendJson(res, 404, { error: 'not found' })
        const { owner, repo, pr_number: prNumber } = existing.review
        try {
          const { stdout } = await execFileAsync('gh', [
            'pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`,
            '--json', 'state,reviewDecision,author,title,url',
            '--jq', '{state,reviewDecision,author:.author.login,title,url}',
          ])
          const meta = JSON.parse(stdout)
          updatePrMeta(id, {
            pr_state: meta.state, review_decision: meta.reviewDecision || '',
            author: meta.author, url: meta.url, title: meta.title,
          })
          return sendJson(res, 200, getReview(id))
        } catch (err) {
          return sendJson(res, 502, { error: `gh refresh failed: ${err && err.message ? err.message : err}` })
        }
      }
```

In `app/api.js`, append:

```js
export async function refreshReview(id) {
  const res = await fetch(`/api/reviews/${id}/refresh`, { method: 'POST' })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error || 'failed to refresh')
  }
  return res.json()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd review-harness/app && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-harness/app/server.js review-harness/app/api.js review-harness/app/test/server.test.js
git commit -m "review-harness: add PR-state refresh endpoint backed by gh"
```

---

## Task 6: Dashboard list enrichment

**Files:**
- Modify: `app/src/App.jsx`
- Modify: `app/src/styles.css`

**Interfaces:**
- Consumes: `listReviews` row shape (Task 4); `prBadge`, `relativeAge`, `severityChips` (Task 3).

- [ ] **Step 1: Update the Dashboard component**

In `app/src/App.jsx`, change the imports:

```js
import { prBadge, relativeAge, severityChips } from './triage-model.js'
```

Replace the `Dashboard` function with:

```jsx
function Dashboard({ reviews, onOpen }) {
  const now = Date.now()
  return (
    <div className="dashboard">
      <h1 className="dash-title">Open reviews</h1>
      {reviews.length === 0 && <p className="muted">No reviews yet. Run staff-review.</p>}
      <ul className="review-list">
        {reviews.map((review) => {
          const badge = prBadge(review.pr_state, review.review_decision)
          const chips = severityChips(review.severity)
          return (
            <li key={review.id}>
              <button className="review-row" onClick={() => onOpen(review.id)}>
                <span className="pr">#{review.pr_number}</span>
                <span className="repo">{review.owner}/{review.repo}</span>
                <span className="row-title">{review.title}</span>
                {review.author && <span className="author">@{review.author}</span>}
                <span className="pr-badge" style={{ '--badge': badge.color }}>{badge.label}</span>
                <span className={`status status-${review.status}`}>{review.status}</span>
                <span className="spacer" />
                <span className="sev-mini">
                  {chips.map((chip) => (
                    <span key={chip.severity} className="sev-mini-item" style={{ color: chip.color }}>
                      {chip.count}{chip.label[0]}
                    </span>
                  ))}
                </span>
                <span className="open">{review.pending_count} undecided</span>
                {review.posted_count > 0 && <span className="meta-soft">{review.posted_count} posted</span>}
                {review.addressed_count > 0 && <span className="meta-soft">{review.addressed_count} addressed</span>}
                <span className="age">{relativeAge(review.updated_at, now)}</span>
                {review.url && (
                  <a className="gh-link" href={review.url} target="_blank" rel="noreferrer"
                     onClick={(event) => event.stopPropagation()} title="Open PR on GitHub">↗</a>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Add the styles**

Append to `app/src/styles.css`:

```css
.review-row .row-title { color: #C2C8D2; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px; }
.review-row .author { color: #8892A0; font-size: 12px; }
.review-row .spacer { flex: 1; }
.pr-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; color: var(--badge); border: 1px solid color-mix(in srgb, var(--badge) 45%, transparent); background: color-mix(in srgb, var(--badge) 14%, transparent); }
.sev-mini { display: inline-flex; gap: 8px; font-size: 12px; font-weight: 600; }
.sev-mini-item { font-variant-numeric: tabular-nums; }
.review-row .meta-soft { color: #646C7A; font-size: 12px; }
.review-row .age { color: #646C7A; font-size: 12px; min-width: 56px; text-align: right; }
.gh-link { color: #5B8DEF; text-decoration: none; font-size: 14px; padding: 0 4px; }
.gh-link:hover { color: #8FB4FF; }
```

- [ ] **Step 3: Build to verify it compiles**

Run: `cd review-harness/app && npm run build`
Expected: build succeeds, no JSX/import errors.

- [ ] **Step 4: Manual browser check**

Run (Node 24): `cd review-harness/app && REVIEW_HARNESS_DB=$HOME/.claude/review-harness/reviews.db node server.js` then open `http://127.0.0.1:7777`.
Confirm each row shows: title, `@author`, a colored PR badge, the triage status badge, severity mini counts, `N undecided`, age, and a working `↗` link to the PR.

- [ ] **Step 5: Commit**

```bash
git add review-harness/app/src/App.jsx review-harness/app/src/styles.css
git commit -m "review-harness: enrich dashboard rows with PR badge, author, severity, age"
```

---

## Task 7: Triage header, per-finding link, scroll fix

**Files:**
- Modify: `app/src/Triage.jsx`
- Modify: `app/src/FindingCard.jsx`
- Modify: `app/src/styles.css`

**Interfaces:**
- Consumes: `detail.review` fields (`author`, `url`, `pr_state`, `review_decision`, `pr_synced_at`, `owner`, `repo`, `head_sha`); `prBadge`, `relativeAge` (Task 3); `refreshReview` (Task 5).

- [ ] **Step 1: Add header metadata + Refresh to Triage.jsx**

In `app/src/Triage.jsx`, extend the imports:

```js
import { submitTriage, refreshReview } from './api.js'
```

```js
import {
  SEVERITY_ORDER, SEVERITY_META, ACTION_META,
  filterFindings, groupBySeverity, counts, prBadge, relativeAge,
} from './triage-model.js'
```

Add state near the other `useState` calls:

```js
  const [review, setReview] = useState(detail.review)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState(null)
```

Add a handler after `save()`:

```js
  async function refresh() {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const updated = await refreshReview(review.id)
      setReview(updated.review)
      if (onSaved) onSaved()
    } catch (err) {
      setRefreshError(err.message)
    } finally {
      setRefreshing(false)
    }
  }
```

In the header, replace the `title-row` block with:

```jsx
              <div className="title-row">
                <span className="pr-num">#{review.pr_number}</span>
                <span className="repo-slug">{review.owner}/{review.repo}</span>
                {(() => { const badge = prBadge(review.pr_state, review.review_decision)
                  return <span className="pr-badge" style={{ '--badge': badge.color }}>{badge.label}</span> })()}
                {review.author && <span className="author">@{review.author}</span>}
                {review.url && (
                  <a className="gh-link" href={review.url} target="_blank" rel="noreferrer" title="Open PR on GitHub">↗</a>
                )}
                <button className="refresh-btn" onClick={refresh} disabled={refreshing}>
                  {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
                {review.pr_synced_at && <span className="synced">synced {relativeAge(review.pr_synced_at, Date.now())}</span>}
                {refreshError && <span className="refresh-error">{refreshError}</span>}
              </div>
```

Pass the git ref to each card by changing the `FindingCard` render to include:

```jsx
              <FindingCard key={finding.id} finding={finding}
                gitRef={{ owner: review.owner, repo: review.repo, head_sha: review.head_sha }}
                focused={finding.id === focusedId}
                expanded={finding.id === expandedId}
                onFocus={focus} onAction={setAction} onBodyChange={setBody} onToggleExpand={toggleExpand} />
```

Note: other header references to `detail.review.pr_number` etc. are now `review.*`; update the two `detail.review.owner/repo` reads in the header to `review.owner/repo`. The `save()` call keeps `detail.review.id` (or use `review.id`).

- [ ] **Step 2: Add the per-finding blob link in FindingCard.jsx**

In `app/src/FindingCard.jsx`, update the signature:

```jsx
export default function FindingCard({ finding, gitRef, focused, expanded, onFocus, onAction, onBodyChange, onToggleExpand }) {
```

After the `name` computation, add:

```jsx
  const blobUrl = gitRef
    ? `https://github.com/${gitRef.owner}/${gitRef.repo}/blob/${gitRef.head_sha}/${finding.path}#L${finding.line}`
    : null
```

In `finding-head`, after the `file-pill` `</code>`, add:

```jsx
        {blobUrl && (
          <a className="gh-link finding-link" href={blobUrl} target="_blank" rel="noreferrer"
             onClick={(event) => event.stopPropagation()} title="Open file at reviewed commit">↗</a>
        )}
```

- [ ] **Step 3: Add styles + the scroll-margin fix**

Append to `app/src/styles.css`:

```css
.title-row .pr-badge { margin-left: 4px; }
.title-row .author { color: #8892A0; font-size: 13px; }
.refresh-btn { background: #2A3140; color: #C2C8D2; border: 1px solid #3A4250; border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.refresh-btn:disabled { opacity: 0.6; cursor: default; }
.synced { color: #646C7A; font-size: 12px; }
.refresh-error { color: #F2545B; font-size: 12px; }
.finding-link { font-size: 13px; }
.finding { scroll-margin-top: 140px; }
```

Note: `140px` targets the sticky `.triage-header` (title row + chip row). Verify in Step 5; if the focused card still hides under the header on J/K, increase to match the real header height.

- [ ] **Step 4: Build to verify it compiles**

Run: `cd review-harness/app && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual browser check**

With the server running (see Task 6 Step 4), open a review. Confirm: header shows PR badge, `@author`, `↗` PR link, a Refresh button, and `synced ... ago`; each finding shows a `↗` that opens the file at `head_sha`; pressing `J`/`K` scrolls the focused card fully into view below the sticky header (not hidden under it). Click Refresh on a real PR and confirm the badge updates (or an inline error if gh fails).

- [ ] **Step 6: Commit**

```bash
git add review-harness/app/src/Triage.jsx review-harness/app/src/FindingCard.jsx review-harness/app/src/styles.css
git commit -m "review-harness: triage header PR metadata, refresh, finding links, scroll fix"
```

---

## Task 8: Wire staff-review ingestion

**Files:**
- Modify: `skills/staff-review/SKILL.md`

**Interfaces:**
- Consumes: `insert_review.py` payload (Task 2).

- [ ] **Step 1: Extend the gh pre-flight fetch**

In `skills/staff-review/SKILL.md`, replace the pre-flight `gh pr view` line (around line 39) with:

```bash
gh pr view --json number,url,author,baseRefName,state,reviewDecision \
  --jq '{number, url, author: .author.login, base: .baseRefName, state, reviewDecision}'
```

- [ ] **Step 2: Extend the insert_review payload**

In the persist block (around line 480), replace the `pr` object with:

```
  "pr": {"number": <n>, "owner": "<owner>", "repo": "<repo>",
         "branch": "<branch>", "title": "<title>", "head_sha": "<sha>",
         "author": "<author>", "url": "<pr_url>",
         "pr_state": "<state>", "review_decision": "<reviewDecision>"},
```

Add one sentence after the payload note: "`author`, `url`, `pr_state`, and `review_decision` come from the pre-flight `gh pr view` fetch; `review_decision` may be empty."

- [ ] **Step 3: Verify the document reads correctly**

Run: `sed -n '36,46p;476,492p' skills/staff-review/SKILL.md`
Expected: the gh fetch includes `state,reviewDecision`; the payload includes the four new fields.

- [ ] **Step 4: Commit**

```bash
git add skills/staff-review/SKILL.md
git commit -m "staff-review: pass PR author, url, state, and review decision to the harness"
```

---

## Self-Review

**Spec coverage:**
- Author + PR state -> Tasks 1, 2, 8 (ingest), 6, 7 (display).
- PR url + per-finding blob link -> Tasks 6 (list), 7 (header + card).
- Severity breakdown -> Tasks 3 (`severityChips`), 4 (`listReviews.severity`), 6 (render).
- Triage progress + age -> Tasks 4 (`posted_count`/`addressed_count`/`updated_at`), 3 (`relativeAge`), 6 (render).
- Card scroll fix -> Task 7 Step 3.
- Refresh (snapshot + button) -> Tasks 2/4 (snapshot), 5 (endpoint), 7 (button).
- Two-badge decision -> Tasks 6, 7 keep `status-${review.status}` alongside `pr-badge`.
- Migration for existing DB -> Tasks 1 (Python), 4 (JS).

**Placeholder scan:** No TBD/TODO; every code step has full code. The one tunable (`scroll-margin-top: 140px`) ships a concrete value with a verify-and-adjust step.

**Type consistency:** `prBadge` returns `{ kind, label, color }`, used by `.label`/`.color` in Tasks 6/7. `listReviews` emits `pending_count` (rename from `open_count`) consumed in Task 6 and updated in Task 4's test. `updatePrMeta(id, meta)` keys match between Task 4 (def), Task 5 (caller), Task 4 test. `gitRef` prop shape `{owner,repo,head_sha}` defined in Task 7 Triage and consumed in Task 7 FindingCard. Severity map keys `critical/warning/suggestion/nit` consistent across Tasks 3/4/6.

**Known limitation:** the refresh gh success/502 paths are not unit-tested (shells out); covered by Task 7 manual check. Documented in spec.
