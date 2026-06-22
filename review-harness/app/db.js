import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, '..', 'db', 'schema.sql')

const REVIEW_COLUMNS = [
  ['author', 'TEXT'], ['url', 'TEXT'], ['pr_state', 'TEXT'],
  ['review_decision', 'TEXT'], ['pr_synced_at', 'TEXT'],
]

function applyMigrations(handle) {
  const existing = new Set(handle.prepare('PRAGMA table_info(reviews)').all().map((column) => column.name))
  for (const [name, type] of REVIEW_COLUMNS) {
    if (!existing.has(name)) handle.exec(`ALTER TABLE reviews ADD COLUMN ${name} ${type}`)
  }
}

function dbPath() {
  return process.env.REVIEW_HARNESS_DB
    || join(homedir(), '.claude', 'review-harness', 'reviews.db')
}

export function openDb() {
  const handle = new Database(dbPath())
  handle.pragma('journal_mode = WAL')
  handle.pragma('foreign_keys = ON')
  handle.pragma('busy_timeout = 5000')
  handle.exec(readFileSync(schemaPath, 'utf8'))
  applyMigrations(handle)
  return handle
}

export function listReviews() {
  const handle = openDb()
  try {
    const rows = handle.prepare(
      `SELECT r.id, r.pr_number, r.owner, r.repo, r.title, r.author, r.url,
              r.status, r.pr_state, r.review_decision, r.pr_synced_at, r.updated_at,
              (SELECT COUNT(*) FROM findings f
                 WHERE f.review_id = r.id AND f.decision = 'pending') AS pending_count,
              (SELECT COUNT(*) FROM findings f
                 WHERE f.review_id = r.id AND f.posted_at IS NOT NULL) AS posted_count,
              (SELECT COUNT(*) FROM findings f
                 WHERE f.review_id = r.id AND f.addressed_status = 'addressed') AS addressed_count
         FROM reviews r ORDER BY r.updated_at DESC`,
    ).all()
    const severityRows = handle.prepare(
      `SELECT review_id, severity, COUNT(*) AS n
         FROM findings WHERE decision = 'pending'
        GROUP BY review_id, severity`,
    ).all()
    const severityByReview = {}
    for (const severityRow of severityRows) {
      (severityByReview[severityRow.review_id] ||= {})[severityRow.severity] = severityRow.n
    }
    return rows.map((row) => ({
      ...row,
      severity: {
        critical: severityByReview[row.id]?.critical || 0,
        warning: severityByReview[row.id]?.warning || 0,
        suggestion: severityByReview[row.id]?.suggestion || 0,
        nit: severityByReview[row.id]?.nit || 0,
      },
    }))
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

export function deleteReview(id) {
  const handle = openDb()
  try {
    // findings cascade via ON DELETE CASCADE (foreign_keys pragma is ON)
    return handle.prepare('DELETE FROM reviews WHERE id = ?').run(id).changes
  } finally {
    handle.close()
  }
}

export function updatePrMeta(id, meta) {
  const handle = openDb()
  try {
    const stamp = new Date().toISOString()
    const info = handle.prepare(
      `UPDATE reviews SET pr_state = ?, review_decision = ?, author = ?, url = ?,
              title = ?, pr_synced_at = ? WHERE id = ?`,
    ).run(meta.pr_state ?? null, meta.review_decision ?? null, meta.author ?? null,
          meta.url ?? null, meta.title ?? null, stamp, id)
    return info.changes
  } finally {
    handle.close()
  }
}
