export async function refreshReview(id) {
  const res = await fetch(`/api/reviews/${id}/refresh`, { method: 'POST' })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.error || 'failed to refresh')
  }
  return res.json()
}
