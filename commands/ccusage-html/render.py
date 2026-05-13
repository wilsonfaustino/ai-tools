#!/usr/bin/env python3
"""Render ccusage JSON (from stdin) to standalone HTML report (to stdout)."""
import argparse
import datetime as dt
import html
import json
import sys
from pathlib import Path

TEMPLATE_PATH = Path(__file__).parent / "template.html"

ROW_FIELDS = [
    "inputTokens",
    "outputTokens",
    "cacheCreationTokens",
    "cacheReadTokens",
    "totalTokens",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=["daily", "monthly"])
    parser.add_argument("--source-cmd", required=True)
    return parser.parse_args()


def load_payload() -> dict:
    try:
        return json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"Invalid JSON on stdin: {exc}\n")
        sys.exit(1)


def period_key(mode: str) -> str:
    return "date" if mode == "daily" else "month"


def period_label(mode: str) -> str:
    return "Date" if mode == "daily" else "Month"


def fmt_int(value: int | float) -> str:
    return f"{int(value):,}"


def fmt_cost(value: float) -> str:
    return f"${value:,.2f}"


def compute_totals(rows: list[dict]) -> dict:
    totals = {field: 0 for field in ROW_FIELDS}
    totals["totalCost"] = 0.0
    for row in rows:
        for field in ROW_FIELDS:
            totals[field] += row.get(field, 0) or 0
        totals["totalCost"] += row.get("totalCost", 0) or 0
    return totals


def render_cards(totals: dict) -> str:
    cards = [
        ("cost", "Total Cost", fmt_cost(totals.get("totalCost", 0))),
        ("tokens", "Total Tokens", fmt_int(totals.get("totalTokens", 0))),
        ("", "Input", fmt_int(totals.get("inputTokens", 0))),
        ("", "Output", fmt_int(totals.get("outputTokens", 0))),
        ("", "Cache Created", fmt_int(totals.get("cacheCreationTokens", 0))),
        ("", "Cache Read", fmt_int(totals.get("cacheReadTokens", 0))),
    ]
    lines = []
    for klass, label, value in cards:
        klass_attr = f" {klass}" if klass else ""
        lines.append(
            f'    <div class="card{klass_attr}"><div class="label">{label}</div>'
            f'<div class="value">{value}</div></div>'
        )
    return "\n".join(lines)


def render_rows(rows: list[dict], period: str) -> str:
    if not rows:
        return '      <tr><td colspan="8">No usage data.</td></tr>'
    lines = []
    for row in rows:
        period_value = html.escape(str(row.get(period, "")))
        models = ", ".join(html.escape(m) for m in row.get("modelsUsed") or [])
        lines.append("    <tr>")
        lines.append(f"      <td>{period_value}</td>")
        lines.append(f"      <td>{models}</td>")
        for field in ROW_FIELDS:
            lines.append(f'      <td class="num">{fmt_int(row.get(field, 0) or 0)}</td>')
        lines.append(
            f'      <td class="num cost">{fmt_cost(row.get("totalCost", 0) or 0)}</td>'
        )
        lines.append("    </tr>")
    return "\n".join(lines)


def render_tfoot(totals: dict) -> str:
    cells = [f'<td colspan="2">Totals</td>']
    for field in ROW_FIELDS:
        cells.append(f'<td class="num">{fmt_int(totals.get(field, 0))}</td>')
    cells.append(f'<td class="num cost">{fmt_cost(totals.get("totalCost", 0))}</td>')
    return "      <tr>" + "".join(cells) + "</tr>"


def render_meta(row_count: int) -> str:
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return f"Generated {now} &middot; {row_count} rows &middot; sorted newest first"


def main() -> None:
    args = parse_args()
    payload = load_payload()

    rows = payload.get(args.mode) or []
    period = period_key(args.mode)
    rows = sorted(rows, key=lambda r: r.get(period, ""), reverse=True)

    totals = payload.get("totals") or compute_totals(rows)

    template = TEMPLATE_PATH.read_text()
    output = (
        template
        .replace("{{META}}", render_meta(len(rows)))
        .replace("{{CARDS}}", render_cards(totals))
        .replace("{{PERIOD_LABEL}}", period_label(args.mode))
        .replace("{{ROWS}}", render_rows(rows, period))
        .replace("{{TFOOT}}", render_tfoot(totals))
        .replace("{{SOURCE_CMD}}", html.escape(args.source_cmd))
    )
    sys.stdout.write(output)
    sys.stderr.write(f"rows={len(rows)} bytes={len(output)}\n")


if __name__ == "__main__":
    main()
