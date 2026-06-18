# Triage View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the review-harness app's bare triage screen with the "Code Review Triage" design: dark-theme, keyboard-driven, severity-grouped finding cards with a segmented action control and click-to-expand body editor.

**Architecture:** Frontend-only rebuild of the React SPA. A new pure-logic module (`triage-model.js`) holds all grouping/filtering/counting/body-parsing and is unit-tested. Two new presentational components (`Triage.jsx`, `FindingCard.jsx`) consume it. `App.jsx` keeps its router role and a re-themed Dashboard. No backend, schema, or skill changes; the `POST /api/reviews/:id/triage` contract (`{ findings: [{ id, decision, body }] }`) is unchanged.

**Tech Stack:** React 18, Vite 5, plain CSS, Node `node:test` runner.

## Global Constraints

- All `node`, `npm`, and build commands MUST run under Node 24: prefix with `fnm exec --using=24 --`. The Bash default (v20) breaks `better-sqlite3` (ABI mismatch).
- Work happens only under `review-harness/app/`. No schema, DB, installer, hook, or skill files change.
- Severity values are exactly `critical`, `warning`, `suggestion`, `nit`. Action/decision values are exactly `pending`, `inline`, `general`, `skip`. Do not invent others.
- No emojis in code, comments, or commit messages. No em-dashes. Comments only for non-obvious logic.
- Commit messages prefixed `review-harness:`.
- Color palette (from the mock), used verbatim:
  - Severity: critical `#F2545B`, warning `#E5A53B`, suggestion `#58B6D6`, nit `#8892A0`
  - Action: pending `#9AA3B2`, inline `#5B8DEF`, general `#B58CEA`, skip `#646C7A`
  - Surfaces: bg `#0C0D11`, card `#13151A`, accent `#5B8DEF`, green `#2FA56B`

---

### Task 1: Pure triage model + unit tests

**Files:**
- Create: `review-harness/app/src/triage-model.js`
- Test: `review-harness/app/test/triage-model.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SEVERITY_ORDER: string[]` = `['critical','warning','suggestion','nit']`
  - `ACTION_ORDER: string[]` = `['pending','inline','general','skip']`
  - `SEVERITY_META: Record<string,{label:string,color:string}>`
  - `ACTION_META: Record<string,{label:string,color:string,hot:string}>`
  - `stripSeverityPrefix(body: string): string`
  - `parseBody(body: string): Array<{kind:'text'|'code'|'bold', text:string}>`
  - `filterFindings(findings, {severity?:string, pendingOnly?:boolean}): findings[]`
  - `groupBySeverity(findings): Array<{severity,label,color,findings}>`
  - `counts(findings): {total,triaged,pending,bySeverity,byAction}`

- [ ] **Step 1: Write the failing test**

Create `review-harness/app/test/triage-model.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stripSeverityPrefix, parseBody, filterFindings, groupBySeverity, counts,
  SEVERITY_ORDER, ACTION_ORDER,
} from '../src/triage-model.js'

test('SEVERITY_ORDER and ACTION_ORDER are the agreed taxonomies', () => {
  assert.deepEqual(SEVERITY_ORDER, ['critical', 'warning', 'suggestion', 'nit'])
  assert.deepEqual(ACTION_ORDER, ['pending', 'inline', 'general', 'skip'])
})

test('stripSeverityPrefix removes a leading **[severity]** marker only', () => {
  assert.equal(stripSeverityPrefix('**[critical]** Routing bug'), 'Routing bug')
  assert.equal(stripSeverityPrefix('No prefix here'), 'No prefix here')
  assert.equal(stripSeverityPrefix('text **[warning]** mid'), 'text **[warning]** mid')
})

test('parseBody tokenizes code and bold spans after stripping prefix', () => {
  assert.deepEqual(
    parseBody('**[warning]** calls `useHook()` and **bold** text'),
    [
      { kind: 'text', text: 'calls ' },
      { kind: 'code', text: 'useHook()' },
      { kind: 'text', text: ' and ' },
      { kind: 'bold', text: 'bold' },
      { kind: 'text', text: ' text' },
    ],
  )
})

test('parseBody returns a single text token when there is no markup', () => {
  assert.deepEqual(parseBody('plain sentence'), [{ kind: 'text', text: 'plain sentence' }])
})

test('filterFindings filters by severity and pendingOnly', () => {
  const rows = [
    { id: 1, severity: 'critical', decision: 'inline' },
    { id: 2, severity: 'nit', decision: 'pending' },
    { id: 3, severity: 'nit', decision: 'skip' },
  ]
  assert.deepEqual(filterFindings(rows, { severity: 'nit' }).map((f) => f.id), [2, 3])
  assert.deepEqual(filterFindings(rows, { pendingOnly: true }).map((f) => f.id), [2])
  assert.deepEqual(filterFindings(rows, { severity: 'all' }).map((f) => f.id), [1, 2, 3])
  assert.deepEqual(filterFindings(rows, {}).map((f) => f.id), [1, 2, 3])
})

test('groupBySeverity orders groups and drops empty severities', () => {
  const rows = [
    { id: 1, severity: 'nit' }, { id: 2, severity: 'critical' }, { id: 3, severity: 'nit' },
  ]
  const groups = groupBySeverity(rows)
  assert.deepEqual(groups.map((g) => g.severity), ['critical', 'nit'])
  assert.deepEqual(groups[1].findings.map((f) => f.id), [1, 3])
  assert.equal(groups[0].label, 'Critical')
})

test('counts totals findings, pending, triaged, and per-bucket tallies', () => {
  const rows = [
    { severity: 'critical', decision: 'inline' },
    { severity: 'nit', decision: 'pending' },
    { severity: 'nit', decision: 'skip' },
  ]
  const c = counts(rows)
  assert.equal(c.total, 3)
  assert.equal(c.pending, 1)
  assert.equal(c.triaged, 2)
  assert.equal(c.bySeverity.nit, 2)
  assert.equal(c.byAction.skip, 1)
  assert.equal(c.byAction.general, 0)
})

test('counts treats a missing decision as pending', () => {
  const c = counts([{ severity: 'nit' }])
  assert.equal(c.pending, 1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd review-harness/app && fnm exec --using=24 -- node --test test/triage-model.test.js`
Expected: FAIL — cannot find module `../src/triage-model.js`.

- [ ] **Step 3: Write minimal implementation**

Create `review-harness/app/src/triage-model.js`:

```js
export const SEVERITY_ORDER = ['critical', 'warning', 'suggestion', 'nit']

export const SEVERITY_META = {
  critical: { label: 'Critical', color: '#F2545B' },
  warning: { label: 'Warning', color: '#E5A53B' },
  suggestion: { label: 'Suggestion', color: '#58B6D6' },
  nit: { label: 'Nit', color: '#8892A0' },
}

export const ACTION_ORDER = ['pending', 'inline', 'general', 'skip']

export const ACTION_META = {
  pending: { label: 'Pending', color: '#9AA3B2', hot: 'P' },
  inline: { label: 'Inline', color: '#5B8DEF', hot: 'I' },
  general: { label: 'General', color: '#B58CEA', hot: 'G' },
  skip: { label: 'Skip', color: '#646C7A', hot: 'S' },
}

export function stripSeverityPrefix(body) {
  return body.replace(/^\s*\*\*\[[a-z]+\]\*\*\s*/i, '')
}

export function parseBody(body) {
  const text = stripSeverityPrefix(body)
  const tokenPattern = /`([^`]+)`|\*\*([^*]+)\*\*/g
  const tokens = []
  let lastIndex = 0
  let match
  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', text: text.slice(lastIndex, match.index) })
    }
    if (match[1] != null) tokens.push({ kind: 'code', text: match[1] })
    else tokens.push({ kind: 'bold', text: match[2] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) tokens.push({ kind: 'text', text: text.slice(lastIndex) })
  return tokens.length ? tokens : [{ kind: 'text', text: '' }]
}

export function filterFindings(findings, options = {}) {
  const { severity = 'all', pendingOnly = false } = options
  return findings.filter((finding) =>
    (severity === 'all' || finding.severity === severity)
    && (!pendingOnly || (finding.decision || 'pending') === 'pending'))
}

export function groupBySeverity(findings) {
  return SEVERITY_ORDER
    .map((severity) => ({
      severity,
      label: SEVERITY_META[severity].label,
      color: SEVERITY_META[severity].color,
      findings: findings.filter((finding) => finding.severity === severity),
    }))
    .filter((group) => group.findings.length > 0)
}

export function counts(findings) {
  const bySeverity = {}
  SEVERITY_ORDER.forEach((severity) => { bySeverity[severity] = 0 })
  const byAction = {}
  ACTION_ORDER.forEach((action) => { byAction[action] = 0 })
  for (const finding of findings) {
    if (bySeverity[finding.severity] != null) bySeverity[finding.severity] += 1
    const action = finding.decision || 'pending'
    if (byAction[action] != null) byAction[action] += 1
  }
  const total = findings.length
  const pending = byAction.pending
  return { total, triaged: total - pending, pending, bySeverity, byAction }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd review-harness/app && fnm exec --using=24 -- node --test test/triage-model.test.js`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add review-harness/app/src/triage-model.js review-harness/app/test/triage-model.test.js
git commit -m "review-harness: add pure triage model with unit tests"
```

---

### Task 2: Dark-theme stylesheet

**Files:**
- Modify (replace): `review-harness/app/src/styles.css`

**Interfaces:**
- Consumes: nothing (CSS).
- Produces: class names consumed by Tasks 3-5. Data-driven colors arrive via inline `style` (CSS custom props `--sev`, `--act`, `--chip`, or direct `background`/`color`), so the stylesheet itself hardcodes only structure and neutral surfaces.

- [ ] **Step 1: Replace the stylesheet**

Replace the entire contents of `review-harness/app/src/styles.css` with:

```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #0C0D11;
  color: #D7DBE2;
  font-family: 'IBM Plex Sans', -apple-system, system-ui, sans-serif;
}
::selection { background: #5B8DEF44; }
kbd {
  font-family: 'IBM Plex Mono', monospace; font-size: 10px;
  background: #1C1F27; border: 1px solid #2A2E38; border-bottom-width: 2px;
  border-radius: 4px; padding: 1px 5px; color: #AEB6C2;
}
.spacer { flex: 1; }
.muted { opacity: 0.6; }
.error { color: #fcc; background: #3a1a1a; padding: 12px; border-radius: 8px; margin: 24px; }

/* Dashboard (light re-theme of existing rows) */
.dashboard { max-width: 1000px; margin: 0 auto; padding: 28px; }
.dash-title { font-size: 1.2rem; font-weight: 700; }
.review-list { list-style: none; padding: 0; }
.review-row {
  width: 100%; display: flex; gap: 12px; align-items: center;
  background: #13151A; color: #D7DBE2; border: 1px solid #20242D;
  border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; cursor: pointer; text-align: left;
}
.review-row:hover { border-color: #2E3442; }
.review-row .pr { font-family: 'IBM Plex Mono', monospace; font-weight: 600; color: #EAEDF2; }
.review-row .repo { flex: 1; font-family: 'IBM Plex Mono', monospace; font-size: 0.85rem; color: #8A92A0; }
.review-row .status { font-size: 0.72rem; padding: 2px 8px; border-radius: 10px; background: #1C1F27; color: #AEB6C2; }
.review-row .status-posted { background: #1B2A3A; color: #9FB4E8; }
.review-row .status-addressed { background: #14241C; color: #7BD3A6; }
.review-row .open { font-size: 0.8rem; color: #666E7B; }

/* Triage screen */
.triage-screen { min-height: 100vh; padding-bottom: 96px; }
.triage-header {
  position: sticky; top: 0; z-index: 30;
  background: rgba(12, 13, 17, 0.86); backdrop-filter: blur(12px); border-bottom: 1px solid #1B1E26;
}
.header-inner { max-width: 1000px; margin: 0 auto; padding: 16px 28px 0; }
.header-top { display: flex; align-items: flex-start; gap: 18px; }
.back-btn {
  flex: none; display: inline-flex; align-items: center; gap: 5px; padding: 7px 13px;
  border-radius: 8px; border: 1px solid #23262E; background: #15171C; color: #9BA1AC;
  font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
}
.header-title { flex: 1; min-width: 0; }
.title-row { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.pr-num { font-family: 'IBM Plex Mono', monospace; font-size: 16px; font-weight: 600; color: #EAEDF2; }
.repo-slug { font-family: 'IBM Plex Mono', monospace; font-size: 13.5px; color: #8A92A0; }
.subtitle { margin-top: 4px; font-size: 12.5px; color: #666E7B; }
.progress-block { text-align: right; flex: none; }
.triaged-count { font-size: 13px; font-weight: 600; color: #D7DBE2; }
.triaged-count .done { color: #2FA56B; }
.progress-bar {
  display: flex; width: 172px; height: 6px; border-radius: 4px; overflow: hidden;
  background: #1C1F27; margin: 8px 0 0 auto; gap: 1px;
}
.progress-seg { height: 100%; transition: width 0.2s; }
.pending-text { font-size: 11px; color: #8A92A0; margin-top: 7px; }

.chip-row { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; padding: 15px 0; }
.chip {
  display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 8px;
  cursor: pointer; font-size: 12.5px; font-weight: 600; font-family: inherit;
  border: 1px solid #23262E; background: transparent; color: #8A92A0; transition: all 0.12s;
}
.chip.active { border-color: #5B8DEF66; background: #5B8DEF1C; color: #E2E6EC; }
.chip[style*="--chip"].active { border-color: var(--chip); background: transparent; }
.chip-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.chip-count {
  font-size: 11px; font-weight: 700; padding: 0 6px; border-radius: 10px;
  background: #1C1F27; color: #6B7280;
}
.chip.active .chip-count { background: #5B8DEF2E; color: #E2E6EC; }
.chip.toggle.active { border-color: #E5A53B66; background: #E5A53B1C; color: #E5C173; }
.kbd-legend { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: #5A6270; margin-right: 4px; }

.triage-body { max-width: 1000px; margin: 0 auto; padding: 24px 28px 40px; display: flex; flex-direction: column; gap: 28px; }
.empty { text-align: center; padding: 70px 20px; color: #5A6270; font-size: 14px; }
.sev-group { display: flex; flex-direction: column; gap: 12px; }
.group-header { display: flex; align-items: center; gap: 9px; padding-left: 2px; }
.group-dot { width: 7px; height: 7px; border-radius: 50%; }
.group-label { font-size: 12px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; }
.group-count { font-size: 12px; color: #666E7B; font-weight: 600; }

/* Finding card */
.finding {
  position: relative; background: #13151A; border: 1px solid #20242D; border-left: 3px solid #8892A0;
  border-radius: 12px; padding: 16px 18px 15px; display: flex; flex-direction: column; gap: 12px;
  transition: box-shadow 0.12s, border-color 0.12s, opacity 0.12s;
}
.finding.sev-critical { border-left-color: #F2545B; }
.finding.sev-warning { border-left-color: #E5A53B; }
.finding.sev-suggestion { border-left-color: #58B6D6; }
.finding.sev-nit { border-left-color: #8892A0; }
.finding.focused { border-color: #2E3442; box-shadow: 0 0 0 1px #5B8DEF, 0 0 0 4px #5B8DEF22; }
.finding.dimmed { opacity: 0.5; }
.finding-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sev-badge {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 6px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; flex: none;
  color: var(--sev); background: color-mix(in srgb, var(--sev) 12%, transparent);
}
.sev-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--sev); }
.file-pill {
  display: inline-flex; align-items: center; max-width: 100%; font-family: 'IBM Plex Mono', monospace;
  font-size: 12px; background: #181B22; border: 1px solid #23262E; border-radius: 6px;
  padding: 4px 9px; cursor: pointer; overflow: hidden;
}
.file-dir { color: #6B7280; }
.file-name { color: #CBD0D9; font-weight: 600; }
.file-line { color: #5B8DEF; font-weight: 600; }
.badge-ood { font-size: 0.7rem; padding: 1px 6px; border-radius: 4px; background: #553; color: #fc6; flex: none; }
.status { font-size: 12px; font-weight: 600; font-family: inherit; flex: none; }
.finding-body { margin: 0; font-size: 14px; line-height: 1.66; color: #C2C8D2; cursor: pointer; }
.finding-body .body-code {
  font-family: 'IBM Plex Mono', monospace; background: #1B1E26; color: #9FC8FF;
  padding: 1px 5px; border-radius: 4px; font-size: 12.5px;
}
.body-editor {
  width: 100%; min-height: 90px; background: #0F1116; color: #D7DBE2; border: 1px solid #23262E;
  border-radius: 8px; padding: 10px; font-family: 'IBM Plex Mono', monospace; font-size: 12.5px;
  line-height: 1.5; resize: vertical;
}
.seg-control {
  display: inline-flex; background: #0F1116; border: 1px solid #20242D; border-radius: 9px; padding: 3px; gap: 2px;
}
.seg {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; font-size: 12.5px;
  font-weight: 600; border-radius: 7px; cursor: pointer; letter-spacing: 0.2px; font-family: inherit;
  border: 1px solid transparent; background: transparent; color: #6B7280; transition: all 0.12s;
}
.seg.active {
  color: var(--act); border-color: color-mix(in srgb, var(--act) 40%, transparent);
  background: color-mix(in srgb, var(--act) 14%, transparent);
}
.seg-dot { width: 6px; height: 6px; border-radius: 50%; background: #4B515C; flex: none; }
.seg.active .seg-dot { background: var(--act); }

/* Footer */
.triage-footer {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  background: rgba(12, 13, 17, 0.92); backdrop-filter: blur(12px); border-top: 1px solid #1B1E26;
}
.footer-inner { max-width: 1000px; margin: 0 auto; padding: 14px 28px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.footer-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.footer-status { font-size: 13px; font-weight: 600; }
.cmd-hint { display: flex; align-items: center; gap: 7px; font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: #666E7B; }
.cmd-hint code { background: #181B22; border: 1px solid #23262E; border-radius: 6px; padding: 3px 8px; color: #9FB4E8; }
.save-btn {
  display: inline-flex; align-items: center; gap: 8px; padding: 9px 20px; border-radius: 9px; border: none;
  cursor: pointer; font-size: 13.5px; font-weight: 700; font-family: inherit; transition: all 0.15s;
  background: #2FA56B; color: #06140C; box-shadow: 0 2px 14px #2FA56B33;
}
.save-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.toast {
  position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); z-index: 40;
  background: #14241C; border: 1px solid #2FA56B66; color: #7BD3A6; padding: 12px 18px;
  border-radius: 10px; font-size: 13px; font-weight: 600;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);
}
```

- [ ] **Step 2: Verify the build still succeeds**

Run: `cd review-harness/app && fnm exec --using=24 -- npm run build`
Expected: build completes, `dist/` written, no errors. (The old `App.jsx` still references removed classes but CSS is additive, so the build is unaffected.)

- [ ] **Step 3: Commit**

```bash
git add review-harness/app/src/styles.css
git commit -m "review-harness: dark-theme stylesheet for triage redesign"
```

---

### Task 3: FindingCard component

**Files:**
- Create: `review-harness/app/src/FindingCard.jsx`

**Interfaces:**
- Consumes from Task 1: `parseBody`, `SEVERITY_META`, `ACTION_META`, `ACTION_ORDER`.
- Produces: default export `FindingCard`, props
  `{ finding, focused: boolean, expanded: boolean, onFocus(id), onAction(id, action), onBodyChange(id, body), onToggleExpand(id) }`.
  `finding` shape: `{ id, severity, path, line, decision, body, in_diff }`.

- [ ] **Step 1: Write the component**

Create `review-harness/app/src/FindingCard.jsx`:

```jsx
import { parseBody, SEVERITY_META, ACTION_META, ACTION_ORDER } from './triage-model.js'

function renderBody(body) {
  return parseBody(body).map((token, index) => {
    if (token.kind === 'code') return <code key={index} className="body-code">{token.text}</code>
    if (token.kind === 'bold') return <strong key={index}>{token.text}</strong>
    return <span key={index}>{token.text}</span>
  })
}

export default function FindingCard({ finding, focused, expanded, onFocus, onAction, onBodyChange, onToggleExpand }) {
  const decision = finding.decision || 'pending'
  const severity = SEVERITY_META[finding.severity] || { label: finding.severity, color: '#8892A0' }
  const slashIndex = finding.path.lastIndexOf('/')
  const dir = finding.path.slice(0, slashIndex + 1)
  const name = finding.path.slice(slashIndex + 1)
  const dimmed = decision === 'skip' && !focused
  const statusColor = decision === 'pending' ? '#E5A53B' : ACTION_META[decision].color
  const statusText = decision === 'pending' ? '○ Pending' : `✓ ${ACTION_META[decision].label}`

  function copyReference(event) {
    event.stopPropagation()
    try { navigator.clipboard.writeText(`${finding.path}:${finding.line}`) } catch (err) { /* clipboard unavailable */ }
  }

  function toggleEditor(event) {
    event.stopPropagation()
    onFocus(finding.id)
    onToggleExpand(finding.id)
  }

  return (
    <div
      id={`fc-${finding.id}`}
      className={`finding sev-${finding.severity}${focused ? ' focused' : ''}${dimmed ? ' dimmed' : ''}`}
      onClick={() => onFocus(finding.id)}
    >
      <div className="finding-head">
        <span className="sev-badge" style={{ '--sev': severity.color }}>
          <span className="sev-dot" />{severity.label}
        </span>
        <code className="file-pill" title="Click to copy reference" onClick={copyReference}>
          <span className="file-dir">{dir}</span>
          <span className="file-name">{name}</span>
          <span className="file-line">:{finding.line}</span>
        </code>
        {finding.in_diff ? null : <span className="badge-ood">out-of-diff</span>}
        <span className="spacer" />
        <span className="status" style={{ color: statusColor }}>{statusText}</span>
      </div>

      <p className="finding-body" onClick={toggleEditor}>{renderBody(finding.body)}</p>

      {expanded && (
        <textarea
          className="body-editor"
          value={finding.body}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onBodyChange(finding.id, event.target.value)}
        />
      )}

      <div className="seg-control" onClick={(event) => event.stopPropagation()}>
        {ACTION_ORDER.map((key) => {
          const meta = ACTION_META[key]
          const active = decision === key
          return (
            <button
              key={key}
              className={`seg${active ? ' active' : ''}`}
              style={{ '--act': meta.color }}
              title={`Set to ${meta.label} (press ${meta.hot})`}
              onClick={() => onAction(finding.id, key)}
            >
              <span className="seg-dot" />{meta.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the build compiles the component**

Run: `cd review-harness/app && fnm exec --using=24 -- npm run build`
Expected: build completes with no errors. (Component is not yet imported anywhere; this confirms it parses and type-checks under the bundler.)

- [ ] **Step 3: Commit**

```bash
git add review-harness/app/src/FindingCard.jsx
git commit -m "review-harness: add FindingCard component"
```

---

### Task 4: Triage screen component

**Files:**
- Create: `review-harness/app/src/Triage.jsx`

**Interfaces:**
- Consumes from Task 1: `SEVERITY_ORDER`, `SEVERITY_META`, `ACTION_META`, `filterFindings`, `groupBySeverity`, `counts`.
- Consumes from Task 3: `FindingCard`.
- Consumes existing `./api.js`: `submitTriage(reviewId, findings)`.
- Produces: default export `Triage`, props `{ detail: { review, findings }, onBack(), onSaved() }`.

- [ ] **Step 1: Write the component**

Create `review-harness/app/src/Triage.jsx`:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { submitTriage } from './api.js'
import FindingCard from './FindingCard.jsx'
import {
  SEVERITY_ORDER, SEVERITY_META, ACTION_META,
  filterFindings, groupBySeverity, counts,
} from './triage-model.js'

const PROGRESS_ORDER = ['inline', 'general', 'skip', 'pending']
const KEY_TO_ACTION = { p: 'pending', i: 'inline', g: 'general', s: 'skip' }

export default function Triage({ detail, onBack, onSaved }) {
  const [rows, setRows] = useState(detail.findings)
  const [filter, setFilter] = useState('all')
  const [pendingOnly, setPendingOnly] = useState(false)
  const [focusedId, setFocusedId] = useState(detail.findings[0]?.id ?? null)
  const [expandedId, setExpandedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const toastTimer = useRef(null)

  const stat = useMemo(() => counts(rows), [rows])
  const ordered = useMemo(() => {
    const visible = filterFindings(rows, { severity: filter, pendingOnly })
    return SEVERITY_ORDER.flatMap((severity) => visible.filter((finding) => finding.severity === severity))
  }, [rows, filter, pendingOnly])
  const groups = useMemo(() => groupBySeverity(ordered), [ordered])
  const visibleIds = ordered.map((finding) => finding.id)

  function setAction(id, action) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, decision: action } : row)))
    setSaved(false)
  }
  function setBody(id, body) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, body } : row)))
    setSaved(false)
  }
  function toggleExpand(id) {
    setExpandedId((current) => (current === id ? null : id))
  }
  function focus(id) {
    setFocusedId(id)
    requestAnimationFrame(() => {
      const element = document.getElementById(`fc-${id}`)
      if (element) element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }
  function move(delta) {
    if (!visibleIds.length) return
    let index = visibleIds.indexOf(focusedId)
    if (index < 0) index = delta > 0 ? -1 : visibleIds.length
    const next = Math.max(0, Math.min(visibleIds.length - 1, index + delta))
    focus(visibleIds[next])
  }

  useEffect(() => {
    function onKey(event) {
      const tag = event.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const key = event.key.toLowerCase()
      if (key === 'j' || key === 'arrowdown') { event.preventDefault(); move(1); return }
      if (key === 'k' || key === 'arrowup') { event.preventDefault(); move(-1); return }
      if (KEY_TO_ACTION[key] && focusedId != null) { event.preventDefault(); setAction(focusedId, KEY_TO_ACTION[key]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function save() {
    setSaving(true)
    try {
      await submitTriage(detail.review.id, rows.map((row) => ({ id: row.id, decision: row.decision, body: row.body })))
      setSaved(true)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setSaved(false), 3200)
      if (onSaved) onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="triage-screen">
      <header className="triage-header">
        <div className="header-inner">
          <div className="header-top">
            <button className="back-btn" onClick={onBack}>&lsaquo; Back</button>
            <div className="header-title">
              <div className="title-row">
                <span className="pr-num">#{detail.review.pr_number}</span>
                <span className="repo-slug">{detail.review.owner}/{detail.review.repo}</span>
              </div>
              <div className="subtitle">Decide what to do with each finding, then save your triage.</div>
            </div>
            <div className="progress-block">
              <div className="triaged-count"><span className="done">{stat.triaged}</span> / {stat.total} triaged</div>
              <div className="progress-bar">
                {PROGRESS_ORDER.map((action) => (
                  <div key={action} className="progress-seg"
                    style={{ width: `${stat.total ? (stat.byAction[action] / stat.total) * 100 : 0}%`, background: ACTION_META[action].color }} />
                ))}
              </div>
              <div className="pending-text">{stat.pending > 0 ? `${stat.pending} pending` : 'all done'}</div>
            </div>
          </div>
          <div className="chip-row">
            <button className={`chip${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
              <span className="chip-dot" style={{ background: '#7E8696' }} />All<span className="chip-count">{stat.total}</span>
            </button>
            {SEVERITY_ORDER.map((severity) => (
              <button key={severity} className={`chip${filter === severity ? ' active' : ''}`}
                style={{ '--chip': SEVERITY_META[severity].color }} onClick={() => setFilter(severity)}>
                <span className="chip-dot" style={{ background: SEVERITY_META[severity].color }} />
                {SEVERITY_META[severity].label}<span className="chip-count">{stat.bySeverity[severity]}</span>
              </button>
            ))}
            <span className="spacer" />
            <span className="kbd-legend"><kbd>J</kbd><kbd>K</kbd> move <kbd>P</kbd><kbd>I</kbd><kbd>G</kbd><kbd>S</kbd> act</span>
            <button className={`chip toggle${pendingOnly ? ' active' : ''}`} onClick={() => setPendingOnly((value) => !value)}>
              <span className="chip-dot" style={{ background: '#E5A53B' }} />Pending only
            </button>
          </div>
        </div>
      </header>

      <main className="triage-body">
        {groups.length === 0 && <div className="empty">No findings match this filter.</div>}
        {groups.map((group) => (
          <section key={group.severity} className="sev-group">
            <div className="group-header">
              <span className="group-dot" style={{ background: group.color }} />
              <span className="group-label" style={{ color: group.color }}>{group.label}</span>
              <span className="group-count">{group.findings.length}</span>
            </div>
            {group.findings.map((finding) => (
              <FindingCard key={finding.id} finding={finding}
                focused={finding.id === focusedId}
                expanded={finding.id === expandedId}
                onFocus={focus} onAction={setAction} onBodyChange={setBody} onToggleExpand={toggleExpand} />
            ))}
          </section>
        ))}
      </main>

      <footer className="triage-footer">
        <div className="footer-inner">
          <span className="footer-dot" style={{ background: stat.pending > 0 ? '#E5A53B' : '#2FA56B' }} />
          <span className="footer-status" style={{ color: stat.pending > 0 ? '#E5A53B' : '#2FA56B' }}>
            {stat.pending > 0
              ? `${stat.pending} ${stat.pending === 1 ? 'finding still needs a decision' : 'findings still need a decision'}`
              : 'All findings triaged'}
          </span>
          <span className="spacer" />
          <span className="cmd-hint">then run <code>/post-review --from-db</code></span>
          <button className="save-btn" disabled={saving} onClick={save}>
            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save triage'}
          </button>
        </div>
      </footer>

      {saved && <div className="toast">&#10003; Triage saved &mdash; {stat.triaged} of {stat.total} findings recorded.</div>}
    </div>
  )
}
```

Note: `&mdash;` in the toast is rendered HTML output (the saved-confirmation copy), not source prose, mirroring the mock's toast text.

- [ ] **Step 2: Verify the build compiles**

Run: `cd review-harness/app && fnm exec --using=24 -- npm run build`
Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add review-harness/app/src/Triage.jsx
git commit -m "review-harness: add Triage screen component"
```

---

### Task 5: Wire up App and verify end to end

**Files:**
- Modify (replace): `review-harness/app/src/App.jsx`

**Interfaces:**
- Consumes from Task 4: `Triage`.
- Consumes existing `./api.js`: `fetchReviews`, `fetchReview`.
- Behavior change: on save, the app stays on the triage screen (so the toast shows) and refreshes the review list in the background. `onSaved` therefore reloads reviews without clearing `detail`.

- [ ] **Step 1: Replace App.jsx**

Replace the entire contents of `review-harness/app/src/App.jsx` with:

```jsx
import { useEffect, useState } from 'react'
import { fetchReviews, fetchReview } from './api.js'
import Triage from './Triage.jsx'

function Dashboard({ reviews, onOpen }) {
  return (
    <div className="dashboard">
      <h1 className="dash-title">Open reviews</h1>
      {reviews.length === 0 && <p className="muted">No reviews yet. Run staff-review.</p>}
      <ul className="review-list">
        {reviews.map((review) => (
          <li key={review.id}>
            <button className="review-row" onClick={() => onOpen(review.id)}>
              <span className="pr">#{review.pr_number}</span>
              <span className="repo">{review.owner}/{review.repo}</span>
              <span className={`status status-${review.status}`}>{review.status}</span>
              <span className="open">{review.open_count} undecided</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function App() {
  const [reviews, setReviews] = useState([])
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)

  async function loadReviews() {
    try { setReviews(await fetchReviews()) } catch (err) { setError(err.message) }
  }

  useEffect(() => { loadReviews() }, [])

  async function open(id) {
    try { setDetail(await fetchReview(id)) } catch (err) { setError(err.message) }
  }

  if (error) return <div className="error">{error}</div>
  if (detail) {
    return <Triage key={detail.review.id} detail={detail} onBack={() => setDetail(null)} onSaved={loadReviews} />
  }
  return <Dashboard reviews={reviews} onOpen={open} />
}
```

- [ ] **Step 2: Run the full test suite**

Run: `cd review-harness/app && fnm exec --using=24 -- npm test`
Expected: PASS — `triage-model.test.js`, `db.test.js`, and `server.test.js` all green.

- [ ] **Step 3: Build**

Run: `cd review-harness/app && fnm exec --using=24 -- npm run build`
Expected: build completes, `dist/` regenerated, no errors.

- [ ] **Step 4: Manual verification in the browser**

Start the server, then check the UI:

```bash
cd review-harness/app && fnm exec --using=24 -- node server.js
```

Open `http://127.0.0.1:7777` and confirm:
- Dashboard lists the CWS-20146 review (PR #10164); dark theme applied.
- Clicking it opens the triage screen with 11 findings grouped by severity (1 critical, 3 warning, 1 suggestion, 6 nit).
- `J`/`K` move the focus ring; `P`/`I`/`G`/`S` change the focused card's action; progress bar and counts update.
- Filter chips and "Pending only" toggle narrow the list; severity headers/counts track.
- Clicking a finding body opens the inline editor; edits persist while navigating.
- Clicking the file pill copies `path:line` (paste to confirm).
- "Save triage" posts, shows the toast, and stays on the screen.

Stop the server with Ctrl-C when done.

- [ ] **Step 5: Commit**

```bash
git add review-harness/app/src/App.jsx
git commit -m "review-harness: wire triage redesign into App and keep page on save"
```

---

## Self-Review

**Spec coverage:**
- Header/progress/pending text -> Task 4.
- Filter chips + pending toggle + keyboard legend -> Task 4.
- Severity grouping -> Task 1 (`groupBySeverity`) + Task 4 render.
- Finding card (badge, file pill copy, status, segmented action, skip-dim, out-of-diff) -> Task 3.
- Click-to-expand body editor -> Task 3 + Task 4 state.
- Keyboard nav (J/K, P/I/G/S, suppressed in fields) -> Task 4.
- Sticky footer + `/post-review --from-db` hint + Save -> Task 4.
- Save toast (stay on page) -> Task 4 + Task 5 `onSaved`.
- Body lite-render (code + bold) + strip `**[severity]**` prefix -> Task 1 + Task 3.
- Dashboard light re-theme -> Task 2 (CSS) + Task 5 (classes).
- Out-of-scope (source chips, schema, dashboard redesign) -> not implemented, per spec.

**Placeholder scan:** none. Every code step contains complete code.

**Type consistency:** `FindingCard` prop names (`onFocus`, `onAction`, `onBodyChange`, `onToggleExpand`, `focused`, `expanded`) match the calls in `Triage.jsx`. Model exports (`SEVERITY_ORDER`, `SEVERITY_META`, `ACTION_META`, `ACTION_ORDER`, `filterFindings`, `groupBySeverity`, `counts`, `parseBody`, `stripSeverityPrefix`) match all imports in Tasks 3-4 and the tests in Task 1.
