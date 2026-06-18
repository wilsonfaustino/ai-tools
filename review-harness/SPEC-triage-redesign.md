# Spec: Triage view redesign

Date: 2026-06-18
Status: approved, pending implementation plan

## Goal

Replace the review-harness app's bare `<select>` + `<textarea>` triage screen with
the "Code Review Triage" design: a dark-theme, keyboard-driven, severity-grouped
triage surface. No backend, schema, or skill changes. The Dashboard (review list)
is re-themed for visual consistency only.

Reference design: `Code Review Triage.dc.html` (downloaded artifact, not committed).

## Why this is a clean swap

The seeded DB already matches the mock's data model:

- Severities in use: `critical`, `warning`, `suggestion`, `nit` (matches mock exactly;
  current app CSS `sev-major` / `sev-minor` is stale and gets removed).
- Decisions in use: `pending`, `inline`, `general`, `skip` (matches mock's action set).

So this is a frontend-only rebuild. The `POST /api/reviews/:id/triage` contract
(`{ findings: [{ id, decision, body }] }`) is unchanged.

## Scope decisions

- **Body editing: keep, click-to-expand.** Default card is read-only like the mock.
  Clicking a finding reveals an inline editor for the comment body. Edits are tracked
  in component state and saved with the triage POST. Preserves pre-post tweaking.
- **Source chips: deferred.** The mock shows reviewer-source chips
  (`code-reviewer`, `pr-test-analyzer`, `local:regression`). The `findings` table has
  no `source` column. Adding it (schema migration + staff-review write-path change) is
  Phase 3. The rebuild omits source chips.
- **Dashboard: light re-theme only.** Apply the design's color/font tokens to the
  existing row layout. No layout change, no new per-PR data. The mock provides no list
  layout, so a full list redesign is out of scope.

## File structure

The triage screen outgrows a single component, so split by responsibility:

- `src/App.jsx` — top-level router + Dashboard (re-themed, class changes only).
- `src/Triage.jsx` — triage screen: sticky header, filter chips, severity groups,
  sticky footer, save toast, keyboard navigation.
- `src/FindingCard.jsx` — one finding: severity badge, file pill, status text,
  rendered body, segmented action control, click-to-expand body editor.
- `src/triage-model.js` — pure, framework-free helpers (grouping, filtering, counts,
  body parsing, prefix stripping). Unit-tested.
- `src/styles.css` — replaced with the design's token set (IBM Plex Sans/Mono, the
  mock's color palette).

## Features ported from the mock

1. **Sticky header**: Back button, `#PR` + `owner/repo` slug, subtitle, right-aligned
   `X / Y triaged` count, segmented progress bar (by action), pending-count text.
2. **Filter chips**: `All` + one chip per severity with live counts; `Pending only`
   toggle; a `J K` / `P I G S` keyboard legend.
3. **Severity grouping**: order `critical` → `warning` → `suggestion` → `nit`, each
   group with a colored dot, label, and count header. Empty groups hidden.
4. **Finding card**: severity badge, file pill that copies `path:line` on click,
   status text (`○ Pending` / `✓ Inline`), segmented action control
   (`Pending` / `Inline` / `General` / `Skip`). Skip-decided cards dim when unfocused.
   Keep the existing `out-of-diff` badge driven by `in_diff` (real field, not in mock).
5. **Click-to-expand body editor** (our addition): clicking the card body reveals a
   themed textarea; edits persist in state and save with the triage.
6. **Keyboard navigation**: `J` / `K` (and arrows) move focus between visible findings;
   `P` / `I` / `G` / `S` set the focused finding's action. Suppressed while a textarea
   or input is focused.
7. **Sticky footer**: status dot + `N findings still need a decision` /
   `All findings triaged`, the reminder `then run /post-review --from-db`, and the
   `Save triage` button.
8. **Save toast**: transient confirmation after a successful save.

## Data handling

- **Body rendering**: a lite renderer for inline `` `code` `` and `**bold**` only
  (no markdown library). Strip a leading `**[severity]**` prefix when present, since the
  badge already conveys severity.
- **Severity / decision values**: consumed as-is from the DB; no mapping table needed.
- **`in_diff`**: retained, surfaced as the `out-of-diff` badge.

## Out of scope (Phase 3 backlog)

- Source chips and the `findings.source` column + staff-review write path.
- Full Dashboard redesign beyond theming.
- The mock's design-tool props (accent-color picker, `groupBySeverity` toggle).

## Testing & verification

- Unit-test `src/triage-model.js` (grouping, filtering, counts, body parse, prefix
  strip) with the Node test runner, matching the existing `test/` setup.
- `vite build` passes.
- Existing `test/db.test.js` and `test/server.test.js` remain green (no backend change).
- Manual: app renders the CWS-20146 review (11 findings); keyboard nav, filters,
  click-to-edit, and save all work in the browser at `127.0.0.1:7777`.
