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
        db_dir = str(DB_DIR)
        if db_dir not in sys.path:
            sys.path.insert(0, db_dir)
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
        foreign_keys_on = conn.execute("PRAGMA foreign_keys").fetchone()[0]
        self.assertEqual(foreign_keys_on, 1)
        conn.close()

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
        self.assertIn("in_diff", out["posted_findings"][0])

    def test_get_review_absent_returns_null(self):
        out = run_script("get_review.py",
                         {"owner": "nobody", "repo": "nothing", "pr_number": 1},
                         self.db_path)
        self.assertIsNone(out["review"])
        self.assertEqual(out["posted_findings"], [])


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
