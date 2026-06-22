import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dbScripts = join(here, '..', '..', 'db')

function seed(dbPath) {
  const env = { ...process.env, REVIEW_HARNESS_DB: dbPath }
  execFileSync('python3', [join(dbScripts, 'insert_review.py')], {
    input: JSON.stringify({
      pr: {
        number: 7, owner: 'me', repo: 'r', branch: 'b', title: 't', head_sha: 's',
        author: 'alice', url: 'https://github.com/me/r/pull/7',
        pr_state: 'OPEN', review_decision: 'REVIEW_REQUIRED',
      },
      findings: [
        { severity: 'major', path: 'x.ts', line: 3, in_diff: true, body: '**[major]** y' },
        { severity: 'nit', path: 'z.ts', line: 9, in_diff: true, body: '**[nit]** w' },
      ],
    }),
    env,
  })
}

test('listReviews and getReview and saveTriage round-trip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rh-app-'))
  const dbPath = join(dir, 'reviews.db')
  process.env.REVIEW_HARNESS_DB = dbPath
  seed(dbPath)
  const { listReviews, getReview, saveTriage } = await import('../db.js?' + Date.now())

  const reviews = listReviews()
  assert.equal(reviews.length, 1)
  assert.equal(reviews[0].pending_count, 2)
  assert.equal(reviews[0].author, 'alice')
  assert.equal(reviews[0].pr_state, 'OPEN')
  assert.equal(reviews[0].severity.major === undefined, true)
  assert.equal(reviews[0].severity.nit, 1)

  const detail = getReview(reviews[0].id)
  assert.equal(detail.findings.length, 2)

  const res = saveTriage(reviews[0].id, [
    { id: detail.findings[0].id, decision: 'inline', body: '**[major]** edited' },
    { id: detail.findings[1].id, decision: 'skip', body: detail.findings[1].body },
  ])
  assert.equal(res.updated, 2)

  const after = getReview(reviews[0].id)
  const edited = after.findings.find((f) => f.id === detail.findings[0].id)
  assert.equal(edited.decision, 'inline')
  assert.equal(edited.body, '**[major]** edited')
  rmSync(dir, { recursive: true, force: true })
})

test('deleteReview removes review and cascades findings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rh-del-'))
  const dbPath = join(dir, 'reviews.db')
  process.env.REVIEW_HARNESS_DB = dbPath
  seed(dbPath)
  const { listReviews, getReview, deleteReview, openDb } = await import('../db.js?' + Date.now())
  const id = listReviews()[0].id

  const removed = deleteReview(id)
  assert.equal(removed, 1)
  assert.equal(listReviews().length, 0)
  assert.equal(getReview(id), null)

  const handle = openDb()
  const orphans = handle.prepare('SELECT COUNT(*) AS n FROM findings WHERE review_id = ?').get(id)
  handle.close()
  assert.equal(orphans.n, 0)

  assert.equal(deleteReview(id), 0)
  rmSync(dir, { recursive: true, force: true })
})

test('updatePrMeta refreshes state and stamps pr_synced_at', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rh-meta-'))
  const dbPath = join(dir, 'reviews.db')
  process.env.REVIEW_HARNESS_DB = dbPath
  seed(dbPath)
  const { listReviews, updatePrMeta } = await import('../db.js?' + Date.now())
  const id = listReviews()[0].id

  const changed = updatePrMeta(id, {
    pr_state: 'MERGED', review_decision: 'APPROVED',
    author: 'alice', url: 'u', title: 't2',
  })
  assert.equal(changed, 1)

  const row = listReviews()[0]
  assert.equal(row.pr_state, 'MERGED')
  assert.equal(row.review_decision, 'APPROVED')
  assert.equal(row.title, 't2')
  assert.ok(row.pr_synced_at)
  rmSync(dir, { recursive: true, force: true })
})
