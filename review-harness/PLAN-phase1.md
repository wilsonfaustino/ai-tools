# review-harness Phase 1 (SQLite spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the PR-review lifecycle in a shared SQLite database so findings, posted comments, and addressed state survive across sessions and PRs, and wire the three review skills to read/write it.

**Architecture:** SQLite file at `~/.claude/review-harness/reviews.db` is the integration bus. Skill-side Python scripts (stdlib `sqlite3`, zero deps, WAL mode) are CLI tools that read a JSON payload on stdin and print a JSON result on stdout. `staff-review` writes findings, `post-review` marks them posted, `gh-reply-comments` reads the baseline and marks them addressed. No UI in this phase.

**Tech Stack:** Python 3 standard library only. `unittest` for tests, run by file path (no package install, no pytest). `sqlite3` with WAL.

## Global Constraints

- Python standard library only. No third-party packages on the skill side.
- DB path: `~/.claude/review-harness/reviews.db`. Honor env var `REVIEW_HARNESS_DB` as an override (required for tests).
- Open every connection in WAL mode (`PRAGMA journal_mode=WAL`) and with `PRAGMA foreign_keys=ON`.
- Each script reads one JSON object on stdin and writes one JSON object on stdout. Errors go to stderr with a non-zero exit.
- Timestamps are ISO-8601 UTC strings.
- No emojis. No em-dashes. No double dashes in prose or comments.
- Comments only for non-obvious logic; no obvious comments.
- Descriptive variable names.
- Git: stage files selectively (never `git add -A` / `git add .`). No `Co-Authored-By` trailers. One logical change per commit. Work stays on the `review-harness` branch.
- Skill edits are surgical: add the DB step, do not restructure the surrounding skill.

---

## File Structure

```
review-harness/
  db/
    schema.sql           # DDL, idempotent (CREATE TABLE IF NOT EXISTS)
    dbcommon.py          # connect(), get_db_path(), now_iso()
    insert_review.py     # staff-review -> writes review + findings
    set_decisions.py     # triage decisions per finding
    mark_posted.py       # post-review -> gh_comment_id/posted_at, status=posted
    mark_addressed.py    # gh-reply-comments -> addressed_status, status rollup
    get_review.py        # gh-reply-comments -> read baseline (posted findings)
    tests/
      test_db.py         # unittest, drives each script via subprocess
```

Each script imports its sibling `dbcommon` (Python puts the script's own
directory on `sys.path[0]`, so `import dbcommon` resolves when a script is run
directly).

---

## Task 1: DB foundation (schema + dbcommon)

**Files:**
- Create: `review-harness/db/schema.sql`
- Create: `review-harness/db/dbcommon.py`
- Test: `review-harness/db/tests/test_db.py`

**Interfaces:**
- Produces:
  - `dbcommon.get_db_path() -> pathlib.Path` (honors `REVIEW_HARNESS_DB`)
  - `dbcommon.now_iso() -> str` (ISO-8601 UTC)
  - `dbcommon.connect() -> sqlite3.Connection` (creates parent dir, WAL on, foreign_keys on, applies `schema.sql`, `row_factory = sqlite3.Row`)

- [ ] **Step 1: Write the failing test**

Create `review-harness/db/tests/test_db.py`:

```python
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

DB_DIR = Path(__file__).resolve().parent.parent


def run_script(name, payload, db_path):
    env = dict(os.environ)
    env["REVIEW_HARNESS_DB"] = str(db_path)
    proc = subprocess.run(
        [sys.executable, str(DB_DIR / name)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )
    if proc.returncode != 0:
        raise AssertionError(f"{name} failed: {proc.stderr}")
    return json.loads(proc.stdout) if proc.stdout.strip() else None


class DbTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "reviews.db"

    def tearDown(self):
        self.tmp.cleanup()

    def _connect(self):
        sys.path.insert(0, str(DB_DIR))
        os.environ["REVIEW_HARNESS_DB"] = str(self.db_path)
        import importlib
        import dbcommon
        importlib.reload(dbcommon)
        return dbcommon.connect()


class TestFoundation(DbTestCase):
    def test_connect_creates_schema_and_wal(self):
        conn = self._connect()
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        self.assertIn("reviews", tables)
        self.assertIn("findings", tables)
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        self.assertEqual(mode.lower(), "wal")
        conn.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 review-harness/db/tests/test_db.py TestFoundation -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'dbcommon'` or schema file missing).

- [ ] **Step 3: Write schema.sql**

Create `review-harness/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS reviews (
  id          INTEGER PRIMARY KEY,
  pr_number   INTEGER NOT NULL,
  owner       TEXT NOT NULL,
  repo        TEXT NOT NULL,
  branch      TEXT,
  title       TEXT,
  head_sha    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'triaging',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(owner, repo, pr_number)
);

CREATE TABLE IF NOT EXISTS findings (
  id                   INTEGER PRIMARY KEY,
  review_id            INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  severity             TEXT NOT NULL,
  path                 TEXT NOT NULL,
  line                 INTEGER NOT NULL,
  in_diff              INTEGER NOT NULL DEFAULT 1,
  body                 TEXT NOT NULL,
  decision             TEXT NOT NULL DEFAULT 'pending',
  gh_comment_id        INTEGER,
  posted_at            TEXT,
  addressed_status     TEXT NOT NULL DEFAULT 'open',
  addressed_commit_sha TEXT,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id);
```

- [ ] **Step 4: Write dbcommon.py**

Create `review-harness/db/dbcommon.py`:

```python
"""Shared SQLite helpers for the review-harness skill-side scripts."""
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_PATH = Path(__file__).parent / "schema.sql"
DEFAULT_DB = Path.home() / ".claude" / "review-harness" / "reviews.db"


def get_db_path():
    override = os.environ.get("REVIEW_HARNESS_DB")
    return Path(override) if override else DEFAULT_DB


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def connect():
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA_PATH.read_text())
    return conn
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 review-harness/db/tests/test_db.py TestFoundation -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add review-harness/db/schema.sql review-harness/db/dbcommon.py review-harness/db/tests/test_db.py
git commit -m "review-harness: add db schema and connection helper"
```

---

## Task 2: insert_review.py

**Files:**
- Create: `review-harness/db/insert_review.py`
- Test: `review-harness/db/tests/test_db.py` (add `TestInsertReview`)

**Interfaces:**
- Consumes: `dbcommon.connect`, `dbcommon.now_iso`
- Produces: CLI script.
  - Input: `{"pr": {"number","owner","repo","branch","title","head_sha"}, "findings": [{"severity","path","line","in_diff","body"}]}`
  - Output: `{"review_id": int, "finding_ids": [int, ...]}`
  - Idempotent: upserts the review by `(owner, repo, number)`; inserts only findings not already present (dedup key `path+line+severity+body`); updates `head_sha`, `title`, `branch`, `updated_at` on an existing review.

- [ ] **Step 1: Write the failing test**

Append to `review-harness/db/tests/test_db.py` (before the `if __name__` block):

```python
SAMPLE_PR = {
    "number": 423,
    "owner": "wilsonfaustino",
    "repo": "ai-tools",
    "branch": "feature-x",
    "title": "Add feature X",
    "head_sha": "a3f9b21e4c8d5f6a7b8c9d0e1f2a3b4c5d6e7f80",
}
SAMPLE_FINDINGS = [
    {"severity": "critical", "path": "src/db.ts", "line": 88,
     "in_diff": True, "body": "**[critical]** Interpolated input."},
    {"severity": "minor", "path": "src/utils.ts", "line": 9,
     "in_diff": True, "body": "**[minor]** Prefer const."},
]


class TestInsertReview(DbTestCase):
    def test_insert_creates_review_and_findings(self):
        out = run_script(
            "insert_review.py",
            {"pr": SAMPLE_PR, "findings": SAMPLE_FINDINGS},
            self.db_path,
        )
        self.assertIsInstance(out["review_id"], int)
        self.assertEqual(len(out["finding_ids"]), 2)

    def test_rerun_dedups_findings_and_updates_sha(self):
        run_script("insert_review.py",
                   {"pr": SAMPLE_PR, "findings": SAMPLE_FINDINGS}, self.db_path)
        updated_pr = dict(SAMPLE_PR, head_sha="bbbb222233334444555566667777888899990000")
        out = run_script("insert_review.py",
                         {"pr": updated_pr, "findings": SAMPLE_FINDINGS},
                         self.db_path)
        self.assertEqual(len(out["finding_ids"]), 0)
        conn = self._connect()
        sha = conn.execute("SELECT head_sha FROM reviews WHERE id=?",
                           (out["review_id"],)).fetchone()["head_sha"]
        count = conn.execute("SELECT COUNT(*) AS c FROM findings WHERE review_id=?",
                             (out["review_id"],)).fetchone()["c"]
        conn.close()
        self.assertEqual(sha, updated_pr["head_sha"])
        self.assertEqual(count, 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 review-harness/db/tests/test_db.py TestInsertReview -v`
Expected: FAIL (`insert_review.py` does not exist).

- [ ] **Step 3: Write insert_review.py**

Create `review-harness/db/insert_review.py`:

```python
#!/usr/bin/env python3
"""Insert or update a review and its findings (status=triaging).

Reads one JSON object on stdin, writes {"review_id", "finding_ids"} on stdout.
Idempotent: upserts the review by (owner, repo, number); inserts only findings
that are not already present for that review.
"""
import json
import sys

from dbcommon import connect, now_iso


def main():
    payload = json.load(sys.stdin)
    pr = payload["pr"]
    findings = payload.get("findings", [])
    timestamp = now_iso()
    conn = connect()
    try:
        existing_review = conn.execute(
            "SELECT id FROM reviews WHERE owner=? AND repo=? AND pr_number=?",
            (pr["owner"], pr["repo"], pr["number"]),
        ).fetchone()
        if existing_review:
            review_id = existing_review["id"]
            conn.execute(
                "UPDATE reviews SET head_sha=?, title=?, branch=?, updated_at=?"
                " WHERE id=?",
                (pr["head_sha"], pr.get("title"), pr.get("branch"),
                 timestamp, review_id),
            )
        else:
            cursor = conn.execute(
                "INSERT INTO reviews"
                " (pr_number, owner, repo, branch, title, head_sha, status,"
                "  created_at, updated_at)"
                " VALUES (?,?,?,?,?,?, 'triaging', ?, ?)",
                (pr["number"], pr["owner"], pr["repo"], pr.get("branch"),
                 pr.get("title"), pr["head_sha"], timestamp, timestamp),
            )
            review_id = cursor.lastrowid

        seen_keys = {
            (row["path"], row["line"], row["severity"], row["body"])
            for row in conn.execute(
                "SELECT path, line, severity, body FROM findings WHERE review_id=?",
                (review_id,),
            )
        }
        finding_ids = []
        for finding in findings:
            key = (finding["path"], int(finding["line"]),
                   finding["severity"], finding["body"])
            if key in seen_keys:
                continue
            cursor = conn.execute(
                "INSERT INTO findings"
                " (review_id, severity, path, line, in_diff, body, updated_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (review_id, finding["severity"], finding["path"],
                 int(finding["line"]),
                 1 if finding.get("in_diff", True) else 0,
                 finding["body"], timestamp),
            )
            finding_ids.append(cursor.lastrowid)
            seen_keys.add(key)
        conn.commit()
    finally:
        conn.close()
    json.dump({"review_id": review_id, "finding_ids": finding_ids}, sys.stdout)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 review-harness/db/tests/test_db.py TestInsertReview -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add review-harness/db/insert_review.py review-harness/db/tests/test_db.py
git commit -m "review-harness: add insert_review script"
```

---

## Task 3: set_decisions.py and mark_posted.py

**Files:**
- Create: `review-harness/db/set_decisions.py`
- Create: `review-harness/db/mark_posted.py`
- Test: `review-harness/db/tests/test_db.py` (add `TestDecisionsAndPosted`)

**Interfaces:**
- Consumes: `dbcommon.connect`, `dbcommon.now_iso`; finding ids from `insert_review.py`.
- Produces:
  - `set_decisions.py`: Input `{"decisions": [{"finding_id", "decision"}]}` where decision is one of `inline|general|skip|pending`. Output `{"updated": int}`. Rejects invalid decision values with a non-zero exit.
  - `mark_posted.py`: Input `{"review_id": int, "posted": [{"finding_id", "gh_comment_id"?}]}`. Sets `posted_at` (and `gh_comment_id` when provided) on each finding, sets the review `status='posted'`. Output `{"updated": int}`.

- [ ] **Step 1: Write the failing test**

Append to `review-harness/db/tests/test_db.py`:

```python
class TestDecisionsAndPosted(DbTestCase):
    def _seed(self):
        out = run_script("insert_review.py",
                         {"pr": SAMPLE_PR, "findings": SAMPLE_FINDINGS},
                         self.db_path)
        return out["review_id"], out["finding_ids"]

    def test_set_decisions_updates_rows(self):
        _, finding_ids = self._seed()
        out = run_script(
            "set_decisions.py",
            {"decisions": [{"finding_id": finding_ids[0], "decision": "inline"},
                           {"finding_id": finding_ids[1], "decision": "skip"}]},
            self.db_path,
        )
        self.assertEqual(out["updated"], 2)

    def test_set_decisions_rejects_invalid(self):
        _, finding_ids = self._seed()
        with self.assertRaises(AssertionError):
            run_script(
                "set_decisions.py",
                {"decisions": [{"finding_id": finding_ids[0], "decision": "bogus"}]},
                self.db_path,
            )

    def test_mark_posted_sets_ids_and_status(self):
        review_id, finding_ids = self._seed()
        run_script(
            "mark_posted.py",
            {"review_id": review_id,
             "posted": [{"finding_id": finding_ids[0], "gh_comment_id": 555}]},
            self.db_path,
        )
        conn = self._connect()
        finding = conn.execute(
            "SELECT gh_comment_id, posted_at FROM findings WHERE id=?",
            (finding_ids[0],)).fetchone()
        status = conn.execute("SELECT status FROM reviews WHERE id=?",
                              (review_id,)).fetchone()["status"]
        conn.close()
        self.assertEqual(finding["gh_comment_id"], 555)
        self.assertIsNotNone(finding["posted_at"])
        self.assertEqual(status, "posted")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 review-harness/db/tests/test_db.py TestDecisionsAndPosted -v`
Expected: FAIL (`set_decisions.py` / `mark_posted.py` do not exist).

- [ ] **Step 3: Write set_decisions.py**

Create `review-harness/db/set_decisions.py`:

```python
#!/usr/bin/env python3
"""Set the triage decision on findings. Reads JSON on stdin, prints {"updated"}."""
import json
import sys

from dbcommon import connect, now_iso

VALID_DECISIONS = {"inline", "general", "skip", "pending"}


def main():
    payload = json.load(sys.stdin)
    timestamp = now_iso()
    conn = connect()
    updated = 0
    try:
        for decision in payload.get("decisions", []):
            if decision["decision"] not in VALID_DECISIONS:
                raise ValueError(f"invalid decision: {decision['decision']}")
            cursor = conn.execute(
                "UPDATE findings SET decision=?, updated_at=? WHERE id=?",
                (decision["decision"], timestamp, decision["finding_id"]),
            )
            updated += cursor.rowcount
        conn.commit()
    finally:
        conn.close()
    json.dump({"updated": updated}, sys.stdout)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Write mark_posted.py**

Create `review-harness/db/mark_posted.py`:

```python
#!/usr/bin/env python3
"""Mark findings as posted and the review as posted. Reads JSON on stdin.

gh_comment_id is optional: a batch pending review does not return per-comment
ids cleanly, so the reply step matches by path+line. When an id is known it is
stored here for convenience.
"""
import json
import sys

from dbcommon import connect, now_iso


def main():
    payload = json.load(sys.stdin)
    timestamp = now_iso()
    conn = connect()
    updated = 0
    try:
        for posted in payload.get("posted", []):
            cursor = conn.execute(
                "UPDATE findings SET gh_comment_id=?, posted_at=?, updated_at=?"
                " WHERE id=?",
                (posted.get("gh_comment_id"), timestamp, timestamp,
                 posted["finding_id"]),
            )
            updated += cursor.rowcount
        conn.execute(
            "UPDATE reviews SET status='posted', updated_at=? WHERE id=?",
            (timestamp, payload["review_id"]),
        )
        conn.commit()
    finally:
        conn.close()
    json.dump({"updated": updated}, sys.stdout)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 review-harness/db/tests/test_db.py TestDecisionsAndPosted -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add review-harness/db/set_decisions.py review-harness/db/mark_posted.py review-harness/db/tests/test_db.py
git commit -m "review-harness: add set_decisions and mark_posted scripts"
```

---

## Task 4: mark_addressed.py and get_review.py

**Files:**
- Create: `review-harness/db/mark_addressed.py`
- Create: `review-harness/db/get_review.py`
- Test: `review-harness/db/tests/test_db.py` (add `TestAddressedAndGet`)

**Interfaces:**
- Consumes: `dbcommon.connect`, `dbcommon.now_iso`; review/finding ids; `mark_posted.py` to mark a finding posted before addressing.
- Produces:
  - `mark_addressed.py`: Input `{"review_id", "addressed": [{"finding_id", "addressed_status", "addressed_commit_sha"?}]}`, `addressed_status` one of `open|addressed|wont_fix`. Rolls review `status` to `addressed` when every posted finding is `addressed`/`wont_fix`, else `awaiting_author`. Output `{"updated": int, "review_status": str}`.
  - `get_review.py`: Input `{"owner","repo","pr_number"}`. Output `{"review": {...}|null, "posted_findings": [{...}]}` returning only findings with a non-null `posted_at`.

- [ ] **Step 1: Write the failing test**

Append to `review-harness/db/tests/test_db.py`:

```python
class TestAddressedAndGet(DbTestCase):
    def _seed_posted(self):
        out = run_script("insert_review.py",
                         {"pr": SAMPLE_PR, "findings": SAMPLE_FINDINGS},
                         self.db_path)
        run_script("mark_posted.py",
                   {"review_id": out["review_id"],
                    "posted": [{"finding_id": fid} for fid in out["finding_ids"]]},
                   self.db_path)
        return out["review_id"], out["finding_ids"]

    def test_partial_addressed_sets_awaiting_author(self):
        review_id, finding_ids = self._seed_posted()
        out = run_script(
            "mark_addressed.py",
            {"review_id": review_id,
             "addressed": [{"finding_id": finding_ids[0],
                            "addressed_status": "addressed",
                            "addressed_commit_sha": "deadbeef"}]},
            self.db_path,
        )
        self.assertEqual(out["review_status"], "awaiting_author")

    def test_all_addressed_sets_addressed(self):
        review_id, finding_ids = self._seed_posted()
        out = run_script(
            "mark_addressed.py",
            {"review_id": review_id,
             "addressed": [{"finding_id": finding_ids[0], "addressed_status": "addressed"},
                           {"finding_id": finding_ids[1], "addressed_status": "wont_fix"}]},
            self.db_path,
        )
        self.assertEqual(out["review_status"], "addressed")

    def test_get_review_returns_posted_only(self):
        review_id, finding_ids = self._seed_posted()
        out = run_script("get_review.py",
                         {"owner": SAMPLE_PR["owner"], "repo": SAMPLE_PR["repo"],
                          "pr_number": SAMPLE_PR["number"]},
                         self.db_path)
        self.assertEqual(out["review"]["id"], review_id)
        self.assertEqual(len(out["posted_findings"]), 2)

    def test_get_review_absent_returns_null(self):
        out = run_script("get_review.py",
                         {"owner": "nobody", "repo": "nothing", "pr_number": 1},
                         self.db_path)
        self.assertIsNone(out["review"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 review-harness/db/tests/test_db.py TestAddressedAndGet -v`
Expected: FAIL (`mark_addressed.py` / `get_review.py` do not exist).

- [ ] **Step 3: Write mark_addressed.py**

Create `review-harness/db/mark_addressed.py`:

```python
#!/usr/bin/env python3
"""Update addressed state on findings and roll up the review status.

Reads JSON on stdin, writes {"updated", "review_status"} on stdout. The review
becomes 'addressed' only when every posted finding is addressed or wont_fix.
"""
import json
import sys

from dbcommon import connect, now_iso

VALID_STATUSES = {"open", "addressed", "wont_fix"}


def main():
    payload = json.load(sys.stdin)
    review_id = payload["review_id"]
    timestamp = now_iso()
    conn = connect()
    updated = 0
    try:
        for item in payload.get("addressed", []):
            if item["addressed_status"] not in VALID_STATUSES:
                raise ValueError(
                    f"invalid addressed_status: {item['addressed_status']}")
            cursor = conn.execute(
                "UPDATE findings SET addressed_status=?, addressed_commit_sha=?,"
                " updated_at=? WHERE id=?",
                (item["addressed_status"], item.get("addressed_commit_sha"),
                 timestamp, item["finding_id"]),
            )
            updated += cursor.rowcount
        posted_rows = conn.execute(
            "SELECT addressed_status FROM findings"
            " WHERE review_id=? AND posted_at IS NOT NULL",
            (review_id,),
        ).fetchall()
        if posted_rows and all(
            row["addressed_status"] in ("addressed", "wont_fix")
            for row in posted_rows
        ):
            review_status = "addressed"
        else:
            review_status = "awaiting_author"
        conn.execute(
            "UPDATE reviews SET status=?, updated_at=? WHERE id=?",
            (review_status, timestamp, review_id),
        )
        conn.commit()
    finally:
        conn.close()
    json.dump({"updated": updated, "review_status": review_status}, sys.stdout)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Write get_review.py**

Create `review-harness/db/get_review.py`:

```python
#!/usr/bin/env python3
"""Read a review and its posted findings (the reply-checking baseline).

Reads {"owner","repo","pr_number"} on stdin. Writes
{"review": {...}|null, "posted_findings": [{...}]} on stdout.
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
            json.dump({"review": None, "posted_findings": []}, sys.stdout)
            return
        posted = conn.execute(
            "SELECT id, severity, path, line, body, gh_comment_id, posted_at,"
            " addressed_status, addressed_commit_sha FROM findings"
            " WHERE review_id=? AND posted_at IS NOT NULL",
            (review["id"],),
        ).fetchall()
        result = {
            "review": dict(review),
            "posted_findings": [dict(row) for row in posted],
        }
    finally:
        conn.close()
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the whole suite to verify it passes**

Run: `python3 review-harness/db/tests/test_db.py -v`
Expected: PASS (all tests across Tasks 1-4).

- [ ] **Step 6: Commit**

```bash
git add review-harness/db/mark_addressed.py review-harness/db/get_review.py review-harness/db/tests/test_db.py
git commit -m "review-harness: add mark_addressed and get_review scripts"
```

---

## Task 5: Wire staff-review to write findings

**Files:**
- Modify: `skills/staff-review/SKILL.md`

**Interfaces:**
- Consumes: `insert_review.py` (stdin payload, stdout `{review_id, finding_ids}`).
- Produces: a persisted review row that `post-review` and `gh-reply-comments` later read.

staff-review is read-only with respect to GitHub. Writing to the local DB does
not violate that. Add the DB write at the very end, after the Section 3 findings
table is presented, and make it non-fatal (a DB failure must not break the
review output).

- [ ] **Step 1: Add a persistence step to staff-review**

In `skills/staff-review/SKILL.md`, after the section that presents the final
Section 3 findings table, add a new section:

````markdown
## Persist to review-harness

After presenting the findings, persist them so post-review and
gh-reply-comments can track them. This is best-effort: if it fails, report a
one-line warning and continue. Do not abort the review.

Build a JSON payload from the PR identity and the Section 3 findings, then:

```bash
python3 <ai-tools>/review-harness/db/insert_review.py <<'JSON'
{
  "pr": {"number": <n>, "owner": "<owner>", "repo": "<repo>",
         "branch": "<branch>", "title": "<title>", "head_sha": "<sha>"},
  "findings": [
    {"severity": "critical", "path": "src/db.ts", "line": 88,
     "in_diff": true, "body": "**[critical]** ..."}
  ]
}
JSON
```

`<ai-tools>` is the absolute path to the installed ai-tools checkout. Capture
`review_id` from stdout and report it: `Persisted as review <review_id>.`
If the script exits non-zero, print `review-harness: persist skipped (<stderr>)`
and continue.
````

- [ ] **Step 2: Verify with a smoke run**

Run (from the ai-tools repo root, using a throwaway DB):

```bash
REVIEW_HARNESS_DB=/tmp/rh-smoke.db python3 review-harness/db/insert_review.py <<'JSON'
{"pr":{"number":1,"owner":"me","repo":"r","branch":"b","title":"t","head_sha":"abc123"},
 "findings":[{"severity":"minor","path":"a.ts","line":2,"in_diff":true,"body":"**[minor]** x"}]}
JSON
sqlite3 /tmp/rh-smoke.db "SELECT pr_number,status FROM reviews; SELECT path,decision FROM findings;"
rm -f /tmp/rh-smoke.db
```

Expected output:
```
1|triaging
a.ts|pending
```

- [ ] **Step 3: Commit**

```bash
git add skills/staff-review/SKILL.md
git commit -m "staff-review: persist findings to review-harness"
```

---

## Task 6: Wire post-review to mark findings posted

**Files:**
- Modify: `skills/post-review/SKILL.md`

**Interfaces:**
- Consumes: `get_review.py` (to map findings to ids), `set_decisions.py`, `mark_posted.py`.
- Produces: findings with `posted_at` set and review `status='posted'`.

post-review already posts a pending review (Section "Post Pending Review"). Add
a DB write right after Step 1 succeeds, keyed by `review_id`. Match queued
comments to stored findings by `path` and `line`. gh_comment_id is optional
(the batch pending review does not return per-comment ids), so pass only
`finding_id` unless an id is known.

- [ ] **Step 1: Add a DB write to post-review**

In `skills/post-review/SKILL.md`, inside "Post Pending Review", immediately
after "Step 1: Create pending review" succeeds, add:

````markdown
### Step 1b: Record posted findings in review-harness

Best-effort. If it fails, print a one-line warning and continue (the GitHub
review is already posted; DB tracking is secondary).

1. Resolve the review id and finding ids from the DB:

```bash
python3 <ai-tools>/review-harness/db/get_review.py <<JSON
{"owner": "{owner}", "repo": "{repo}", "pr_number": {number}}
JSON
```

   If `review` is null (staff-review did not persist this PR), skip Step 1b.

2. For each queued inline comment, find the stored finding whose `path` and
   `line` match, collecting its `id`. Then mark them posted:

```bash
python3 <ai-tools>/review-harness/db/mark_posted.py <<JSON
{"review_id": <review_id>,
 "posted": [{"finding_id": <id1>}, {"finding_id": <id2>}]}
JSON
```

3. Optionally record the chosen decisions:

```bash
python3 <ai-tools>/review-harness/db/set_decisions.py <<JSON
{"decisions": [{"finding_id": <id1>, "decision": "inline"},
               {"finding_id": <id3>, "decision": "skip"}]}
JSON
```
````

Also add to the `--from <path>` JSON branch: after posting, run the same Step 1b
using `pr.owner`, `pr.repo`, `pr.number` from the JSON.

- [ ] **Step 2: Verify with a smoke run**

```bash
REVIEW_HARNESS_DB=/tmp/rh-smoke.db python3 review-harness/db/insert_review.py <<'JSON'
{"pr":{"number":2,"owner":"me","repo":"r","branch":"b","title":"t","head_sha":"abc123"},
 "findings":[{"severity":"major","path":"x.ts","line":10,"in_diff":true,"body":"**[major]** y"}]}
JSON
RID=$(REVIEW_HARNESS_DB=/tmp/rh-smoke.db python3 review-harness/db/get_review.py <<'JSON'
{"owner":"me","repo":"r","pr_number":2}
JSON
)
echo "$RID"
rm -f /tmp/rh-smoke.db
```

Expected: the printed JSON contains `"review"` with `"status": "triaging"` and one entry in `"posted_findings"` is empty (nothing posted yet). Confirms get_review wiring before the skill uses it.

- [ ] **Step 3: Commit**

```bash
git add skills/post-review/SKILL.md
git commit -m "post-review: record posted findings in review-harness"
```

---

## Task 7: Wire gh-reply-comments to read baseline and mark addressed

**Files:**
- Modify: `skills/gh-reply-comments/SKILL.md`

**Interfaces:**
- Consumes: `get_review.py` (baseline of posted findings), `mark_addressed.py`.
- Produces: findings with `addressed_status` set and review `status` rolled up.

In reviewer-follow-up mode (you reviewed someone and they pushed fixes),
gh-reply-comments should load the stored baseline instead of re-deriving the
full set from the live PR, decide addressed/not per finding, and write the
result back.

- [ ] **Step 1: Add baseline load + writeback to gh-reply-comments**

In `skills/gh-reply-comments/SKILL.md`, in the reviewer-follow-up classification
flow, add:

````markdown
## Load baseline from review-harness

Before classifying threads, load the stored baseline for this PR:

```bash
python3 <ai-tools>/review-harness/db/get_review.py <<JSON
{"owner": "{owner}", "repo": "{repo}", "pr_number": {number}}
JSON
```

If `review` is non-null, use `posted_findings` (match by `path` and `line`) as
the authoritative set of comments you posted. Diff the current PR commits
against `review.head_sha` to decide whether each finding was addressed. If
`review` is null, fall back to the existing live-PR derivation.

## Write addressed state back

After deciding, persist (best-effort, non-fatal):

```bash
python3 <ai-tools>/review-harness/db/mark_addressed.py <<JSON
{"review_id": <review_id>,
 "addressed": [{"finding_id": <id1>, "addressed_status": "addressed",
                "addressed_commit_sha": "<sha>"},
               {"finding_id": <id2>, "addressed_status": "open"}]}
JSON
```

Report the returned `review_status` to the user (for example
`Review now: addressed.`).
````

- [ ] **Step 2: Verify with a smoke run**

```bash
REVIEW_HARNESS_DB=/tmp/rh-smoke.db python3 review-harness/db/insert_review.py <<'JSON'
{"pr":{"number":3,"owner":"me","repo":"r","branch":"b","title":"t","head_sha":"sha0"},
 "findings":[{"severity":"major","path":"x.ts","line":10,"in_diff":true,"body":"**[major]** y"}]}
JSON
FID=$(REVIEW_HARNESS_DB=/tmp/rh-smoke.db python3 - <<'PY'
import json,subprocess,sys
out=subprocess.run([sys.executable,"review-harness/db/get_review.py"],
  input='{"owner":"me","repo":"r","pr_number":3}',capture_output=True,text=True)
print(json.loads(out.stdout))
PY
)
echo "$FID"
rm -f /tmp/rh-smoke.db
```

Expected: prints a dict with `review` not null and `posted_findings` empty (nothing posted in this smoke). Confirms get_review is callable from the skill context.

- [ ] **Step 3: Commit**

```bash
git add skills/gh-reply-comments/SKILL.md
git commit -m "gh-reply-comments: use review-harness baseline and write addressed state"
```

---

## Task 8: Install scripts locally and full-suite gate

**Files:** none (verification + install).

The skills are installed separately from this repo. The DB scripts live under
the ai-tools checkout and are referenced by absolute path, so no `npx skills add`
is needed for the scripts. Confirm the installed skills pick up the edits.

- [ ] **Step 1: Run the full test suite**

Run: `python3 review-harness/db/tests/test_db.py -v`
Expected: PASS (every test from Tasks 1-4).

- [ ] **Step 2: Reinstall the three edited skills**

```bash
npx skills add skills/staff-review skills/post-review skills/gh-reply-comments
```

Expected: each reports installed/updated. (If the project uses a different
install path for skills, follow that instead; do not hand-copy into
`~/.claude/skills`.)

- [ ] **Step 3: End-to-end smoke against a real throwaway DB**

```bash
export REVIEW_HARNESS_DB=/tmp/rh-e2e.db
python3 review-harness/db/insert_review.py <<'JSON'
{"pr":{"number":9,"owner":"me","repo":"r","branch":"b","title":"t","head_sha":"sha0"},
 "findings":[{"severity":"critical","path":"a.ts","line":1,"in_diff":true,"body":"**[critical]** a"},
             {"severity":"minor","path":"b.ts","line":2,"in_diff":true,"body":"**[minor]** b"}]}
JSON
python3 review-harness/db/mark_posted.py <<'JSON'
{"review_id":1,"posted":[{"finding_id":1},{"finding_id":2}]}
JSON
python3 review-harness/db/mark_addressed.py <<'JSON'
{"review_id":1,"addressed":[{"finding_id":1,"addressed_status":"addressed","addressed_commit_sha":"sha1"},
                            {"finding_id":2,"addressed_status":"wont_fix"}]}
JSON
sqlite3 /tmp/rh-e2e.db "SELECT status FROM reviews; SELECT id,posted_at IS NOT NULL,addressed_status FROM findings;"
unset REVIEW_HARNESS_DB
rm -f /tmp/rh-e2e.db
```

Expected output:
```
addressed
1|1|addressed
2|1|wont_fix
```

- [ ] **Step 4: Commit (if any install metadata changed)**

```bash
git status --short
# Commit only files this plan created/modified. Do not stage unrelated changes.
```

---

## Self-Review

**Spec coverage:**
- Data model (reviews, findings, WAL, ~/.claude path, env override) -> Task 1.
- staff-review writes findings -> Task 5.
- post-review writes back gh_comment_id/posted/status -> Tasks 3, 6.
- gh-reply-comments reads baseline + marks addressed -> Tasks 4, 7.
- Status flow triaging -> posted -> awaiting_author -> addressed -> Tasks 2, 3, 4.
- Skills never depend on the app (Phase 1 has no app; all writes are best-effort) -> Tasks 5, 6, 7.
- Phase 2 (Node+React app, ensure-up hook, review-flow repoint, deprecate commands/review-board) -> deferred to a separate plan, by design.

**Placeholder scan:** `<ai-tools>`, `<n>`, `<owner>`, `<review_id>` in the skill-edit tasks are intentional fill-ins the skill resolves at runtime from live PR context, not plan placeholders; every Python file and test carries complete code.

**Type consistency:** script input/output keys are consistent across tasks (`review_id`, `finding_ids`, `finding_id`, `gh_comment_id`, `addressed_status`, `addressed_commit_sha`, `review_status`). `connect`/`now_iso`/`get_db_path` names match Task 1 throughout.

## Notes / open items for Phase 2

- Backfilling `gh_comment_id` per finding (batch pending reviews do not return per-comment ids) lands in Phase 2 when the app needs it; Phase 1 matches by path+line.
- `commands/review-board/` stays in place until Phase 2 supersedes it.
