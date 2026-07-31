"""Shared SQLite helpers for the review-harness skill-side scripts."""
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_PATH = Path(__file__).parent / "schema.sql"
DEFAULT_DB = Path.home() / ".claude" / "review-harness" / "reviews.db"

REVIEW_COLUMNS = [
    ("author", "TEXT"),
    ("url", "TEXT"),
    ("pr_state", "TEXT"),
    ("review_decision", "TEXT"),
    ("pr_synced_at", "TEXT"),
]

FINDING_COLUMNS = [
    ("sources", "TEXT"),
]


def _migrate(conn):
    for table, columns in (("reviews", REVIEW_COLUMNS), ("findings", FINDING_COLUMNS)):
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        for name, col_type in columns:
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {col_type}")


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
    conn.executescript(SCHEMA_PATH.read_text())
    _migrate(conn)
    conn.commit()
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn
