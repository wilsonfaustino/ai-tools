---
name: pr-review-local
description: Run the 3-subagent PR review (Security, Regression, Performance) against your current branch diff vs the resolved base branch, locally, before pushing. Use when the user says "review my branch", "local PR review", "review before push", "pre-ship review", or invokes /pr-review-local. Does not post to any PR. Output is stdout markdown only.
license: CC-BY-4.0
metadata:
  author: Claude Code Skills
  version: 0.1.0
---

# pr-review-local - Local Branch Review

Runs the 3-subagent PR review against the current branch diff vs the resolved base branch locally. Outputs a markdown summary to stdout. No PR, no GH Actions, no comment posting.
