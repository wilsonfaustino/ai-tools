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
