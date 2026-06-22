import { useEffect, useState } from 'react'
import { fetchReviews, fetchReview, refreshReview, deleteReview } from './api.js'
import Triage from './Triage.jsx'
import { prBadge, relativeAge, severityChips, groupReviews } from './triage-model.js'

function ReviewRow({ review, onOpen, onDelete, canDelete, now }) {
  const badge = prBadge(review.pr_state, review.review_decision)
  const chips = severityChips(review.severity)
  return (
    <button className="review-row" onClick={() => onOpen(review.id)}>
      <span className="pr">#{review.pr_number}</span>
      <span className="row-title">{review.title}</span>
      <span className="sev-mini">
        {chips.map((chip) => (
          <span key={chip.severity} className="sev-mini-item" style={{ color: chip.color }}>
            {chip.count}{chip.label[0]}
          </span>
        ))}
      </span>
      <span className="author">{review.author ? `@${review.author}` : ''}</span>
      <span className="pr-badge" style={{ '--badge': badge.color }}>{badge.label}</span>
      <span className={`status status-${review.status}`}>{review.status}</span>
      <span className="age">{relativeAge(review.updated_at, now)}</span>
      <span className="row-arrow">
        {review.url && (
          <a className="gh-link" href={review.url} target="_blank" rel="noreferrer"
             onClick={(event) => event.stopPropagation()} title="Open PR on GitHub">↗</a>
        )}
        {/* ponytail: clickable span mirrors gh-link pattern; keyboard-a11y deferred */}
        {canDelete && (
          <span className="row-del" title="Delete review"
                onClick={(event) => {
                  event.stopPropagation()
                  if (window.confirm(`Delete review for #${review.pr_number}? Removes it from the list and database.`)) {
                    onDelete(review.id)
                  }
                }}>✕</span>
        )}
      </span>
    </button>
  )
}

function Dashboard({ reviews, onOpen, onReload }) {
  const now = Date.now()
  const sections = groupReviews(reviews)
  const [refreshing, setRefreshing] = useState(false)

  async function refreshOpen(openReviews) {
    setRefreshing(true)
    try {
      await Promise.all(openReviews.map((review) => refreshReview(review.id)))
      await onReload()
    } finally {
      setRefreshing(false)
    }
  }

  async function remove(id) {
    await deleteReview(id)
    await onReload()
  }

  return (
    <div className="dashboard">
      <h1 className="dash-title">Reviews</h1>
      {reviews.length === 0 && <p className="muted">No reviews yet. Run staff-review.</p>}
      {sections.map((section) => (
        <section key={section.key} className="state-section">
          <div className="state-header">
            <span className={`state-label state-${section.key}`}>{section.label}</span>
            <span className="state-count">{section.count}</span>
            {section.key === 'open' && (
              <button className="refresh-open" disabled={refreshing}
                      onClick={() => refreshOpen(section.repos.flatMap((group) => group.reviews))}>
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            )}
          </div>
          {section.repos.map((group) => (
            <div key={group.repo} className="repo-group">
              <div className="repo-header">{group.repo}</div>
              <div className="review-list">
                {group.reviews.map((review) => (
                  <ReviewRow key={review.id} review={review} onOpen={onOpen}
                             onDelete={remove} canDelete={section.key === 'open'} now={now} />
                ))}
              </div>
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
  return <Dashboard reviews={reviews} onOpen={open} onReload={loadReviews} />
}
