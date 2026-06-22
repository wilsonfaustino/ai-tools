import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dbScripts = join(here, '..', '..', 'db')

function seed(dbPath, pr) {
  execFileSync('python3', [join(dbScripts, 'insert_review.py')], {
    input: JSON.stringify({ pr, findings: [] }),
    env: { ...process.env, REVIEW_HARNESS_DB: dbPath },
  })
}

test('selectStale returns only reviews with NULL pr_synced_at', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rh-backfill-'))
  const dbPath = join(dir, 'reviews.db')
  process.env.REVIEW_HARNESS_DB = dbPath
  seed(dbPath, { number: 1, owner: 'o', repo: 'r', head_sha: 's1', author: 'a', pr_state: 'OPEN' })
  seed(dbPath, { number: 2, owner: 'o', repo: 'r', head_sha: 's2' })

  const { openDb } = await import('../db.js?' + Date.now())
  const { selectStale } = await import('../backfill-pr-meta.js?' + Date.now())
  const handle = openDb()
  handle.prepare('UPDATE reviews SET pr_synced_at = NULL WHERE pr_number = 2').run()
  const stale = selectStale(handle)
  handle.close()

  assert.deepEqual(stale.map((review) => review.pr_number), [2])
  assert.equal(stale[0].owner, 'o')
  assert.equal(stale[0].repo, 'r')
  rmSync(dir, { recursive: true, force: true })
})
