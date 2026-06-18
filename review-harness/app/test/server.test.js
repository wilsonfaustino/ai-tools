import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('health and reviews endpoints respond', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rh-srv-'))
  process.env.REVIEW_HARNESS_DB = join(dir, 'reviews.db')
  const { createServer } = await import('../server.js?' + Date.now())
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const health = await fetch(`http://127.0.0.1:${port}/health`)
  assert.equal(health.status, 200)

  const reviews = await fetch(`http://127.0.0.1:${port}/api/reviews`)
  assert.equal(reviews.status, 200)
  assert.deepEqual(await reviews.json(), [])

  await new Promise((resolve) => server.close(resolve))
})
