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
