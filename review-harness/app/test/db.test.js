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
      pr: { number: 7, owner: 'me', repo: 'r', branch: 'b', title: 't', head_sha: 's' },
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
  assert.equal(reviews[0].open_count, 2)

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
