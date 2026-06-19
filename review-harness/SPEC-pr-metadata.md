# SPEC: PR metadata + status in review-harness

Date: 2026-06-19
Status: approved (design), pending implementation plan

## Goal

Surface GitHub PR context (author, state, review decision, link) and richer
finding signal in the review-harness Dashboard list and Triage view. Capture PR
metadata as a snapshot at ingestion, refreshable on demand from the Triage view.

## In scope

1. Author + PR state (state + review decision), captured at ingest, shown as a
   badge separate from the harness triage status.
2. PR url link (header) + per-finding deep link to `blob@head_sha` file:line.
3. Severity breakdown of pending findings in the Dashboard list.
4. Triage progress (posted / addressed counts) + relative age in the list.
5. Fix focused-card scroll hidden under the sticky header (CSS only).
6. Manual Refresh button in the Triage header (re-fetch PR state via gh).

## Out of scope (deferred)

CI status rollup, PR size (additions/deletions/files), Dashboard "Refresh open"
(global), background sync, filter/sort by status.

## Design decisions (confirmed)

- **Two badges.** Harness `reviews.status` (triage lifecycle: `triaging`...)
  stays as-is. GitHub state is a new, separate badge.
- **Combined PR badge** derived from `pr_state` + `review_decision` by
  precedence: `merged` > `closed` > `approved` > `changes` > `open`.
- **Per-finding link** = `https://github.com/{owner}/{repo}/blob/{head_sha}/{path}#L{line}`
  (precise, no diff-hash needed). File pill keeps its click-to-copy behavior.
- **Freshness** = snapshot at ingest + manual Refresh. No background sync.

## Data model

Add columns to `reviews` (`db/schema.sql`):

| column            | type | source / meaning                                  |
|-------------------|------|---------------------------------------------------|
| `author`          | TEXT | `gh pr view` `.author.login`                       |
| `url`             | TEXT | PR url                                             |
| `pr_state`        | TEXT | `OPEN` / `CLOSED` / `MERGED`                       |
| `review_decision` | TEXT | `APPROVED` / `CHANGES_REQUESTED` / `REVIEW_REQUIRED` / empty |
| `pr_synced_at`    | TEXT | ISO timestamp of last PR-state fetch               |

New installs get these via the `CREATE TABLE` definition. Existing DBs need a
migration: SQLite has no `ADD COLUMN IF NOT EXISTS`, and both `db.js` (`openDb`)
and `dbcommon.py` (`connect`) exec `schema.sql` on every open. Add an idempotent
migration in both connect paths: read `PRAGMA table_info(reviews)`, `ALTER TABLE
reviews ADD COLUMN <c>` for each missing column from the known list. Runs after
`schema.sql`, no-op once columns exist.

## Ingestion

`skills/staff-review/SKILL.md`:
- Extend the pre-flight gh fetch (currently `--json number,url,author,baseRefName`)
  to also fetch `state,reviewDecision`.
- Extend the `insert_review.py` JSON payload `pr` object with `author`, `url`,
  `pr_state`, `review_decision`.

`db/insert_review.py`:
- Store the four new fields on insert.
- On upsert (existing review), update them too, and stamp `pr_synced_at`, so a
  re-run of staff-review refreshes PR state.

## Refresh endpoint

`app/server.js`: `POST /api/reviews/:id/refresh`
- Load the review (owner, repo, pr_number) from DB.
- `execFile('gh', ['pr','view', String(pr_number), '--repo', `${owner}/${repo}`,
  '--json','state,reviewDecision,author,title,url','--jq',
  '{state,reviewDecision,author:.author.login,title,url}'])` (array args, no
  shell, DB values are trusted).
- Parse JSON, call `db.js updatePrMeta(id, {...})` to set `pr_state`,
  `review_decision`, `author`, `url`, `title`, `pr_synced_at = now`.
- Return the updated review (same shape as `getReview`).
- gh non-zero exit or parse failure -> HTTP 502 `{error}`; the existing snapshot
  is left intact.

`app/api.js`: add `refreshReview(id)` calling the endpoint.

## Dashboard list

`app/db.js listReviews`: extend the main query with `author`, `url`, `title`,
`pr_state`, `review_decision`, `updated_at`, `pending_count` (rename from
`open_count`), `posted_count` (`posted_at IS NOT NULL`), `addressed_count`
(`addressed_status = 'addressed'`). Compute per-severity pending counts with a
separate grouped query (`SELECT review_id, severity, COUNT(*) ... WHERE
decision='pending' GROUP BY review_id, severity`) merged into rows in JS, to
avoid a fan of correlated subqueries.

`app/src/App.jsx` Dashboard row renders: `#num`, `owner/repo`, **title**,
**author**, **PR badge** (combined), existing **triage status badge** (kept),
**severity breakdown** (colored counts, omit zeros), **posted/addressed** when
> 0, **relative age** (from `updated_at`), and a `↗` **GitHub link** (`url`).

PR-badge derivation + relative-age + severity-breakdown formatting live as pure
helpers in `app/src/triage-model.js` (unit-testable).

## Triage view

`app/db.js getReview`: already returns the full `reviews` row, so new columns
flow through automatically.

`app/src/Triage.jsx` header: show **author**, **PR badge**, `↗` **PR link**,
**Refresh** button (calls `refreshReview`, updates state, shows error inline on
502), and `synced <relative> ago` from `pr_synced_at`.

`app/src/FindingCard.jsx`: add a small `↗` link next to the file pill ->
`blob@head_sha` deep link. `head_sha`, `owner`, `repo` passed from the review
into each card (or via props from Triage). Keep click-to-copy on the pill.

## Card scroll fix

`app/src/styles.css`: add `scroll-margin-top` to `.finding` equal to the sticky
`.triage-header` height (measure at implementation; header has a title row +
chip row). Makes the existing `scrollIntoView({block:'nearest'})` leave room so
the focused card is not hidden under the header.

## Testing

- `db/test_db.py`: migration adds all new columns idempotently on an existing
  DB; `insert_review` stores new fields; upsert updates `pr_state` +
  `review_decision` + `pr_synced_at`.
- `app/test/`: `listReviews` returns severity breakdown + posted/addressed
  counts; `updatePrMeta` writes the new columns; `triage-model` helpers
  (PR-badge derivation, relative-age, severity formatting).
- Refresh endpoint's gh call is not unit-tested (shells out); `updatePrMeta` is
  tested directly. Manual verification: Refresh on a real PR updates the badge.

## Migration / compatibility notes

- `listReviews` renames `open_count` -> `pending_count`; update `App.jsx`
  consumer in the same change.
- `post-review --from-db` and other Python readers are unaffected (additive
  columns only).
