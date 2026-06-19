export async function fetchReviews() {
  const res = await fetch('/api/reviews')
  if (!res.ok) throw new Error('failed to load reviews')
  return res.json()
}

export async function fetchReview(id) {
  const res = await fetch(`/api/reviews/${id}`)
  if (!res.ok) throw new Error('failed to load review')
  return res.json()
}

export async function submitTriage(id, findings) {
  const res = await fetch(`/api/reviews/${id}/triage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ findings }),
  })
  if (!res.ok) throw new Error('failed to save triage')
  return res.json()
}

export async function refreshReview(id) {
  const res = await fetch(`/api/reviews/${id}/refresh`, { method: 'POST' })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error || 'failed to refresh')
  }
  return res.json()
}
