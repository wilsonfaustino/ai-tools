import { useEffect, useState } from 'react'
import { fetchReviews, fetchReview } from './api.js'
import Triage from './Triage.jsx'

function Dashboard({ reviews, onOpen }) {
  return (
    <div className="dashboard">
      <h1 className="dash-title">Open reviews</h1>
      {reviews.length === 0 && <p className="muted">No reviews yet. Run staff-review.</p>}
      <ul className="review-list">
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
