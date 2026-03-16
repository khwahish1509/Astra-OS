/**
 * BrainDashboard.jsx — Astra OS Company Brain Dashboard (Dark Theme)
 * ===================================================================
 * NOTE: This component is no longer used in the main InterviewRoom layout
 * (replaced by DashboardView.jsx), but kept for backward compatibility
 * and standalone use.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

const BACKEND = import.meta.env.VITE_BACKEND_URL || (window.location.hostname === 'localhost' ? 'http://localhost:8000' : '')
const POLL_INTERVAL = 30000

export default function BrainDashboard({ isAstra = false }) {
  const [expanded, setExpanded] = useState(false)
  const [summary, setSummary] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [relationships, setRelationships] = useState([])
  const [insights, setInsights] = useState([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)

  const fetchData = useCallback(async () => {
    if (!isAstra) return
    setLoading(true)
    try {
      const [sumRes, alertRes, relRes, insightRes] = await Promise.all([
        fetch(`${BACKEND}/brain/summary`).then(r => r.ok ? r.json() : null),
        fetch(`${BACKEND}/brain/alerts?severity=medium`).then(r => r.ok ? r.json() : []),
        fetch(`${BACKEND}/brain/relationships`).then(r => r.ok ? r.json() : []),
        fetch(`${BACKEND}/brain/insights?limit=10`).then(r => r.ok ? r.json() : []),
      ])
      if (sumRes) setSummary(sumRes)
      setAlerts(alertRes || [])
      setRelationships(relRes || [])
      setInsights(insightRes || [])
    } catch (e) {
      console.warn('[BrainDashboard] fetch failed:', e)
    }
    setLoading(false)
  }, [isAstra])

  useEffect(() => {
    if (expanded && isAstra) {
      fetchData()
      timerRef.current = setInterval(fetchData, POLL_INTERVAL)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [expanded, isAstra, fetchData])

  if (!isAstra) return null

  return (
    <div style={S.wrapper}>
      <button
        style={{ ...S.toggleBtn, ...(expanded ? S.toggleBtnActive : {}) }}
        onClick={() => setExpanded(!expanded)}
      >
        <span>&#9673;</span>
        <span style={S.toggleLabel}>Brain</span>
        {summary && summary.pending_alerts > 0 && (
          <span style={S.alertBadge}>{summary.pending_alerts}</span>
        )}
        <span style={S.chevron}>{expanded ? '\u25BE' : '\u25B8'}</span>
      </button>

      {expanded && (
        <div style={S.panel}>
          {loading && !summary && <div style={S.loading}>Loading brain state...</div>}

          {summary && (
            <div style={S.statsGrid}>
              <StatCard label="Insights" value={summary.active_insights} color="#3b82f6" />
              <StatCard label="Overdue" value={summary.overdue_commitments} color="#ef4444" />
              <StatCard label="At-Risk" value={summary.at_risk_contacts} color="#f59e0b" />
              <StatCard label="Alerts" value={summary.pending_alerts} color="#8b5cf6" />
              <StatCard label="Tasks" value={summary.open_tasks} color="#10b981" />
            </div>
          )}

          {relationships.length > 0 && (
            <div style={S.section}>
              <div style={S.sectionTitle}>Relationships</div>
              {relationships.slice(0, 6).map((r, i) => (
                <div key={i} style={S.relRow}>
                  <span style={S.relName}>{r.name || r.contact_email}</span>
                  <div style={S.healthBar}>
                    <div style={{
                      ...S.healthFill,
                      width: `${Math.round(r.health_score * 100)}%`,
                      background: r.health_score > 0.7 ? '#22c55e'
                        : r.health_score > 0.4 ? '#f59e0b' : '#ef4444',
                    }} />
                  </div>
                  <span style={S.healthPct}>{Math.round(r.health_score * 100)}%</span>
                </div>
              ))}
            </div>
          )}

          {summary && summary.active_insights === 0 && alerts.length === 0 && (
            <div style={S.empty}>Brain is empty — scan emails to populate it.</div>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div style={S.statCard}>
      <div style={{ ...S.statValue, color }}>{value || 0}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  )
}

const S = {
  wrapper: {
    position: 'absolute', top: 14, right: 14,
    zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
  },
  toggleBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', borderRadius: 10,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: 'rgba(238,240,250,0.7)', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.2s',
  },
  toggleBtnActive: {
    background: 'rgba(124,58,237,0.15)',
    border: '1px solid rgba(124,58,237,0.3)',
    color: '#c4b5fd',
  },
  toggleLabel: { letterSpacing: '-0.01em' },
  alertBadge: {
    background: '#ef4444', color: '#fff',
    fontSize: 10, fontWeight: 700,
    padding: '1px 6px', borderRadius: 10,
    minWidth: 16, textAlign: 'center',
  },
  chevron: { fontSize: 10, opacity: 0.6 },
  panel: {
    marginTop: 6, width: 300,
    background: 'rgba(14,14,26,0.9)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 14, padding: 12,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    backdropFilter: 'blur(16px)',
    maxHeight: 'calc(100vh - 160px)', overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  loading: { fontSize: 11, color: 'rgba(238,240,250,0.4)', textAlign: 'center', padding: 12 },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 },
  statCard: {
    textAlign: 'center', padding: '8px 4px',
    background: 'rgba(255,255,255,0.03)', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.04)',
  },
  statValue: { fontSize: 18, fontWeight: 700, lineHeight: 1 },
  statLabel: {
    fontSize: 9, fontWeight: 600, color: 'rgba(238,240,250,0.4)',
    marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em',
  },
  section: { display: 'flex', flexDirection: 'column', gap: 4 },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, color: 'rgba(238,240,250,0.5)',
    borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 4,
  },
  relRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' },
  relName: {
    fontSize: 11, color: 'rgba(238,240,250,0.7)', fontWeight: 500,
    width: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  healthBar: { flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  healthFill: { height: '100%', borderRadius: 2, transition: 'width 0.3s' },
  healthPct: { fontSize: 10, fontWeight: 600, color: 'rgba(238,240,250,0.5)', width: 32, textAlign: 'right' },
  empty: { fontSize: 11, color: 'rgba(238,240,250,0.3)', textAlign: 'center', padding: 16 },
}
