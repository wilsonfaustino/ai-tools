#!/usr/bin/env python3
"""Append a task line to a section in an Obsidian daily note.

Owns the deterministic Phase 2 work for the obsidian-daily-append skill:
  - File-exists check
  - gh CLI calls (PR mode)
  - Indent unit detection
  - Section heading lookup and child walk
  - Line insertion preserving every other line

The skill body owns classification, section routing, and Jira metadata
gathering. This script is called once those decisions are resolved.

Exit codes:
  0  success (or successful dry run)
  1  user-facing failure with a clear message on stderr
  2  invalid arguments
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(1)


def detect_indent(lines: list[str]) -> str:
    """Return the file's indent unit. Tab default per Obsidian."""
    pattern = re.compile(r"^(\t+|  +)- ")
    for line in lines:
        match = pattern.match(line)
        if match:
            return match.group(1)
    return "\t"


def find_section_bounds(lines: list[str], label: str, file_path: Path) -> tuple[int, int]:
    """Return (heading_index, end_index_exclusive) for the section.

    Heading is a top-level list item (starts with '- ' at column 0)
    containing the label as substring. Section ends when another
    top-level list item appears or at EOF.
    """
    heading_index = -1
    for index, line in enumerate(lines):
        if line.startswith("- ") and label in line:
            heading_index = index
            break
    if heading_index == -1:
        fail(f"Could not find section '{label}' in {file_path}. Check the file manually.")

    end_index = len(lines)
    for index in range(heading_index + 1, len(lines)):
        if lines[index].startswith("- "):
            end_index = index
            break
    return heading_index, end_index


def find_insertion_point(lines: list[str], heading_index: int, end_index: int, indent: str) -> int:
    """Return the index AFTER the last child line of the section.

    A child is any line in (heading_index, end_index) that starts with
    the indent unit and a list marker, or with deeper indentation.
    If the section has no children, insert directly after the heading.
    """
    last_child = heading_index
    child_pattern = re.compile(rf"^(?:{re.escape(indent)})+- ")
    for index in range(heading_index + 1, end_index):
        if child_pattern.match(lines[index]):
            last_child = index
    return last_child + 1


def gh_json(args: list[str]) -> dict:
    try:
        result = subprocess.run(
            ["gh", *args],
            capture_output=True,
            text=True,
            check=True,
        )
    except FileNotFoundError:
        fail("gh CLI not found. Install it and authenticate before using PR mode.")
    except subprocess.CalledProcessError as error:
        fail(f"gh failed: {error.stderr.strip() or error.stdout.strip()}")
    return json.loads(result.stdout)


def format_pr_line(indent: str, pr_url: str) -> str:
    pr_data = gh_json(["pr", "view", pr_url, "--json", "author,number,headRepository,url"])
    author_login = pr_data["author"]["login"]
    pr_number = pr_data["number"]
    repo_name = pr_data["headRepository"]["name"]
    canonical_url = pr_data["url"]

    user_data = gh_json(["api", f"/users/{author_login}"])
    display_name = user_data.get("name") or author_login

    project = "backend" if "api" in repo_name.lower() else "frontend"
    return f"{indent}- [ ] Code review {display_name} {project} [{pr_number}]({canonical_url})"


def format_ticket_line(indent: str, key: str, url: str, severity: str, short_desc: str) -> str:
    return f"{indent}- [ ] [{key}]({url}) {severity} {short_desc}"


def format_free_line(indent: str, text: str) -> str:
    return f"{indent}- [ ] {text}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--file", required=True, help="Path to today's daily note")
    parser.add_argument("--section", required=True, help="Section label to append under, e.g. '🌿 Syngenta'")
    parser.add_argument("--type", required=True, choices=["pr", "ticket", "free"])
    parser.add_argument("--pr-url")
    parser.add_argument("--ticket-key")
    parser.add_argument("--ticket-url")
    parser.add_argument("--severity")
    parser.add_argument("--short-desc")
    parser.add_argument("--text")
    parser.add_argument("--dry-run", action="store_true", help="Print proposed change without writing")
    args = parser.parse_args()

    required_by_type = {
        "pr": ["pr_url"],
        "ticket": ["ticket_key", "ticket_url", "severity", "short_desc"],
        "free": ["text"],
    }
    missing = [name for name in required_by_type[args.type] if getattr(args, name) is None]
    if missing:
        parser.error(f"--type {args.type} requires: {', '.join('--' + name.replace('_', '-') for name in missing)}")
    return args


def main() -> None:
    args = parse_args()

    daily_note = Path(args.file)
    if not daily_note.exists():
        fail(f"No daily note found at {daily_note}. Create the file first and try again.")

    text = daily_note.read_text()
    # Preserve original line endings by splitting without losing the trailing newline state.
    lines = text.splitlines()
    trailing_newline = text.endswith("\n")

    indent = detect_indent(lines)
    heading_index, end_index = find_section_bounds(lines, args.section, daily_note)
    insertion_index = find_insertion_point(lines, heading_index, end_index, indent)

    if args.type == "pr":
        new_line = format_pr_line(indent, args.pr_url)
    elif args.type == "ticket":
        new_line = format_ticket_line(indent, args.ticket_key, args.ticket_url, args.severity, args.short_desc)
    else:
        new_line = format_free_line(indent, args.text)

    if args.dry_run:
        print(f"[dry-run] section: {args.section}")
        print(f"[dry-run] indent unit: {indent!r}")
        print(f"[dry-run] insertion at line {insertion_index + 1} (1-indexed)")
        print(f"[dry-run] line to insert: {new_line}")
        return

    new_lines = lines[:insertion_index] + [new_line] + lines[insertion_index:]
    output = "\n".join(new_lines) + ("\n" if trailing_newline else "")
    daily_note.write_text(output)
    print(f"Added to {args.section}: {new_line.strip()}")


if __name__ == "__main__":
    main()
