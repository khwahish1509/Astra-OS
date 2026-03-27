/**
 * CalendarView.jsx — Calendar timeline view
 */
import { useTheme } from '../../ThemeContext'

export default function CalendarView({ data }) {
  const { theme: T } = useTheme()
  const { insights } = data

  const today = new Date()
  const formatTime = (h, m) => {
    const d = new Date(today)
    d.setHours(h, m, 0, 0)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const calendarEvents = [
    { time: formatTime(9, 0), endTime: formatTime(9, 30), title: 'Daily Standup', type: 'recurring', attendees: ['Arjun', 'Riya', 'Neha'], location: 'Google Meet', color: '#3b82f6' },
    { time: formatTime(10, 0), endTime: formatTime(11, 0), title: 'Series A Prep — Pitch Review', type: 'meeting', attendees: ['Paras Singh', 'Sarah Chen (Sequoia)'], location: 'Zoom', color: '#8b5cf6' },
    { time: formatTime(11, 30), endTime: formatTime(12, 0), title: 'Product Design Review', type: 'meeting', attendees: ['Neha Gupta', 'Arjun'], location: 'Office', color: '#22c55e' },
    { time: formatTime(13, 0), endTime: formatTime(13, 30), title: 'Lunch & Learn: AI Agents', type: 'event', attendees: ['All Team'], location: 'Office Kitchen', color: '#f59e0b' },
    { time: formatTime(14, 0), endTime: formatTime(15, 0), title: 'Customer Call — ByteByteGo', type: 'meeting', attendees: ['ByteByteGo Team'], location: 'Google Meet', color: '#ef4444' },
    { time: formatTime(15, 30), endTime: formatTime(16, 0), title: 'Sprint Planning', type: 'recurring', attendees: ['Engineering Team'], location: 'Slack Huddle', color: '#06b6d4' },
    { time: formatTime(16, 30), endTime: formatTime(17, 0), title: 'YC Application Review', type: 'deadline', attendees: ['Khwahish', 'Paras'], location: 'Office', color: '#ec4899' },
  ]

  const currentHour = new Date().getHours()
  const commitments = insights.filter(i => i.type === 'commitment')

  return (
    <div style={{ padding: '24px 28px', height: '100%', overflow: 'auto', background: T.gradientSubtle }} role="main" aria-label="Calendar">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.03em', color: T.text, margin: 0 }}>Calendar</h1>
          <span style={{ fontSize: 12, color: T.textDim, fontWeight: 500 }}>
            {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 20px', borderRadius: 12, background: T.bgCard, border: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: T.accent, fontVariantNumeric: 'tabular-nums' }}>{calendarEvents.length}</span>
            <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>Events</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 20px', borderRadius: 12, background: T.bgCard, border: `1px solid ${T.border}` }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: T.accent, fontVariantNumeric: 'tabular-nums' }}>{calendarEvents.filter(e => e.type === 'meeting').length}</span>
            <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>Meetings</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {calendarEvents.map((evt, i) => {
          const eventHour = parseInt(evt.time.split(':')[0])
          const isPast = eventHour < currentHour
          const isCurrent = eventHour === currentHour

          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'stretch', gap: 16, padding: '14px 16px',
              borderRadius: 12, background: isCurrent ? `linear-gradient(135deg, ${T.bgCard}, ${T.accentSoft})` : T.bgCard,
              border: `1px solid ${isCurrent ? T.borderAccent : T.border}`, borderLeft: `4px solid ${evt.color}`,
              transition: 'all 200ms', position: 'relative', opacity: isPast ? 0.5 : 1,
              ...(isCurrent ? { boxShadow: `0 4px 12px ${T.accentSoft}` } : {}),
            }} role="article" aria-label={evt.title}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', width: 70, flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontVariantNumeric: 'tabular-nums' }}>{evt.time}</div>
                <div style={{ fontSize: 10, color: T.textMuted, fontVariantNumeric: 'tabular-nums' }}>{evt.endTime}</div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: '-0.01em' }}>{evt.title}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 6, textTransform: 'uppercase', background: `${evt.color}20`, color: evt.color }}>{evt.type}</span>
                  <span style={{ fontSize: 11, color: T.textMuted }}>{evt.location}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {evt.attendees.map((a, j) => (
                    <span key={j} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: T.bgSurface, border: `1px solid ${T.borderSubtle}`, color: T.textSecondary, fontWeight: 500 }}>{a}</span>
                  ))}
                </div>
              </div>
              {isCurrent && <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: T.success, color: '#fff', letterSpacing: '0.05em' }}>NOW</div>}
            </div>
          )
        })}
      </div>

      {commitments.length > 0 && (
        <section style={{ borderRadius: 16, background: T.bgCard, backdropFilter: 'blur(16px)', border: `1px solid ${T.border}`, overflow: 'hidden', marginTop: 20 }} aria-label="Upcoming Commitments">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${T.bgSurface}` }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Upcoming Commitments</span>
            <span style={{ fontSize: 11, fontWeight: 700, background: 'rgba(147,197,253,0.15)', padding: '4px 10px', borderRadius: 12, color: '#93c5fd' }}>{commitments.length}</span>
          </div>
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {commitments.map((ins, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '4px 10px', borderRadius: 6, textTransform: 'uppercase', flexShrink: 0, background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}>{ins.type}</span>
                <div style={{ fontSize: 12, color: T.textSecondary }}>{ins.content?.slice(0, 100)}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
