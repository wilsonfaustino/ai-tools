# review-harness Phase 2 (persistent triage app + ensure-up hook) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken one-shot review-board page with a persistent, DB-backed local web app (cross-PR dashboard + per-PR triage) that writes triage decisions to the Phase 1 SQLite bus, plus a `--from-db` posting path and an ensure-up hook so the app self-starts when you review.

**Architecture:** The Phase 1 SQLite file (`~/.claude/review-harness/reviews.db`) stays the single source of truth. A Node process (`review-harness/app/`) serves a built React SPA and a small JSON API over `better-sqlite3`, reading reviews/findings and writing back `decision` + edited `body`. Posting stays in `post-review`: a new `--from-db` mode reads the decided findings from the DB (via a Python reader) and posts them, reusing the existing Post Pending Review + mark_posted machinery. A `PreToolUse` hook runs `ensure-up.sh` to health-check and self-start the app when a review skill is invoked.

**Tech Stack:** Node 20 (`node:http`, `node:test` - both stable on v20), `better-sqlite3` (only runtime npm dep), Vite + React (JSX, build-time devDeps), Python 3 stdlib for the reader script. No TypeScript, no server framework, no test framework beyond `node:test` and `unittest`.

## Global Constraints

- DB path: `~/.claude/review-harness/reviews.db`, overridable via env `REVIEW_HARNESS_DB`. WAL mode, `foreign_keys=ON`. Schema source is the existing `review-harness/db/schema.sql` (apply idempotently; do not redefine the schema in the app).
- The app reads and writes the SAME findings/reviews rows the Phase 1 Python scripts use. Column names and the `decision` vocabulary (`pending|inline|general|skip`) and review `status` flow (`triaging -> posted -> awaiting_author -> addressed`) are fixed by Phase 1; do not change them.
- The app MUST be optional: if it is down, the Phase 1 skills still work. Nothing in Phase 1 may be made to depend on the app being up.
- App port: env `REVIEW_HARNESS_PORT`, default `7777`, bound to `127.0.0.1` only (never `0.0.0.0`).
- Runtime DB-script path used by skills stays `~/.claude/review-harness/db/<script>.py` (Phase 1 decision). The new `get_decided.py` installs to the same place (it lives in `review-harness/db/`, picked up by the existing `install.sh` symlink).
- Only runtime npm dependency is `better-sqlite3`. Vite/React are devDependencies. `review-harness/app/node_modules`, `review-harness/app/dist` are gitignored.
- No emojis. No em-dashes. No double dashes in prose or comments. Comments only for non-obvious logic. Descriptive variable names.
- Git: stage files selectively (never `git add -A`). No `Co-Authored-By` trailers. One logical change per commit. Work on a branch off the merged Phase 1 (`review-harness-phase2`). Use the exact commit messages in each task.
- Do NOT write under `~/.claude` from any subagent (symlink/hook/settings install is a user-approved step in the final task). Do NOT run `npx`, `npm install`, the app, or hook installs against the user environment without it being an explicit plan step run in the repo.

---

## File Structure

```
review-harness/
  db/
    get_decided.py          # NEW: reads decided-but-unposted findings for a PR
    tests/test_db.py        # extend: TestGetDecided
  app/                      # NEW Node app
    package.json
    .gitignore              # node_modules, dist
    db.js                   # better-sqlite3 access: listReviews, getReview, saveTriage
    server.js               # node:http: JSON API + static dist serving + /health
    vite.config.js
    index.html
    src/
      main.jsx
      api.js
      App.jsx               # dashboard + per-PR triage in one component
      styles.css
    test/
      db.test.js            # node:test over a temp DB
      server.test.js        # node:test: start server, hit endpoints
  hooks/
    ensure-up.sh            # NEW: health-check + self-start the app
    settings-snippet.json   # NEW: the PreToolUse hook block to merge into settings.json
  install.sh                # extend: also build the app and note hook install
skills/post-review/SKILL.md # extend: --from-db mode
```

---

## Task 1: get_decided.py reader + post-review --from-db mode

**Files:**
- Create: `review-harness/db/get_decided.py`
- Test: `review-harness/db/tests/test_db.py` (add `TestGetDecided`)
- Modify: `skills/post-review/SKILL.md`

**Interfaces:**
- Consumes: `dbcommon.connect` (Phase 1).
- Produces:
  - `get_decided.py`: Input `{owner, repo, pr_number}`. Output `{"review": {...}|null, "decided": [{id, severity, path, line, in_diff, body, decision}]}` returning only findings whose `decision` is `inline` or `general` and whose `posted_at` IS NULL (decided, not yet posted).
  - post-review `--from-db` invocation path.

- [ ] **Step 1: Write the failing test**

Append to `review-harness/db/tests/test_db.py` (before the `if __name__` block):

```python
class TestGetDecided(DbTestCase):
    def _seed_decided(self):
        out = run_script("insert_review.py",
                         {"pr": SAMPLE_PR, "findings": SAMPLE_FINDINGS},
                         self.db_path)
        run_script("set_decisions.py",
                   {"decisions": [{"finding_id": out["finding_ids"][0], "decision": "inline"},
                                  {"finding_id": out["finding_ids"][1], "decision": "skip"}]},
                   self.db_path)
        return out["review_id"], out["finding_ids"]

    def test_returns_only_decided_unposted(self):
        self._seed_decided()
        out = run_script("get_decided.py",
                         {"owner": SAMPLE_PR["owner"], "repo": SAMPLE_PR["repo"],
                          "pr_number": SAMPLE_PR["number"]},
                         self.db_path)
        self.assertEqual(len(out["decided"]), 1)
        self.assertEqual(out["decided"][0]["decision"], "inline")

    def test_excludes_posted(self):
        review_id, finding_ids = self._seed_decided()
        run_script("mark_posted.py",
                   {"review_id": review_id, "posted": [{"finding_id": finding_ids[0]}]},
                   self.db_path)
        out = run_script("get_decided.py",
                         {"owner": SAMPLE_PR["owner"], "repo": SAMPLE_PR["repo"],
                          "pr_number": SAMPLE_PR["number"]},
                         self.db_path)
        self.assertEqual(out["decided"], [])

    def test_absent_review(self):
        out = run_script("get_decided.py",
                         {"owner": "nobody", "repo": "x", "pr_number": 1},
                         self.db_path)
        self.assertIsNone(out["review"])
        self.assertEqual(out["decided"], [])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 review-harness/db/tests/test_db.py TestGetDecided -v`
Expected: FAIL (`get_decided.py` does not exist).

- [ ] **Step 3: Write get_decided.py**

Create `review-harness/db/get_decided.py`:

```python
#!/usr/bin/env python3
"""Read decided-but-unposted findings for a PR (input to post-review --from-db).

Reads {"owner","repo","pr_number"} on stdin. Writes
{"review": {...}|null, "decided": [{...}]} on stdout. A finding is "decided"
when its decision is 'inline' or 'general' and it has not been posted yet
(posted_at IS NULL).
"""
import json
import sys

from dbcommon import connect


def main():
    query = json.load(sys.stdin)
    conn = connect()
    try:
        review = conn.execute(
            "SELECT * FROM reviews WHERE owner=? AND repo=? AND pr_number=?",
            (query["owner"], query["repo"], query["pr_number"]),
        ).fetchone()
        if not review:
            json.dump({"review": None, "decided": []}, sys.stdout)
            return
        decided = conn.execute(
            "SELECT id, severity, path, line, in_diff, body, decision FROM findings"
            " WHERE review_id=? AND decision IN ('inline','general')"
            " AND posted_at IS NULL",
            (review["id"],),
        ).fetchall()
        result = {"review": dict(review), "decided": [dict(row) for row in decided]}
    finally:
        conn.close()
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 review-harness/db/tests/test_db.py TestGetDecided -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the --from-db mode to post-review**

In `skills/post-review/SKILL.md`, add a new section right after the `## From JSON input` section:

````markdown
## From DB input (--from-db)

If the user invokes `/post-review --from-db` (the review was triaged in the
review-harness app), read the decided findings from the DB instead of the
conversation. Skip Parse Context, Noise Threshold, and the Interactive Loop.

Steps:

1. Run pre-flight (`gh auth status`, `gh pr view` for `number,url,headRefOid,owner,repo`). Refuse if auth fails or there is no open PR.
2. Resolve decided findings:

```bash
python3 ~/.claude/review-harness/db/get_decided.py <<JSON
{"owner": "{owner}", "repo": "{repo}", "pr_number": {number}}
JSON
```

   (`{number}` is the integer PR number.) If `review` is null or `decided` is
   empty, abort with `Nothing decided in the app for this PR. Triage it in the
   review-harness app first.`
3. Map each decided finding: `decision == "inline"` becomes an inline comment
   (`path`, `line`, `side: RIGHT`, `body`); `decision == "general"` becomes a
   general comment (body prefixed with `` `path:line` ``). Re-prepend the
   `**[severity]**` tag if missing.
4. Run Post Pending Review Step 1 (inline) and Step 2 (general) exactly as the
   standard path does, using `headRefOid` for `commit_id`.
5. After Step 1 succeeds, record posted state (best-effort, non-fatal):

```bash
python3 ~/.claude/review-harness/db/mark_posted.py <<JSON
{"review_id": <review.id>, "posted": [{"finding_id": <id1>}, {"finding_id": <id2>}]}
JSON
```

6. Run Step 3 Report, then Summary and Verdict unchanged.

The standard invocation and `--from <path>` are unchanged. `--from-db` shares
Post Pending Review, Error Handling, Summary, and Verdict.
````

Also update the top-of-file description line and the `## From JSON input` cross-reference so the three input modes (default, `--from`, `--from-db`) are listed.

- [ ] **Step 6: Smoke-verify get_decided wiring**

```bash
REVIEW_HARNESS_DB=/tmp/rh-p2.db python3 review-harness/db/insert_review.py <<'JSON'
{"pr":{"number":5,"owner":"me","repo":"r","branch":"b","title":"t","head_sha":"s"},
 "findings":[{"severity":"major","path":"x.ts","line":3,"in_diff":true,"body":"**[major]** y"}]}
JSON
REVIEW_HARNESS_DB=/tmp/rh-p2.db python3 review-harness/db/set_decisions.py <<'JSON'
{"decisions":[{"finding_id":1,"decision":"inline"}]}
JSON
REVIEW_HARNESS_DB=/tmp/rh-p2.db python3 review-harness/db/get_decided.py <<'JSON'
{"owner":"me","repo":"r","pr_number":5}
JSON
echo; rm -f /tmp/rh-p2.db
```

Expected: JSON with `review` non-null and one `decided` entry whose `decision` is `inline`.

- [ ] **Step 7: Commit**

```bash
git add review-harness/db/get_decided.py review-harness/db/tests/test_db.py skills/post-review/SKILL.md
git commit -m "review-harness: add get_decided + post-review --from-db mode"
```

---

## Task 2: App scaffold (package.json, db.js, server.js)

**Files:**
- Create: `review-harness/app/package.json`
- Create: `review-harness/app/.gitignore`
- Create: `review-harness/app/db.js`
- Create: `review-harness/app/server.js`
- Test: `review-harness/app/test/db.test.js`, `review-harness/app/test/server.test.js`

**Interfaces:**
- Produces (from `db.js`):
  - `listReviews()` -> array of `{id, pr_number, owner, repo, title, status, updated_at, open_count}` (open_count = findings with decision `pending`)
  - `getReview(id)` -> `{review: {...}, findings: [{...}]}` or `null`
  - `saveTriage(id, items)` where items = `[{id, decision, body}]`; updates each finding's `decision` and `body`; returns `{updated: n}`
  - `openDb()` -> a configured better-sqlite3 handle (WAL, foreign_keys, schema applied)
- Produces (from `server.js`): an HTTP server on `127.0.0.1:PORT` with `GET /health`, `GET /api/reviews`, `GET /api/reviews/:id`, `POST /api/reviews/:id/triage`, and static serving of `dist/` (fallback to `dist/index.html`). Exports `createServer()` for tests.

- [ ] **Step 1: Write package.json**

Create `review-harness/app/package.json`:

```json
{
  "name": "review-harness-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "start": "node server.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Write .gitignore**

Create `review-harness/app/.gitignore`:

```
node_modules
dist
```

- [ ] **Step 3: Install deps**

Run: `npm install --prefix review-harness/app`
Expected: installs `better-sqlite3` (native build) plus vite/react. If the native build of `better-sqlite3` fails, STOP and report BLOCKED (the environment lacks a C toolchain); do not switch libraries without escalating.

- [ ] **Step 4: Write the failing db test**

Create `review-harness/app/test/db.test.js`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dbScripts = join(here, '..', '..', 'db')

function seed(dbPath) {
  const env = { ...process.env, REVIEW_HARNESS_DB: dbPath }
  execFileSync('python3', [join(dbScripts, 'insert_review.py')], {
    input: JSON.stringify({
      pr: { number: 7, owner: 'me', repo: 'r', branch: 'b', title: 't', head_sha: 's' },
      findings: [
        { severity: 'major', path: 'x.ts', line: 3, in_diff: true, body: '**[major]** y' },
        { severity: 'nit', path: 'z.ts', line: 9, in_diff: true, body: '**[nit]** w' },
      ],
    }),
    env,
  })
}

test('listReviews and getReview and saveTriage round-trip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rh-app-'))
  const dbPath = join(dir, 'reviews.db')
  process.env.REVIEW_HARNESS_DB = dbPath
  seed(dbPath)
  const { listReviews, getReview, saveTriage } = await import('../db.js?' + Date.now())

  const reviews = listReviews()
  assert.equal(reviews.length, 1)
  assert.equal(reviews[0].open_count, 2)

  const detail = getReview(reviews[0].id)
  assert.equal(detail.findings.length, 2)

  const res = saveTriage(reviews[0].id, [
    { id: detail.findings[0].id, decision: 'inline', body: '**[major]** edited' },
    { id: detail.findings[1].id, decision: 'skip', body: detail.findings[1].body },
  ])
  assert.equal(res.updated, 2)

  const after = getReview(reviews[0].id)
  const edited = after.findings.find((f) => f.id === detail.findings[0].id)
  assert.equal(edited.decision, 'inline')
  assert.equal(edited.body, '**[major]** edited')
  rmSync(dir, { recursive: true, force: true })
})
```

- [ ] **Step 5: Run db test to verify it fails**

Run: `node --test --test-name-pattern="round-trip" review-harness/app/test/`
Expected: FAIL (`../db.js` not found).

- [ ] **Step 6: Write db.js**

Create `review-harness/app/db.js`:

```javascript
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, '..', 'db', 'schema.sql')

function dbPath() {
  return process.env.REVIEW_HARNESS_DB
    || join(homedir(), '.claude', 'review-harness', 'reviews.db')
}

export function openDb() {
  const handle = new Database(dbPath())
  handle.pragma('journal_mode = WAL')
  handle.pragma('foreign_keys = ON')
  handle.exec(readFileSync(schemaPath, 'utf8'))
  return handle
}

export function listReviews() {
  const handle = openDb()
  try {
    return handle.prepare(
      `SELECT r.id, r.pr_number, r.owner, r.repo, r.title, r.status, r.updated_at,
              (SELECT COUNT(*) FROM findings f
                WHERE f.review_id = r.id AND f.decision = 'pending') AS open_count
         FROM reviews r ORDER BY r.updated_at DESC`,
    ).all()
  } finally {
    handle.close()
  }
}

export function getReview(id) {
  const handle = openDb()
  try {
    const review = handle.prepare('SELECT * FROM reviews WHERE id = ?').get(id)
    if (!review) return null
    const findings = handle.prepare(
      'SELECT * FROM findings WHERE review_id = ? ORDER BY id',
    ).all(id)
    return { review, findings }
  } finally {
    handle.close()
  }
}

export function saveTriage(id, items) {
  const handle = openDb()
  try {
    const stamp = new Date().toISOString()
    const update = handle.prepare(
      'UPDATE findings SET decision = ?, body = ?, updated_at = ? WHERE id = ? AND review_id = ?',
    )
    const run = handle.transaction((rows) => {
      let updated = 0
      for (const row of rows) updated += update.run(row.decision, row.body, stamp, row.id, id).changes
      return updated
    })
    return { updated: run(items) }
  } finally {
    handle.close()
  }
}
```

- [ ] **Step 7: Run db test to verify it passes**

Run: `node --test --test-name-pattern="round-trip" review-harness/app/test/`
Expected: PASS.

- [ ] **Step 8: Write the failing server test**

Create `review-harness/app/test/server.test.js`:

```javascript
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('health and reviews endpoints respond', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rh-srv-'))
  process.env.REVIEW_HARNESS_DB = join(dir, 'reviews.db')
  const { createServer } = await import('../server.js?' + Date.now())
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const health = await fetch(`http://127.0.0.1:${port}/health`)
  assert.equal(health.status, 200)

  const reviews = await fetch(`http://127.0.0.1:${port}/api/reviews`)
  assert.equal(reviews.status, 200)
  assert.deepEqual(await reviews.json(), [])

  await new Promise((resolve) => server.close(resolve))
})
```

- [ ] **Step 9: Run server test to verify it fails**

Run: `node --test --test-name-pattern="endpoints respond" review-harness/app/test/`
Expected: FAIL (`../server.js` not found).

- [ ] **Step 10: Write server.js**

Create `review-harness/app/server.js`:

```javascript
import { createServer as createHttpServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, normalize, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listReviews, getReview, saveTriage } from './db.js'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function serveStatic(res, urlPath) {
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(distDir, safe === '/' ? 'index.html' : safe)
  if (!existsSync(filePath)) filePath = join(distDir, 'index.html')
  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: 'not built; run npm run build' })
    return
  }
  const data = await readFile(filePath)
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' })
  res.end(data)
}

export function createServer() {
  return createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = url.pathname

      if (path === '/health') return sendJson(res, 200, { ok: true })
      if (path === '/api/reviews' && req.method === 'GET') return sendJson(res, 200, listReviews())

      const detail = path.match(/^\/api\/reviews\/(\d+)$/)
      if (detail && req.method === 'GET') {
        const review = getReview(Number(detail[1]))
        return review ? sendJson(res, 200, review) : sendJson(res, 404, { error: 'not found' })
      }

      const triage = path.match(/^\/api\/reviews\/(\d+)\/triage$/)
      if (triage && req.method === 'POST') {
        const parsed = JSON.parse(await readBody(req) || '{}')
        return sendJson(res, 200, saveTriage(Number(triage[1]), parsed.findings || []))
      }

      if (req.method === 'GET') return serveStatic(res, path)
      sendJson(res, 404, { error: 'not found' })
    } catch (err) {
      sendJson(res, 500, { error: String(err && err.message ? err.message : err) })
    }
  })
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const port = Number(process.env.REVIEW_HARNESS_PORT || 7777)
  createServer().listen(port, '127.0.0.1', () => {
    process.stdout.write(`review-harness app on http://127.0.0.1:${port}\n`)
  })
}
```

- [ ] **Step 11: Run both app tests to verify they pass**

Run: `node --test review-harness/app/test/`
Expected: PASS (2 tests).

- [ ] **Step 12: Commit**

```bash
git add review-harness/app/package.json review-harness/app/.gitignore review-harness/app/db.js review-harness/app/server.js review-harness/app/test/db.test.js review-harness/app/test/server.test.js
git commit -m "review-harness: add app server and db access with tests"
```

Note: `package-lock.json` may be created by `npm install`. Stage it too if present (`git add review-harness/app/package-lock.json`) in this commit.

---

## Task 3: React SPA (dashboard + per-PR triage)

**Files:**
- Create: `review-harness/app/vite.config.js`
- Create: `review-harness/app/index.html`
- Create: `review-harness/app/src/main.jsx`
- Create: `review-harness/app/src/api.js`
- Create: `review-harness/app/src/App.jsx`
- Create: `review-harness/app/src/styles.css`

**Interfaces:**
- Consumes: the `/api/reviews`, `/api/reviews/:id`, `/api/reviews/:id/triage` endpoints from Task 2.
- Produces: a built SPA in `dist/` that `server.js` serves. No automated test (verified by the integration build + smoke in Task 5; the API it depends on is already tested).

- [ ] **Step 1: Write vite.config.js**

Create `review-harness/app/vite.config.js`:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:7777' } },
  build: { outDir: 'dist' },
})
```

- [ ] **Step 2: Write index.html**

Create `review-harness/app/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Review Harness</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Write src/api.js**

Create `review-harness/app/src/api.js`:

```javascript
export async function fetchReviews() {
  const res = await fetch('/api/reviews')
  if (!res.ok) throw new Error('failed to load reviews')
  return res.json()
}

export async function fetchReview(id) {
  const res = await fetch(`/api/reviews/${id}`)
  if (!res.ok) throw new Error('failed to load review')
  return res.json()
}

export async function submitTriage(id, findings) {
  const res = await fetch(`/api/reviews/${id}/triage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ findings }),
  })
  if (!res.ok) throw new Error('failed to save triage')
  return res.json()
}
```

- [ ] **Step 4: Write src/main.jsx**

Create `review-harness/app/src/main.jsx`:

```javascript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 5: Write src/App.jsx**

Create `review-harness/app/src/App.jsx`:

```javascript
import { useEffect, useState } from 'react'
import { fetchReviews, fetchReview, submitTriage } from './api.js'

const DECISIONS = ['pending', 'inline', 'general', 'skip']

function Dashboard({ reviews, onOpen }) {
  return (
    <div className="dashboard">
      <h1>Open reviews</h1>
      {reviews.length === 0 && <p className="muted">No reviews yet. Run staff-review.</p>}
      <ul>
        {reviews.map((review) => (
          <li key={review.id}>
            <button className="review-row" onClick={() => onOpen(review.id)}>
              <span className="pr">#{review.pr_number}</span>
              <span className="repo">{review.owner}/{review.repo}</span>
              <span className={`status status-${review.status}`}>{review.status}</span>
              <span className="open">{review.open_count} undecided</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Triage({ detail, onBack, onSaved }) {
  const [rows, setRows] = useState(detail.findings)
  const [saving, setSaving] = useState(false)

  function setRow(id, patch) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  async function save() {
    setSaving(true)
    try {
      await submitTriage(detail.review.id, rows.map((row) => ({
        id: row.id, decision: row.decision, body: row.body,
      })))
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="triage">
      <button className="back" onClick={onBack}>back</button>
      <h1>#{detail.review.pr_number} {detail.review.owner}/{detail.review.repo}</h1>
      {rows.map((row) => (
        <div key={row.id} className={`finding sev-${row.severity}`}>
          <div className="finding-head">
            <code>{row.path}:{row.line}</code>
            <span className="badge">{row.severity}</span>
            {row.in_diff ? null : <span className="badge ood">out-of-diff</span>}
            <select value={row.decision} onChange={(e) => setRow(row.id, { decision: e.target.value })}>
              {DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <textarea value={row.body} onChange={(e) => setRow(row.id, { body: e.target.value })} />
        </div>
      ))}
      <button className="save" disabled={saving} onClick={save}>
        {saving ? 'saving...' : 'Save triage'}
      </button>
      <p className="hint">Then run <code>/post-review --from-db</code> in the PR worktree.</p>
    </div>
  )
}

export default function App() {
  const [reviews, setReviews] = useState([])
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)

  async function loadReviews() {
    try { setReviews(await fetchReviews()) } catch (err) { setError(err.message) }
  }

  useEffect(() => { loadReviews() }, [])

  async function open(id) {
    try { setDetail(await fetchReview(id)) } catch (err) { setError(err.message) }
  }

  if (error) return <div className="error">{error}</div>
  if (detail) {
    return <Triage detail={detail} onBack={() => setDetail(null)}
      onSaved={() => { setDetail(null); loadReviews() }} />
  }
  return <Dashboard reviews={reviews} onOpen={open} />
}
```

- [ ] **Step 6: Write src/styles.css**

Create `review-harness/app/src/styles.css`:

```css
:root { color-scheme: dark; }
body { font-family: -apple-system, system-ui, sans-serif; background: #111; color: #eee; margin: 0; padding: 24px; }
h1 { font-size: 1.2rem; }
.muted { opacity: 0.6; }
ul { list-style: none; padding: 0; }
.review-row { width: 100%; display: flex; gap: 12px; align-items: center; background: #1a1a1a; color: #eee; border: 1px solid #2a2a2a; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; text-align: left; }
.review-row .pr { font-weight: bold; }
.review-row .repo { flex: 1; opacity: 0.8; }
.status { font-size: 0.75rem; padding: 2px 8px; border-radius: 10px; background: #333; }
.status-posted { background: #245; }
.status-addressed { background: #252; }
.status-awaiting_author { background: #443; }
.open { font-size: 0.8rem; opacity: 0.7; }
.back, .save { background: #2a2a2a; color: #eee; border: 1px solid #333; border-radius: 4px; padding: 6px 12px; cursor: pointer; }
.save { background: #2a5a2a; border-color: #3a7a3a; font-weight: bold; margin-top: 12px; }
.save:disabled { opacity: 0.5; cursor: not-allowed; }
.finding { background: #1a1a1a; border-left: 3px solid #555; border-radius: 4px; padding: 10px 12px; margin: 10px 0; }
.finding.sev-critical { border-color: #c44; }
.finding.sev-major { border-color: #d80; }
.finding.sev-minor { border-color: #8b3; }
.finding.sev-nit { border-color: #5ad; }
.finding-head { display: flex; gap: 8px; align-items: center; }
.finding-head code { flex: 1; }
.badge { font-size: 0.7rem; padding: 1px 6px; border-radius: 3px; background: #333; }
.badge.ood { background: #553; color: #fc6; }
.finding textarea { width: 100%; margin-top: 6px; min-height: 48px; background: #111; color: #eee; border: 1px solid #333; padding: 6px; font-family: ui-monospace, Menlo, monospace; font-size: 0.85rem; }
.hint { opacity: 0.6; font-size: 0.85rem; }
.error { color: #fcc; background: #3a1a1a; padding: 12px; border-radius: 4px; }
```

- [ ] **Step 7: Build to verify it compiles**

Run: `npm run build --prefix review-harness/app`
Expected: Vite builds to `review-harness/app/dist/` with no errors.

- [ ] **Step 8: Commit**

```bash
git add review-harness/app/vite.config.js review-harness/app/index.html review-harness/app/src
git commit -m "review-harness: add React triage SPA (dashboard + per-PR triage)"
```

---

## Task 4: ensure-up hook + installer extension

**Files:**
- Create: `review-harness/hooks/ensure-up.sh`
- Create: `review-harness/hooks/settings-snippet.json`
- Modify: `review-harness/install.sh`

**Interfaces:**
- Consumes: `server.js` (Task 2), the built `dist/` (Task 3).
- Produces: a hook script that self-starts the app, and a settings snippet the user merges.

- [ ] **Step 1: Write ensure-up.sh**

Create `review-harness/hooks/ensure-up.sh`:

```bash
#!/usr/bin/env bash
# Health-check the review-harness app and start it detached if it is down.
# Wired as a PreToolUse hook for the review skills. Idempotent and silent on
# success; never blocks the triggering tool call.
set -euo pipefail

port="${REVIEW_HARNESS_PORT:-7777}"
app_dir="$(cd "$(dirname "$0")/../app" && pwd)"

if curl -fsS --max-time 1 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
  exit 0
fi

if [ ! -d "${app_dir}/dist" ]; then
  echo "review-harness app not built (run: npm run build --prefix ${app_dir})" >&2
  exit 0
fi

nohup node "${app_dir}/server.js" >"${app_dir}/.server.log" 2>&1 &
disown || true
exit 0
```

Make it executable: `chmod +x review-harness/hooks/ensure-up.sh`. Add `.server.log` to `review-harness/app/.gitignore`.

- [ ] **Step 2: Write settings-snippet.json**

Create `review-harness/hooks/settings-snippet.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Skill",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.claude/review-harness/hooks/ensure-up.sh"
          }
        ]
      }
    ]
  }
}
```

(This fires the check whenever any Skill runs; `ensure-up.sh` is a sub-second no-op when the app is already up. A tighter matcher can be added later if needed. The command path assumes the installer also links `hooks/`; see install.sh.)

- [ ] **Step 3: Extend install.sh**

In `review-harness/install.sh`, after the existing `db` symlink line, add symlinking of `hooks/` and an app-build reminder. The final script body:

```bash
#!/usr/bin/env bash
# Install review-harness scripts to the stable runtime location the skills and
# hook call. Symlinks the db and hooks dirs into ~/.claude/review-harness, and
# reminds the owner to build the app and merge the hook snippet.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")" && pwd)"
target_dir="$HOME/.claude/review-harness"

mkdir -p "$target_dir"
ln -sfn "$repo_root/db" "$target_dir/db"
ln -sfn "$repo_root/hooks" "$target_dir/hooks"
echo "Linked $target_dir/db -> $repo_root/db"
echo "Linked $target_dir/hooks -> $repo_root/hooks"
echo
echo "Next:"
echo "  1. npm install --prefix $repo_root/app"
echo "  2. npm run build --prefix $repo_root/app"
echo "  3. Merge $repo_root/hooks/settings-snippet.json into ~/.claude/settings.json"
```

- [ ] **Step 4: Verify the hook script is a no-op when app is down-but-unbuilt and syntactically valid**

```bash
bash -n review-harness/hooks/ensure-up.sh && echo "syntax ok"
REVIEW_HARNESS_PORT=59999 bash review-harness/hooks/ensure-up.sh; echo "exit=$?"
```

Expected: `syntax ok`, then (since nothing is on 59999 and `dist/` may exist after Task 3) it either prints the not-built message or starts the server; exit code 0 either way. If it started a server, stop it: `pkill -f "review-harness/app/server.js" || true`.

- [ ] **Step 5: Commit**

```bash
git add review-harness/hooks/ensure-up.sh review-harness/hooks/settings-snippet.json review-harness/install.sh review-harness/app/.gitignore
git commit -m "review-harness: add ensure-up hook and extend installer"
```

---

## Task 5: Integration gate + docs

**Files:**
- Modify: `review-harness/DESIGN.md` (Phase 2 status + run instructions)

- [ ] **Step 1: Full Python suite**

Run: `python3 review-harness/db/tests/test_db.py -v`
Expected: PASS (Phase 1 tests + `TestGetDecided`).

- [ ] **Step 2: Full app suite**

Run: `node --test review-harness/app/test/`
Expected: PASS (db + server tests).

- [ ] **Step 3: End-to-end click-through via the API (throwaway DB)**

```bash
export REVIEW_HARNESS_DB=/tmp/rh-e2e2.db
python3 review-harness/db/insert_review.py <<'JSON'
{"pr":{"number":8,"owner":"me","repo":"r","branch":"b","title":"t","head_sha":"s"},
 "findings":[{"severity":"critical","path":"a.ts","line":1,"in_diff":true,"body":"**[critical]** a"},
             {"severity":"nit","path":"b.ts","line":2,"in_diff":true,"body":"**[nit]** b"}]}
JSON
node review-harness/app/server.js &
SRV=$!
sleep 1
curl -fsS http://127.0.0.1:7777/api/reviews
echo
curl -fsS -X POST http://127.0.0.1:7777/api/reviews/1/triage \
  -H 'Content-Type: application/json' \
  -d '{"findings":[{"id":1,"decision":"inline","body":"**[critical]** a edited"},{"id":2,"decision":"skip","body":"**[nit]** b"}]}'
echo
python3 review-harness/db/get_decided.py <<'JSON'
{"owner":"me","repo":"r","pr_number":8}
JSON
echo
kill $SRV
unset REVIEW_HARNESS_DB; rm -f /tmp/rh-e2e2.db
```

Expected: `/api/reviews` returns one review with `open_count` 2; the triage POST returns `{"updated":2}`; `get_decided.py` then returns exactly one `decided` finding (id 1, decision `inline`, body `**[critical]** a edited`). This proves app-triage -> DB -> post-review-input composes. If any step's output differs, STOP and report BLOCKED with the actual output.

- [ ] **Step 4: Update DESIGN.md**

In `review-harness/DESIGN.md`, update the Phasing section to mark Phase 2 delivered (app + ensure-up hook) with Phase 3 (gh_comment_id backfill, deprecate commands/review-board) remaining, and add a short "## Running the app" section:

```markdown
## Running the app

1. `bash review-harness/install.sh` (links db + hooks, prints next steps).
2. `npm install --prefix review-harness/app` then `npm run build --prefix review-harness/app`.
3. Merge `review-harness/hooks/settings-snippet.json` into `~/.claude/settings.json` so the app self-starts when you run a review skill. Or start it manually: `node review-harness/app/server.js` (http://127.0.0.1:7777).

Flow: staff-review writes findings to the DB, the app lists them and lets you triage (decision + edited body), then `/post-review --from-db` posts the decided ones.
```

- [ ] **Step 5: Commit**

```bash
git add review-harness/DESIGN.md
git commit -m "review-harness: document phase 2 app run instructions"
```

---

## Post-implementation (user-approved, outside the repo)

These touch `~/.claude` and the user environment; run them only with the owner present (not inside an implementer subagent):

1. `bash review-harness/install.sh` (re-link to pick up `hooks/`).
2. `npm install --prefix review-harness/app && npm run build --prefix review-harness/app`.
3. Merge `review-harness/hooks/settings-snippet.json` into `~/.claude/settings.json` (use the update-config skill).
4. Confirm: run a review skill, then open http://127.0.0.1:7777 and verify the dashboard lists the review.

---

## Self-Review

**Spec coverage (vs DESIGN.md Phase 2):**
- Persistent local web app, dashboard + per-PR triage, reads/writes the SQLite bus -> Tasks 2, 3.
- App is optional / never a hard dependency -> server reads the same DB; Phase 1 skills untouched; ensure-up is best-effort.
- ensure-up hook (PreToolUse, replaces launchd) -> Task 4.
- App-triage flows to posting via `--from-db` (chosen bridge) -> Task 1.
- Deferred to Phase 3 (gh_comment_id backfill, deprecate commands/review-board) -> explicitly out of scope, noted in Task 5.

**Placeholder scan:** `{owner}`, `{repo}`, `{number}`, `<id1>`, `<review.id>` in the post-review markdown are runtime fill-ins the skill resolves from live PR/DB context, not plan placeholders. All JS, Python, bash, and config files carry complete content.

**Type consistency:** `decision` vocabulary (`pending|inline|general|skip`) matches Phase 1 `set_decisions`/`get_decided`. `db.js` `saveTriage(id, items)` items use `{id, decision, body}`, matching the server POST shape `{findings:[...]}` and the React submit payload. `listReviews` `open_count` (decision = pending) is consistent between `db.js` and the Dashboard. Server routes match `api.js` paths.

## Notes / open items for Phase 3

- `gh_comment_id` backfill in gh-reply-comments (match live PR comments by path+line, store the id).
- Deprecate/remove `commands/review-board/` once the app fully replaces it.
- Optional: tighten the PreToolUse matcher to only the review skills if firing on every Skill proves noisy.
- Optional: a `dev` workflow note (Vite dev server with `/api` proxy) for iterating on the UI; production path serves the built `dist/`.
```
