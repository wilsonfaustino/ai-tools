// One-off backfill: fill PR metadata (author, url, state, review decision, title)
// for reviews ingested before the metadata feature, by fetching each from gh.
// Targets rows that were never synced (pr_synced_at IS NULL). Run once:
//   REVIEW_HARNESS_DB=~/.claude/review-harness/reviews.db node backfill-pr-meta.js
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { openDb, updatePrMeta } from './db.js'

export function selectStale(handle) {
  return handle.prepare(
    'SELECT id, owner, repo, pr_number FROM reviews WHERE pr_synced_at IS NULL ORDER BY id',
  ).all()
}

export function fetchPrMeta(owner, repo, prNumber) {
  const stdout = execFileSync('gh', [
    'pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`,
    '--json', 'state,reviewDecision,author,title,url',
    '--jq', '{state,reviewDecision,author:.author.login,title,url}',
  ], { encoding: 'utf8' })
  return JSON.parse(stdout)
}

function main() {
  const handle = openDb()
  const stale = selectStale(handle)
  handle.close()

  if (!stale.length) {
    process.stdout.write('backfill: no reviews need PR metadata\n')
    return
  }

  let filled = 0
  let skipped = 0
  for (const review of stale) {
    try {
      const meta = fetchPrMeta(review.owner, review.repo, review.pr_number)
      updatePrMeta(review.id, {
        pr_state: meta.state, review_decision: meta.reviewDecision || '',
        author: meta.author, url: meta.url, title: meta.title,
      })
      filled += 1
      process.stdout.write(`filled #${review.pr_number} ${review.owner}/${review.repo} -> ${meta.state}\n`)
    } catch (err) {
      skipped += 1
      const reason = String(err && err.message ? err.message : err).split('\n')[0]
      process.stderr.write(`skip #${review.pr_number} ${review.owner}/${review.repo}: ${reason}\n`)
    }
  }
  process.stdout.write(`backfill done: ${filled} filled, ${skipped} skipped, ${stale.length} candidates\n`)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) main()
