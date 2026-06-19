import { createServer as createHttpServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, normalize, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { listReviews, getReview, saveTriage, updatePrMeta } from './db.js'

const execFileAsync = promisify(execFile)

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

async function serveStatic(res, urlPath) {
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(distDir, safe === '/' ? 'index.html' : safe)
  if (!existsSync(filePath)) filePath = join(distDir, 'index.html')
  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: 'not built; run npm run build' })
    return
  }
  const data = await readFile(filePath)
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' })
  res.end(data)
}

export function createServer() {
  return createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = url.pathname

      if (path === '/health') return sendJson(res, 200, { ok: true })
      if (path === '/api/reviews' && req.method === 'GET') return sendJson(res, 200, listReviews())

      const detail = path.match(/^\/api\/reviews\/(\d+)$/)
      if (detail && req.method === 'GET') {
        const review = getReview(Number(detail[1]))
        return review ? sendJson(res, 200, review) : sendJson(res, 404, { error: 'not found' })
      }

      const triage = path.match(/^\/api\/reviews\/(\d+)\/triage$/)
      if (triage && req.method === 'POST') {
        const parsed = JSON.parse(await readBody(req) || '{}')
        return sendJson(res, 200, saveTriage(Number(triage[1]), parsed.findings || []))
      }

      const refresh = path.match(/^\/api\/reviews\/(\d+)\/refresh$/)
      if (refresh && req.method === 'POST') {
        const id = Number(refresh[1])
        const existing = getReview(id)
        if (!existing) return sendJson(res, 404, { error: 'not found' })
        const { owner, repo, pr_number: prNumber } = existing.review
        try {
          const { stdout } = await execFileAsync('gh', [
            'pr', 'view', String(prNumber), '--repo', `${owner}/${repo}`,
            '--json', 'state,reviewDecision,author,title,url',
            '--jq', '{state,reviewDecision,author:.author.login,title,url}',
          ])
          const meta = JSON.parse(stdout)
          updatePrMeta(id, {
            pr_state: meta.state, review_decision: meta.reviewDecision || '',
            author: meta.author, url: meta.url, title: meta.title,
          })
          return sendJson(res, 200, getReview(id))
        } catch (err) {
          return sendJson(res, 502, { error: `gh refresh failed: ${err && err.message ? err.message : err}` })
        }
      }

      if (req.method === 'GET') return serveStatic(res, path)
      sendJson(res, 404, { error: 'not found' })
    } catch (err) {
      sendJson(res, 500, { error: String(err && err.message ? err.message : err) })
    }
  })
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const port = Number(process.env.REVIEW_HARNESS_PORT || 7777)
  createServer().listen(port, '127.0.0.1', () => {
    process.stdout.write(`review-harness app on http://127.0.0.1:${port}\n`)
  })
}
