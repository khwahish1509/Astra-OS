/**
 * CRMView.jsx — Relationship intelligence grid
 */
import { useState } from 'react'
import { useTheme } from '../../ThemeContext'
import { getAvatarGradient } from '../../utils/helpers'
import { PeopleIcon } from '../shared/Icons'

function RelationshipGridCard({ relationship }) {
  const { theme: T } = useTheme()
  const [hovered, setHovered] = useState(false)
  const healthScore = relationship.health_score || 0
  const healthColor = healthScore > 0.7 ? T.success : healthScore > 0.4 ? T.warning : T.danger
  const gradient = getAvatarGradient(relationship.name || relationship.contact_email || '?')

  return (
    <div
      style={{
        padding: 20, borderRadius: 16, background: T.bgCard, backdropFilter: 'blur(16px)',
        border: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: 12, textAlign: 'center',
        transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
        ...(hovered ? { transform: 'translateY(-4px)', boxShadow: `0 20px 40px ${T.accentSoft}`, borderColor: 'rgba(147,197,253,0.2)' } : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="article"
      aria-label={`${relationship.name || 'Unknown'}: ${Math.round(healthScore * 100)}% health`}
    >
      <div style={{
        width: 52, height: 52, borderRadius: '50%', border: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, fontWeight: 700, color: '#93c5fd', background: gradient,
      }}>
        {(relationship.name || relationship.contact_email || '?')[0].toUpperCase()}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{relationship.name || 'Unknown'}</div>
      <div style={{ fontSize: 11, color: T.textDim }}>{relationship.contact_email}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.borderSubtle, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 3, background: healthColor, width: `${Math.round(healthScore * 100)}%`, transition: 'width 600ms cubic-bezier(0.4, 0, 0.2, 1)' }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: healthColor }}>
          {Math.round(healthScore * 100)}%
        </span>
      </div>
      {relationship.last_interaction && (
        <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>
          Last: {new Date(relationship.last_interaction).toLocaleDateString()}
        </div>
      )}
    </div>
  )
}

export default function CRMView({ data }) {
  const { theme: T } = useTheme()
  const { relationships } = data

  return (
    <div style={{ padding: '24px 28px', height: '100%', overflow: 'auto', background: T.gradientSubtle }} role="main" aria-label="CRM">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: T.text, margin: 0 }}>Relationships</h1>
        <span style={{ fontSize: 12, color: T.textDim, fontWeight: 500 }}>Contact intelligence powered by your brain</span>
      </div>
      {relationships.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '80px 40px', textAlign: 'center', minHeight: 'calc(100% - 120px)' }}>
          <div style={{ color: T.textMuted }}><PeopleIcon size={64} /></div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: 0 }}>Relationship Intelligence</h2>
          <p style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.7, maxWidth: 520 }}>
            Astra tracks every contact from your emails and conversations. Ask about any relationship and get health scores, last interactions, and tone analysis.
          </p>
          <div style={{ fontSize: 10, color: T.accentCyan, fontWeight: 500, fontStyle: 'italic', marginTop: 8 }}>
            Ask Astra about a contact: "How's my relationship with Sarah?"
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {relationships.map((r, i) => <RelationshipGridCard key={i} relationship={r} />)}
        </div>
      )}
    </div>
  )
}
