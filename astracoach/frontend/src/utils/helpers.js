/**
 * helpers.js — Shared utility functions for Astra OS
 */

/** Generate a deterministic gradient for avatar backgrounds based on name */
export function getAvatarGradient(name) {
  const colors = [
    'linear-gradient(135deg, rgba(79,125,255,0.25), rgba(124,58,237,0.25))',
    'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(59,130,246,0.25))',
    'linear-gradient(135deg, rgba(245,158,11,0.25), rgba(239,68,68,0.25))',
    'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(236,72,153,0.25))',
    'linear-gradient(135deg, rgba(6,182,212,0.25), rgba(59,130,246,0.25))',
  ]
  const index = (name || '?').charCodeAt(0) % colors.length
  return colors[index]
}

/** Format a date string to relative time (e.g. "2m", "3h", "Yesterday") */
export function relativeTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now - d
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m`
  if (hrs < 24) return `${hrs}h`
  if (days < 2) return 'Yesterday'
  if (days < 7) return `${days}d`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Sort array by timestamp (newest first) */
export function sortByTime(arr) {
  return [...arr].sort((a, b) => {
    const tA = a.timestamp || new Date(a.date || 0).getTime() / 1000
    const tB = b.timestamp || new Date(b.date || 0).getTime() / 1000
    return tB - tA
  })
}

/** Get priority color */
export function getPriorityColor(priority, theme) {
  if (priority === 'critical') return theme.danger
  if (priority === 'urgent') return theme.warning
  if (priority === 'important') return '#3b82f6'
  if (priority === 'notable') return theme.accentCyan
  if (priority === 'low') return theme.textMuted
  return 'rgba(107,114,128,0.5)'
}

/** Get priority background color */
export function getPriorityBg(priority, theme) {
  return `${getPriorityColor(priority, theme)}15`
}
