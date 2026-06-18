import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, '..', 'db', 'schema.sql')

function dbPath() {
  return process.env.REVIEW_HARNESS_DB
    || join(homedir(), '.claude', 'review-harness', 'reviews.db')
}

export function openDb() {
  const handle = new Database(dbPath())
  handle.pragma('journal_mode = WAL')
  handle.pragma('foreign_keys = ON')
  handle.exec(readFileSync(schemaPath, 'utf8'))
  return handle
}

export function listReviews() {
  const handle = openDb()
  try {
    return handle.prepare(
      `SELECT r.id, r.pr_number, r.owner, r.repo, r.title, r.status, r.updated_at,
              (SELECT COUNT(*) FROM findings f
                WHERE f.review_id = r.id AND f.decision = 'pending') AS open_count
         FROM reviews r ORDER BY r.updated_at DESC`,
    ).all()
  } finally {
    handle.close()
  }
}

export function getReview(id) {
  const handle = openDb()
  try {
    const review = handle.prepare('SELECT * FROM reviews WHERE id = ?').get(id)
    if (!review) return null
    const findings = handle.prepare(
      'SELECT * FROM findings WHERE review_id = ? ORDER BY id',
    ).all(id)
    return { review, findings }
  } finally {
    handle.close()
  }
}

export function saveTriage(id, items) {
  const handle = openDb()
  try {
    const stamp = new Date().toISOString()
    const update = handle.prepare(
      'UPDATE findings SET decision = ?, body = ?, updated_at = ? WHERE id = ? AND review_id = ?',
    )
    const run = handle.transaction((rows) => {
      let updated = 0
      for (const row of rows) updated += update.run(row.decision, row.body, stamp, row.id, id).changes
      return updated
    })
    return { updated: run(items) }
  } finally {
    handle.close()
  }
}
