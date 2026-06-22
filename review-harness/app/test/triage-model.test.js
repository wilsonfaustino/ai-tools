import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stripSeverityPrefix, parseBody, filterFindings, groupBySeverity, counts,
  SEVERITY_ORDER, ACTION_ORDER,
  prBadge, relativeAge, severityChips, groupReviews,
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

test('prBadge follows precedence merged > closed > approved > changes > open', () => {
  assert.equal(prBadge('MERGED', 'APPROVED').kind, 'merged')
  assert.equal(prBadge('CLOSED', 'CHANGES_REQUESTED').kind, 'closed')
  assert.equal(prBadge('OPEN', 'APPROVED').kind, 'approved')
  assert.equal(prBadge('OPEN', 'CHANGES_REQUESTED').kind, 'changes')
  assert.equal(prBadge('OPEN', 'REVIEW_REQUIRED').kind, 'open')
  assert.equal(prBadge(null, null).kind, 'open')
})

test('relativeAge formats common buckets and rejects bad input', () => {
  const now = Date.parse('2026-06-19T12:00:00Z')
  assert.equal(relativeAge('2026-06-19T11:59:30Z', now), 'just now')
  assert.equal(relativeAge('2026-06-19T11:30:00Z', now), '30m ago')
  assert.equal(relativeAge('2026-06-19T09:00:00Z', now), '3h ago')
  assert.equal(relativeAge('2026-06-17T12:00:00Z', now), '2d ago')
  assert.equal(relativeAge('', now), '')
  assert.equal(relativeAge('not-a-date', now), '')
})

test('severityChips omits zeros and keeps SEVERITY_ORDER', () => {
  const chips = severityChips({ critical: 2, warning: 0, suggestion: 1, nit: 0 })
  assert.deepEqual(chips.map((c) => c.severity), ['critical', 'suggestion'])
  assert.equal(chips[0].count, 2)
  assert.equal(chips[0].label, 'Critical')
  assert.deepEqual(severityChips(undefined), [])
})

test('groupReviews splits by state, groups by repo, drops empty sections', () => {
  const reviews = [
    { id: 1, owner: 'o', repo: 'a', pr_state: 'OPEN' },
    { id: 2, owner: 'o', repo: 'b', pr_state: 'MERGED' },
    { id: 3, owner: 'o', repo: 'a', pr_state: 'OPEN' },
    { id: 4, owner: 'o', repo: 'a', pr_state: null },
    { id: 5, owner: 'o', repo: 'b', pr_state: 'MERGED' },
  ]
  const sections = groupReviews(reviews)
  assert.deepEqual(sections.map((section) => section.key), ['open', 'merged'])
  assert.equal(sections[0].label, 'Open')
  assert.equal(sections[0].count, 3)
  assert.deepEqual(sections[0].repos.map((group) => group.repo), ['o/a'])
  assert.deepEqual(sections[0].repos[0].reviews.map((review) => review.id), [1, 3, 4])
  assert.deepEqual(sections[1].repos.map((group) => group.repo), ['o/b'])
  assert.equal(sections[1].repos[0].reviews.length, 2)
})

test('groupReviews puts CLOSED (not merged) in its own section', () => {
  const sections = groupReviews([{ id: 1, owner: 'o', repo: 'a', pr_state: 'CLOSED' }])
  assert.deepEqual(sections.map((section) => section.key), ['closed'])
})
