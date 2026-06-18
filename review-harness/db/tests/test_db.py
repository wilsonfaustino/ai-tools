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
