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
                "UPDATE reviews SET head_sha=?, title=?, branch=?, author=?,"
                " url=?, pr_state=?, review_decision=?, updated_at=?, pr_synced_at=?"
                " WHERE id=?",
                (pr["head_sha"], pr.get("title"), pr.get("branch"),
                 pr.get("author"), pr.get("url"), pr.get("pr_state"),
                 pr.get("review_decision"), timestamp, timestamp, review_id),
            )
        else:
            cursor = conn.execute(
                "INSERT INTO reviews"
                " (pr_number, owner, repo, branch, title, head_sha, author, url,"
                "  pr_state, review_decision, status, created_at, updated_at,"
                "  pr_synced_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?, 'triaging', ?, ?, ?)",
                (pr["number"], pr["owner"], pr["repo"], pr.get("branch"),
                 pr.get("title"), pr["head_sha"], pr.get("author"), pr.get("url"),
                 pr.get("pr_state"), pr.get("review_decision"),
                 timestamp, timestamp, timestamp),
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
                " (review_id, severity, path, line, in_diff, body, sources,"
                "  updated_at)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (review_id, finding["severity"], finding["path"],
                 int(finding["line"]),
                 1 if finding.get("in_diff", True) else 0,
                 finding["body"], finding.get("sources"), timestamp),
            )
            finding_ids.append(cursor.lastrowid)
            seen_keys.add(key)
        conn.commit()
    finally:
        conn.close()
    json.dump({"review_id": review_id, "finding_ids": finding_ids}, sys.stdout)


if __name__ == "__main__":
    main()
