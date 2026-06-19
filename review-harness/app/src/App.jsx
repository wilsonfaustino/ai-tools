import { useEffect, useState } from 'react'
import { fetchReviews, fetchReview } from './api.js'
import Triage from './Triage.jsx'
import { prBadge, relativeAge, severityChips, groupReviews } from './triage-model.js'

function ReviewRow({ review, onOpen, now }) {
  const badge = prBadge(review.pr_state, review.review_decision)
  const chips = severityChips(review.severity)
  return (
    <li>
      <button className="review-row" onClick={() => onOpen(review.id)}>
        <span className="pr">#{review.pr_number}</span>
        <span className="row-title">{review.title}</span>
        {review.author && <span className="author">@{review.author}</span>}
        <span className="pr-badge" style={{ '--badge': badge.color }}>{badge.label}</span>
        <span className={`status status-${review.status}`}>{review.status}</span>
        <span className="spacer" />
        {chips.length > 0 && (
          <span className="sev-mini">
            {chips.map((chip) => (
              <span key={chip.severity} className="sev-mini-item" style={{ color: chip.color }}>
                {chip.count}{chip.label[0]}
              </span>
            ))}
          </span>
        )}
        <span className="age">{relativeAge(review.updated_at, now)}</span>
        {review.url && (
          <a className="gh-link" href={review.url} target="_blank" rel="noreferrer"
             onClick={(event) => event.stopPropagation()} title="Open PR on GitHub">↗</a>
        )}
      </button>
    </li>
  )
}

function Dashboard({ reviews, onOpen }) {
  const now = Date.now()
  const sections = groupReviews(reviews)
  return (
    <div className="dashboard">
      <h1 className="dash-title">Reviews</h1>
      {reviews.length === 0 && <p className="muted">No reviews yet. Run staff-review.</p>}
      {sections.map((section) => (
        <section key={section.key} className="state-section">
          <div className="state-header">
            <span className={`state-label state-${section.key}`}>{section.label}</span>
            <span className="state-count">{section.count}</span>
          </div>
          {section.repos.map((group) => (
            <div key={group.repo} className="repo-group">
              <div className="repo-header">{group.repo}</div>
              <ul className="review-list">
                {group.reviews.map((review) => (
                  <ReviewRow key={review.id} review={review} onOpen={onOpen} now={now} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
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
    return <Triage key={detail.review.id} detail={detail} onBack={() => setDetail(null)} onSaved={loadReviews} />
  }
  return <Dashboard reviews={reviews} onOpen={open} />
}
