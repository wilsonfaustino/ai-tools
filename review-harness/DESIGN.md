# review-harness — design spec

Date: 2026-06-17
Status: approved for planning

## Problem

PR review runs across six tools (`obsidian-daily-append`, `wt-review`,
`staff-review`, `review-board`, `post-review`, `gh-reply-comments`). At ~5
reviews/day the flow is stressful for four reasons, all confirmed by the owner:

1. **Lost track of posted comments.** Nothing persists which comments were
   posted, their GitHub comment IDs, or which finding each maps to. The triage
   artifact is ephemeral (`/tmp/review-triage.json`).
2. **Reply loop is slow.** `gh-reply-comments` re-derives everything from the
   live PR each run because there is no stored baseline to diff against.
3. **Filtering UI is broken.** `commands/review-board` is unreliable: a single
   unsubstituted `{{PR_JSON}}` placeholder (`template.html:58`,
   `const PR = {{PR_JSON}};`) is a syntax error that kills the entire page
   script, so no event listeners attach and the UI "does not respond". Launch
   is clunky (hand-rolled Python HTTP server, random port, `sys.stdin/stdout`
   monkeypatch in `server.py:render_html`). Editing UX is plain textareas.
4. **Too much tool juggling.** Six stateless steps with no shared memory.

Root cause behind 1, 2, and 4: the pipeline holds **no persistent state across
the multi-day, multi-PR review lifecycle**. review-board is the right idea at
the wrong scope (single-shot: server shuts down on submit, one PR per run).

## Goals

- Persist the full review lifecycle in one place, keyed for easy lookup.
- Let `gh-reply-comments` diff against a stored baseline instead of re-deriving.
- Replace the brittle review-board page with a reliable, persistent triage UI
  plus a cross-PR dashboard.
- Keep each piece independently usable; the UI must never be a hard dependency
  of the pipeline.

## Non-goals (YAGNI)

Auth, multi-user, analytics/charts, full-text search, an in-app reply composer
(replies stay in `gh-reply-comments`), remote hosting, and migrating the other
skills (`obsidian-daily-append`, `wt-review`) into the harness.

## Architecture

**SQLite is the integration bus.** A single SQLite file is the source of truth.
Two independent client kinds read/write it:

- **Skill-side** Python scripts (stdlib `sqlite3`, zero deps) called by the
  review skills.
- **App-side** a Node process (`better-sqlite3`) serving the web UI.

Both open the same file in **WAL mode** for safe concurrent access. If the app
is down, the skills still work — they hit the file directly.

```
staff-review ──writes findings (status=triaging)──┐
                                                   ▼
                                            [ reviews.db ]  ← source of truth
                                                   ▲
post-review ──writes gh_comment_id, posted_at, status=posted──┤
gh-reply-comments ──reads baseline, sets addressed_status──────┘
                                                   ▲
                          (optional) web app: dashboard + per-PR triage
```

### Data model

Path: `~/.claude/review-harness/reviews.db` (outside any worktree, so it
survives `wt-clean` and is shared across PRs). WAL mode enabled on first open.

```sql
CREATE TABLE reviews (
  id          INTEGER PRIMARY KEY,
  pr_number   INTEGER NOT NULL,
  owner       TEXT NOT NULL,
  repo        TEXT NOT NULL,
  branch      TEXT,
  title       TEXT,
  head_sha    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'triaging',   -- triaging|posted|awaiting_author|addressed
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE(owner, repo, pr_number)
);

CREATE TABLE findings (
  id                  INTEGER PRIMARY KEY,
  review_id           INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  severity            TEXT NOT NULL,               -- critical|major|minor|nit
  path                TEXT NOT NULL,
  line                INTEGER NOT NULL,
  in_diff             INTEGER NOT NULL DEFAULT 1,  -- 0/1
  body                TEXT NOT NULL,
  decision            TEXT NOT NULL DEFAULT 'pending', -- pending|inline|general|skip
  gh_comment_id       INTEGER,                     -- set after posting
  posted_at           TEXT,
  addressed_status    TEXT NOT NULL DEFAULT 'open', -- open|addressed|wont_fix
  addressed_commit_sha TEXT,
  updated_at          TEXT NOT NULL
);
```

Review status flow: `triaging → posted → awaiting_author → addressed`.

### Components

1. **`review-harness/db/schema.sql`** — the schema above. Single source for both
   clients.
2. **`review-harness/db/*.py`** — thin skill-side helpers, stdlib only:
   `insert_review` (review + findings, status=triaging), `set_decisions`,
   `mark_posted` (write gh_comment_id/posted_at, status=posted),
   `mark_addressed` (addressed_status/commit, status=addressed). Each opens the
   DB in WAL mode and exits.
3. **`review-harness/app/`** — one Node process serving a Vite+React SPA plus a
   thin read/write JSON API over `better-sqlite3`. Views: **dashboard**
   (cross-PR list with status) and **per-PR triage** (select/edit/submit; submit
   sets `decision` in the DB). Exposes `GET /health`.
4. **`review-harness/hooks/ensure-up.sh`** — health-checks `localhost:PORT/health`
   and spawns the app detached (`nohup … &`) if down. Self-healing.

### Skill wiring

| Skill | Change |
|---|---|
| `staff-review` | After producing findings, call `insert_review` (review row + findings, status=triaging). Still prints findings to chat. |
| `post-review` | Read `decision IN (inline, general)` rows for the PR; post to GitHub; call `mark_posted` with returned `gh_comment_id`. Existing `--from <json>` path kept as fallback. |
| `gh-reply-comments` | Read posted findings as baseline; diff commits since `head_sha`; call `mark_addressed`; draft replies from that state. |
| `review-flow` | Stage 2 triage points at the app (or in-app submit) instead of the one-shot board. |

### Ensure-up hook

A `PreToolUse` hook scoped to the review skills (`staff-review`, `review-flow`,
`post-review`, `review-board`, `gh-reply-comments`) runs `ensure-up.sh`. Replaces
a launchd LaunchAgent: no system config, no autostart outside review work,
respawns on next review if the process died. (Exact hook event/matcher finalized
in the plan; SessionStart is the fallback if Skill-name matching proves awkward.)

## Phasing

- **Phase 1 — spine, no UI.** schema.sql + WAL + the Python db helpers + wire
  `staff-review`, `post-review`, `gh-reply-comments`. Delivers relief for
  lost-track, slow-reply, and tool-juggling.
- **Phase 2 — UI.** Node+React app + `ensure-up.sh` hook + `review-flow`
  repoint. Delivers relief for editing-UX and clunky-launch. Supersedes
  `commands/review-board/` (flagged for removal, not auto-deleted).

## File layout

```
review-harness/
  db/
    schema.sql
    insert_review.py
    set_decisions.py
    mark_posted.py
    mark_addressed.py
  app/            # Phase 2: Vite + React + better-sqlite3 server
  hooks/
    ensure-up.sh  # Phase 2
```

`review-harness/app/node_modules` gitignored. Stays inside the ai-tools repo
(shared schema, co-developed); extract to its own repo later only if it grows.

## Risks / mitigations

- **Concurrent writers (Python skill + Node app) on one file** → WAL mode +
  short-lived skill connections; writes are small and serialized by SQLite.
- **App not running at triage time** → ensure-up hook; and pipeline degrades
  gracefully (skills never depend on the app).
- **Schema drift between Python and Node clients** → single `schema.sql`,
  applied idempotently on open by whichever client touches the DB first.

## Open questions

None blocking. Hook event/matcher choice is a plan-level detail, not a design
fork.
