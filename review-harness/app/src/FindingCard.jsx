import { parseBody, SEVERITY_META, ACTION_META, ACTION_ORDER } from './triage-model.js'

function renderBody(body) {
  return parseBody(body).map((token, index) => {
    if (token.kind === 'code') return <code key={index} className="body-code">{token.text}</code>
    if (token.kind === 'bold') return <strong key={index}>{token.text}</strong>
    return <span key={index}>{token.text}</span>
  })
}

export default function FindingCard({ finding, gitRef, focused, expanded, onFocus, onAction, onBodyChange, onToggleExpand }) {
  const decision = finding.decision || 'pending'
  const severity = SEVERITY_META[finding.severity] || { label: finding.severity, color: '#8892A0' }
  const slashIndex = finding.path.lastIndexOf('/')
  const dir = finding.path.slice(0, slashIndex + 1)
  const name = finding.path.slice(slashIndex + 1)
  const blobUrl = gitRef
    ? `https://github.com/${gitRef.owner}/${gitRef.repo}/blob/${gitRef.head_sha}/${finding.path}#L${finding.line}`
    : null
  const dimmed = decision === 'skip' && !focused
  const statusColor = decision === 'pending' ? '#E5A53B' : ACTION_META[decision].color
  const statusText = decision === 'pending' ? '○ Pending' : `✓ ${ACTION_META[decision].label}`

  function copyReference(event) {
    event.stopPropagation()
    try { navigator.clipboard.writeText(`${finding.path}:${finding.line}`) } catch (err) { /* clipboard unavailable */ }
  }

  function toggleEditor(event) {
    event.stopPropagation()
    onFocus(finding.id)
    onToggleExpand(finding.id)
  }

  return (
    <div
      id={`fc-${finding.id}`}
      className={`finding sev-${finding.severity}${focused ? ' focused' : ''}${dimmed ? ' dimmed' : ''}`}
      onClick={() => onFocus(finding.id)}
    >
      <div className="finding-head">
        <span className="sev-badge" style={{ '--sev': severity.color }}>
          <span className="sev-dot" />{severity.label}
        </span>
        <code className="file-pill" title="Click to copy reference" onClick={copyReference}>
          <span className="file-dir">{dir}</span>
          <span className="file-name">{name}</span>
          <span className="file-line">:{finding.line}</span>
        </code>
        {blobUrl && (
          <a className="gh-link finding-link" href={blobUrl} target="_blank" rel="noreferrer"
             onClick={(event) => event.stopPropagation()} title="Open file at reviewed commit">↗</a>
        )}
        {finding.in_diff ? null : <span className="badge-ood">out-of-diff</span>}
        <span className="spacer" />
        <span className="status" style={{ color: statusColor }}>{statusText}</span>
      </div>

      <p className="finding-body" onClick={toggleEditor}>{renderBody(finding.body)}</p>

      {expanded && (
        <textarea
          className="body-editor"
          value={finding.body}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onBodyChange(finding.id, event.target.value)}
        />
      )}

      <div className="seg-control" onClick={(event) => event.stopPropagation()}>
        {ACTION_ORDER.map((key) => {
          const meta = ACTION_META[key]
          const active = decision === key
          return (
            <button
              key={key}
              className={`seg${active ? ' active' : ''}`}
              style={{ '--act': meta.color }}
              title={`Set to ${meta.label} (press ${meta.hot})`}
              onClick={() => onAction(finding.id, key)}
            >
              <span className="seg-dot" />{meta.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
