# staff-review decomposition roadmap

Goal: ship `staff-review-standalone` with own agents, no `pr-review-toolkit` or `pr-review-local` deps. Parallel skill. Current `staff-review` (v2) stays until standalone proves out, then gradual deprecation.

## Agent roster

Source: **V** vendor, **R** rewrite. All live under `skills/staff-review-standalone/agents/`.

| Agent | Source | Origin | Why keep |
|---|---|---|---|
| code-reviewer | R | toolkit | rewrite for staff voice, drop generic framing |
| pr-test-analyzer | V | toolkit | test-coverage gaps, prompt is solid |
| silent-failure-hunter | V | toolkit | swallowed errors, catch-block heuristics |
| security | V | local | toolkit has no security coverage |
| regression | V | local | catches AI slop (phantom imports, unrelated deletions) |
| performance | V | local | N+1, backend patterns |

Dropped: `comment-analyzer` (low signal), `type-design-analyzer` (specialist), `code-simplifier` (violates read-only rule).

## Layout

```
skills/staff-review-standalone/
  SKILL.md
  agents/
    code-reviewer.md
    pr-test-analyzer.md
    silent-failure-hunter.md
    security.md
    regression.md
    performance.md
  references/
    auto-detect-rules.md
```

## Phases

### P1: Scaffold + vendor
- Create `skills/staff-review-standalone/` via skill-creator
- Vendor 5 prompts (test, silent-failure, security, regression, performance) into `agents/`
- Adapt universal rules: line allowlist, severity labels, positive highlights, false-positive guard

### P2: Rewrite code-reviewer
- Staff-engineer voice, PR-specific
- Cut toolkit's generic framing
- Target under 100 lines

### P3: Auto-detect selection
- SKILL.md inspects changed files, picks agent subset
- Rules in `references/auto-detect-rules.md`: `*.test.*` triggers pr-test-analyzer, `try/catch` diff triggers silent-failure-hunter, DB/query patterns trigger performance, etc.
- Default floor: code-reviewer + regression always run
- Flag override: `--agents security,tests`

### P4: Judge + output parity with v2
- Port judge step (Opus, fresh context, full diff + findings)
- Parse findings from own agents only
- Keep same output schema (Sections 1-4, `--no-judge` flag, Dropped-by-Judge appendix)

### P5: Gradual deprecation
- Ship standalone as v0.1.0
- v2 SKILL.md gets deprecation note in frontmatter pointing to standalone
- 2-week soak
- If stable, v2 becomes thin shim that invokes standalone
- After 4 weeks of no direct v2 invocations, remove v2

### P6: Optimize size
- Agents already external, SKILL.md holds only pre-flight, auto-detect, judge, output
- Target: SKILL.md under 300 lines, each agent under 100 lines
- If pushing limits: extract auto-detect rules, judge prompt, and output schema to `references/`

## Verification

- Run v2 and standalone on 5 real PRs side-by-side
- Compare: finding count, false-positive rate (manual triage), judge verdict agreement, coverage of diff
- Standalone must match or beat v2 on precision before recommending migration
- Track in a notes file; do not ship deprecation step until verification passes

## Unresolved

1. Rewritten code-reviewer: enforce repo-wide CLAUDE.md rules, or generic staff-engineer lens?
2. Auto-detect edge: PR with only config or YAML changes. Skip all agents, or keep code-reviewer floor?
3. Judge token budget on 6 agents' findings plus full diff. Cap findings per agent, chunk by file, or trust the model?
4. Vendoring policy: pin to a specific commit of `pr-review-toolkit` and `pr-review-local` at copy time, or copy current state once and diverge freely?
