export const SEVERITY_ORDER = ['critical', 'warning', 'suggestion', 'nit']

export const SEVERITY_META = {
  critical: { label: 'Critical', color: '#F2545B' },
  warning: { label: 'Warning', color: '#E5A53B' },
  suggestion: { label: 'Suggestion', color: '#58B6D6' },
  nit: { label: 'Nit', color: '#8892A0' },
}

export const ACTION_ORDER = ['pending', 'inline', 'general', 'skip']

export const ACTION_META = {
  pending: { label: 'Pending', color: '#9AA3B2', hot: 'P' },
  inline: { label: 'Inline', color: '#5B8DEF', hot: 'I' },
  general: { label: 'General', color: '#B58CEA', hot: 'G' },
  skip: { label: 'Skip', color: '#646C7A', hot: 'S' },
}

export function stripSeverityPrefix(body) {
  return body.replace(/^\s*\*\*\[[a-z]+\]\*\*\s*/i, '')
}

export function parseBody(body) {
  const text = stripSeverityPrefix(body)
  const tokenPattern = /`([^`]+)`|\*\*([^*]+)\*\*/g
  const tokens = []
  let lastIndex = 0
  let match
  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', text: text.slice(lastIndex, match.index) })
    }
    if (match[1] != null) tokens.push({ kind: 'code', text: match[1] })
    else tokens.push({ kind: 'bold', text: match[2] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) tokens.push({ kind: 'text', text: text.slice(lastIndex) })
  return tokens.length ? tokens : [{ kind: 'text', text: '' }]
}

export function filterFindings(findings, options = {}) {
  const { severity = 'all', pendingOnly = false } = options
  return findings.filter((finding) =>
    (severity === 'all' || finding.severity === severity)
    && (!pendingOnly || (finding.decision || 'pending') === 'pending'))
}

export function groupBySeverity(findings) {
  return SEVERITY_ORDER
    .map((severity) => ({
      severity,
      label: SEVERITY_META[severity].label,
      color: SEVERITY_META[severity].color,
      findings: findings.filter((finding) => finding.severity === severity),
    }))
    .filter((group) => group.findings.length > 0)
}

export function counts(findings) {
  const bySeverity = {}
  SEVERITY_ORDER.forEach((severity) => { bySeverity[severity] = 0 })
  const byAction = {}
  ACTION_ORDER.forEach((action) => { byAction[action] = 0 })
  for (const finding of findings) {
    if (bySeverity[finding.severity] != null) bySeverity[finding.severity] += 1
    const action = finding.decision || 'pending'
    if (byAction[action] != null) byAction[action] += 1
  }
  const total = findings.length
  const pending = byAction.pending
  return { total, triaged: total - pending, pending, bySeverity, byAction }
}

export const PR_BADGE_META = {
  merged: { kind: 'merged', label: 'merged', color: '#A371F7' },
  closed: { kind: 'closed', label: 'closed', color: '#8892A0' },
  approved: { kind: 'approved', label: 'approved', color: '#2FA56B' },
  changes: { kind: 'changes', label: 'changes', color: '#F2545B' },
  open: { kind: 'open', label: 'open', color: '#5B8DEF' },
}

export function prBadge(prState, reviewDecision) {
  if (prState === 'MERGED') return PR_BADGE_META.merged
  if (prState === 'CLOSED') return PR_BADGE_META.closed
  if (reviewDecision === 'APPROVED') return PR_BADGE_META.approved
  if (reviewDecision === 'CHANGES_REQUESTED') return PR_BADGE_META.changes
  return PR_BADGE_META.open
}

export function relativeAge(iso, nowMs) {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.round((nowMs - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function severityChips(bySeverity) {
  return SEVERITY_ORDER
    .filter((severity) => (bySeverity?.[severity] || 0) > 0)
    .map((severity) => ({
      severity,
      count: bySeverity[severity],
      label: SEVERITY_META[severity].label,
      color: SEVERITY_META[severity].color,
    }))
}
