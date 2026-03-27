/**
 * DashboardHome.jsx — Main dashboard overview with KPIs, alerts, insights, relationships
 */
import { useState, useEffect } from 'react'
import { useTheme } from '../../ThemeContext'
import { BarChartIcon, BrainIcon, PeopleIcon, BellIcon, LightbulbIcon, MicrophoneIcon } from '../shared/Icons'

// Animated number counter
function AnimatedNumber({ value, duration = 1000 }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    const start = performance.now()
    const animate = (now) => {
      const progress = Math.min((now - start) / duration, 1)
      setDisplay(Math.round(progress * value))
      if (progress < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }, [value, duration])
  return <>{display}</>
}

function KpiCard({ label, value, icon: Icon, trend }) {
  const { theme: T } = useTheme()
  const [hovered, setHovered] = useState(false)
  const numericValue = typeof value === 'number' ? value : 0
  const trendColor = trend?.direction === 'up' ? T.success : trend?.direction === 'down' ? T.danger : T.textMuted

  return (
    <div
      style={{
        padding: 20, borderRadius: 16, background: T.bgCard,
        backdropFilter: 'blur(16px)', border: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        ...(hovered ? { transform: 'translateY(-4px)', boxShadow: `0 20px 40px ${T.accentSoft}`, borderColor: 'rgba(147,197,253,0.2)' } : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="article"
      aria-label={`${label}: ${value}`}
    >
      <div style={{
        width: 48, height: 48, borderRadius: '50%', background: T.kpiIconBg,
        border: '1px solid rgba(147,197,253,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#93c5fd',
      }}>
        <Icon />
      </div>
      <div style={{
        fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color: T.text, lineHeight: 1, display: 'flex', alignItems: 'center',
      }}>
        <AnimatedNumber value={numericValue} />
        {trend && (
          <span style={{ fontSize: 12, fontWeight: 700, marginLeft: 6, color: trendColor, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '–'}
            {trend.label && <span style={{ marginLeft: 4, fontSize: 11 }}>{trend.label}</span>}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </div>
    </div>
  )
}

function AlertCard({ alert }) {
  const { theme: T } = useTheme()
  const [hovered, setHovered] = useState(false)
  const color = alert.severity === 'critical' ? T.danger : alert.severity === 'high' ? T.warning : T.accentCyan
  const bg = alert.severity === 'critical' ? T.dangerSoft : alert.severity === 'high' ? T.warningSoft : 'rgba(6,182,212,0.1)'

  return (
    <div
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px',
        borderRadius: 10, borderLeft: `3px solid ${color}`,
        background: hovered ? bg : 'transparent',
        transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="alert"
    >
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, marginTop: 6, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 4 }}>{alert.title}</div>
        <div style={{ fontSize: 11, color: T.textDim, lineHeight: 1.4 }}>{alert.message?.slice(0, 100)}</div>
      </div>
      <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: color, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>
        {alert.severity}
      </span>
    </div>
  )
}

function InsightCard({ insight }) {
  const { theme: T } = useTheme()
  const [hovered, setHovered] = useState(false)
  const typeColor = insight.type === 'commitment' ? '#3b82f6' : insight.type === 'risk' ? T.danger : insight.type === 'decision' ? T.accentPurple : T.success
  const typeBg = insight.type === 'commitment' ? 'rgba(59,130,246,0.15)' : insight.type === 'risk' ? T.dangerSoft : insight.type === 'decision' ? 'rgba(139,92,246,0.15)' : T.successSoft

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 8,
        background: hovered ? 'rgba(139,92,246,0.08)' : 'transparent',
        transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ fontSize: 9, fontWeight: 700, padding: '4px 10px', borderRadius: 6, textTransform: 'uppercase', flexShrink: 0, letterSpacing: '0.06em', background: typeBg, color: typeColor }}>
        {insight.type}
      </span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, color: T.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {insight.content?.slice(0, 100)}
        </div>
        {insight.confidence && (
          <div style={{ height: 4, borderRadius: 2, background: T.borderSubtle, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)', width: `${insight.confidence * 100}%`, transition: 'width 600ms cubic-bezier(0.4, 0, 0.2, 1)' }} />
          </div>
        )}
      </div>
    </div>
  )
}

function RelationshipCard({ relationship }) {
  const { theme: T } = useTheme()
  const [hovered, setHovered] = useState(false)
  const healthScore = relationship.health_score || 0
  const healthColor = healthScore > 0.7 ? T.success : healthScore > 0.4 ? T.warning : T.danger
  const colors = [
    'linear-gradient(135deg, rgba(79,125,255,0.25), rgba(124,58,237,0.25))',
    'linear-gradient(135deg, rgba(34,197,94,0.25), rgba(59,130,246,0.25))',
    'linear-gradient(135deg, rgba(245,158,11,0.25), rgba(239,68,68,0.25))',
    'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(236,72,153,0.25))',
    'linear-gradient(135deg, rgba(6,182,212,0.25), rgba(59,130,246,0.25))',
  ]
  const gradient = colors[(relationship.name || '?').charCodeAt(0) % colors.length]

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10,
        background: hovered ? 'rgba(79,125,255,0.05)' : 'transparent',
        transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        width: 36, height: 36, borderRadius: '50%', border: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, color: '#93c5fd', flexShrink: 0, background: gradient,
      }}>
        {(relationship.name || relationship.contact_email || '?')[0].toUpperCase()}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {relationship.name || relationship.contact_email}
        </div>
        <div style={{ fontSize: 10, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {relationship.contact_email}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, width: 110 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.borderSubtle, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 3, background: healthColor, width: `${Math.round(healthScore * 100)}%`, transition: 'width 600ms cubic-bezier(0.4, 0, 0.2, 1)' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: healthColor }}>
          {Math.round(healthScore * 100)}%
        </span>
      </div>
    </div>
  )
}

export default function DashboardHome({ data }) {
  const { theme: T } = useTheme()
  const { summary, alerts, insights, relationships, loading } = data

  return (
    <div style={{ padding: '24px 28px', height: '100%', overflow: 'auto', background: T.gradientSubtle }} role="main" aria-label="Dashboard">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: T.text, margin: 0 }}>Dashboard</h1>
        <span style={{ fontSize: 12, color: T.textDim, fontWeight: 500 }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </span>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 32 }}>
          {[1,2,3,4,5].map(i => (
            <div key={i} style={{ padding: 20, borderRadius: 16, background: T.bgCard, border: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, minHeight: 120 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
              <div style={{ width: 40, height: 20, borderRadius: 4, background: 'rgba(255,255,255,0.05)' }} />
            </div>
          ))}
        </div>
      )}

      {/* KPI Cards */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 32 }}>
          <KpiCard label="Active Insights" value={summary?.active_insights ?? 0} icon={BarChartIcon} trend={{ direction: 'up', label: '+12%' }} />
          <KpiCard label="Open Tasks" value={summary?.open_tasks ?? 0} icon={BrainIcon} trend={{ direction: 'up', label: '+3' }} />
          <KpiCard label="At-Risk Contacts" value={summary?.at_risk_contacts ?? 0} icon={PeopleIcon} trend={{ direction: 'neutral', label: '' }} />
          <KpiCard label="Active Alerts" value={summary?.pending_alerts ?? 0} icon={BellIcon} trend={{ direction: 'down', label: '-2' }} />
          <KpiCard label="Overdue" value={summary?.overdue_commitments ?? 0} icon={LightbulbIcon} trend={{ direction: 'up', label: '+5' }} />
        </div>
      )}

      {/* Two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Left: Alerts + Insights */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section style={{ borderRadius: 16, background: T.bgCard, backdropFilter: 'blur(16px)', border: `1px solid ${T.border}`, overflow: 'hidden', transition: 'all 200ms' }} aria-label="Pending Alerts">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.bgSurface}` }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Pending Alerts</span>
              <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(147,197,253,0.15)', padding: '4px 10px', borderRadius: 12, color: '#93c5fd' }}>{alerts.length}</span>
            </div>
            {alerts.length === 0 ? (
              <div style={{ padding: '32px 20px', fontSize: 13, color: T.textMuted, textAlign: 'center', lineHeight: 1.6 }}>
                All clear — no pending alerts
              </div>
            ) : (
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
                {alerts.slice(0, 8).map((a, i) => <AlertCard key={a.id || i} alert={a} />)}
              </div>
            )}
          </section>

          <section style={{ borderRadius: 16, background: T.bgCard, backdropFilter: 'blur(16px)', border: `1px solid ${T.border}`, overflow: 'hidden' }} aria-label="Recent Insights">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.bgSurface}` }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recent Insights</span>
              <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(147,197,253,0.15)', padding: '4px 10px', borderRadius: 12, color: '#93c5fd' }}>{insights.length}</span>
            </div>
            {insights.length === 0 ? (
              <div style={{ padding: '32px 20px', fontSize: 13, color: T.textMuted, textAlign: 'center' }}>
                Insights will appear after your first session
              </div>
            ) : (
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
                {insights.slice(0, 8).map((ins, i) => <InsightCard key={i} insight={ins} />)}
              </div>
            )}
          </section>
        </div>

        {/* Right: Relationships + Quick Commands */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section style={{ borderRadius: 16, background: T.bgCard, backdropFilter: 'blur(16px)', border: `1px solid ${T.border}`, overflow: 'hidden' }} aria-label="Relationship Health">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.bgSurface}` }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Relationship Health</span>
              <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(147,197,253,0.15)', padding: '4px 10px', borderRadius: 12, color: '#93c5fd' }}>{relationships.length}</span>
            </div>
            {relationships.length === 0 ? (
              <div style={{ padding: '32px 20px', fontSize: 13, color: T.textMuted, textAlign: 'center' }}>
                Contacts appear after scanning your inbox
              </div>
            ) : (
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
                {relationships.slice(0, 10).map((r, i) => <RelationshipCard key={i} relationship={r} />)}
              </div>
            )}
          </section>

          <section style={{ borderRadius: 16, background: T.bgCard, backdropFilter: 'blur(16px)', border: `1px solid ${T.border}`, overflow: 'hidden' }} aria-label="Quick Commands">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.bgSurface}` }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Quick Commands</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '12px 16px' }}>
              {[
                { label: 'Brief me', desc: 'Full status update' },
                { label: 'Check emails', desc: 'Scan recent inbox' },
                { label: "Today's schedule", desc: 'Calendar overview' },
                { label: 'Overdue items', desc: "What's slipping" },
                { label: 'At-risk contacts', desc: 'Who needs attention' },
                { label: 'Search Drive', desc: 'Find documents' },
              ].map((cmd, i) => (
                <button
                  key={i}
                  style={{
                    padding: '12px 14px', borderRadius: 10, background: T.accentSoft,
                    border: `1px solid ${T.borderAccent}`, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)', color: '#93c5fd',
                  }}
                  aria-label={`Voice command: ${cmd.label}`}
                >
                  <MicrophoneIcon />
                  <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'center' }}>{cmd.label}</div>
                  <div style={{ fontSize: 9, color: T.textMuted, textAlign: 'center' }}>{cmd.desc}</div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
