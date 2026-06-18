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
