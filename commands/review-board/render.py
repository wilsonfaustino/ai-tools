#!/usr/bin/env python3
"""Render review-board HTML from findings JSON on stdin to stdout."""
import html
import json
import sys
from pathlib import Path

TEMPLATE_PATH = Path(__file__).parent / "template.html"
SEVERITY_ORDER = ["critical", "major", "minor", "nit"]
OPEN_BY_DEFAULT = {"critical", "major"}
CHECKED_BY_DEFAULT = {"critical", "major"}


def load_payload() -> dict:
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"Invalid JSON on stdin: {exc}\n")
        sys.exit(1)


def group_by_severity(findings: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {s: [] for s in SEVERITY_ORDER}
    for finding in findings:
        sev = finding.get("severity", "minor")
        if sev not in grouped:
            sev = "minor"
        grouped[sev].append(finding)
    return grouped


def render_row(finding: dict) -> str:
    severity = html.escape(finding.get("severity", "minor"))
    path = html.escape(finding.get("path", ""))
    line = int(finding.get("line", 0))
    in_diff = bool(finding.get("in_diff", True))
    body = html.escape(finding.get("body", ""))
    checked = "checked" if severity in CHECKED_BY_DEFAULT else ""
    badge = (
        '<span class="badge out-of-diff">OUT-OF-DIFF</span>'
        '<select class="ood-decision"><option value="general">post as general</option>'
        '<option value="skip">skip</option></select>'
        if not in_diff else ""
    )
    return (
        f'<div class="row" data-severity="{severity}" data-path="{path}" '
        f'data-line="{line}" data-in-diff="{str(in_diff).lower()}">'
        f'<label class="head">'
        f'<input type="checkbox" {checked}>'
        f'<div style="flex:1">'
        f'<code class="loc">{path}:{line}</code>{badge}'
        f'<textarea>{body}</textarea>'
        f'</div></label></div>'
    )


def render_section(severity: str, findings: list[dict]) -> str:
    count = len(findings)
    open_attr = " open" if severity in OPEN_BY_DEFAULT and count else ""
    rows = "\n".join(render_row(f) for f in findings) if count else (
        '<div class="row"><em>None.</em></div>'
    )
    return (
        f'<details class="severity" data-severity="{severity}"{open_attr}>'
        f'<summary>{severity} ({count})</summary>'
        f'{rows}'
        f'</details>'
    )


def main() -> None:
    payload = load_payload()
    pr = payload.get("pr") or {}
    findings = payload.get("findings") or []
    grouped = group_by_severity(findings)
    sections = "\n".join(render_section(s, grouped[s]) for s in SEVERITY_ORDER)

    template = TEMPLATE_PATH.read_text()
    sha = str(pr.get("sha", ""))
    output = (
        template
        .replace("{{PR_NUMBER}}", html.escape(str(pr.get("number", ""))))
        .replace("{{SHA_SHORT}}", html.escape(sha[:7]))
        .replace("{{TOTAL}}", str(len(findings)))
        .replace("{{SECTIONS}}", sections)
        .replace("{{PR_JSON}}", json.dumps(pr))
    )
    sys.stdout.write(output)


if __name__ == "__main__":
    main()
