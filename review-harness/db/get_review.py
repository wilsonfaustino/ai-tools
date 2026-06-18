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
            "SELECT id, severity, path, line, in_diff, body, gh_comment_id, posted_at,"
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
