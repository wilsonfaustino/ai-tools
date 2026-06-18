import { useEffect, useState } from 'react'
import { fetchReviews, fetchReview, submitTriage } from './api.js'

const DECISIONS = ['pending', 'inline', 'general', 'skip']

function Dashboard({ reviews, onOpen }) {
  return (
    <div className="dashboard">
      <h1>Open reviews</h1>
      {reviews.length === 0 && <p className="muted">No reviews yet. Run staff-review.</p>}
      <ul>
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

function Triage({ detail, onBack, onSaved }) {
  const [rows, setRows] = useState(detail.findings)
  const [saving, setSaving] = useState(false)

  function setRow(id, patch) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  async function save() {
    setSaving(true)
    try {
      await submitTriage(detail.review.id, rows.map((row) => ({
        id: row.id, decision: row.decision, body: row.body,
      })))
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="triage">
      <button className="back" onClick={onBack}>back</button>
      <h1>#{detail.review.pr_number} {detail.review.owner}/{detail.review.repo}</h1>
      {rows.map((row) => (
        <div key={row.id} className={`finding sev-${row.severity}`}>
          <div className="finding-head">
            <code>{row.path}:{row.line}</code>
            <span className="badge">{row.severity}</span>
            {row.in_diff ? null : <span className="badge ood">out-of-diff</span>}
            <select value={row.decision} onChange={(e) => setRow(row.id, { decision: e.target.value })}>
              {DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <textarea value={row.body} onChange={(e) => setRow(row.id, { body: e.target.value })} />
        </div>
      ))}
      <button className="save" disabled={saving} onClick={save}>
        {saving ? 'saving...' : 'Save triage'}
      </button>
      <p className="hint">Then run <code>/post-review --from-db</code> in the PR worktree.</p>
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
    return <Triage key={detail.review.id} detail={detail} onBack={() => setDetail(null)}
      onSaved={() => { setDetail(null); loadReviews() }} />
  }
  return <Dashboard reviews={reviews} onOpen={open} />
}
