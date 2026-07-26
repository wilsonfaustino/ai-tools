#!/usr/bin/env python3
"""Prefix each added line of a unified diff with its post-image line number.

Reads a diff on stdin, writes the annotated diff on stdout. Added lines become
`+[L<n>] <text>`, where n is the line's absolute number in the new file.
"""
import re
import sys

HUNK = re.compile(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@')

# Lines that sit outside a hunk body's line-number space. Without this guard a
# `+++` header would be annotated and a `\ No newline` marker would advance the
# counter, shifting every annotation after it.
META = (
    '+++', '---', 'diff --git', 'index ', 'new file', 'deleted file',
    'similarity index', 'rename ', 'old mode', 'new mode', 'Binary files',
    '\\',
)


def annotate(lines):
    line_no, saw_hunk = 0, False
    for raw in lines:
        hunk = HUNK.match(raw)
        if hunk:
            line_no, saw_hunk = int(hunk.group(1)), True
            yield raw
        elif raw.startswith(META):
            yield raw
        elif raw.startswith('+'):
            yield f'+[L{line_no}] {raw[1:]}'
            line_no += 1
        elif raw.startswith('-'):
            yield raw
        else:
            if saw_hunk:
                line_no += 1
            yield raw
    if not saw_hunk:
        sys.exit('annotate_diff: no hunk headers found in input')


if __name__ == '__main__':
    sys.stdout.writelines(annotate(sys.stdin.readlines()))
