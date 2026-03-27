/**
 * BrainView.jsx — Company Brain: facts, episodes, events, insights
 */
import { useTheme } from '../../ThemeContext'

export default function BrainView({ data }) {
  const { theme: T } = useTheme()
  const { memoryFacts, memoryEpisodes, memoryEvents, memoryStatus, insights } = data

  return (
    <div style={{ padding: '24px 28px', height: '100%', overflow: 'auto', background: T.gradientSubtle }} role="main" aria-label="Company Brain">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: T.text, margin: 0 }}>Company Brain</h1>
          <span style={{ fontSize: 12, color: T.textDim, fontWeight: 500 }}>Persistent memory across all sessions</span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {[{ label: 'Facts', value: memoryFacts.length }, { label: 'Episodes', value: memoryEpisodes.length }, { label: 'Events', value: memoryEvents.length }].map(s => (
            <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 20px', borderRadius: 12, background: T.bgCard, border: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: T.accent, fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
              <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Memory Status */}
      {memoryStatus && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, background: T.bgCard, border: `1px solid ${T.border}`, marginBottom: 16 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: memoryStatus.status === 'active' ? T.success : T.warning }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Memory {memoryStatus.status === 'active' ? 'Active' : 'Initializing'}</span>
          {memoryStatus.status === 'active' && (
            <span style={{ fontSize: 11, color: T.textMuted, marginLeft: 'auto' }}>
              {memoryStatus.facts_count} facts · {memoryStatus.episodes_count} episodes · {memoryStatus.events_count} events stored
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Facts */}
        <section style={{ borderRadius: 16, background: T.bgCard, backdropFilter: 'blur(16px)', border: `1px solid ${T.border}`, overflow: 'hidden' }} aria-label="Learned Facts">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.bgSurface}` }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Learned Facts</span>
            <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(147,197,253,0.15)', padding: '4px 10px', borderRadius: 12, color: '#93c5fd' }}>{memoryFacts.length}</span>
          </div>
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
            {memoryFacts.length === 0 ? (
              <div style={{ padding: '32px 20px', fontSize: 13, color: T.textMuted, textAlign: 'center' }}>Facts appear as Astra learns from your conversations</div>
            ) : memoryFacts.slice(0, 15).map((fact, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.borderSubtle}` }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: T.accentCyan, marginTop: 5, flexShrink: 0 }} />
                <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.5 }}>{fact.content || fact.text || JSON.stringify(fact).slice(0, 120)}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Episodes */}
        <section style={{ borderRadius: 16, background: T.bgCard, backdropFilter: 'blur(16px)', border: `1px solid ${T.border}`, overflow: 'hidden' }} aria-label="Session Episodes">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.bgSurface}` }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Session Episodes</span>
            <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(147,197,253,0.15)', padding: '4px 10px', borderRadius: 12, color: '#93c5fd' }}>{memoryEpisodes.length}</span>
          </div>
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
            {memoryEpisodes.length === 0 ? (
              <div style={{ padding: '32px 20px', fontSize: 13, color: T.textMuted, textAlign: 'center' }}>Episodes are created after each voice session</div>
            ) : memoryEpisodes.map((ep, i) => (
              <div key={i} style={{ padding: 12, borderRadius: 10, background: T.bgSurface, border: `1px solid ${T.borderSubtle}` }}>
                <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, marginBottom: 8 }}>
                  {ep.timestamp ? new Date(typeof ep.timestamp === 'number' ? ep.timestamp * 1000 : ep.timestamp).toLocaleString() : 'Recent'}
                </div>
                <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.5 }}>
                  {ep.summary || ep.content || JSON.stringify(ep).slice(0, 200)}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Events Timeline */}
      <section style={{ borderRadius: 16, background: T.bgCard, backdropFilter: 'blur(16px)', border: `1px solid ${T.border}`, overflow: 'hidden', marginTop: 16 }} aria-label="Recent Events">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.bgSurface}` }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recent Events</span>
          <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(147,197,253,0.15)', padding: '4px 10px', borderRadius: 12, color: '#93c5fd' }}>{memoryEvents.length}</span>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
          {memoryEvents.length === 0 ? (
            <div style={{ padding: '32px 20px', fontSize: 13, color: T.textMuted, textAlign: 'center' }}>Events track every interaction across sessions</div>
          ) : memoryEvents.slice(0, 15).map((evt, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '4px 0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16, flexShrink: 0 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.accentPurple, flexShrink: 0 }} />
                {i < memoryEvents.length - 1 && <div style={{ width: 2, flex: 1, background: T.borderSubtle, marginTop: 4 }} />}
              </div>
              <div style={{ flex: 1, paddingBottom: 12 }}>
                <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.4 }}>
                  {evt.content || evt.text || (evt.parts && evt.parts[0]?.text) || JSON.stringify(evt).slice(0, 150)}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {evt.author && <span style={{ fontSize: 10, color: T.accentCyan, fontWeight: 600 }}>{evt.author}</span>}
                  {evt.timestamp && <span style={{ fontSize: 10, color: T.textMuted }}>{new Date(typeof evt.timestamp === 'number' ? evt.timestamp * 1000 : evt.timestamp).toLocaleString()}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Insights */}
      <section style={{ borderRadius: 16, background: T.bgCard, backdropFilter: 'blur(16px)', border: `1px solid ${T.border}`, overflow: 'hidden', marginTop: 16 }} aria-label="Active Insights">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.bgSurface}` }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Active Insights</span>
          <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(147,197,253,0.15)', padding: '4px 10px', borderRadius: 12, color: '#93c5fd' }}>{insights.length}</span>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
          {insights.length === 0 ? (
            <div style={{ padding: '32px 20px', fontSize: 13, color: T.textMuted, textAlign: 'center' }}>Insights are extracted from emails and conversations</div>
          ) : insights.slice(0, 10).map((ins, i) => {
            const typeColor = ins.type === 'commitment' ? '#3b82f6' : ins.type === 'risk' ? T.danger : ins.type === 'decision' ? T.accentPurple : T.success
            const typeBg = ins.type === 'commitment' ? 'rgba(59,130,246,0.15)' : ins.type === 'risk' ? T.dangerSoft : ins.type === 'decision' ? 'rgba(139,92,246,0.15)' : T.successSoft
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '4px 10px', borderRadius: 6, textTransform: 'uppercase', flexShrink: 0, background: typeBg, color: typeColor }}>{ins.type}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: T.textSecondary }}>{ins.content?.slice(0, 100)}</div>
                  {ins.confidence && (
                    <div style={{ height: 4, borderRadius: 2, background: T.borderSubtle, overflow: 'hidden', marginTop: 6 }}>
                      <div style={{ height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)', width: `${ins.confidence * 100}%` }} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
