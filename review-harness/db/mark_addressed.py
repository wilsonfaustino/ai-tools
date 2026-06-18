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
