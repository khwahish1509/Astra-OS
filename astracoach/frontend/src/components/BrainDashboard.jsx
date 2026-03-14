/**
 * BrainDashboard.jsx — Astra OS Company Brain Dashboard
 * ======================================================
 * Collapsible panel showing real-time brain state:
 *   - Summary stats (insights, alerts, relationships, tasks)
 *   - Active alerts with dismiss action
 *   - Relationship health scores
 *   - Recent insights
 *
 * Polls /brain/summary every 30 seconds when expanded.
 * Only shows when the Astra persona is active.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'
const POLL_INTERVAL = 30000 // 30 seconds

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

  // Fetch on expand, then poll
  useEffect(() => {
    if (expanded && isAstra) {
      fetchData()
      timerRef.current = setInterval(fetchData, POLL_INTERVAL)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [expanded, isAstra, fetchData])

  const dismissAlert = async (alertId) => {
    try {
      await fetch(`${BACKEND}/brain/alerts/${alertId}/dismiss`, { method: 'POST' })
      setAlerts(prev => prev.filter(a => a.id !== alertId))
    } catch { /* ignore */ }
  }

  const triggerScan = async () => {
    try {
      const res = await fetch(`${BACKEND}/brain/scan`, { method: 'POST' })
      const data = await res.json()
      console.log('[BrainDashboard] scan result:', data)
      fetchData() // refresh
    } catch { /* ignore */ }
  }

  if (!isAstra) return null

  return (
    <div style={S.wrapper}>
      {/* Toggle button */}
      <button
        style={{
          ...S.toggleBtn,
          ...(expanded ? S.toggleBtnActive : {}),
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <span>🧠</span>
        <span style={S.toggleLabel}>Brain</span>
        {summary && summary.pending_alerts > 0 && (
          <span style={S.alertBadge}>{summary.pending_alerts}</span>
        )}
        <span style={S.chevron}>{expanded ? '▾' : '▸'}</span>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div style={S.panel}>
          {loading && !summary && <div style={S.loading}>Loading brain state…</div>}

          {/* Summary stats */}
          {summary && (
            <div style={S.statsGrid}>
              <StatCard label="Insights" value={summary.active_insights} color="#3b82f6" />
              <StatCard label="Overdue" value={summary.overdue_commitments} color="#ef4444" />
              <StatCard label="At-Risk" value={summary.at_risk_contacts} color="#f59e0b" />
              <StatCard label="Alerts" value={summary.pending_alerts} color="#8b5cf6" />
              <StatCard label="Tasks" value={summary.open_tasks} color="#10b981" />
            </div>
          )}

          {/* Quick actions */}
          <div style={S.actions}>
            <button style={S.actionBtn} onClick={triggerScan} title="Scan emails now">
              📧 Scan Emails
            </button>
            <button style={S.actionBtn} onClick={fetchData} title="Refresh brain state">
              🔄 Refresh
            </button>
          </div>

          {/* Alerts */}
          {alerts.length > 0 && (
            <div style={S.section}>
              <div style={S.sectionTitle}>🔔 Pending Alerts</div>
              {alerts.slice(0, 5).map(a => (
                <div key={a.id} style={S.alertRow}>
                  <div style={S.alertLeft}>
                    <span style={{
                      ...S.severityDot,
                      background: a.severity === 'critical' ? '#ef4444'
                        : a.severity === 'high' ? '#f59e0b'
                        : '#3b82f6',
                    }} />
                    <div>
                      <div style={S.alertTitle}>{a.title}</div>
                      <div style={S.alertMsg}>{a.message?.slice(0, 80)}</div>
                    </div>
                  </div>
                  <button style={S.dismissBtn} onClick={() => dismissAlert(a.id)}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Relationships */}
          {relationships.length > 0 && (
            <div style={S.section}>
              <div style={S.sectionTitle}>💚 Relationships</div>
              {relationships.slice(0, 6).map((r, i) => (
                <div key={i} style={S.relRow}>
                  <span style={S.relName}>{r.name || r.contact_email}</span>
                  <div style={S.healthBar}>
                    <div style={{
                      ...S.healthFill,
                      width: `${Math.round(r.health_score * 100)}%`,
                      background: r.health_score > 0.7 ? '#22c55e'
                        : r.health_score > 0.4 ? '#f59e0b'
                        : '#ef4444',
                    }} />
                  </div>
                  <span style={S.healthPct}>{Math.round(r.health_score * 100)}%</span>
                </div>
              ))}
            </div>
          )}

          {/* Recent insights */}
          {insights.length > 0 && (
            <div style={S.section}>
              <div style={S.sectionTitle}>💡 Recent Insights</div>
              {insights.slice(0, 5).map((ins, i) => (
                <div key={i} style={S.insightRow}>
                  <span style={{
                    ...S.insightType,
                    background: ins.type === 'commitment' ? '#dbeafe'
                      : ins.type === 'risk' ? '#fee2e2'
                      : ins.type === 'decision' ? '#f3e8ff'
                      : '#dcfce7',
                    color: ins.type === 'commitment' ? '#2563eb'
                      : ins.type === 'risk' ? '#dc2626'
                      : ins.type === 'decision' ? '#7c3aed'
                      : '#16a34a',
                  }}>
                    {ins.type}
                  </span>
                  <span style={S.insightText}>{ins.content?.slice(0, 70)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {summary && summary.active_insights === 0 && alerts.length === 0 && (
            <div style={S.empty}>
              Brain is empty — scan emails to populate it.
            </div>
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

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  wrapper: {
    position: 'absolute', top: 14, right: 14,
    zIndex: 100, display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
  },
  toggleBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 12px', borderRadius: 10,
    background: '#ffffff', border: '1px solid #e5e7eb',
    color: '#374151', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    transition: 'all 0.2s',
  },
  toggleBtnActive: {
    background: '#f3e8ff', border: '1px solid #c4b5fd',
    color: '#7c3aed',
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
    marginTop: 6, width: 320,
    background: '#ffffff', border: '1px solid #e5e7eb',
    borderRadius: 14, padding: 12,
    boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
    maxHeight: 'calc(100vh - 160px)', overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  loading: { fontSize: 11, color: '#9ca3af', textAlign: 'center', padding: 12 },

  statsGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6,
  },
  statCard: {
    textAlign: 'center', padding: '8px 4px',
    background: '#f9fafb', borderRadius: 8,
    border: '1px solid #f3f4f6',
  },
  statValue: { fontSize: 18, fontWeight: 700, lineHeight: 1 },
  statLabel: { fontSize: 9, fontWeight: 600, color: '#6b7280', marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em' },

  actions: { display: 'flex', gap: 6 },
  actionBtn: {
    flex: 1, padding: '5px 8px', borderRadius: 8,
    background: '#f9fafb', border: '1px solid #e5e7eb',
    color: '#374151', fontSize: 11, fontWeight: 600,
    cursor: 'pointer',
  },

  section: { display: 'flex', flexDirection: 'column', gap: 4 },
  sectionTitle: {
    fontSize: 11, fontWeight: 700, color: '#374151',
    borderBottom: '1px solid #f3f4f6', paddingBottom: 4,
  },

  alertRow: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: '6px 8px', borderRadius: 8, background: '#fef2f2',
    border: '1px solid #fecaca',
  },
  alertLeft: { display: 'flex', gap: 8, alignItems: 'flex-start', flex: 1 },
  severityDot: { width: 8, height: 8, borderRadius: '50%', marginTop: 4, flexShrink: 0 },
  alertTitle: { fontSize: 11, fontWeight: 600, color: '#111827' },
  alertMsg: { fontSize: 10, color: '#6b7280', marginTop: 1 },
  dismissBtn: {
    background: 'none', border: 'none', color: '#9ca3af',
    fontSize: 12, cursor: 'pointer', padding: '2px 4px',
  },

  relRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 0',
  },
  relName: { fontSize: 11, color: '#374151', fontWeight: 500, width: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  healthBar: { flex: 1, height: 6, borderRadius: 3, background: '#f3f4f6', overflow: 'hidden' },
  healthFill: { height: '100%', borderRadius: 3, transition: 'width 0.3s' },
  healthPct: { fontSize: 10, fontWeight: 600, color: '#6b7280', width: 32, textAlign: 'right' },

  insightRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 0',
  },
  insightType: {
    fontSize: 9, fontWeight: 700, padding: '2px 6px',
    borderRadius: 4, textTransform: 'uppercase', flexShrink: 0,
  },
  insightText: { fontSize: 11, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  empty: { fontSize: 11, color: '#9ca3af', textAlign: 'center', padding: 16 },
}
