#!/usr/bin/env python3
"""Prefix each added line of a unified diff with its post-image line number.

Reads a diff on stdin, writes the annotated diff on stdout. Added lines become
`+[L<n>] <text>`, where n is the line's absolute number in the new file.
"""
import re
import sys

HUNK = re.compile(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@')


def annotate(lines):
    # Content-fragile prefix matching (e.g. a bare '+++' string) misfires on an
    # added line whose own text happens to start with '++' or '--'. Tracking
    # whether we are inside a hunk body, and dispatching on the first
    # character only while inside one, avoids that class of false match.
    line_no, saw_hunk, in_hunk = 0, False, False
    for raw in lines:
        hunk = HUNK.match(raw)
        if hunk:
            line_no, saw_hunk, in_hunk = int(hunk.group(1)), True, True
            yield raw
        elif raw.startswith('diff --git'):
            in_hunk = False
            yield raw
        elif not in_hunk:
            yield raw
        elif raw[0] == '+':
            yield f'+[L{line_no}] {raw[1:]}'
            line_no += 1
        elif raw[0] in '-\\':
            yield raw
        else:
            line_no += 1
            yield raw
    if not saw_hunk:
        sys.exit('annotate_diff: no hunk headers found in input')


if __name__ == '__main__':
    sys.stdout.writelines(annotate(sys.stdin.readlines()))
