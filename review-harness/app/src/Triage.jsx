import { useEffect, useMemo, useRef, useState } from 'react'
import { submitTriage } from './api.js'
import FindingCard from './FindingCard.jsx'
import {
  SEVERITY_ORDER, SEVERITY_META, ACTION_META,
  filterFindings, groupBySeverity, counts,
} from './triage-model.js'

const PROGRESS_ORDER = ['inline', 'general', 'skip', 'pending']
const KEY_TO_ACTION = { p: 'pending', i: 'inline', g: 'general', s: 'skip' }

export default function Triage({ detail, onBack, onSaved }) {
  const [rows, setRows] = useState(detail.findings)
  const [filter, setFilter] = useState('all')
  const [pendingOnly, setPendingOnly] = useState(false)
  const [focusedId, setFocusedId] = useState(detail.findings[0]?.id ?? null)
  const [expandedId, setExpandedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const toastTimer = useRef(null)

  const stat = useMemo(() => counts(rows), [rows])
  const ordered = useMemo(() => {
    const visible = filterFindings(rows, { severity: filter, pendingOnly })
    return SEVERITY_ORDER.flatMap((severity) => visible.filter((finding) => finding.severity === severity))
  }, [rows, filter, pendingOnly])
  const groups = useMemo(() => groupBySeverity(ordered), [ordered])
  const visibleIds = ordered.map((finding) => finding.id)

  function setAction(id, action) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, decision: action } : row)))
    setSaved(false)
  }
  function setBody(id, body) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, body } : row)))
    setSaved(false)
  }
  function toggleExpand(id) {
    setExpandedId((current) => (current === id ? null : id))
  }
  function focus(id) {
    setFocusedId(id)
    requestAnimationFrame(() => {
      const element = document.getElementById(`fc-${id}`)
      if (element) element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }
  function move(delta) {
    if (!visibleIds.length) return
    let index = visibleIds.indexOf(focusedId)
    if (index < 0) index = delta > 0 ? -1 : visibleIds.length
    const next = Math.max(0, Math.min(visibleIds.length - 1, index + delta))
    focus(visibleIds[next])
  }

  useEffect(() => {
    function onKey(event) {
      const tag = event.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const key = event.key.toLowerCase()
      if (key === 'j' || key === 'arrowdown') { event.preventDefault(); move(1); return }
      if (key === 'k' || key === 'arrowup') { event.preventDefault(); move(-1); return }
      if (KEY_TO_ACTION[key] && focusedId != null) { event.preventDefault(); setAction(focusedId, KEY_TO_ACTION[key]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function save() {
    setSaving(true)
    try {
      await submitTriage(detail.review.id, rows.map((row) => ({ id: row.id, decision: row.decision, body: row.body })))
      setSaved(true)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setSaved(false), 3200)
      if (onSaved) onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="triage-screen">
      <header className="triage-header">
        <div className="header-inner">
          <div className="header-top">
            <button className="back-btn" onClick={onBack}>&lsaquo; Back</button>
            <div className="header-title">
              <div className="title-row">
                <span className="pr-num">#{detail.review.pr_number}</span>
                <span className="repo-slug">{detail.review.owner}/{detail.review.repo}</span>
              </div>
              <div className="subtitle">Decide what to do with each finding, then save your triage.</div>
            </div>
            <div className="progress-block">
              <div className="triaged-count"><span className="done">{stat.triaged}</span> / {stat.total} triaged</div>
              <div className="progress-bar">
                {PROGRESS_ORDER.map((action) => (
                  <div key={action} className="progress-seg"
                    style={{ width: `${stat.total ? (stat.byAction[action] / stat.total) * 100 : 0}%`, background: ACTION_META[action].color }} />
                ))}
              </div>
              <div className="pending-text">{stat.pending > 0 ? `${stat.pending} pending` : 'all done'}</div>
            </div>
          </div>
          <div className="chip-row">
            <button className={`chip${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
              <span className="chip-dot" style={{ background: '#7E8696' }} />All<span className="chip-count">{stat.total}</span>
            </button>
            {SEVERITY_ORDER.map((severity) => (
              <button key={severity} className={`chip${filter === severity ? ' active' : ''}`}
                style={{ '--chip': SEVERITY_META[severity].color }} onClick={() => setFilter(severity)}>
                <span className="chip-dot" style={{ background: SEVERITY_META[severity].color }} />
                {SEVERITY_META[severity].label}<span className="chip-count">{stat.bySeverity[severity]}</span>
              </button>
            ))}
            <span className="spacer" />
            <span className="kbd-legend"><kbd>J</kbd><kbd>K</kbd> move <kbd>P</kbd><kbd>I</kbd><kbd>G</kbd><kbd>S</kbd> act</span>
            <button className={`chip toggle${pendingOnly ? ' active' : ''}`} onClick={() => setPendingOnly((value) => !value)}>
              <span className="chip-dot" style={{ background: '#E5A53B' }} />Pending only
            </button>
          </div>
        </div>
      </header>

      <main className="triage-body">
        {groups.length === 0 && <div className="empty">No findings match this filter.</div>}
        {groups.map((group) => (
          <section key={group.severity} className="sev-group">
            <div className="group-header">
              <span className="group-dot" style={{ background: group.color }} />
              <span className="group-label" style={{ color: group.color }}>{group.label}</span>
              <span className="group-count">{group.findings.length}</span>
            </div>
            {group.findings.map((finding) => (
              <FindingCard key={finding.id} finding={finding}
                focused={finding.id === focusedId}
                expanded={finding.id === expandedId}
                onFocus={focus} onAction={setAction} onBodyChange={setBody} onToggleExpand={toggleExpand} />
            ))}
          </section>
        ))}
      </main>

      <footer className="triage-footer">
        <div className="footer-inner">
          <span className="footer-dot" style={{ background: stat.pending > 0 ? '#E5A53B' : '#2FA56B' }} />
          <span className="footer-status" style={{ color: stat.pending > 0 ? '#E5A53B' : '#2FA56B' }}>
            {stat.pending > 0
              ? `${stat.pending} ${stat.pending === 1 ? 'finding still needs a decision' : 'findings still need a decision'}`
              : 'All findings triaged'}
          </span>
          <span className="spacer" />
          <span className="cmd-hint">then run <code>/post-review --from-db</code></span>
          <button className="save-btn" disabled={saving} onClick={save}>
            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save triage'}
          </button>
        </div>
      </footer>

      {saved && <div className="toast">&#10003; Triage saved &mdash; {stat.triaged} of {stat.total} findings recorded.</div>}
    </div>
  )
}
