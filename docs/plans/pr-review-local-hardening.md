# pr-review-local Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `staff-review` from producing confident findings about code that is not in the PR, and stop the model from doing diff line arithmetic by hand.

**Architecture:** Three independent edits. Task 1 makes `staff-review` assert the PR branch is checked out in pre-flight instead of having a fan-out subtask check it out mid-run (removes both the wrong-diff bug and the same-worktree race, without adding ref-passing plumbing or mutating the worktree). Task 2 moves the `[L<n>]` diff annotation algorithm out of `pr-review-local`'s prose and into a Python script with a golden fixture. Task 3 records the implicit output contract between the two skills as comments in both files.

**Tech Stack:** Markdown skills (`SKILL.md`), Python 3 stdlib, `gh` CLI, git.

## Global Constraints

- No emojis anywhere. No em-dashes and no double dashes in prose or comments.
- Comments only for magic numbers, complex logic, or non-self-explanatory code.
- One logical change per commit. Never `git add -A` or `git add .`; stage named paths only.
- Never `git push` unless the owner asks.
- `pr-review-local` and `staff-review` are READ-ONLY skills: no file writes, no `gh` writes, no worktree mutation.
- Skills install via `npx skills add skills/<name>`, which copies the whole skill directory. Anything a skill needs at runtime must live inside `skills/<name>/`, never at repo root.

---

## Context

`staff-review` invokes `pr-review-local` as fan-out Task 2, so `pr-review-local` is a shared library, not a leaf skill.

Verified premises (2026-07-26):

- `skills/staff-review/SKILL.md:127` invokes `pr-review-local` via the Skill tool with no arguments.
- `skills/pr-review-local/SKILL.md:39` computes `MERGE_BASE=$(git merge-base HEAD $RESOLVED_BASE)` with no override path.
- `skills/staff-review/SKILL.md:99-102` tells fan-out Task 1 to run `gh pr checkout <PR_NUMBER>`; Task 2 gets no equivalent instruction.
- All three fan-out tasks launch in one message (`skills/staff-review/SKILL.md:87`), same worktree.
- Only `staff-review` consumes `pr-review-local`'s output. Its parser is the heading map at `skills/staff-review/SKILL.md:227-231` plus the bullet regex in "Bucket: local".

Two consequences:

1. Running `/staff-review` from a branch that is not the PR head branch makes `pr-review-local` diff the wrong branch and emit confident `local:*` findings about code not in the PR.
2. Task 1's `gh pr checkout` can land while Task 2 is mid `git diff`, in the same worktree, making output nondeterministic.

Both die if the PR branch is guaranteed checked out before fan-out and no fan-out task changes branches. `/wt-review` already puts the reviewer in a worktree with the PR branch checked out, so asserting is cheaper than checking out, and it keeps the skill honestly read-only.

## Non-goals

- No new "self-review" skill. `pr-review-local` is that skill.
- No `--base`/`--head` ref plumbing. The pre-flight assert covers the failure that is actually happening. Add refs only when a PR whose base is not the default branch actually burns you.
- No `gh pr checkout` inside `staff-review`, so no dirty-tree gate and no branch-restore step.
- No `--judge` flag on `pr-review-local`. See Rejected.
- No cheap-model finder tier. The finder caps recall; a judge cannot recover what the finder missed.
- No `CONTRACT.md` plus parse-harness. Two consumers in one repo do not need a test suite to keep a heading list in sync.

## File Structure

| File | Responsibility |
|---|---|
| `skills/staff-review/SKILL.md` (modify) | Pre-flight asserts PR branch; Task 1 prompt no longer checks out; failure table gains the new hard block; "Bucket: local" points at the contract note |
| `skills/pr-review-local/scripts/annotate_diff.py` (create) | Sole owner of the `[L<n>]` post-image line-number arithmetic |
| `skills/pr-review-local/fixtures/sample.diff` (create) | Golden input: two files, offset hunk, removal-only hunk, no-newline marker |
| `skills/pr-review-local/fixtures/sample.annotated.diff` (create) | Expected output, byte for byte |
| `skills/pr-review-local/scripts/test_annotate_diff.sh` (create) | The one runnable check: fixture in, expected out |
| `skills/pr-review-local/SKILL.md` (modify) | Step 1.7 calls the script; Step 3 carries the output contract note |

---

### Task 1: `staff-review` asserts the PR branch instead of checking it out

**Files:**
- Modify: `skills/staff-review/SKILL.md:39-40` (pre-flight `gh pr view` fields)
- Modify: `skills/staff-review/SKILL.md:71-77` (hard blocks)
- Modify: `skills/staff-review/SKILL.md:98-102` (Task 1 prompt)
- Modify: `skills/staff-review/SKILL.md` failure-modes table near line 507
- Test: manual, plus the grep assertions in Step 5

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the guarantee that `HEAD` is the PR head branch for the whole fan-out. Task 3's contract note assumes no fan-out task mutates the worktree.

- [ ] **Step 1: Add `headRefName` to the pre-flight PR query**

In `skills/staff-review/SKILL.md`, replace the `gh pr view` line in the Pre-flight block:

```bash
gh pr view --json number,url,author,baseRefName,headRefName,state,reviewDecision \
  --jq '{number, url, author: .author.login, base: .baseRefName, head: .headRefName, state, reviewDecision}'
```

Record the result as `PR_NUMBER`, `BASE_BRANCH` (from `base`), and `PR_HEAD_BRANCH` (from `head`).

- [ ] **Step 2: Add the branch assertion as a hard block**

In the same Pre-flight section, immediately after the fenced block of parallel checks, insert:

```markdown
### Branch assertion

```bash
git rev-parse --abbrev-ref HEAD   # CURRENT_BRANCH
```

If `CURRENT_BRANCH` does not equal `PR_HEAD_BRANCH`, this is a hard block. Abort with:

`not on the PR branch (on <CURRENT_BRANCH>, PR head is <PR_HEAD_BRANCH>); run /wt-review <PR_NUMBER> to review in an isolated worktree, or check the branch out yourself`

Do NOT run `gh pr checkout`. This skill is read-only and must not mutate the
owner's worktree. Every fan-out task diffs the branch that is already checked
out, so the branch must be correct before fan-out starts.
```

Then add one bullet to the existing "Hard blocks (refuse to proceed)" list:

```markdown
- The current branch is not the PR head branch (see Branch assertion)
```

- [ ] **Step 3: Strip the checkout instruction from Task 1's prompt**

In `### Task 1: pr-review-toolkit`, replace the second `IMPORTANT` paragraph (the one containing `gh pr checkout`, currently lines 98-102) with:

```markdown
> IMPORTANT: This review targets the PR diff, not the uncommitted working
> tree. The PR branch is already checked out and verified in pre-flight. Use
> `git diff origin/<BASE_BRANCH>...HEAD`. Do NOT run `gh pr checkout` or
> otherwise change branches: sibling tasks are reading the same worktree
> concurrently.
```

- [ ] **Step 4: Add the failure mode to the table**

In the failure-modes table near line 507, add one row above the `pr-review-local not installed` row:

```markdown
| Current branch is not the PR head branch | Hard block, abort with the /wt-review hint |
```

- [ ] **Step 5: Verify the edits**

Run:

```bash
cd ~/www/dot/ai-tools
grep -n "gh pr checkout" skills/staff-review/SKILL.md
grep -n "headRefName\|PR_HEAD_BRANCH\|Branch assertion" skills/staff-review/SKILL.md
```

Expected: the first grep prints only the two prohibition mentions added in Steps 2 and 3 (no instruction to run it). The second prints the query field, the assertion heading, and the hard-block bullet.

- [ ] **Step 6: Manual acceptance check**

From `main`, with an open PR on another branch, run `/staff-review`.
Expected: aborts in pre-flight with the `not on the PR branch` message, before any fan-out task launches.

Then run `/wt-review <PR_NUMBER>` and `/staff-review` inside the worktree.
Expected: proceeds, and every file cited by a `local:*` finding appears in `gh pr diff --name-only`. Verify by comparing the two file lists; overlap must be 100%.

- [ ] **Step 7: Commit**

```bash
git add skills/staff-review/SKILL.md
git commit -m "fix(staff-review): assert PR branch in pre-flight, drop per-task checkout"
```

---

### Task 2: Move diff line annotation into `annotate_diff.py`

**Why:** Step 1.7 currently asks the model to parse `@@ -a,b +c,d @@` headers and carry a counter across up to 3000 diff lines. When the counter drifts, every `path:L<n>` citation is wrong, which silently corrupts `staff-review`'s `file_line` values, its `source_count` grouping, and the judge's ability to confirm a claim by opening the file.

**Files:**
- Create: `skills/pr-review-local/scripts/annotate_diff.py`
- Create: `skills/pr-review-local/fixtures/sample.diff`
- Create: `skills/pr-review-local/fixtures/sample.annotated.diff`
- Create: `skills/pr-review-local/scripts/test_annotate_diff.sh`
- Modify: `skills/pr-review-local/SKILL.md:81-93` (Step 1.7)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `annotate_diff.py`, a stdin-to-stdout filter. Exit 0 with the annotated diff on stdout; exit 1 with `annotate_diff: no hunk headers found in input` on stderr when the input has no hunk header (covers empty input too). Installed path at runtime: `~/.claude/skills/pr-review-local/scripts/annotate_diff.py`. Task 3's contract note refers to the `[L<n>]` format this script emits.

- [ ] **Step 1: Write the fixture pair (the failing test)**

Create `skills/pr-review-local/fixtures/sample.diff`. It covers the five cases that break naive counters or content-fragile prefix matching: a hunk not starting at line 1, a removal-only hunk, a second file, a `\ No newline at end of file` marker, and an added line whose own text starts with `++` (plus a removed line whose own text starts with `--`, which is harmless but must still be handled correctly rather than by accident).

```diff
diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,6 +10,8 @@ export function alpha() {
   const x = 1
   const y = 2
+  const z = 3
+  const w = 4
   return x + y
 }
 
@@ -30,7 +32,6 @@ export function beta() {
   const a = 1
-  const b = 2
   return a
 }
diff --git a/src/b.ts b/src/b.ts
index 3333333..4444444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,3 +1,4 @@
 const first = 1
+const second = 2
 const third = 3
\ No newline at end of file
diff --git a/src/c.c b/src/c.c
index 5555555..6666666 100644
--- a/src/c.c
+++ b/src/c.c
@@ -1,3 +1,4 @@
 int i = 0;
---counter;
+i++;
+++i;
 int j = 0;
```

Create `skills/pr-review-local/fixtures/sample.annotated.diff` with the expected output. Note `[L12]` and `[L13]` (two context lines consumed 10 and 11 first), `[L2]` in the second file, that the removal-only hunk and the no-newline marker produce no annotation and consume no line number, and that in the third file `---counter;` (a removed line) is untouched while `+++i;` (an added line) still gets `[L3]` despite its own text starting with `++`:

```diff
diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,6 +10,8 @@ export function alpha() {
   const x = 1
   const y = 2
+[L12]   const z = 3
+[L13]   const w = 4
   return x + y
 }
 
@@ -30,7 +32,6 @@ export function beta() {
   const a = 1
-  const b = 2
   return a
 }
diff --git a/src/b.ts b/src/b.ts
index 3333333..4444444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,3 +1,4 @@
 const first = 1
+[L2] const second = 2
 const third = 3
\ No newline at end of file
diff --git a/src/c.c b/src/c.c
index 5555555..6666666 100644
--- a/src/c.c
+++ b/src/c.c
@@ -1,3 +1,4 @@
 int i = 0;
---counter;
+[L2] i++;
+[L3] ++i;
 int j = 0;
```

Create `skills/pr-review-local/scripts/test_annotate_diff.sh`:

```bash
#!/usr/bin/env bash
# Fails if the [L<n>] counter drifts on the golden fixture, or if a
# hunk-less input stops being an error.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 scripts/annotate_diff.py < fixtures/sample.diff \
  | diff -u fixtures/sample.annotated.diff -

if echo "no hunks here" | python3 scripts/annotate_diff.py 2>/dev/null; then
  echo "FAIL: hunk-less input should exit non-zero" >&2
  exit 1
fi

echo "PASS"
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd ~/www/dot/ai-tools/skills/pr-review-local
chmod +x scripts/test_annotate_diff.sh
./scripts/test_annotate_diff.sh
```

Expected: FAIL, `can't open file 'scripts/annotate_diff.py': [Errno 2] No such file or directory`.

- [ ] **Step 3: Write the script**

Create `skills/pr-review-local/scripts/annotate_diff.py`:

```python
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd ~/www/dot/ai-tools/skills/pr-review-local
./scripts/test_annotate_diff.sh
```

Expected: `PASS`, no diff output.

- [ ] **Step 5: Spot-check against a real diff**

Run:

```bash
cd ~/www/dot/ai-tools
git diff origin/main...HEAD | python3 skills/pr-review-local/scripts/annotate_diff.py | grep -n "\[L" | head -5
```

Pick five annotations and confirm each `[L<n>]` matches `sed -n '<n>p' <file>` in the working tree. All five must match. If the branch has no diff, run it against any branch that does.

- [ ] **Step 6: Rewrite Step 1.7 to call the script**

In `skills/pr-review-local/SKILL.md`, replace all of `### 1.7 Pre-annotate the diff` (currently lines 81-93) with:

```markdown
### 1.7 Pre-annotate the diff

Annotation is done by a script, not by hand. Model arithmetic over thousands of
diff lines drifts, and every drifted `[L<n>]` produces a citation that points at
the wrong code.

```bash
ANNOTATE=~/.claude/skills/pr-review-local/scripts/annotate_diff.py
ANNOTATED_DIFF=$(printf '%s\n' "$DIFF" | python3 "$ANNOTATE")
```

If the script is missing, abort with `annotate_diff.py not found at $ANNOTATE; reinstall with npx skills add skills/pr-review-local`.
If it exits non-zero, abort with its stderr message verbatim.
Verify `$ANNOTATED_DIFF` is non-empty.

Every added line in the result carries `+[L<n>] `, where `n` is that line's
absolute number in the post-image of its file. Subagents receive
`$ANNOTATED_DIFF`, never `$DIFF`.
```

- [ ] **Step 7: Commit**

```bash
git add skills/pr-review-local/scripts/annotate_diff.py \
        skills/pr-review-local/scripts/test_annotate_diff.sh \
        skills/pr-review-local/fixtures/sample.diff \
        skills/pr-review-local/fixtures/sample.annotated.diff \
        skills/pr-review-local/SKILL.md
git commit -m "refactor(pr-review-local): move diff annotation to annotate_diff.py"
```

---

### Task 3: Record the output contract in both skills

**Why:** `staff-review` parses `pr-review-local`'s markdown with a bullet regex and a fixed heading map. That is a public API, and right now it is implicit, so an edit to either skill can break the other with no signal. A note in each file is enough for two consumers in one repo.

**Files:**
- Modify: `skills/pr-review-local/SKILL.md` (Step 3, above the output template near line 205)
- Modify: `skills/staff-review/SKILL.md` (`### Bucket: local`, near line 210)

**Interfaces:**
- Consumes: the `[L<n>]` format produced in Task 2; the no-worktree-mutation guarantee from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Read the current parser to copy the regex verbatim**

Run:

```bash
cd ~/www/dot/ai-tools
sed -n '205,240p' skills/staff-review/SKILL.md
```

Copy the finding-bullet regex exactly as written there into Step 2 below. Do not retype it from memory.

- [ ] **Step 2: Add the contract note to `pr-review-local`**

In `skills/pr-review-local/SKILL.md`, insert directly above the Step 3 output template:

```markdown
> **Output contract (consumed by `staff-review`).** `staff-review` parses this
> report by heading, matching a heading prefix (the `(<N>)` count suffix is
> ignored), and then by a finding-bullet regex. The stable headings are
> `### Security`, `### Critical`, `### Performance`, `### Warnings`,
> `### Suggestions`, and `### Highlights`.
>
> Rule: new output goes under a NEW heading. Never change the bullet grammar.
> Any new heading needs a matching entry in `staff-review`'s "Bucket: local"
> heading map, in the same commit.
```

- [ ] **Step 3: Add the back-pointer to `staff-review`**

In `skills/staff-review/SKILL.md`, at the end of the `### Bucket: local` section, add:

```markdown
This heading map and the finding-bullet regex above are the contract with
`pr-review-local`. It is documented on the producer side in
`skills/pr-review-local/SKILL.md`, Step 3. Adding a heading here requires the
matching edit there, in the same commit.
```

- [ ] **Step 4: Verify both sides agree**

Run:

```bash
cd ~/www/dot/ai-tools
grep -n "^### \(Security\|Critical\|Performance\|Warnings\|Suggestions\|Highlights\)" skills/pr-review-local/SKILL.md
grep -n "\`### " skills/staff-review/SKILL.md | grep -i "security\|critical\|performance\|warning\|suggestion"
```

Expected: the heading set emitted by `pr-review-local` Step 3 and the set mapped by `staff-review` are the same six. Report any heading present on one side only.

- [ ] **Step 5: Commit**

```bash
git add skills/pr-review-local/SKILL.md skills/staff-review/SKILL.md
git commit -m "docs(pr-review-local): record the output contract consumed by staff-review"
```

---

## Reinstall after landing

Both skills run from `~/.claude/skills/`, not from this repo. Nothing in this
plan takes effect locally until:

```bash
cd ~/www/dot/ai-tools
npx skills add skills/pr-review-local
npx skills add skills/staff-review
ls ~/.claude/skills/pr-review-local/scripts/annotate_diff.py
```

The `ls` must succeed. If it does not, the installer is not copying subdirectories, and Step 1.7's abort path will fire on the next run.

## Deferred

| Item | Why deferred |
|---|---|
| `--base`/`--head` refs on `pr-review-local` | The pre-flight assert fixes the failure that is happening. Refs are only needed for a PR whose base is not the default branch, where `pr-review-local`'s base ladder picks wrong. Revisit when that actually bites. |
| tsc/eslint/knip preflight inside `pr-review-local` | Output carries no `[L<n>]` citation, so it breaks the `staff-review` parser, and it adds latency to a cost-gated path. Belongs in `/ship` or `staff-review` pre-flight. Separate plan. |
| New lenses (test coverage of the change, repo convention drift) | Real recall gain, and recall is the real bottleneck. Each lens needs a heading plus a `staff-review` map entry. Do it after Task 3 makes that coupling explicit. |
| Persisting dismissed findings to `review-harness/reviews.db` | Useful for adoption (suppress the false positive that recurs every branch), but needs a schema decision and a dismissal UX. Separate plan. |

## Rejected

| Item | Why |
|---|---|
| `--judge` pass on `pr-review-local` | Its job is precision, and precision is an adoption problem, not a correctness one. `staff-review` already has a judge, and running two in sequence drops findings before the cross-source judge ever sees `merges` and `source_count`. Spend the effort on recall instead. |
| `gh pr checkout` inside `staff-review` | Mutates the owner's worktree in a read-only skill, and drags in a dirty-tree gate plus a branch-restore step. `/wt-review` already provides a checked-out worktree. |
| `CONTRACT.md` plus fixture plus parse-harness | Ceremony for two consumers in one repo with one author. Task 3's notes carry the same information at a fraction of the surface. |
| Cheap-model finder tier | Wrong bottleneck. The finder caps recall, and savings are negligible against a 3000-line diff gate. |
| Separate "self-review" skill | Duplicates `pr-review-local` and creates a third copy of the same prompt to keep in sync. |

## Open questions

None blocking. Recorded answers to the questions the previous draft left open:

1. **Trigger for `pr-review-local`:** manual only (`/pr-review-local`, or via `staff-review`). Not a pre-push hook, so there is no 60-second budget to design around.
2. **Default scope:** unchanged, full branch diff vs resolved base.
3. **Advisory or blocking:** advisory. Warning and Suggestion tiers stay as they are for now; collapsing them is a recall/precision question to answer with real usage data, not upfront.
