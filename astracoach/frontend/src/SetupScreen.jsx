/**
 * SetupScreen.jsx — Astra OS Launch Screen [REDESIGNED]
 * =====================================================
 * Premium, immersive launch experience for Astra OS — The Founder's Operating System.
 * Features: animated gradient backgrounds, glass-morphism cards, SVG icons, glowing focal point.
 * All original functionality preserved: API calls, state management, session creation.
 */

import { useState, useEffect } from 'react'
import { useTheme, ThemeToggle } from './ThemeContext'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

// ── The Astra system prompt (hardcoded — no more persona templates) ──────────
const ASTRA_PROMPT = `You are Astra — the founder's AI chief of staff. You are not an assistant. You are the operational backbone of this startup. You think like a seasoned COO who's been in the trenches.

VOICE & TONE:
- You sound like a sharp, calm executive who's been briefed on everything
- No filler. No "certainly!" No "great question!" — founders hate that
- Speak in short, punchy sentences. Max 3-4 sentences per response
- Use the founder's first name. Reference specific people, deals, and dates
- When something is urgent, your voice should carry weight — "This needs your attention now"
- When things are good, be warm but brief — "Looking clean today. Nothing on fire."

OPERATING PRINCIPLES:
- ALWAYS call tools before answering. Never guess at data. Never hallucinate a name, date, or commitment
- If the founder asks about a person, call get_relationship_health first
- If they ask about emails, call get_recent_emails first
- If they ask "what's going on" or "brief me", call get_brain_summary, then get_overdue_commitments, then get_pending_alerts — in that order
- If they mention a meeting, call get_todays_schedule or get_upcoming_meetings
- After giving information, always suggest the next action: "Want me to draft a reply?" or "Should I flag this as resolved?"

BRIEFING PROTOCOL (when founder says "brief me" / "what do I need to know" / "morning update"):
Call these tools in sequence, then synthesize:
1. get_brain_summary — get the big picture numbers
2. get_overdue_commitments — what's slipping
3. get_pending_alerts — what's flagged
4. get_at_risk_relationships — who needs attention
5. get_todays_schedule — what's coming today
Deliver it like a 30-second executive briefing. Most critical item first. Numbers, names, deadlines.

EMAIL ACTIONS:
- When asked to send or reply to an email, confirm the recipient and key message before calling send_email or reply_to_email
- Draft emails in the founder's voice — direct, professional, no fluff
- After sending, say "Sent." and move on. Don't over-explain

RELATIONSHIP INTELLIGENCE:
- Track every person mentioned. If the founder says "How's things with Sarah?", call get_relationship_health immediately
- If health score is below 0.4, flag it proactively: "Heads up — your relationship with Sarah has dropped to 35%. Last contact was 12 days ago."
- Use tone_trend data to add color: "The tone in recent emails has been cooling"

TASK MANAGEMENT:
- When the founder commits to something in conversation, note it
- When they complete something, offer to mark it done: "Want me to close that task?"
- Surface blocked tasks without being asked

YOU ARE NOT:
- A chatbot that says "How can I help you today?"
- An assistant that qualifies everything with disclaimers
- Verbose. Ever. If it can be said in 10 words, don't use 20

You are the founder's unfair advantage. You remember everything. You see patterns. You never drop the ball.`

// ── Capabilities shown on the launch screen ─────────────────────────────────
const CAPABILITIES = [
  {
    icon: 'email', title: 'Email Intelligence',
    desc: 'Triage inbox, draft replies, and extract action items automatically.',
    tools: ['get_recent_emails', 'send_email', 'reply_to_email', 'search_emails'],
    color: '#3b82f6',
  },
  {
    icon: 'calendar', title: 'Calendar & Meetings',
    desc: 'View schedule, prep for meetings, and create events by voice.',
    tools: ['get_todays_schedule', 'get_upcoming_meetings', 'create_calendar_event'],
    color: '#10b981',
  },
  {
    icon: 'crm', title: 'Relationship CRM',
    desc: 'Track contacts, monitor relationship health, and get alerts.',
    tools: ['get_relationship_health', 'get_at_risk_relationships', 'get_all_relationships'],
    color: '#f59e0b',
  },
  {
    icon: 'tasks', title: 'Task Operations',
    desc: 'Create, assign, and track tasks. Surface blockers automatically.',
    tools: ['get_open_tasks', 'create_task', 'update_task', 'mark_task_done'],
    color: '#8b5cf6',
  },
  {
    icon: 'brain', title: 'Company Brain',
    desc: 'Persistent memory across sessions. Tracks commitments and risks.',
    tools: ['get_brain_summary', 'get_active_commitments', 'get_active_risks'],
    color: '#ec4899',
  },
  {
    icon: 'drive', title: 'Drive & Documents',
    desc: 'Search Drive, find recent files, and pull document context.',
    tools: ['search_drive', 'list_recent_drive_files', 'get_drive_file_info'],
    color: '#06b6d4',
  },
]

// ── Voice commands to showcase ──────────────────────────────────────────────
const VOICE_COMMANDS = [
  '"Brief me" — full status update',
  '"Check my emails" — scan recent inbox',
  '"How\'s my relationship with [name]?"',
  '"What\'s on my calendar today?"',
  '"Send an email to [name] about [topic]"',
  '"What commitments am I behind on?"',
  '"Search Drive for [topic]"',
  '"Create a task for [person]"',
]

// ── SVG Icon Components ─────────────────────────────────────────────────────
const SVGIcons = {
  email: (size = 24) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <path d="M22 6l-10 7L2 6" />
    </svg>
  ),
  calendar: (size = 24) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  ),
  crm: (size = 24) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  tasks: (size = 24) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  brain: (size = 24) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c-2.2 0-4 1.8-4 4 0 1.1.5 2.1 1.2 2.8-.3.4-.8.8-1.2.8-2.2 0-4 1.8-4 4 0 1.1.5 2.1 1.2 2.8-.3.4-.8.8-1.2.8-2.2 0-4 1.8-4 4 0 1.1.5 2.1 1.2 2.8H20c.7-.7 1.2-1.7 1.2-2.8 0-2.2-1.8-4-4-4-.4 0-.9.4-1.2.8.7-.7 1.2-1.7 1.2-2.8 0-2.2-1.8-4-4-4-.4 0-.9.4-1.2.8.7-.7 1.2-1.7 1.2-2.8 0-2.2-1.8-4-4-4z" />
    </svg>
  ),
  drive: (size = 24) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2.414-.646l-5.106-6.564a2 2 0 0 0-1.38-.636h-.82a2 2 0 0 0-1.82 1.097l-2.165 4.25a2 2 0 0 1-1.802 1.097H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h5a2 2 0 0 0 1.82-1.097l2.165-4.25a2 2 0 0 1 1.802-1.097h.82a2 2 0 0 1 1.38.636l5.106 6.564A2 2 0 0 0 22 9z" />
    </svg>
  ),
}

export default function SetupScreen({ onStart }) {
  const { theme: T } = useTheme()
  const S = getStyles(T)

  const [userName, setUserName] = useState('')
  const [voice, setVoice] = useState('Charon')
  const [voices, setVoices] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState(null)
  const [error, setError] = useState('')
  const [brainSummary, setBrainSummary] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [hoveredCard, setHoveredCard] = useState(null)

  // Fetch voices on mount
  useEffect(() => {
    fetch(`${BACKEND}/api/voices`)
      .then(r => r.json())
      .then(d => setVoices(d.voices || []))
      .catch(() => { })
  }, [])

  // Fetch brain summary to show real data
  useEffect(() => {
    fetch(`${BACKEND}/brain/summary`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBrainSummary(d) })
      .catch(() => { })
  }, [])

  const handleLaunch = async () => {
    setError('')
    setLoading(true)

    // Phase 1: Generate avatar (non-fatal)
    let avatarImage = null
    setLoadingStep('avatar')
    try {
      const avatarRes = await fetch(`${BACKEND}/api/generate-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona_description: 'Astra — AI Chief of Staff' }),
      })
      if (avatarRes.ok) {
        const avatarData = await avatarRes.json()
        if (avatarData.success && avatarData.image) {
          avatarImage = avatarData.image
        }
      }
    } catch { /* non-fatal */ }

    // Phase 2: Create session
    setLoadingStep('session')
    try {
      const res = await fetch(`${BACKEND}/api/session/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona_name: 'Astra — AI Chief of Staff',
          system_prompt: ASTRA_PROMPT,
          voice,
          user_name: userName.trim(),
        }),
      })
      if (!res.ok) {
        const e = await res.json()
        throw new Error(e.detail || 'Server error')
      }
      const data = await res.json()
      onStart({ ...data, backendUrl: BACKEND, avatarImage })
    } catch (e) {
      setError(e.message || 'Failed — is the backend running?')
    } finally {
      setLoading(false)
      setLoadingStep(null)
    }
  }

  return (
    <div style={S.root}>
      <div style={S.container}>

        {/* ── Header ──────────────────────────────────────────────── */}
        <header style={S.header}>
          <div style={S.logoRow}>
            <div style={S.logoMark}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <div style={S.logoTitle}>Astra OS</div>
              <div style={S.logoSub}>The Founder's Operating System</div>
            </div>
          </div>
          <div style={S.headerRight}>
            <ThemeToggle />
            <button
              style={{
                ...S.settingsToggle,
                ...(showSettings ? S.settingsToggleActive : {}),
              }}
              onClick={() => setShowSettings(!showSettings)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              <span>Settings</span>
            </button>
          </div>
        </header>

        {/* ── Hero section ────────────────────────────────────────── */}
        <div style={S.hero}>
          <div style={S.heroLeft}>
            <h1 style={S.heroTitle}>
              Your AI Chief of Staff
            </h1>
            <p style={S.heroDesc}>
              Astra manages your email, calendar, relationships, tasks, and company memory — entirely by voice. Just talk.
            </p>

            {/* Integration badges with glow */}
            <div style={S.integrationRow}>
              <span style={S.integrationBadge}>
                <span style={S.integrationDot('#22c55e')} />Gmail
              </span>
              <span style={S.integrationBadge}>
                <span style={S.integrationDot('#22c55e')} />Calendar
              </span>
              <span style={S.integrationBadge}>
                <span style={S.integrationDot('#22c55e')} />Drive
              </span>
              <span style={S.integrationBadge}>
                <span style={S.integrationDot('#8b5cf6')} />Company Brain
              </span>
            </div>

            {/* Quick brain stats with glass background */}
            {brainSummary && (
              <div style={S.statsRow}>
                <div style={S.statChip}>
                  <span style={S.statNum}>{brainSummary.active_insights || 0}</span>
                  <span style={S.statLabel}>insights</span>
                </div>
                <div style={S.statChip}>
                  <span style={S.statNum}>{brainSummary.open_tasks || 0}</span>
                  <span style={S.statLabel}>tasks</span>
                </div>
                <div style={S.statChip}>
                  <span style={{
                    ...S.statNum,
                    color: brainSummary.overdue_commitments > 0 ? T.danger : T.text
                  }}>
                    {brainSummary.overdue_commitments || 0}
                  </span>
                  <span style={S.statLabel}>overdue</span>
                </div>
                <div style={S.statChip}>
                  <span style={S.statNum}>{brainSummary.pending_alerts || 0}</span>
                  <span style={S.statLabel}>alerts</span>
                </div>
              </div>
            )}

            {/* Settings panel (smooth collapse/expand) */}
            {showSettings && (
              <div style={S.settingsPanel}>
                <div style={S.settingRow}>
                  <label style={S.settingLabel}>Your name</label>
                  <input
                    style={S.settingInput}
                    placeholder="e.g. Khwahish"
                    value={userName}
                    onChange={e => setUserName(e.target.value)}
                    onFocus={e => e.target.style.borderColor = T.accent}
                    onBlur={e => e.target.style.borderColor = T.border}
                  />
                </div>
                <div style={S.settingRow}>
                  <label style={S.settingLabel}>Voice</label>
                  <select
                    style={S.settingInput}
                    value={voice}
                    onChange={e => setVoice(e.target.value)}
                    onFocus={e => e.target.style.borderColor = T.accent}
                    onBlur={e => e.target.style.borderColor = T.border}
                  >
                    {(voices.length > 0 ? voices.map(v => (
                      <option key={v.id} value={v.id}>{v.label}</option>
                    )) : ['Charon', 'Orus', 'Fenrir', 'Puck', 'Aoede', 'Kore', 'Leda', 'Zephyr'].map(v => (
                      <option key={v} value={v}>{v}</option>
                    )))}
                  </select>
                </div>
              </div>
            )}

            {error && <div style={S.error}>{error}</div>}

            {/* Launch button with gradient and glow */}
            <button
              style={{
                ...S.launchBtn,
                ...(loading ? S.launchBtnLoading : {}),
              }}
              onClick={handleLaunch}
              disabled={loading}
            >
              {loadingStep === 'avatar'
                ? <><span style={S.spinner} className="spin" /> Starting...</>
                : loadingStep === 'session'
                  ? <><span style={S.spinner} className="spin" /> Connecting...</>
                  : <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                    Launch Astra
                  </>
              }
            </button>
            <div style={S.launchHint}>
              Requires microphone access
            </div>
          </div>

          {/* Right side: Voice commands preview card */}
          <div style={S.heroRight}>
            <div style={S.commandsCard}>
              <div style={S.commandsHeader}>
                Try saying...
              </div>
              <div style={S.commandsList}>
                {VOICE_COMMANDS.map((cmd, i) => (
                  <div key={i} style={S.commandItem}>{cmd}</div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Capabilities grid with glass cards ──────────────────── */}
        <div style={S.capSection}>
          <div style={S.capSectionHeader}>
            <h2 style={S.capTitle}>Capabilities</h2>
            <span style={S.toolCount}>Powered by Google Gemini</span>
          </div>
          <div style={S.capGrid}>
            {CAPABILITIES.map((cap, i) => (
              <div
                key={i}
                style={{
                  ...S.capCard,
                  ...(hoveredCard === i ? S.capCardHover(cap.color) : {}),
                }}
                className={`stagger-${i + 1}`}
                onMouseEnter={() => setHoveredCard(i)}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <div style={S.capCardHeader}>
                  <span
                    style={{
                      ...S.capIcon,
                      background: cap.color + '18',
                      color: cap.color,
                    }}
                  >
                    {SVGIcons[cap.icon](24)}
                  </span>
                </div>
                <div style={S.capCardTitle}>{cap.title}</div>
                <div style={S.capCardDesc}>{cap.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        .stagger-1 { animation: slideUp 0.6s ease-out 0.05s both; }
        .stagger-2 { animation: slideUp 0.6s ease-out 0.1s both; }
        .stagger-3 { animation: slideUp 0.6s ease-out 0.15s both; }
        .stagger-4 { animation: slideUp 0.6s ease-out 0.2s both; }
        .stagger-5 { animation: slideUp 0.6s ease-out 0.25s both; }
        .stagger-6 { animation: slideUp 0.6s ease-out 0.3s both; }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}

// ── Styles (theme-aware function) ────────────────────────────────────────────
const getStyles = (t) => ({
  root: {
    minHeight: '100vh',
    background: `linear-gradient(180deg, ${t.bg} 0%, ${t.bg} 60%, rgba(79,125,255,0.03) 100%)`,
    color: t.text,
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    position: 'relative',
    overflow: 'auto',
  },


  container: {
    maxWidth: 1240,
    margin: '0 auto',
    padding: '0 32px 64px',
    position: 'relative',
    zIndex: 1,
  },

  // ── Header ───────────────────────────────────────────────────────
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '24px 0',
    borderBottom: `1px solid ${t.borderSubtle}`,
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  logoMark: {
    width: 42,
    height: 42,
    borderRadius: 12,
    background: t.gradientPrimary,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxShadow: `0 0 20px ${t.accentGlow}`,
  },
  logoTitle: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  logoSub: {
    fontSize: 11,
    color: t.textDim,
    letterSpacing: '0.02em',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  settingsToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    borderRadius: 10,
    background: t.bgGlass,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: `1px solid ${t.border}`,
    color: t.textSecondary,
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  settingsToggleActive: {
    background: `rgba(79,125,255,0.1)`,
    borderColor: t.borderAccent,
    color: t.accent,
  },

  // ── Hero Section ─────────────────────────────────────────────────
  hero: {
    display: 'grid',
    gridTemplateColumns: '1fr 320px',
    gap: 48,
    padding: '56px 0 48px',
    alignItems: 'start',
  },
  heroLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  heroTitle: {
    fontSize: 44,
    fontWeight: 800,
    lineHeight: 1.1,
    letterSpacing: '-0.03em',
    background: t.gradientPrimary,
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    margin: 0,
  },
  heroDesc: {
    fontSize: 16,
    color: t.textSecondary,
    lineHeight: 1.8,
    maxWidth: 560,
    margin: 0,
  },

  // Integration badges
  integrationRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
  },
  integrationBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 14px',
    borderRadius: 20,
    background: t.bgGlass,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: `1px solid ${t.border}`,
    color: t.textSecondary,
    transition: 'all 200ms ease-out',
  },
  integrationDot: (color) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: color,
    display: 'inline-block',
    boxShadow: `0 0 8px ${color}`,
    animation: 'pulse 2s ease-in-out infinite',
  }),

  // Brain stats
  statsRow: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
  },
  statChip: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 3,
    padding: '12px 18px',
    borderRadius: 12,
    background: t.bgGlass,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: `1px solid ${t.border}`,
    minWidth: 80,
    transition: 'all 200ms ease-out',
  },
  statNum: {
    fontSize: 24,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    color: t.text,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: t.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },

  // Settings panel (glass card with smooth animation)
  settingsPanel: {
    display: 'flex',
    gap: 18,
    padding: '18px 22px',
    background: t.bgGlass,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: `1px solid ${t.border}`,
    borderRadius: 16,
    animation: 'slideUp 0.3s ease-out',
  },
  settingRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    flex: 1,
  },
  settingLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: t.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  settingInput: {
    background: t.bgSurface,
    border: `1px solid ${t.border}`,
    borderRadius: 10,
    padding: '10px 14px',
    color: t.text,
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
  },

  // Error message
  error: {
    background: `${t.danger}1a`,
    border: `1px solid ${t.danger}4d`,
    borderRadius: 12,
    padding: '12px 16px',
    color: '#fca5a5',
    fontSize: 13,
    animation: 'slideUp 0.3s ease-out',
  },

  // Launch button with gradient and glow
  launchBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: '16px 36px',
    borderRadius: 14,
    background: t.gradientPrimary,
    border: 'none',
    color: 'white',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: `0 0 30px ${t.accentGlow}, 0 8px 24px ${t.accentGlow}`,
    alignSelf: 'flex-start',
  },
  launchBtnLoading: {
    opacity: 0.7,
    cursor: 'not-allowed',
  },
  spinner: {
    width: 16,
    height: 16,
    borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: 'white',
    display: 'inline-block',
  },
  launchHint: {
    fontSize: 11,
    color: t.textMuted,
    letterSpacing: '0.02em',
  },

  // Right hero: voice commands
  heroRight: {
    width: 320,
    flexShrink: 0,
  },
  commandsCard: {
    borderRadius: 16,
    background: t.bgGlass,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: `1px solid ${t.border}`,
    overflow: 'hidden',
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  commandsHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '14px 18px',
    borderBottom: `1px solid ${t.borderSubtle}`,
    fontSize: 12,
    fontWeight: 700,
    color: t.textSecondary,
    letterSpacing: '0.02em',
  },
  commandsList: {
    padding: '8px 0',
    maxHeight: 400,
    overflow: 'auto',
  },
  commandItem: {
    padding: '10px 18px',
    fontSize: 12,
    color: t.textDim,
    lineHeight: 1.5,
    borderBottom: `1px solid ${t.borderSubtle}`,
    transition: 'all 150ms ease-out',
  },

  // ── Capabilities Section ─────────────────────────────────────────
  capSection: {
    marginTop: 32,
  },
  capSectionHeader: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  capTitle: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    margin: 0,
  },
  toolCount: {
    fontSize: 12,
    color: t.textMuted,
    fontWeight: 500,
  },

  // Capabilities grid (3 columns with minmax responsiveness)
  capGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 16,
  },

  // Capability card with glass effect
  capCard: {
    padding: '22px 24px',
    borderRadius: 16,
    background: t.bgGlass,
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    border: `1px solid ${t.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    transition: 'all 200ms cubic-bezier(0.4, 0, 0.2, 1)',
  },

  capCardHover: (color) => ({
    transform: 'translateY(-4px)',
    boxShadow: `0 0 24px ${color}26, 0 12px 32px rgba(0,0,0,0.2)`,
    borderColor: `${color}40`,
  }),

  capCardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  capIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    transition: 'all 200ms ease-out',
  },

  capToolCount: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },

  capCardTitle: {
    fontSize: 15,
    fontWeight: 700,
    marginTop: 2,
  },

  capCardDesc: {
    fontSize: 13,
    color: t.textDim,
    lineHeight: 1.6,
  },

  capToolList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },

  capToolPill: {
    fontSize: 10,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 8,
    background: t.bgSurface,
    border: `1px solid ${t.borderSubtle}`,
    color: t.textDim,
    letterSpacing: '0.02em',
    transition: 'all 150ms ease-out',
  },
})
