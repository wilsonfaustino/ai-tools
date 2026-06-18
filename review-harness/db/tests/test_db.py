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


if __name__ == "__main__":
    unittest.main(verbosity=2)
